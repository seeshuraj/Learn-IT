#!/usr/bin/env bash
# One-command load test for LearnIT. Run in Google Cloud Shell:
#
#   bash <(curl -fsSL https://raw.githubusercontent.com/seeshuraj/Learn-IT/loadtest/loadtest/run.sh)
#
# It reads DATABASE_URL and SUPABASE_SERVICE_ROLE_KEY from Secret Manager
# (never printed), creates an isolated "LearnIT Load Test" college, runs k6
# against the live API, deletes everything it created, and prints a summary.
# Options: PEAK=300 (concurrent students), STUDENTS=300.
set -euo pipefail

PROJECT="${PROJECT:-learnit-prod-514916}"
export API_URL="${API_URL:-https://learnit-api-912681143217.asia-south1.run.app}"
export SUPABASE_URL="https://idytyybyyqutkgwrqjzl.supabase.co"
export SUPABASE_PUBLISHABLE_KEY="sb_publishable_YUNmvpDrFTeRfqiQV80Y0Q_olamWQKg"   # public key, same as the web app
export PEAK="${PEAK:-300}" STUDENTS="${STUDENTS:-300}"

WORK="$(mktemp -d)"; export OUT="$WORK/out"; mkdir -p "$OUT"; chmod 700 "$OUT"
REGION=asia-south1; SERVICE=learnit-api
# Rate limits are raised only while the test runs (30 logins are shared by
# 300 simulated students, all from this one IP), then restored exactly.
prev_env() { gcloud run services describe "$SERVICE" --region "$REGION" --project "$PROJECT" \
  --format=json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const e=JSON.parse(s).spec.template.spec.containers[0].env||[];const f=n=>(e.find(x=>x.name===n)||{}).value||"";console.log(f(process.argv[1]))})' "$1"; }
LIMITS_RAISED=0
restore_limits() {
  [ "$LIMITS_RAISED" = 1 ] || return 0
  echo "Restoring the API's rate limits…"
  local set="" rm=""
  if [ -n "$PREV_IP" ]; then set="RATE_IP_MAX=$PREV_IP"; else rm="RATE_IP_MAX"; fi
  if [ -n "$PREV_USER" ]; then set="${set:+$set,}RATE_USER_MAX=$PREV_USER"; else rm="${rm:+$rm,}RATE_USER_MAX"; fi
  gcloud run services update "$SERVICE" --region "$REGION" --project "$PROJECT" --quiet \
    ${set:+--update-env-vars "$set"} ${rm:+--remove-env-vars "$rm"} >/dev/null && LIMITS_RAISED=0
}
cleanup() {
  restore_limits || echo "!! Could not restore rate limits: run  gcloud run services update $SERVICE --region $REGION --remove-env-vars RATE_IP_MAX,RATE_USER_MAX"
  echo; echo "Cleaning up test data…"
  (cd "$WORK/repo/loadtest" && node teardown.mjs) || echo "Teardown failed: re-run this script with TEARDOWN_ONLY=1"
  rm -f "$OUT/tokens.json"
}

echo "1/5 Fetching the load test scripts…"
git clone -q --depth 1 -b loadtest https://github.com/seeshuraj/Learn-IT.git "$WORK/repo"
cd "$WORK/repo/loadtest"
npm init -y >/dev/null && npm i -s --no-audit --no-fund pg@8 @supabase/supabase-js@2 >/dev/null

echo "2/5 Reading secrets from Secret Manager (not shown)…"
DATABASE_URL="$(gcloud secrets versions access latest --secret=DATABASE_URL --project "$PROJECT")"; export DATABASE_URL
SUPABASE_SERVICE_ROLE_KEY="$(gcloud secrets versions access latest --secret=SUPABASE_SERVICE_ROLE_KEY --project "$PROJECT")"; export SUPABASE_SERVICE_ROLE_KEY

if [ "${TEARDOWN_ONLY:-}" = "1" ]; then node teardown.mjs; exit; fi

if ! command -v k6 >/dev/null; then
  curl -fsSL https://github.com/grafana/k6/releases/download/v0.55.0/k6-v0.55.0-linux-amd64.tar.gz | tar xz -C "$WORK"
  export PATH="$WORK/k6-v0.55.0-linux-amd64:$PATH"
fi

trap cleanup EXIT
echo "3/5 Creating the test college…"
node setup.mjs

PREV_IP="$(prev_env RATE_IP_MAX)"; PREV_USER="$(prev_env RATE_USER_MAX)"
echo "    Raising rate limits for the test (restored afterwards)…"
LIMITS_RAISED=1
gcloud run services update "$SERVICE" --region "$REGION" --project "$PROJECT" --quiet \
  --update-env-vars RATE_IP_MAX=1000000,RATE_USER_MAX=100000 >/dev/null

echo "4/5 Running the load (about 13 minutes, up to $PEAK students at once)…"
BASE=$(curl -s -o /dev/null -w '%{time_total}' "$API_URL/api/health")
TOKENS="$OUT/tokens.json" k6 run --quiet --summary-export "$OUT/summary.json" k6.js >"$OUT/k6.log" 2>&1 || true

echo "5/5 Results"
echo "Network round trip from this Cloud Shell to the API: $(awk "BEGIN{printf \"%d\", $BASE*1000}") ms (included in every timing below)"
node report.mjs "$OUT/summary.json"
if grep -q "FAIL " "$OUT/k6.log"; then
  echo; echo "Failed requests by endpoint and status:"
  grep -o 'FAIL [^"]*' "$OUT/k6.log" | awk '{print $2, $3, $4}' | sort | uniq -c | sort -rn | head -15
fi
