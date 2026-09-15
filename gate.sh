#!/usr/bin/env bash
# The Studio app's gate. One command, the way Limicon and UnImpact have one.
#
#   bash gate.sh              types, build, and every verifier
#   bash gate.sh --fast       types and build only, no database
#
# Why this exists: the checks were all here already but spread across twelve
# script names, each needing its env sourced by hand, and two of them silently
# doing nothing useful when it was not. A gate you have to remember how to run
# is a gate that does not get run.
#
# WHAT BIT US, recorded so it does not bite again:
#
#  1. `.env.local` ships `APP=` and `NEXT_PUBLIC_SITE_URL=` EMPTY. The scripts
#     read them with `??`, which keeps an empty string, so sourcing the env file
#     produced fetch('/api/...') with no origin and a thrown URL parse. Running
#     them WITHOUT the env file worked and running them WITH it failed, which is
#     the opposite of what anyone expects. This file sets both explicitly.
#
#  2. `next build` overwrites .next underneath a running `next dev`, after which
#     the dev server serves pages with no JavaScript and browser probes fail for
#     a reason that has nothing to do with the code. So the build runs FIRST and
#     the dev server for the probes is started AFTER it, by this script.
#
#  3. Port 3000 is usually the Limicon dev server on this machine. Reading it
#     and calling the answer Pentinian is a wrong-target measurement, so this
#     pins 3001 and checks what answers there before trusting a single result.

set -uo pipefail
cd "$(dirname "$0")"

PORT="${PORT:-3001}"
APP_URL="http://127.0.0.1:${PORT}"
FAST=0
[[ "${1:-}" == "--fast" ]] && FAST=1

fail=0
step() { printf '\n== %s\n' "$1"; }
report() {
  if [[ "$1" -eq 0 ]]; then printf '   PASS: %s\n' "$2"
  else printf '   FAIL: %s\n' "$2"; fail=1; fi
}

# ---------------------------------------------------------------- fence -----
step "fence: the right repo, the right author"
origin=$(git config --get remote.origin.url)
[[ "$origin" == *Pentinian-Studio* ]]
report $? "origin is Pentinian-Studio ($origin)"
email=$(git config user.email)
[[ "$email" == "308107907+pentinian@users.noreply.github.com" ]]
report $? "commit author is the pentinian noreply ($email)"

# ------------------------------------------------------------------ env -----
step "env"
if [[ ! -f .env.local ]]; then
  echo "   FAIL: no .env.local"; exit 1
fi
set -a; source .env.local; set +a
# Empty is not absent. Override whatever the file left blank.
export APP="$APP_URL"
export NEXT_PUBLIC_SITE_URL="$APP_URL"
[[ -n "${NEXT_PUBLIC_SUPABASE_URL:-}" && -n "${SUPABASE_SERVICE_ROLE_KEY:-}" ]]
report $? "supabase keys present (values never printed)"

# ----------------------------------------------------------------- types ----
step "tsc --noEmit"
npx tsc --noEmit
report $? "types clean"

# ----------------------------------------------------------------- build ----
step "next build"
npx next build > /tmp/pentinian-studio-build.log 2>&1
report $? "production build compiles (log: /tmp/pentinian-studio-build.log)"

if [[ "$FAST" -eq 1 ]]; then
  printf '\n%s\n' "$([[ $fail -eq 0 ]] && echo 'GATE OK (fast: no database checks)' || echo 'GATE FAILED')"
  exit $fail
fi

# ------------------------------------------------------- the app, for real --
step "dev server on :${PORT}"
started=""
# A dev server that was already running when `next build` ran above is now
# serving from a .next the build overwrote underneath it, which makes pages
# arrive with no JavaScript and browser probes fail for a reason that has
# nothing to do with the code. This is trap 2 in the header, and reusing the
# incumbent server walks straight into it. So: always start our own, on a port
# nothing else holds.
if curl -s -o /dev/null --max-time 3 "$APP_URL/login"; then
  report 1 "something already answers on :$PORT; stop it first, or set PORT to a free one"
  echo "GATE FAILED"; exit 1
fi

PORT="$PORT" npm run dev > /tmp/pentinian-studio-dev.log 2>&1 &
started=$!
for _ in $(seq 1 40); do
  sleep 1
  curl -s -o /dev/null --max-time 2 "$APP_URL/login" && break
done
# Confirm what answered is this app, not whatever else uses this port.
curl -s --max-time 5 "$APP_URL/login" | grep -qi pentinian
report $? "started on a fresh build (pid $started)"

cleanup() { [[ -n "$started" ]] && kill "$started" 2>/dev/null; }
trap cleanup EXIT

# -------------------------------------------------------------- verifiers ---
# verify-nonadmin is the signed-in non-admin path, which was inference until
# 2026-09-15. probe-reply-failure drives a real browser.
for s in verify-privacy verify-window verify-console verify-replies \
         verify-window-brain verify-brain verify-nonadmin probe-reply-failure; do
  step "$s"
  node "scripts/$s.mjs" > "/tmp/pentinian-$s.log" 2>&1
  code=$?
  report $code "$(grep -oE '[0-9]+ passed, [0-9]+ failed' "/tmp/pentinian-$s.log" | tail -1) (log: /tmp/pentinian-$s.log)"
done

# --------------------------------------------------------------- residue ----
# Every verifier above creates throwaway users and deletes them. That teardown
# is this repo's data net, so it is checked rather than assumed.
step "test residue"
node scripts/leftovers.mjs > /tmp/pentinian-leftovers.log 2>&1
report $? "$(tail -2 /tmp/pentinian-leftovers.log | head -1)"

printf '\n%s\n' "$([[ $fail -eq 0 ]] && echo 'GATE OK' || echo 'GATE FAILED')"
exit $fail
