#!/usr/bin/env bash
# Usage report from the anonymous events in D1 (tao-analytics).
# Usage: scripts/analytics.sh [days=7] [--local]
set -euo pipefail
DAYS="${1:-7}"; WHERE="--remote"; [[ "${2:-}" == "--local" ]] && WHERE="--local"
SINCE="(strftime('%s','now') - ${DAYS}*86400) * 1000"
q() {
  echo; echo "== $1"
  npx wrangler d1 execute tao-analytics $WHERE --json --command "$2" 2>/dev/null \
    | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const r=JSON.parse(s)[0]?.results||[];r.length?console.table(r):console.log("(none)")})'
}
q "Visitors, sessions, events (last ${DAYS} days)" \
  "SELECT COUNT(DISTINCT vid) visitors, COUNT(DISTINCT sid) sessions, COUNT(*) events FROM events WHERE ts > ${SINCE}"
q "Top pages" \
  "SELECT CASE WHEN path LIKE '/p/%' THEN '/p/N' ELSE path END page, COUNT(*) views, COUNT(DISTINCT vid) visitors FROM events WHERE ev='view' AND ts > ${SINCE} GROUP BY page ORDER BY views DESC LIMIT 20"
q "Features used" \
  "SELECT ev, COUNT(*) n, COUNT(DISTINCT vid) visitors FROM events WHERE ev <> 'view' AND ts > ${SINCE} GROUP BY ev ORDER BY n DESC"
q "Most common steps (from -> to)" \
  "SELECT COALESCE(CASE WHEN prev LIKE '/p/%' THEN '/p/N' ELSE prev END,'(entry)') AS from_page, CASE WHEN path LIKE '/p/%' THEN '/p/N' ELSE path END AS to_page, COUNT(*) n FROM events WHERE ev='view' AND ts > ${SINCE} GROUP BY from_page, to_page ORDER BY n DESC LIMIT 25"
q "Session paths (15 latest sessions)" \
  "SELECT substr(sid,1,8) AS session, COUNT(*) pages, group_concat(path, ' > ') AS path FROM (SELECT sid, path, ts FROM events WHERE ev='view' AND ts > ${SINCE} ORDER BY sid, ts) GROUP BY sid ORDER BY MAX(ts) DESC LIMIT 15"
q "Passages drawn" \
  "SELECT detail AS passage, COUNT(*) n FROM events WHERE ev='draw' AND ts > ${SINCE} GROUP BY detail ORDER BY n DESC LIMIT 15"
q "Devices and countries" \
  "SELECT device, country, COUNT(DISTINCT vid) visitors FROM events WHERE ts > ${SINCE} GROUP BY device, country ORDER BY visitors DESC LIMIT 15"
