#!/bin/sh
set -eu

secrets=${EVALUATOR_SECRETS_FILE:-"$HOME/.config/agentic-sdlc/runtime.env"}
port=${EVALUATOR_HTTP_PORT:-8080}
base_url="http://127.0.0.1:$port"

line() { printf '%s\n' "================================================================"; }
pass() { printf '[PASS] %s\n' "$1"; }
fail() { printf '[FAIL] %s\n' "$1" >&2; exit 1; }
run() { printf '[RUN]  %s\n       How: %s\n' "$1" "$2"; }

line
printf 'Evaluator deployment verification\n'
printf 'Target: %s\n' "$base_url"
line

test -f "$secrets" || fail "Runtime secrets file was not found at $secrets."
token=$(sed -n 's/^EVALUATOR_API_TOKEN=//p' "$secrets" | tail -n 1)
test -n "$token" || fail "EVALUATOR_API_TOKEN is missing from the runtime secrets file."

run "Health endpoint" "Request GET /health and require HTTP 200 with a JSON status response."
attempt=1
health_body=$(mktemp)
canary_body=""
trap 'rm -f "$health_body" "$canary_body"' EXIT HUP INT TERM
while [ "$attempt" -le 12 ]; do
  if health_code=$(curl -sS -o "$health_body" -w '%{http_code}' --max-time 10 "$base_url/health"); then
    if [ "$health_code" = "200" ] && grep -q '"status":"ok"' "$health_body"; then
      pass "Health endpoint returned HTTP 200: $(cat "$health_body")"
      break
    fi
  fi
  if [ "$attempt" = "12" ]; then
    fail "Health endpoint did not return HTTP 200. Last HTTP status: ${health_code:-connection failed}."
  fi
  printf '       Waiting for service startup (%s/12).\n' "$attempt"
  sleep 2
  attempt=$((attempt + 1))
done

run "Codex authentication canary" "POST /deployment-tests/codex-auth with the evaluator bearer token. This makes one real, low-scope Codex request and requires HTTP 200."
canary_body=$(mktemp)
if canary_code=$(curl -sS -o "$canary_body" -w '%{http_code}' --max-time 120 -H "Authorization: Bearer $token" -X POST "$base_url/deployment-tests/codex-auth"); then
  if [ "$canary_code" = "200" ]; then
    pass "Codex authentication canary passed: $(cat "$canary_body")"
  else
    fail "Codex authentication canary returned HTTP $canary_code: $(cat "$canary_body")"
  fi
else
  fail "Codex authentication canary could not reach the evaluator endpoint."
fi

line
printf 'Deployment verification passed. View the live report at %s/\n' "$base_url"
line
