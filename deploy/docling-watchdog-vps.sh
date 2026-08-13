#!/usr/bin/env bash
# Docling Lab watchdog — VPS-NATIVE version.
# Runs ON the server (root cron, every 5 min). Checks local services directly,
# auto-restarts via systemctl, and alerts to Discord via webhook when DOWN.
# Silent when everything is UP (no output, exit 0).
set -uo pipefail

WEBHOOK_URL="https://discord.com/api/webhooks/1537515523502243870/tlpxuWx1yfNYKLXkdejOdXepMnazUjTzBO5R_HbCJQMxJbs8mx9IDgd1ayRqYf13MO6B"
LOG="/var/log/docling-watchdog.log"

now() { date -u +%Y-%m-%dT%H:%M:%SZ; }

# Service state: active|inactive|failed
svc_state() { systemctl is-active "$1" 2>/dev/null || echo "unknown"; }

# HTTP state for a local backend
http_state() {
  local url="$1"
  local code
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 15 "$url" 2>/dev/null)
  [ "$code" = "200" ] && echo "UP" || echo "DOWN(http=$code)"
}

DOCLING_STATE=$(http_state "http://127.0.0.1:5001/health")
LAB_STATE=$(http_state "http://127.0.0.1:5100/health")
OLLAMA_STATE=$(http_state "http://127.0.0.1:11434/v1/models")
NODE_STATE=$(svc_state parentdataforce-tools)

if [ "$DOCLING_STATE" = "UP" ] && [ "$LAB_STATE" = "UP" ] && [ "$OLLAMA_STATE" = "UP" ] && [ "$NODE_STATE" = "active" ]; then
  # All healthy — stay silent (watchdog pattern)
  exit 0
fi

NOW=$(now)

# Something is down — restart all docling stack services, report outcome.
RESTART_OUT=$(systemctl restart ollama docling-serve pdf-lab parentdataforce-tools 2>&1; sleep 5; \
  echo "docling-serve=$(svc_state docling-serve) pdf-lab=$(svc_state pdf-lab) ollama=$(svc_state ollama) node=$(svc_state parentdataforce-tools)")

MSG="🚨 **DOCLING LAB DOWN** at $NOW
- docling-serve :5001 -> $DOCLING_STATE
- pdf-lab :5100 -> $LAB_STATE
- ollama :11434 -> $OLLAMA_STATE
- node service -> $NODE_STATE
- auto-restart attempted -> $RESTART_OUT
- verify: https://tools.parentdataforce.org/api/docling/health"

# Log locally too
echo "[$NOW] DOWN: docling=$DOCLING_STATE lab=$LAB_STATE ollama=$OLLAMA_STATE node=$NODE_STATE" >> "$LOG"

# Alert to Discord
curl -s -o /dev/null -w "webhook_http=%{http_code}\n" --max-time 15 \
  -X POST "$WEBHOOK_URL" \
  -H "Content-Type: application/json" \
  -d "$(python3 -c "
import json,sys
print(json.dumps({'content': sys.argv[1]}))
" "$MSG")" >> "$LOG" 2>&1

echo "$MSG"
