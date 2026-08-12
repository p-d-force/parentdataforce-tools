import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import QRCode from 'qrcode';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const port = Number(process.env.PORT || 3000);
const publicBaseUrl = process.env.PUBLIC_BASE_URL || `http://localhost:${port}`;
const dataDirectory = process.env.DATA_DIRECTORY || path.join(__dirname, 'data');
const linkStorePath = path.join(dataDirectory, 'links.json');

fs.mkdirSync(dataDirectory, { recursive: true });

function readStore() {
  try {
    const contents = fs.readFileSync(linkStorePath, 'utf8').trim();
    if (!contents) return {};
    const parsed = JSON.parse(contents);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw error;
  }
}

function writeStore(store) {
  const temporaryPath = `${linkStorePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporaryPath, linkStorePath);
}

function normalizeHttpUrl(value) {
  const parsed = new URL(String(value || '').trim());
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Only http and https destinations are allowed.');
  }
  if (parsed.username || parsed.password) {
    throw new Error('Destination URLs cannot include credentials.');
  }
  return parsed.toString();
}

function createCode(store) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const code = crypto.randomBytes(6).toString('base64url');
    if (!store[code]) return code;
  }
  throw new Error('Could not allocate a unique tracking code.');
}

app.disable('x-powered-by');
app.use(express.json({ limit: '16kb' }));
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

app.get('/healthz', (_request, response) => {
  response.json({ status: 'ok' });
});

app.post('/api/qr', async (request, response) => {
  try {
    const destination = normalizeHttpUrl(request.body?.destination);
    const label = String(request.body?.label || '').trim().slice(0, 80);
    const tracking = Boolean(request.body?.tracking);
    const store = readStore();
    let encodedValue = destination;
    let code = null;

    if (tracking) {
      code = createCode(store);
      store[code] = {
        destination,
        label,
        createdAt: new Date().toISOString(),
        clicks: 0,
        lastClickedAt: null
      };
      writeStore(store);
      encodedValue = `${publicBaseUrl.replace(/\/$/, '')}/r/${code}`;
    }

    const qrDataUrl = await QRCode.toDataURL(encodedValue, {
      errorCorrectionLevel: 'M',
      margin: 2,
      width: 720,
      color: { dark: '#0b0b0b', light: '#ffffff' }
    });

    response.status(201).json({
      destination,
      label,
      tracking,
      code,
      redirectUrl: tracking ? encodedValue : null,
      qrDataUrl
    });
  } catch (error) {
    response.status(400).json({ error: error.message || 'Unable to create QR code.' });
  }
});

app.get('/api/qr/:code', (request, response) => {
  const store = readStore();
  const item = store[request.params.code];
  if (!item) return response.status(404).json({ error: 'Tracked link not found.' });
  return response.json({
    code: request.params.code,
    label: item.label,
    destination: item.destination,
    createdAt: item.createdAt,
    clicks: item.clicks,
    lastClickedAt: item.lastClickedAt
  });
});

app.get('/r/:code', (request, response) => {
  const store = readStore();
  const item = store[request.params.code];
  if (!item) return response.status(404).send('Tracked link not found.');

  item.clicks += 1;
  item.lastClickedAt = new Date().toISOString();
  writeStore(store);
  return response.redirect(302, item.destination);
});

app.use((error, _request, response, _next) => {
  console.error(error);
  response.status(500).json({ error: 'Internal server error.' });
});

app.listen(port, '127.0.0.1', () => {
  console.log(`Parent Data Force Tools listening on http://127.0.0.1:${port}`);
});

export { app, normalizeHttpUrl };
