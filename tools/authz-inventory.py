#!/usr/bin/env python3
"""Inventory the LIVE authorization walls, table by table, before building anything.

  set -a; source .env.local; set +a
  python3 tools/authz-inventory.py

Why this exists, and why it is not tools/rls-live-probe.py:

  rls-live-probe.py asks one question, "can a logged-out visitor read rows",
  and answers it correctly. Its verdict string then says "RLS IS APPLIED",
  which is more than it measured. Every table answered 401 with Postgres
  42501, "permission denied for table". That is a GRANT refusal, raised
  before any policy is consulted. Row Level Security does not refuse, it
  FILTERS: a caller who holds the grant and matches no policy gets 200 with
  an empty array. So a wall built entirely out of `revoke all from anon`
  produces exactly the readings that probe calls proof of RLS, and would
  produce them with RLS switched off on every table.

  That matters because anon is not the caller this app fears. A real client
  signs in and becomes `authenticated`, a role the migrations do NOT revoke
  from clients, projects, work_log_released, sessions or questions. For
  those tables RLS is not the second line, it is the only line.

So this asks all three callers the same question and reports which mechanism
answered, rather than that something did:

  anon           logged out, the key in the browser bundle
  authenticated  a real signed-in user who owns NOTHING (no clients row)
  service_role   the bypass, used read-only here to count what exists

Reading each answer:

  401 / 42501           the grant wall. RLS state unknown and unneeded.
  200 []                the grant is held and RLS filtered it to nothing.
                        This is the only reading that proves RLS is live.
  200 with rows         the caller reads real data. For the orphan user
                        that is a LEAK, and it is the finding.

The orphan user is the instrument. Holding a session and owning no project,
every row they can see is a row they should not have. Created on the
@pentinian.test domain the other verifiers use, deleted in the finally
block, and scripts/leftovers.mjs confirms it afterwards.

Read-only against every existing row. The only writes are the throwaway
user, and its deletion.
"""
import json, os, ssl, sys, time, urllib.error, urllib.request

U = os.environ.get("NEXT_PUBLIC_SUPABASE_URL", "").strip()
A = os.environ.get("NEXT_PUBLIC_SUPABASE_ANON_KEY", "").strip()
S = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "").strip()
if not (U and A and S):
    sys.exit("Missing env. Run: set -a; source .env.local; set +a")

# Every table the hardening row names, plus the ones that sit beside them and
# would be the next thing an attacker tried. Listed explicitly rather than
# discovered, so a new table added without a policy shows up as a diff here.
TABLES = [
    "clients", "projects", "work_log_raw", "work_log_released",
    "sessions", "questions", "site_config", "comments",
    "project_notes", "brain_entries", "access_requests",
    "mail_ledger", "system_events",
]
VIEWS = ["work_days", "window_brain"]

ctx = ssl.create_default_context()


def call(method, url, headers=None, body=None, timeout=30):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method,
                                 headers=headers or {})
    try:
        with urllib.request.urlopen(req, context=ctx, timeout=timeout) as r:
            return r.status, r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")
    except Exception as e:                                # noqa: BLE001
        return None, "%s: %s" % (type(e).__name__, e)


def hdr(key, jwt=None):
    return {"apikey": key, "Authorization": "Bearer " + (jwt or key),
            "Accept": "application/json", "Content-Type": "application/json"}


def read(rel, key, jwt=None):
    """Select up to 3 rows and classify what the wall did."""
    code, body = call("GET", "%s/rest/v1/%s?select=*&limit=3" % (U, rel),
                      hdr(key, jwt))
    try:
        parsed = json.loads(body)
    except Exception:                                     # noqa: BLE001
        parsed = body
    pgcode = parsed.get("code") if isinstance(parsed, dict) else None
    if isinstance(parsed, list):
        return {"status": code, "rows": len(parsed),
                "wall": "NONE (rows returned)" if parsed else "rls_filtered_to_empty",
                "pg": None}
    return {"status": code, "rows": None,
            "wall": "grant_denied" if pgcode == "42501" else "error",
            "pg": pgcode,
            "msg": (parsed.get("message") if isinstance(parsed, dict) else str(parsed))[:70]}


