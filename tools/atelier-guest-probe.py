#!/usr/bin/env python3
"""Prove what protects /atelier and /window from a CLEAN, logged-out browser.

Not from Pen's session. A throwaway Chrome profile, no cookies, no passkey.
This is the only way to see what an outsider sees; the browser_exec harness
drives her real profile and is signed in as admin everywhere.

Checks, in order:
  1. /atelier   logged out  -> expect a redirect to /login (middleware needsSession)
  2. /window    logged out  -> expect a redirect to /login
  3. /no-access logged out  -> reachable, it is excluded from the matcher
  4. /login     logged out  -> reachable, the door itself
  5. /api/me    logged out  -> must NOT return a user
  6. a few /api routes      -> must not leak data without a session

Prints JSON. Nothing here needs or uses a credential.
"""
import sys, json, time
sys.path.insert(0, "/Users/penfinity/Studio/_artinian/tools")
from guest_browser import Guest

BASE = "https://studio.pentinian.com"

def look(g, path, wait=6):
    g.goto(BASE + path, wait=wait)
    return {
        "asked": path,
        "landed": g.eval("location.pathname + location.search"),
        "status_title": g.eval("document.title"),
        "h1": g.eval("(document.querySelector('h1')||{}).textContent || null"),
        "bodyStart": g.eval("document.body.innerText.trim().slice(0,140)"),
        "hasLoginForm": g.eval(
            "!!document.querySelector('input[type=email],input[name=email],form')"),
    }

def api(g, path):
    g.goto(BASE + path, wait=4)
    return {
        "asked": path,
        "landed": g.eval("location.pathname"),
        "body": g.eval("document.body.innerText.trim().slice(0,220)"),
    }

g = Guest()
out = {"base": BASE, "checked_at": time.strftime("%Y-%m-%d %H:%M:%S %Z")}
try:
    out["cookies_at_start"] = g.eval("document.cookie")
    out["pages"] = [look(g, p) for p in ["/atelier", "/window", "/no-access", "/login", "/"]]
    out["apis"] = [api(g, p) for p in ["/api/me", "/api/projects", "/api/people", "/api/health"]]
    out["cookies_at_end"] = g.eval("document.cookie")
finally:
    g.close()

print(json.dumps(out, indent=2))
