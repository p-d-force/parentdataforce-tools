#!/usr/bin/env bash
# Parent Data Force — Docling Lab smoke test.
# Usage: ./smoke_test.sh [remote_host] [base_url]
#   remote_host: SSH host to check service state (default 158.51.125.8)
#   base_url:    public UI/API base (default https://tools.parentdataforce.org)
# Verifies, against the DEPLOYED site:
#   1. Docling conversion of an uploaded PDF (200 + md_content)
#   2. PDF forensic report (evidence hashes + pdfid/peepdf + x-ray available)
#   3. Branded UI served with ad slots wired (dl-* slots + ads.js UNITS)
# Exits nonzero on any failure. Prints PASS/FAIL per check.
set -uo pipefail

HOST="${1:-158.51.125.8}"
BASE="${2:-https://tools.parentdataforce.org}"
KEY="${SSH_KEY:-$HOME/.ssh/id_ed25519_parentdataforce}"
SSH=(ssh -i "$KEY" -o ConnectTimeout=15 -o StrictHostKeyChecking=accept-new root@"$HOST")
# Native Windows curl.exe needs C:/forward-slash paths (MSYS /c/... fails);
# git-bash builtins handle C:/... fine too.
TMP_DIR="C:/Users/LokiF/AppData/Local/Temp"
TEST_PDF="$TMP_DIR/dummy.pdf"
FAIL=0

say()  { printf '%-72s' "$1"; }
pass() { printf 'PASS\n'; }
fail() { printf 'FAIL\n'; FAIL=1; }

echo "==> Docling Lab smoke test: $BASE (ssh $HOST)"
echo

say "[1] services active on $HOST"
OUT=$("${SSH[@]}" 'systemctl is-active docling-serve pdf-lab parentdataforce-tools 2>&1 | tr "\n" " "' 2>&1) || OUT="ssh/state error"
if echo "$OUT" | grep -q "active active active"; then echo "$OUT"; pass; else echo "${OUT}"; fail; fi

say "[2] /api/docling/health via public URL"
HEALTH=$(curl -s -m 10 "$BASE/api/docling/health" 2>/dev/null)
if echo "$HEALTH" | grep -q '"docling":"up"' && echo "$HEALTH" | grep -q '"lab":"up"'; then
  echo "$HEALTH"; pass
else
  echo "${HEALTH:-unreachable}"; fail
fi

say "[3] branded UI pages return 200"
PAGES_OK=1
for p in /tools/docling/ /tools/docling/convert.html /tools/docling/forensics.html; do
  code=$(curl -s -m 10 -o /dev/null -w "%{http_code}" "$BASE$p" 2>/dev/null)
  [ "$code" = "200" ] || PAGES_OK=0
done
if [ "$PAGES_OK" = "1" ]; then echo "hub+convert+forensics -> 200"; pass; else echo "non-200"; fail; fi

say "[4] ad slots wired in served UI (dl-* + ads.js UNITS)"
HUB_HTML=$(curl -s -m 10 "$BASE/tools/docling/" 2>/dev/null)
ADS_JS=$(curl -s -m 10 "$BASE/ads.js" 2>/dev/null)
if echo "$HUB_HTML" | grep -q 'data-ad-slot="dl-' \
   && echo "$ADS_JS" | grep -q "'dl-top'" \
   && echo "$ADS_JS" | grep -q "'dl-convert-1'" \
   && echo "$ADS_JS" | grep -q "'dl-for-1'"; then
  echo "dl- slots present, UNITS wired"; pass
else
  echo "missing ad wiring (hub dl-slots=$(echo "$HUB_HTML" | grep -c 'data-ad-slot="dl-'), ads.js dl-top=$(echo "$ADS_JS" | grep -c "'dl-top'"))"; fail
fi

say "[5] test PDF present"
if [ ! -s "$TEST_PDF" ]; then
  curl -fsSL -m 30 -o "$TEST_PDF" https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf 2>/dev/null || true
fi
if [ -s "$TEST_PDF" ]; then echo "$(wc -c < "$TEST_PDF") bytes"; pass; else echo "download failed"; fail; fi

say "[6] Docling conversion of uploaded PDF"
CONV=$(curl -s -m 600 -X POST "$BASE/api/docling/convert" \
  -H "Content-Type: application/pdf" -H "X-Filename: dummy.pdf" \
  -H "X-Options: {\"to_formats\":[\"md\",\"json\",\"text\"],\"do_ocr\":false}" \
  --data-binary @"$TEST_PDF" 2>/dev/null)
if echo "$CONV" | grep -q '"ok":true' && echo "$CONV" | grep -q 'md_content'; then
  MD=$(echo "$CONV" | python -c "import sys,json; d=json.load(sys.stdin); doc=(d.get('data') or {}).get('document') or {}; print(doc.get('md_content','')[:80])")
  echo "md_content: $MD"; pass
else
  echo "${CONV:0:200}"; fail
fi

say "[7] PDF forensic report (hashes + x-ray + pdfid + peepdf)"
SCAN=$(curl -s -m 120 -X POST "$BASE/api/docling/scan" \
  -H "Content-Type: application/pdf" -H "X-Filename: dummy.pdf" \
  --data-binary @"$TEST_PDF" 2>/dev/null)
if echo "$SCAN" | grep -q '"sha256"' \
   && echo "$SCAN" | grep -q '"redaction":{[^}]*"available":true' \
   && echo "$SCAN" | grep -q '"pdfid":{[^}]*"available":true' \
   && echo "$SCAN" | grep -q '"peepdf":{[^}]*"available":true'; then
  H=$(echo "$SCAN" | python -c "import sys,json; d=json.load(sys.stdin)['data']['evidence']; print(d['sha256'][:16]+'…')")
  echo "sha256 $H + x-ray/pdfid/peepdf available"; pass
else
  echo "${SCAN:0:250}"; fail
fi

echo
if [ "$FAIL" = "0" ]; then
  echo "==> SMOKE TEST: ALL PASS ✅  (UI live: $BASE/tools/docling/)"
  exit 0
else
  echo "==> SMOKE TEST: FAILURES PRESENT ❌"
  exit 1
fi
