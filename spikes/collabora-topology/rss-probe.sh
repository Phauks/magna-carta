#!/bin/sh
# RSS probe (busybox CGI): emits JSON of VmRSS per coolwsd-tree pid.
# Redaction: integers and process (comm) names only; never reads jailed document files,
# never emits document bytes or WOPI tokens.
printf 'Content-Type: application/json\r\n\r\n'
printf '{"ts":%s,"procs":[' "$(date +%s%3N)"
first=1
for p in $(pgrep -d' ' 'coolwsd|coolforkit|coolkit' 2>/dev/null); do
  rss=$(awk '/^VmRSS:/{print $2}' "/proc/$p/status" 2>/dev/null)
  comm=$(tr -d '\0' < "/proc/$p/comm" 2>/dev/null)
  [ -z "$rss" ] && continue
  [ $first -eq 0 ] && printf ','
  printf '{"pid":%s,"comm":"%s","vmrss_kib":%s}' "$p" "$comm" "$rss"
  first=0
done
printf ']}'
