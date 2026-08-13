#!/usr/bin/env bash
# E2E test: Docling Lab conversion + forensic scan through the public URL
set -u
AUTH="dev:$(grep Password /c/Users/LokiF/AppData/Local/hermes/secrets/parentdataforce-dev-credentials.txt | awk '{print $2}')"
BASE="https://dev.parentdataforce.org"
cd "$LOCALAPPDATA/Temp" || exit 1

if [ ! -f dummy.pdf ]; then
  curl -fsSL -o dummy.pdf https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf
fi
echo "=== test file ==="
ls -la dummy.pdf

echo "=== pages return 200 ==="
for p in /tools/docling/ /tools/docling/convert.html /tools/docling/forensics.html; do
  code=$(curl -s -u "$AUTH" -o /dev/null -w "%{http_code}" "$BASE$p")
  echo "$p -> $code"
done

echo "=== ads.js slot wiring ==="
curl -s -u "$AUTH" "$BASE/ads.js" | grep -c "dl-convert\|dl-for\|dl-top\|pdf-between"

echo "=== CONVERT (this is the slow first run; models may download) ==="
time curl -s -u "$AUTH" -X POST "$BASE/api/docling/convert" \
  -H "Content-Type: application/pdf" \
  -H "X-Filename: dummy.pdf" \
  -H "X-Options: {\"to_formats\":[\"md\",\"json\",\"text\"],\"do_ocr\":false}" \
  --data-binary @dummy.pdf -o convert-result.json -w "http=%{http_code} size=%{size_download}\n"
echo "--- response keys ---"
python -c "
import json
d = json.load(open('convert-result.json'))
print('ok:', d.get('ok'))
data = d.get('data') or {}
print('data keys:', list(data.keys())[:10] if isinstance(data, dict) else type(data))
import re
s = json.dumps(data)[:3000]
print('sample:', s[:1200])
"

echo "=== SCAN ==="
time curl -s -u "$AUTH" -X POST "$BASE/api/docling/scan" \
  -H "Content-Type: application/pdf" \
  -H "X-Filename: dummy.pdf" \
  --data-binary @dummy.pdf -o scan-result.json -w "http=%{http_code} size=%{size_download}\n"
python -c "
import json
d = json.load(open('scan-result.json'))
data = d.get('data') or {}
print('evidence:', data.get('evidence'))
print('structure qpdf_ok:', (data.get('structure') or {}).get('qpdf_ok'))
print('redaction available:', (data.get('redaction') or {}).get('available'), 'findings:', (data.get('redaction') or {}).get('findings'))
print('pdfid available:', (data.get('indicators') or {}).get('pdfid', {}).get('available'))
print('peepdf available:', (data.get('indicators') or {}).get('peepdf', {}).get('available'))
print('text pages:', len(data.get('text_coverage') or []))
print('tools:', data.get('tools'))
"
