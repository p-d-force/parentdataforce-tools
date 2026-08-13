#!/usr/bin/env bash
# Docling Lab — VPS provisioning script (run as root on 158.51.125.8).
# Installs the pdf-lab forensics service + Didier Stevens tools, wires the
# systemd units, and (re)starts both AI services. The docling venv itself is
# installed separately (see install-docling.sh / the initial bootstrap).
set -euo pipefail

echo "==> [1/4] pdf-lab venv + deps"
# Pillow must have a wheel (or libjpeg headers) or the source build aborts with
# "jpeg is required". Preinstall a recent Pillow wheel, then the rest.
apt-get install -y -qq libjpeg-dev zlib1g-dev >/dev/null 2>&1 || true
python3 -m venv /opt/pdf-lab/venv
/opt/pdf-lab/venv/bin/pip install -q --upgrade pip
# NOTE: peepdf 0.4.2 pins Pillow==3.2.0 (2016 sdist — cannot build on py3.12).
# Install peepdf --no-deps with modern substitutes (jsbeautifier, future,
# pythonaes, colorama, pillow>=10). If peepdf's CLI still breaks, pdfid +
# pdf-parser cover the same indicators and the service degrades gracefully.
/opt/pdf-lab/venv/bin/pip install -q "pillow>=10.4.0" jsbeautifier future pythonaes colorama || true
/opt/pdf-lab/venv/bin/pip install -q --no-deps peepdf || true
/opt/pdf-lab/venv/bin/pip install -q "x-ray==0.3.6" fastapi "uvicorn[standard]" || {
  echo "PIP FAILED — retrying without x-ray version pin"
  /opt/pdf-lab/venv/bin/pip install -q fastapi "uvicorn[standard]"
  /opt/pdf-lab/venv/bin/pip install -q "x-ray==0.3.6" || true
}

echo "==> [2/4] Didier Stevens pdfid / pdf-parser"
mkdir -p /opt/pdf-lab/tools
curl -fsSL -o /opt/pdf-lab/tools/pdfid.py https://raw.githubusercontent.com/DidierStevens/DidierStevensSuite/master/pdfid.py
curl -fsSL -o /opt/pdf-lab/tools/pdf-parser.py https://raw.githubusercontent.com/DidierStevens/DidierStevensSuite/master/pdf-parser.py
chmod +x /opt/pdf-lab/tools/*.py
/opt/pdf-lab/venv/bin/python /opt/pdf-lab/tools/pdfid.py -h >/dev/null 2>&1 && echo "pdfid OK" || echo "pdfid warning"

echo "==> [3/4] app + dirs"
mkdir -p /opt/pdf-lab
cp /opt/parentdataforce-tools/deploy/pdf-lab/app.py /opt/pdf-lab/app.py
mkdir -p /var/lib/pdf-lab/tmp /var/lib/docling
chmod 700 /var/lib/pdf-lab/tmp
chown -R root:root /opt/pdf-lab /var/lib/pdf-lab

echo "==> [4/4] systemd units"
cp /opt/parentdataforce-tools/deploy/docling-serve.service /etc/systemd/system/docling-serve.service
cp /opt/parentdataforce-tools/deploy/pdf-lab.service /etc/systemd/system/pdf-lab.service
# Env file for docling-serve (API key) — generate if missing
if [ ! -f /etc/docling-serve.env ]; then
  KEY="$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')"
  printf 'DOCLING_SERVE_API_KEY=%s\n' "$KEY" > /etc/docling-serve.env
  chmod 600 /etc/docling-serve.env
fi
# Give the Node app the same key + backend URLs
mkdir -p /etc/systemd/system/parentdataforce-tools.service.d
cat > /etc/systemd/system/parentdataforce-tools.service.d/docling.conf <<EOF
[Service]
EnvironmentFile=/etc/docling-serve.env
Environment=DOCLING_SERVE_URL=http://127.0.0.1:5001
Environment=PDF_LAB_URL=http://127.0.0.1:5100
EOF
systemctl daemon-reload
systemctl enable --now pdf-lab.service
systemctl enable --now docling-serve.service
sleep 3
systemctl is-active docling-serve.service pdf-lab.service
echo "DONE"
