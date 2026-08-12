# Development Deployment — Parent Data Force Tools

## Scope

This document deploys **only** the current QR-code tool hub to the existing Basic-Auth-protected `dev.parentdataforce.org` environment. It does not change `parentdataforce.org` or publish a new public domain.

## Server design

```text
Internet
  → https://dev.parentdataforce.org/tools/
  → existing Nginx + existing Basic Auth + noindex header
  → 127.0.0.1:3101 (systemd service)
  → Node/Express app
  → /var/lib/parentdataforce-tools/links.json (root-owned data directory)
```

Nginx owns the external TLS/authentication boundary. Node binds to loopback only and is not exposed in UFW.

## Preconditions

- Node 18+ and npm installed on the server.
- Existing dev Basic Auth must remain enabled.
- A local checkout is present on the server at `/opt/parentdataforce-tools`.
- Do not store credentials in the repository.

## Create a restricted data directory

```bash
# The loopback-only service runs as www-data and must atomically update its own
# aggregate link store; directory ownership is intentionally assigned to that service user.
install -d -m 0750 -o www-data -g www-data /var/lib/parentdataforce-tools
install -m 0640 -o www-data -g www-data /dev/null /var/lib/parentdataforce-tools/links.json
```

## Systemd service

Create `/etc/systemd/system/parentdataforce-tools.service`:

```ini
[Unit]
Description=Parent Data Force Tools development app
After=network.target

[Service]
Type=simple
User=www-data
Group=www-data
WorkingDirectory=/opt/parentdataforce-tools
Environment=NODE_ENV=production
Environment=PORT=3101
Environment=PUBLIC_BASE_URL=https://dev.parentdataforce.org/tools
Environment=DATA_DIRECTORY=/var/lib/parentdataforce-tools
ExecStart=/usr/bin/node /opt/parentdataforce-tools/server.mjs
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/parentdataforce-tools

[Install]
WantedBy=multi-user.target
```

Then:

```bash
systemctl daemon-reload
systemctl enable --now parentdataforce-tools
systemctl status parentdataforce-tools --no-pager
curl -sS http://127.0.0.1:3101/healthz
```

## Nginx location block

Insert the following *inside the existing* `dev.parentdataforce.org` HTTPS `server {}` block. Do not remove its Basic Auth, existing `X-Robots-Tag`, TLS, or root configuration.

```nginx
location = /tools { return 301 /tools/; }
location /tools/ {
    proxy_pass http://127.0.0.1:3101/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_redirect off;
}
```

Verify and reload:

```bash
nginx -t && systemctl reload nginx
curl -sS -u dev:'<read from protected local secret file>' -I https://dev.parentdataforce.org/tools/
```

## Update procedure

```bash
cd /opt/parentdataforce-tools
git fetch origin
git checkout main
git pull --ff-only origin main
npm ci --omit=dev
systemctl restart parentdataforce-tools
curl -fsS http://127.0.0.1:3101/healthz
```

## Smoke test

```bash
curl -fsS http://127.0.0.1:3101/healthz
curl -fsS -X POST http://127.0.0.1:3101/api/qr \
  -H 'Content-Type: application/json' \
  --data '{"destination":"https://example.org","label":"smoke-test","tracking":true}'
```

Then use the returned `redirectUrl` once and query `GET /api/qr/:code`. It should show one aggregate click. Remove the smoke-test entry afterward only if it was created in the live data store.

## Production gate

Before a public release, require an explicit instruction to go live plus review of:

1. privacy policy and data retention;
2. abuse prevention and URL safety;
3. advertising provider, consent, and content-safety controls if ads are added;
4. uptime/backup/incident ownership;
5. branded public domain and analytics disclosure;
6. public launch copy and support path.

No production deployment is authorized by this document.
