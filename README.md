# Parent Data Force Tools

A privacy-conscious public utility and resource hub, visually aligned with [Parent Data Force](https://www.parentdataforce.com/) but maintained as a separate product surface.

## Current development pilot

- **QR code generator** — Generates downloadable QR PNGs.
- **Optional first-party click counts** — A tracked QR code encodes a Parent Data Force short redirect URL. The service stores only the destination URL, optional label, total click count, and last-click timestamp. It does **not** intentionally store account identity, IP addresses, browser fingerprints, or scan-level histories.

## Product boundaries

- This app is not an advocacy-intake system.
- Do not submit student records, confidential documents, or urgent safety concerns here.
- Tools are developed on `dev.parentdataforce.org` behind HTTP Basic Auth and `noindex` headers. Nothing moves to a public production domain without an explicit release decision.
- Advertising is intentionally not implemented in the pilot. Any future ad network requires its own privacy, consent, content-safety, and revenue review.
- Email open tracking is intentionally not implemented. The planned product direction is consent-based email utilities, not invisible tracking pixels.
- Any future YouTube feature must respect copyright, creators, and platform terms. Transcript/accessibility utilities are the first safe scope.

## Local development

```bash
npm install
npm start
# http://127.0.0.1:3000
```

For a public-facing dev deployment, set:

```bash
PORT=3101
PUBLIC_BASE_URL=https://dev.parentdataforce.org/tools
DATA_DIRECTORY=/var/lib/parentdataforce-tools
```

## Endpoint summary

- `GET /healthz` — health check
- `POST /api/qr` — create QR code; `{ destination, label, tracking }`
- `GET /api/qr/:code` — retrieve aggregate link statistics
- `GET /r/:code` — count a click and redirect

## Deployment

The deployment plan is documented in [`docs/DEV_DEPLOYMENT.md`](docs/DEV_DEPLOYMENT.md). It uses a loopback-only Node process behind the existing Basic-Auth Nginx virtual host.

## Theme provenance

The dark background, ember/orange accent palette, typography direction, and the logo file are derived from the public Parent Data Force site. `public/logo.png` was retrieved from the public URL `https://www.parentdataforce.com/assets/images/logo.png` on 2026-08-11.

## License

Proprietary — Parent Data Force. No license is granted for third-party deployment or redistribution.
