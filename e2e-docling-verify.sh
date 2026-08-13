#!/usr/bin/env bash
set -u
AUTH="dev:$(grep Password /c/Users/LokiF/AppData/Local/hermes/secrets/parentdataforce-dev-credentials.txt | awk '{print $2}')"
BASE="https://dev.parentdataforce.org"
cd "$LOCALAPPDATA/Temp" || exit 1

echo "=== SCAN recheck (qpdf_ok should be True) ==="
curl -s -u "$AUTH" -X POST "$BASE/api/docling/scan" \
  -H "Content-Type: application/pdf" -H "X-Filename: dummy.pdf" \
  --data-binary @dummy.pdf -o scan2.json
python -c "
import json
d = json.load(open('scan2.json'))['data']
print('qpdf_ok:', d['structure']['qpdf_ok'], '| xray findings:', d['redaction']['findings'], '| pdfid:', d['indicators']['pdfid'].get('available'))
"

echo "=== CONVERT-URL (http source) ==="
curl -s -u "$AUTH" -X POST "$BASE/api/docling/convert-url" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf","options":{"to_formats":["md"],"do_ocr":false}}' \
  -o convert-url.json -w "http=%{http_code} size=%{size_download}\n"
python -c "
import json
d = json.load(open('convert-url.json'))
doc = (d.get('data') or {}).get('document') or {}
print('ok:', d.get('ok'), '| md_content:', str(doc.get('md_content'))[:60])
"
