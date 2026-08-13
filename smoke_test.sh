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
TMP="${TMPDIR:-$LOCALAPPDATA/Temp}/docling-smoke"
mkdir -p "$TMP"
FAIL=0

say()  { printf '%-70s' "$1"; }
pass() { printf 'PASS\n'; }
fail() { printf 'FAIL\n'; FAIL=1; }

echo "==> Docling Lab smoke test: $BASE (ssh $HOST)"
echo

say "[1] services active on $HOST"
if OUT=$("${SSH[@]}" 'systemctl is-active docling-serve pdf-lab parentdataforce-tools 2>&1 | tr "\n" " "' 2>&1) && echo "$OUT" | grep -q "active active active"; then
  echo "$OUT"; pass
else
  echo "${OUT:-ssh/state error}"; fail
fi

say "[2] /api/docling/health via public URL"
if OUT=$(curl -s -m 10 "$BASE/api/docling/health") && echo "$OUT" | grep -q '"docling":"up"' && echo "$OUT" | grep -q '"lab":"up"'; then
  echo "$OUT"; pass
else
  echo "${OUT:-unreachable}"; fail
fi

say "[3] branded UI pages return 200"
PAGES_OK=1
for p in /tools/docling/ /tools/docling/convert.html /tools/docling/forensics.html; do
  code=$(curl -s -m 10 -o /dev/null -w "%{http_code}" "$BASE$p")
  [ "$code" = "200" ] || PAGES_OK=0
done
if [ "$PAGES_OK" = "1" ]; then echo "hub+convert+forensics -> 200"; pass; else echo "non-200"; fail; fi

say "[4] ad slots wired in served UI (dl-* + ads.js UNITS)"
if curl -s -m 10 "$BASE/tools/docling/" | grep -q 'data-ad-slot="dl-' && \
   curl -s -m 10 "$BASE/ads.js" | grep -q "'dl-top'" && \
   curl -s -m 10 "$BASE/ads.js" | grep -q "'dl-convert-1'" && \
   curl -s -m 10 "$BASE/ads.js" | grep -q "'dl-for-1'"; then
  echo "dl- slots present, UNITS wired"; pass
else
  echo "missing ad wiring"; fail
fi

say "[5] test PDF present"
if [ ! -f "$TMP/dummy.pdf" ]; then
  curl -fsSL -m 30 -o "$TMP/dummy.pdf" https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf
fi
if [ -s "$TMP/dummy.pdf" ]; then echo "$(wc -c < "$TMP/dummy.pdf") bytes"; pass; else echo "download failed"; fail; fi

say "[6] Docling conversion of uploaded PDF"
CONV=$(curl -s -m 600 -X POST "$BASE/api/docling/convert" \
  -H "Content-Type: application/pdf" -H "X-Filename: dummy.pdf" \
  -H "X-Options: {\"to_formats\":[\"md\",\"json\",\"text\"],\"do_ocr\":false}" \
  --data-binary @"$TMP/dummy.pdf")
if echo "$CONV" | grep -q '"ok":true' && echo "$CONV" | grep -q 'md_content'; then
  MD=$(echo "$CONV" | python -c "import sys,json; d=json.load(sys.stdin); doc=(d.get('data') or {}).get('document') or {}; print(doc.get('md_content','')[:80])")
  echo "md_content: $MD"; pass
else
  echo "${CONV:0:200}"; fail
fi

say "[7] PDF forensic report (hashes + x-ray + pdfid + peepdf)"
SCAN=$(curl -s -m 120 -X POST "$BASE/api/docling/scan" \
  -H "Content-Type: application/pdf" -H "X-Filename: dummy.pdf" \
  --data-binary @"$TMP/dummy.pdf")
if echo "$SCAN" | grep -q '"sha256"' && \
   echo "$SCAN" | grep -q '"redaction":{[^}]*"available":true' && \
   echo "$SCAN" | grep -q '"pdfid":{[^}]*"available":true' && \
   echo "$SCAN" | grep -q '"peepdf":{[^}]*"available":true'; then
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
