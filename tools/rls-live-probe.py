#!/usr/bin/env python3
"""Is RLS actually APPLIED to the live database, or only written in a .sql file?

The anon key ships inside the browser bundle by design, so it is public. That
is exactly why this test is legitimate and why it matters: anyone who loads the
site has this key. If RLS is not applied, that key reads every row.

This pulls the anon key the same way a visitor's browser does, from the live
JS bundle, and asks PostgREST for rows as an unauthenticated caller.

Expected if RLS is ON : every table returns [] or a 401/permission error.
Expected if RLS is OFF: real rows come back, which is a live data leak.

Read-only. No writes, ever. No service key is read or used.
"""
import json, re, ssl, urllib.request, urllib.error

BASE = "https://studio.pentinian.com"
TABLES = ["clients", "projects", "questions", "sessions", "site_config",
          "work_log_raw", "work_log_released", "comments"]

ctx = ssl.create_default_context()

def get(url, headers=None, timeout=25):
    req = urllib.request.Request(url, headers=headers or {})
    try:
        with urllib.request.urlopen(req, context=ctx, timeout=timeout) as r:
            return r.status, r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")
    except Exception as e:
        return None, f"{type(e).__name__}: {e}"

# 1. find the anon key and project url the way the browser gets them
status, html = get(BASE + "/login")
scripts = re.findall(r'src="(/_next/static/[^"]+\.js)"', html)
anon, supa = None, None
for s in scripts[:40]:
    _, js = get(BASE + s)
    if not anon:
        m = re.search(r'"(eyJ[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+)"', js)
        if m:
            anon = m.group(1)
    if not supa:
        m = re.search(r'"(https://[a-z0-9]+\.supabase\.co)"', js)
        if m:
            supa = m.group(1)
    if anon and supa:
        break

out = {"found_anon_key_in_bundle": bool(anon), "supabase_url_found": bool(supa),
       "scripts_scanned": min(len(scripts), 40)}

if not (anon and supa):
    out["verdict"] = "could not extract the public anon key from the bundle; inconclusive"
    print(json.dumps(out, indent=2)); raise SystemExit(0)

# never print the key itself
out["anon_key_fingerprint"] = anon[:12] + "..." + anon[-6:]

hdr = {"apikey": anon, "Authorization": f"Bearer {anon}", "Accept": "application/json"}
rows = {}
leaked = []
for t in TABLES:
    code, body = get(f"{supa}/rest/v1/{t}?select=*&limit=3", hdr)
    try:
        parsed = json.loads(body)
    except Exception:
        parsed = body
    n = len(parsed) if isinstance(parsed, list) else None
    rows[t] = {"status": code,
               "rows_returned": n,
               "note": (parsed.get("message") if isinstance(parsed, dict) else None)}
    if isinstance(parsed, list) and parsed:
        leaked.append(t)
        rows[t]["sample_keys"] = sorted(parsed[0].keys())[:8]

out["tables"] = rows
out["tables_leaking_rows_to_anon"] = leaked
out["verdict"] = ("RLS IS APPLIED: anon reads nothing" if not leaked
                  else f"LEAK: anon reads rows from {leaked}")
print(json.dumps(out, indent=2))