def count(rel):
    """Exact row count via PostgREST's Content-Range, without pulling the rows."""
    h = dict(hdr(S))
    h["Prefer"] = "count=exact"
    h["Range"] = "0-0"
    req = urllib.request.Request("%s/rest/v1/%s?select=*" % (U, rel),
                                 method="GET", headers=h)
    try:
        with urllib.request.urlopen(req, context=ctx, timeout=30) as r:
            rng = r.headers.get("Content-Range", "")
            status = r.status
    except urllib.error.HTTPError as e:
        return {"status": e.code, "exists": False, "rows": None}
    except Exception as e:                                # noqa: BLE001
        return {"status": None, "exists": False, "rows": None,
                "err": type(e).__name__}
    total = rng.split("/")[-1] if "/" in rng else None
    return {"status": status, "exists": True,
            "rows": int(total) if (total or "").isdigit() else None}


out: dict = {"checked_at": time.strftime("%Y-%m-%d %H:%M:%S %Z"),
             "project_ref": U.split("//")[-1].split(".")[0],
             "anon_key_fingerprint": A[:10] + "..." + A[-6:]}
made_user = None

try:
    # ---------------------------------------------------- what exists -------
    # Service role, read only. Counting production rows tells us the blast
    # radius of anything that follows, and whether a "no rows leaked" reading
    # further down is meaningful or is just an empty table.
    counts = {}
    for t in TABLES + VIEWS:
        counts[t] = count(t)
    out["tables_exist"] = counts

    # ------------------------------------------------- the orphan user ------
    email = "authz-inventory-%d@pentinian.test" % int(time.time())
    pw = "Aa1!" + os.urandom(12).hex()
    code, body = call("POST", "%s/auth/v1/admin/users" % U, hdr(S),
                      {"email": email, "password": pw, "email_confirm": True})
    if code not in (200, 201):
        raise SystemExit("could not create the orphan user: %s %s" % (code, body[:200]))
    made_user = json.loads(body)["id"]
    out["orphan_user"] = {"email": email, "id": made_user,
                          "owns": "nothing: no clients row, no project"}

    code, body = call("POST", "%s/auth/v1/token?grant_type=password" % U,
                      hdr(A), {"email": email, "password": pw})
    if code != 200:
        raise SystemExit("orphan sign-in failed: %s %s" % (code, body[:200]))
    jwt = json.loads(body)["access_token"]

    # ------------------------------------------------- the three callers ----
    walls = {}
    for t in TABLES + VIEWS:
        walls[t] = {"anon": read(t, A), "authenticated_orphan": read(t, A, jwt)}
    out["walls"] = walls

    # ------------------------------------------------------- the verdict ----
    leaks, rls_proven, grant_only, unknown = [], [], [], []
    for t, w in walls.items():
        a, o = w["anon"], w["authenticated_orphan"]
        if o["rows"]:
            leaks.append(t)
        elif o["wall"] == "rls_filtered_to_empty":
            rls_proven.append(t)
        elif o["wall"] == "grant_denied":
            grant_only.append(t)
        else:
            unknown.append(t)
        if a["rows"]:
            leaks.append(t + " (ANON)")

    out["verdict"] = {
        "leaking_to_a_signed_in_stranger": sorted(set(leaks)),
        "rls_is_the_wall_and_it_holds": sorted(rls_proven),
        "grant_wall_only_rls_state_not_measured_here": sorted(grant_only),
        "unreadable_for_another_reason": sorted(unknown),
    }
    out["summary"] = ("CLEAN: a signed-in stranger reads nothing"
                      if not leaks else "LEAK: %s" % sorted(set(leaks)))

finally:
    if made_user:
        call("DELETE", "%s/auth/v1/admin/users/%s" % (U, made_user), hdr(S))
        out["teardown"] = "orphan user deleted"

print(json.dumps(out, indent=2))
sys.exit(0 if not out.get("verdict", {}).get("leaking_to_a_signed_in_stranger") else 1)
