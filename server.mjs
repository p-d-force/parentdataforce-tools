import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import QRCode from 'qrcode';
import { YoutubeTranscript } from 'youtube-transcript';
import { Auth } from './auth.mjs';
import { Tracker } from './tracker.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const port = Number(process.env.PORT || 3000);
const publicBaseUrl = process.env.PUBLIC_BASE_URL || `http://localhost:${port}`;
const dataDirectory = process.env.DATA_DIRECTORY || path.join(__dirname, 'data');
const linkStorePath = path.join(dataDirectory, 'links.json');

fs.mkdirSync(dataDirectory, { recursive: true });
const auth = new Auth(dataDirectory);
const tracker = new Tracker(dataDirectory, { readStore, writeStore });

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

// ── QR style config ───────────────────────────────────────────────────
const DEFAULT_STYLE = {
  dots: 'square',          // square | rounded | dots | classy | classy-rounded | extra-rounded
  eyes: 'square',          // square | circle | rounded | leaf | diamond
  dotColor: '#0b0b0b',
  eyeColor: '#0b0b0b',
  bgColor: '#ffffff',
  logo: null,              // data URL (client-uploaded, small)
  logoSize: 0.18           // fraction of QR size
};

function sanitizeStyle(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const out = { ...DEFAULT_STYLE };
  if (['square', 'rounded', 'dots', 'classy', 'classy-rounded', 'extra-rounded'].includes(src.dots)) out.dots = src.dots;
  if (['square', 'circle', 'rounded', 'leaf', 'diamond'].includes(src.eyes)) out.eyes = src.eyes;
  if (typeof src.dotColor === 'string' && /^#[0-9a-fA-F]{6}$/.test(src.dotColor)) out.dotColor = src.dotColor;
  if (typeof src.eyeColor === 'string' && /^#[0-9a-fA-F]{6}$/.test(src.eyeColor)) out.eyeColor = src.eyeColor;
  if (typeof src.bgColor === 'string' && /^#[0-9a-fA-F]{6}$/.test(src.bgColor)) out.bgColor = src.bgColor;
  if (typeof src.logo === 'string' && src.logo.startsWith('data:image/') && src.logo.length < 200000) out.logo = src.logo;
  if (typeof src.logoSize === 'number' && src.logoSize >= 0.08 && src.logoSize <= 0.3) out.logoSize = src.logoSize;
  return out;
}

// ── Premium tier limits ───────────────────────────────────────────────
const TIER_LIMITS = {
  free: { maxLinks: 10, historyCap: 200, webhooks: false, bulk: false },
  pro: { maxLinks: 1000, historyCap: 5000, webhooks: true, bulk: true }
};

function userLinkCount(userId) {
  if (!userId) return 0;
  const store = readStore();
  return Object.values(store).filter((item) => item.userId === userId).length;
}

function tierOf(user) {
  return (user && user.plan === 'pro') ? 'pro' : 'free';
}

app.disable('x-powered-by');
app.use(express.json({ limit: '16kb' }));
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

app.get('/healthz', (_request, response) => {
  response.json({ status: 'ok' });
});

// ─── Auth Routes ─────────────────────────────────────────────────────────────

app.post('/api/auth/signup', (request, response) => {
  try {
    const { email, password } = request.body || {};
    const user = auth.createUser(email, password);
    const token = auth.createSession(user.id);
    response.setHeader('Set-Cookie', auth.sessionCookie(token));
    response.status(201).json({ user: { id: user.id, email: user.email, plan: user.plan } });
  } catch (error) {
    response.status(400).json({ error: error.message || 'Unable to create account.' });
  }
});

app.post('/api/auth/login', (request, response) => {
  try {
    const { email, password } = request.body || {};
    const user = auth.findUserByEmail(email);
    if (!user || !auth.verifyPassword(String(password || ''), user.salt, user.hash)) {
      return response.status(401).json({ error: 'Invalid email or password.' });
    }
    const token = auth.createSession(user.id);
    response.setHeader('Set-Cookie', auth.sessionCookie(token));
    response.json({ user: { id: user.id, email: user.email, plan: user.plan } });
  } catch (error) {
    response.status(400).json({ error: error.message || 'Unable to log in.' });
  }
});

app.post('/api/auth/logout', (request, response) => {
  const cookies = auth.parseCookies(request);
  auth.destroySession(cookies.pdf_session);
  response.setHeader('Set-Cookie', auth.clearSessionCookie());
  response.json({ ok: true });
});

app.get('/api/auth/me', (request, response) => {
  const cookies = auth.parseCookies(request);
  const user = auth.getUserBySessionToken(cookies.pdf_session);
  if (!user) return response.status(401).json({ error: 'Not logged in.' });
  return response.json({
    user: { id: user.id, email: user.email, plan: user.plan },
    limits: TIER_LIMITS[tierOf(user)] || TIER_LIMITS.free,
    used: { links: userLinkCount(user.id) }
  });
});

app.post('/api/qr', async (request, response) => {
  try {
    const destination = normalizeHttpUrl(request.body?.destination);
    const label = String(request.body?.label || '').trim().slice(0, 80);
    const tracking = Boolean(request.body?.tracking);
    const webhookUrl = String(request.body?.webhookUrl || '').trim().slice(0, 500);
    const style = sanitizeStyle(request.body?.style);
    const cookies = auth.parseCookies(request);
    const user = auth.getUserBySessionToken(cookies.pdf_session);
    const store = readStore();
    let encodedValue = destination;
    let code = null;

    if (tracking) {
      if (user && userLinkCount(user.id) >= TIER_LIMITS[tierOf(user)].maxLinks) {
        return response.status(403).json({ error: 'Free tier limit reached — upgrade to Pro for more.' });
      }
      if (webhookUrl && !TIER_LIMITS[tierOf(user)].webhooks && user) {
        return response.status(403).json({ error: 'Webhook alerts are a Pro feature.' });
      }
      code = createCode(store);
      store[code] = {
        destination,
        label,
        userId: user ? user.id : null,
        createdAt: new Date().toISOString(),
        clicks: 0,
        lastClickedAt: null,
        style,
        ...(webhookUrl ? { webhookUrl } : {})
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

// ─── Tracked Link Routes (email tracker — reuses QR store + tracker) ─────────

app.post('/api/links', (request, response) => {
  try {
    const destination = normalizeHttpUrl(request.body?.destination);
    const label = String(request.body?.label || '').trim().slice(0, 80);
    const webhookUrl = String(request.body?.webhookUrl || '').trim().slice(0, 500);
    const cookies = auth.parseCookies(request);
    const user = auth.getUserBySessionToken(cookies.pdf_session);
    const store = readStore();
    if (user && userLinkCount(user.id) >= TIER_LIMITS[tierOf(user)].maxLinks) {
      return response.status(403).json({ error: 'Free tier limit reached — upgrade to Pro for more.' });
    }
    if (webhookUrl && !TIER_LIMITS[tierOf(user)].webhooks && user) {
      return response.status(403).json({ error: 'Webhook alerts are a Pro feature.' });
    }
    const code = createCode(store);
    store[code] = {
      destination,
      label,
      kind: 'link',
      userId: user ? user.id : null,
      createdAt: new Date().toISOString(),
      clicks: 0,
      lastClickedAt: null,
      ...(webhookUrl ? { webhookUrl } : {})
    };
    writeStore(store);
    response.status(201).json({
      code,
      label,
      destination,
      kind: 'link',
      redirectUrl: `${publicBaseUrl.replace(/\/$/, '')}/r/${code}`
    });
  } catch (error) {
    response.status(400).json({ error: error.message || 'Unable to create link.' });
  }
});

// Bulk CSV import — "label,destination" per line (header row optional)
app.post('/api/links/bulk', (request, response) => {
  try {
    const csv = String(request.body?.csv || '').trim();
    if (!csv) return response.status(400).json({ error: 'No CSV provided.' });

    const cookies = auth.parseCookies(request);
    const user = auth.getUserBySessionToken(cookies.pdf_session);
    const store = readStore();

    if (user && !TIER_LIMITS[tierOf(user)].bulk) {
      return response.status(403).json({ error: 'Bulk import is a Pro feature.' });
    }

    const lines = csv.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const created = [];
    let skipped = 0;

    for (const line of lines.slice(0, 100)) {
      // Strip optional header row
      if (/^(label|name|title)\s*[,]/i.test(line) && created.length === 0 && skipped === 0) continue;
      const comma = line.indexOf(',');
      const label = comma > -1 ? line.slice(0, comma).trim().slice(0, 80) : '';
      const dest = (comma > -1 ? line.slice(comma + 1) : line).trim();
      try {
        const destination = normalizeHttpUrl(dest);
        const code = createCode(store);
        store[code] = {
          destination,
          label,
          kind: 'link',
          userId: user ? user.id : null,
          createdAt: new Date().toISOString(),
          clicks: 0,
          lastClickedAt: null
        };
        created.push({ code, label, destination, redirectUrl: `${publicBaseUrl.replace(/\/$/, '')}/r/${code}` });
      } catch {
        skipped += 1;
      }
    }

    writeStore(store);
    response.status(201).json({ created: created.length, skipped, codes: created });
  } catch (error) {
    response.status(400).json({ error: error.message || 'Unable to import links.' });
  }
});

// List the current user's tracked QR codes
app.get('/api/my/qrs', (request, response) => {
  const cookies = auth.parseCookies(request);
  const user = auth.getUserBySessionToken(cookies.pdf_session);
  if (!user) return response.status(401).json({ error: 'Not logged in.' });

  const store = readStore();
  const codes = Object.entries(store)
    .filter(([, item]) => item.userId === user.id)
    .map(([code, item]) => ({
      code,
      kind: item.kind || 'qr',
      label: item.label,
      destination: item.destination,
      createdAt: item.createdAt,
      clicks: item.clicks,
      lastClickedAt: item.lastClickedAt,
      redirectUrl: `${publicBaseUrl.replace(/\/$/, '')}/r/${code}`,
      style: item.style || DEFAULT_STYLE,
      uniqueScans: item.uniqueFp ? Object.keys(item.uniqueFp).length : 0
    }))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  response.json({ codes });
});

// Delete a tracked QR code (owner only, or admin-less anonymous codes allowed)
app.delete('/api/qr/:code', (request, response) => {
  const store = readStore();
  const item = store[request.params.code];
  if (!item) return response.status(404).json({ error: 'Tracked link not found.' });

  const cookies = auth.parseCookies(request);
  const user = auth.getUserBySessionToken(cookies.pdf_session);

  if (item.userId && (!user || user.id !== item.userId)) {
    return response.status(403).json({ error: 'You can only delete your own QR codes.' });
  }

  delete store[request.params.code];
  writeStore(store);
  response.json({ ok: true });
});

function summarizeStats(item) {
  const history = Array.isArray(item.history) ? item.history : [];
  const uniqueIps = new Set(history.map((h) => h.ip));
  const countries = {};
  const cities = {};
  const byDay = {};
  const byDevice = {};
  history.forEach((h) => {
    const day = (h.t || '').slice(0, 10);
    byDay[day] = (byDay[day] || 0) + 1;
    if (h.device) byDevice[h.device] = (byDevice[h.device] || 0) + 1;
    if (h.geo && h.geo.countryCode) {
      countries[h.geo.countryCode] = (countries[h.geo.countryCode] || 0) + 1;
    }
    if (h.geo && h.geo.city) {
      const key = `${h.geo.city}, ${h.geo.countryCode || ''}`;
      cities[key] = (cities[key] || 0) + 1;
    }
  });

  // Unique-scanner buckets: new unique per day (from registry first-seen)
  const fpFirst = item.uniqueFp || {};
  const uniqueByDay = {};
  Object.entries(fpFirst).forEach(([fp, firstSeen]) => {
    const day = String(firstSeen).slice(0, 10);
    if (!uniqueByDay[day]) uniqueByDay[day] = { new: 0, existing: 0 };
    uniqueByDay[day].new += 1;
  });
  // History loop: count every click, but only the fp's FIRST-EVER click is
  // already attributed as "new" above — everything else is a repeat scan.
  history.forEach((h) => {
    const day = (h.t || '').slice(0, 10);
    if (!uniqueByDay[day]) uniqueByDay[day] = { new: 0, existing: 0 };
    const isFirstEver = h.fp && fpFirst[h.fp] === h.t;
    if (!isFirstEver) uniqueByDay[day].existing += 1;
  });

  const uniqueScans = Object.keys(fpFirst).length;
  const totalClicks = item.clicks || 0;
  return {
    totalClicks,
    uniqueScans,
    returnRate: totalClicks > 0
      ? Math.round((1 - uniqueScans / Math.max(1, totalClicks)) * 100)
      : 0,
    uniqueIps: uniqueIps.size,
    firstClickAt: history.length ? history[0].t : null,
    lastClickAt: item.lastClickedAt || null,
    byDay,
    uniqueByDay,
    byDevice,
    topCountries: Object.entries(countries).sort((a, b) => b[1] - a[1]).slice(0, 6),
    topCities: Object.entries(cities).sort((a, b) => b[1] - a[1]).slice(0, 6)
  };
}

function sanitizeHistory(history) {
  // Strip raw UA (keep parsed fields) — full UA not needed client-side
  return (Array.isArray(history) ? history : []).map((h) => ({
    t: h.t,
    ip: h.ip,
    ref: h.ref || '',
    browser: h.browser,
    os: h.os,
    device: h.device,
    geo: h.geo
  }));
}

app.get('/api/qr/:code', (request, response) => {
  const store = readStore();
  const item = store[request.params.code];
  if (!item) return response.status(404).json({ error: 'Tracked link not found.' });

  const cookies = auth.parseCookies(request);
  const user = auth.getUserBySessionToken(cookies.pdf_session);
  const isOwner = item.userId && user && user.id === item.userId;
  const isPublicView = !item.userId; // anonymous codes are fully public

  return response.json({
    code: request.params.code,
    kind: item.kind || 'qr',
    label: item.label,
    destination: item.destination,
    createdAt: item.createdAt,
    clicks: item.clicks,
    lastClickedAt: item.lastClickedAt,
    redirectUrl: `${publicBaseUrl.replace(/\/$/, '')}/r/${request.params.code}`,
    webhookUrl: (isOwner || isPublicView) ? (item.webhookUrl || null) : null,
    style: item.style || DEFAULT_STYLE,
    // Full detail (history + stats) only for owner or anonymous codes
    stats: (isOwner || isPublicView) ? summarizeStats(item) : null,
    history: (isOwner || isPublicView) ? sanitizeHistory(item.history) : null
  });
});

// Edit label / destination (owner only)
app.patch('/api/qr/:code', (request, response) => {
  const store = readStore();
  const item = store[request.params.code];
  if (!item) return response.status(404).json({ error: 'Tracked link not found.' });

  const cookies = auth.parseCookies(request);
  const user = auth.getUserBySessionToken(cookies.pdf_session);
  if (item.userId && (!user || user.id !== item.userId)) {
    return response.status(403).json({ error: 'You can only edit your own QR codes.' });
  }

  try {
    if (typeof request.body?.label === 'string') {
      item.label = request.body.label.trim().slice(0, 80);
    }
    if (typeof request.body?.destination === 'string') {
      item.destination = normalizeHttpUrl(request.body.destination);
    }
    if (typeof request.body?.webhookUrl === 'string') {
      const w = request.body.webhookUrl.trim().slice(0, 500);
      const cookies2 = auth.parseCookies(request);
      const u2 = auth.getUserBySessionToken(cookies2.pdf_session);
      if (w !== '' && u2 && !TIER_LIMITS[tierOf(u2)].webhooks) {
        return response.status(403).json({ error: 'Webhook alerts are a Pro feature.' });
      }
      if (w === '') delete item.webhookUrl;
      else item.webhookUrl = w;
    }
    if (request.body?.style) item.style = sanitizeStyle(request.body.style);
    writeStore(store);
    response.json({ ok: true, label: item.label, destination: item.destination, webhookUrl: item.webhookUrl || null, style: item.style || DEFAULT_STYLE });
  } catch (error) {
    response.status(400).json({ error: error.message || 'Unable to update.' });
  }
});

// Regenerate QR image for a code (PNG data URL)
app.get('/api/qr/:code/image', async (request, response) => {
  const store = readStore();
  const item = store[request.params.code];
  if (!item) return response.status(404).json({ error: 'Tracked link not found.' });

  const encodedValue = `${publicBaseUrl.replace(/\/$/, '')}/r/${request.params.code}`;
  try {
    const qrDataUrl = await QRCode.toDataURL(encodedValue, {
      errorCorrectionLevel: 'M',
      margin: 2,
      width: 720,
      color: { dark: '#0b0b0b', light: '#ffffff' }
    });
    response.json({ qrDataUrl });
  } catch (error) {
    response.status(500).json({ error: 'Unable to render QR code.' });
  }
});

app.get('/r/:code', async (request, response) => {
  const store = readStore();
  const item = store[request.params.code];
  if (!item) return response.status(404).send('Tracked link not found.');

  item.clicks += 1;
  item.lastClickedAt = new Date().toISOString();
  const entry = tracker.recordClick(item, request);
  writeStore(store);

  // Geo enrichment happens AFTER the redirect is sent (never blocks)
  response.redirect(302, item.destination);
  tracker.enrichWithGeo(item, entry)
    .then(() => tracker.notifyWebhook(item, request.params.code, entry, item.destination))
    .catch(() => {});
});

// ─── YouTube Transcript Routes ───────────────────────────────────────────────

const YOUTUBE_RE = /(?:youtube\.com\/(?:[^/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?/\s]{11})/i;

function extractVideoId(input) {
  const url = String(input || '').trim();
  if (url.length === 11 && /^[A-Za-z0-9_-]{11}$/.test(url)) return url;
  const match = url.match(YOUTUBE_RE);
  if (match) return match[1];
  return null;
}

app.get('/api/youtube/info', async (request, response) => {
  try {
    const url = request.query.url;
    if (!url) return response.status(400).json({ error: 'Missing url query parameter.' });

    const videoId = extractVideoId(url);
    if (!videoId) return response.status(400).json({ error: 'Could not extract a valid YouTube video ID from the URL.' });

    // Fetch the YouTube watch page and extract metadata from the initial data JSON
    const pageResp = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });
    if (!pageResp.ok) {
      return response.status(502).json({ error: 'Unable to reach YouTube.' });
    }
    const html = await pageResp.text();

    // Try to extract ytInitialData for title and channel
    let title = null;
    let channel = null;

    // Extract from ytInitialData
    const initDataMatch = html.match(/var\s+ytInitialData\s*=\s*/);
    if (initDataMatch) {
      const jsonStart = html.indexOf('{', initDataMatch.index);
      if (jsonStart !== -1) {
        let depth = 0;
        for (let i = jsonStart; i < html.length; i++) {
          if (html[i] === '{') depth++;
          else if (html[i] === '}') {
            depth--;
            if (depth === 0) {
              try {
                const data = JSON.parse(html.slice(jsonStart, i + 1));
                // Navigate to video title
                const contents = data?.contents?.twoColumnWatchNextResults?.results?.results?.contents;
                if (contents) {
                  for (const c of contents) {
                    if (c.videoPrimaryInfoRenderer) {
                      title = c.videoPrimaryInfoRenderer?.title?.runs?.[0]?.text || null;
                    }
                    if (c.videoSecondaryInfoRenderer) {
                      channel = c.videoSecondaryInfoRenderer?.owner?.videoOwnerRenderer?.title?.runs?.[0]?.text || null;
                    }
                  }
                }
                break;
              } catch { /* ignore parse errors */ }
            }
          }
        }
      }
    }

    // Fallback: extract title from <meta> tag
    if (!title) {
      const titleMatch = html.match(/<meta\s+name="title"\s+content="([^"]+)"/i)
        || html.match(/<title>(.+?)<\/title>/i);
      if (titleMatch) title = titleMatch[1].replace(' - YouTube', '').trim();
    }

    response.json({
      videoId,
      title: title || 'Unknown title',
      channel: channel || 'Unknown channel',
      thumbnail: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
      videoUrl: `https://www.youtube.com/watch?v=${videoId}`,
    });
  } catch (error) {
    console.error('YouTube info error:', error);
    response.status(500).json({ error: error.message || 'Failed to fetch video info.' });
  }
});

app.post('/api/youtube/transcript', express.json({ limit: '4kb' }), async (request, response) => {
  try {
    const { url } = request.body || {};
    if (!url) return response.status(400).json({ error: 'Missing url in request body.' });

    const videoId = extractVideoId(url);
    if (!videoId) return response.status(400).json({ error: 'Could not extract a valid YouTube video ID from the URL.' });

    const transcript = await YoutubeTranscript.fetchTranscript(videoId);

    if (!transcript || transcript.length === 0) {
      return response.status(404).json({ error: 'No transcript available for this video.' });
    }

    // Normalize offsets: the library returns milliseconds for srv3 and seconds for classic format.
    // We detect which format and normalize everything to seconds.
    const hasMilliseconds = transcript.some(item => item.offset > 100000 || (item.duration && item.duration > 1000));
    const normalizedTranscript = transcript.map(item => ({
      text: item.text,
      offset: hasMilliseconds ? item.offset / 1000 : item.offset,
      duration: item.duration
        ? (hasMilliseconds ? item.duration / 1000 : item.duration)
        : 0,
      lang: item.lang || 'en',
    }));

    response.json({
      videoId,
      transcript: normalizedTranscript,
      lang: normalizedTranscript[0]?.lang || 'en',
    });
  } catch (error) {
    console.error('YouTube transcript error:', error);
    const message = String(error.message || error);
    if (message.includes('TooManyRequest')) {
      return response.status(429).json({ error: 'YouTube is rate-limiting requests. Please try again later.' });
    }
    if (message.includes('VideoUnavailable')) {
      return response.status(404).json({ error: 'This video is unavailable.' });
    }
    if (message.includes('TranscriptDisabled') || message.includes('NotAvailable')) {
      return response.status(404).json({ error: 'Transcript is not available for this video.' });
    }
    response.status(500).json({ error: message || 'Failed to fetch transcript.' });
  }
});

app.use((error, _request, response, _next) => {
  console.error(error);
  response.status(500).json({ error: 'Internal server error.' });
});

app.listen(port, '127.0.0.1', () => {
  console.log(`Parent Data Force Tools listening on http://127.0.0.1:${port}`);
});

export { app, normalizeHttpUrl };
