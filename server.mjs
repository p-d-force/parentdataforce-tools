import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import dns from 'node:dns/promises';
import { fileURLToPath } from 'node:url';
import express from 'express';
import QRCode from 'qrcode';
import { YoutubeTranscript } from 'youtube-transcript';
import { Auth } from './auth.mjs';
import { Tracker } from './tracker.mjs';
import { sendEmail } from './mail.mjs';

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

// Request a password reset — always answer identically to avoid leaking account existence.
app.post('/api/auth/forgot', async (request, response) => {
  const email = String(request.body?.email || '').trim().toLowerCase();
  const generic = { ok: true, message: 'If an account exists for that email, a reset link is on its way.' };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return response.json(generic);

  const user = auth.findUserByEmail(email);
  if (!user) return response.json(generic);

  const token = auth.createResetToken(user.id);
  // Link back to the host the user is on (tools.parentdataforce.org is the public one)
  const host = request.get('host') || 'tools.parentdataforce.org';
  const resetUrl = `https://${host}/tools/qr/?reset=${encodeURIComponent(token)}`;

  try {
    await sendEmail({
      to: user.email,
      subject: 'Reset your Parent Data Force password',
      html: `
<p>Someone asked to reset the password for your Parent Data Force account.</p>
<p><a href="${resetUrl}" style="display:inline-block;background:#0b5cad;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none">Reset your password</a></p>
<p>Or copy this link: ${resetUrl}</p>
<p>This link expires in 1 hour. If you didn't request this, you can ignore this email.</p>
<p>— Parent Data Force</p>`
    });
    response.json(generic);
  } catch (error) {
    console.error('reset email failed:', error.message);
    response.status(502).json({ error: 'Could not send the reset email right now. Please try again in a few minutes.' });
  }
});

// Complete a password reset with a one-time token.
app.post('/api/auth/reset', (request, response) => {
  try {
    const token = String(request.body?.token || '');
    const password = String(request.body?.password || '');
    if (!token) return response.status(400).json({ error: 'Reset link is missing a token.' });
    const userId = auth.consumeResetToken(token);
    if (!userId) return response.status(400).json({ error: 'This reset link is invalid or has expired. Request a new one.' });
    const user = auth.setPassword(userId, password);
    auth.destroyAllSessions(userId);
    response.json({ ok: true, user: { id: user.id, email: user.email, plan: user.plan } });
  } catch (error) {
    response.status(400).json({ error: error.message || 'Unable to reset password.' });
  }
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

// ── Docling Lab API (AI document conversion + PDF forensics) ──────────
// Backends: docling-serve on 127.0.0.1:5001 (FastAPI), pdf-lab on 127.0.0.1:5100.
// Both stay localhost-only; nginx + this server are the only entry points.
const DOCLING_SERVE_URL = process.env.DOCLING_SERVE_URL || 'http://127.0.0.1:5001';
const DOCLING_SERVE_API_KEY = process.env.DOCLING_SERVE_API_KEY || '';
const PDF_LAB_URL = process.env.PDF_LAB_URL || 'http://127.0.0.1:5100';
const DOCLING_TIMEOUT_MS = Number(process.env.DOCLING_TIMEOUT_MS || 600000);
// Caps mirrored from docling-serve env so nginx/Node reject early with a clear 413
const DOCLING_MAX_UPLOAD = Number(process.env.DOCLING_MAX_UPLOAD || 50 * 1024 * 1024);
const DOCLING_MAX_PAGES = Number(process.env.DOCLING_MAX_PAGES || 400);

function dlAuthHeaders(extra = {}) {
  const headers = { ...extra };
  if (DOCLING_SERVE_API_KEY) headers['X-Api-Key'] = DOCLING_SERVE_API_KEY;
  return headers;
}

function parseJsonHeader(value, fallback) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function safeFilename(value) {
  const base = String(value || 'document.pdf');
  const name = base.split(/[\\/]/).pop().trim();
  return name && name.length <= 255 ? name : 'document.pdf';
}

// SSRF guard for convert-url: resolve hostname and reject private/loopback/
// link-local/literal-IP targets so the server can't be used to poke internal
// services (metadata endpoints, localhost apps, VPC ranges). Redirect-follow
// cap lives at the fetch call site (manual, max 3).
const PRIVATE_IPV4 = [
  { name: 'loopback', re: /^127\./ },
  { name: 'private-10', re: /^10\./ },
  { name: 'private-172', re: /^172\.(1[6-9]|2[0-9]|3[01])\./ },
  { name: 'private-192', re: /^192\.168\./ },
  { name: 'link-local', re: /^169\.254\./ },
  { name: 'carrier-grade-nat', re: /^100\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\./ },
];
const PRIVATE_IPV6 = [
  { name: 'loopback6', re: /^::1$/ },
  { name: 'link-local6', re: /^fe80:/i },
  { name: 'unique-local6', re: /^fc00:/i },
  { name: 'ula6', re: /^fd[0-9a-f]{2}:/i },
  { name: 'unspecified6', re: /^::$/ },
];

function isPrivateIp(address) {
  const ip = String(address || '').toLowerCase();
  if (ip.includes('.')) return PRIVATE_IPV4.find(r => r.re.test(ip))?.name || null;
  return PRIVATE_IPV6.find(r => r.re.test(ip))?.name || null;
}

async function assertSafeUrl(rawUrl, redirectsLeft = 3) {
  let parsed;
  try { parsed = new URL(rawUrl); } catch { throw Object.assign(new Error('Invalid URL.'), { status: 400, expose: true }); }
  if (!/^https?:$/i.test(parsed.protocol)) {
    throw Object.assign(new Error('Only http(s) URLs are allowed.'), { status: 400, expose: true });
  }
  const hostname = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();

  // Literal IPs: check directly.
  const literalIp = /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname) || hostname.includes(':');
  if (literalIp) {
    const hit = isPrivateIp(hostname);
    if (hit) throw Object.assign(new Error(`Blocked: ${hit} IP addresses are not allowed.`), { status: 400, expose: true });
    return { url: parsed.toString(), hostname };
  }

  // Hostname: resolve and check every A/AAAA record.
  let records;
  try {
    records = await dns.lookup(hostname, { all: true, verbatim: true });
  } catch (e) {
    throw Object.assign(new Error(`DNS resolution failed for ${hostname}.`), { status: 400, expose: true });
  }
  if (!records || records.length === 0) {
    throw Object.assign(new Error(`No addresses for ${hostname}.`), { status: 400, expose: true });
  }
  for (const rec of records) {
    const hit = isPrivateIp(rec.address);
    if (hit) throw Object.assign(new Error(`Blocked: ${hostname} resolves to ${hit} address (${rec.address}).`), { status: 400, expose: true });
  }
  return { url: parsed.toString(), hostname };
}

// Follow up to `max` redirects, re-running the SSRF check at each hop.
async function fetchWithSafeRedirects(url, init, max = 3) {
  let current = url;
  for (let hop = 0; hop <= max; hop++) {
    const { url: safeUrl } = await assertSafeUrl(current);
    const r = await fetch(safeUrl, init);
    if (r.status >= 300 && r.status < 400 && r.headers.get('location')) {
      current = new URL(r.headers.get('location'), safeUrl).toString();
      continue;
    }
    return r;
  }
  throw Object.assign(new Error('Too many redirects.'), { status: 400, expose: true });
}

async function proxyJsonError(error, response, label) {
  console.error(`Docling Lab ${label} error:`, error);
  if (response.headersSent) return;
  // Typed client errors (SSRF guard 400s, payload caps) pass through as-is;
  // everything else is a backend failure → 502.
  if (error.status && error.status >= 400 && error.status < 500) {
    return response.status(error.status).json({ error: String(error.message || 'Bad request.') });
  }
  response.status(502).json({ error: `${label} failed: ${String(error.message || error)}` });
}

// Health — reports both backends
app.get('/api/docling/health', async (_request, response) => {
  const status = { docling: 'down', lab: 'down', time: new Date().toISOString() };
  try {
    const r = await fetch(`${DOCLING_SERVE_URL}/health`, { headers: dlAuthHeaders(), signal: AbortSignal.timeout(8000) });
    status.docling = r.ok ? 'up' : `error:${r.status}`;
  } catch (e) { status.docling = `down:${e.message}`; }
  try {
    const r = await fetch(`${PDF_LAB_URL}/health`, { signal: AbortSignal.timeout(5000) });
    status.lab = r.ok ? 'up' : `error:${r.status}`;
  } catch (e) { status.lab = `down:${e.message}`; }
  response.json(status);
});

// Convert an uploaded file (raw binary body). The browser sends the file bytes
// with Content-Type + X-Filename + X-Options headers; we forward to docling-serve
// as a base64 file_sources payload (no multipart parsing needed).
app.post('/api/docling/convert',
  express.raw({ type: () => true, limit: DOCLING_MAX_UPLOAD + (1024 * 1024) }),
  async (request, response) => {
    try {
      const filename = safeFilename(request.get('x-filename'));
      const options = parseJsonHeader(request.get('x-options'), {});
      if (!request.body || request.body.length === 0) {
        return response.status(400).json({ error: 'Empty upload body.' });
      }
      if (request.body.length > DOCLING_MAX_UPLOAD) {
        return response.status(413).json({ error: `File exceeds ${Math.round(DOCLING_MAX_UPLOAD / 1024 / 1024)}MB limit.` });
      }
      const payload = {
        options: {
          from_formats: ['pdf', 'docx', 'pptx', 'html', 'image', 'asciidoc', 'md', 'xlsx'],
          to_formats: ['md', 'json', 'text', 'html', 'doctags'],
          pdf_backend: 'dlparse_v2',
          do_ocr: true,
          abort_on_error: false,
          ...options,
        },
        // v1 API: sources[] with a kind discriminator (file | http | ...)
        sources: [{ kind: 'file', base64_string: request.body.toString('base64'), filename }],
      };
      const r = await fetch(`${DOCLING_SERVE_URL}/v1/convert/source`, {
        method: 'POST',
        headers: dlAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(DOCLING_TIMEOUT_MS),
      });
      const bodyText = await r.text();
      if (!r.ok) {
        return response.status(r.status).json({ error: `docling-serve ${r.status}`, detail: bodyText.slice(0, 2000) });
      }
      let data = null;
      try { data = JSON.parse(bodyText); } catch { data = { raw: bodyText.slice(0, 20000) }; }
      response.json({ ok: true, filename, options, data });
    } catch (error) {
      await proxyJsonError(error, response, 'convert');
    }
  });

// Convert a remote URL (http/https only). SSRF-guarded: we validate the target
// (private/loopback/link-local rejected, redirect cap 3), fetch the bytes
// ourselves with a size cap, then hand docling-serve a FILE source — docling
// never fetches the URL itself, so no second-hop SSRF.
app.post('/api/docling/convert-url', express.json({ limit: '16kb' }), async (request, response) => {
  try {
    const { url, options } = request.body || {};
    if (!url || !/^https?:\/\//i.test(String(url))) {
      return response.status(400).json({ error: 'A valid http(s) URL is required.' });
    }
    await assertSafeUrl(String(url));

    // Fetch with redirect cap; each hop re-validated by assertSafeUrl.
    const r = await fetchWithSafeRedirects(String(url), {
      headers: { 'User-Agent': 'ParentDataForce-DoclingLab/1.0 (+https://parentdataforce.org)' },
      redirect: 'manual',
      signal: AbortSignal.timeout(30000),
    });
    if (!r.ok) {
      return response.status(502).json({ error: `Upstream ${r.status} while fetching URL.` });
    }
    const totalBytes = Number(r.headers.get('content-length') || 0);
    if (totalBytes > DOCLING_MAX_UPLOAD) {
      return response.status(413).json({ error: `Remote file exceeds ${Math.round(DOCLING_MAX_UPLOAD / 1024 / 1024)}MB limit.` });
    }
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length === 0) {
      return response.status(400).json({ error: 'Remote URL returned an empty body.' });
    }
    if (buf.length > DOCLING_MAX_UPLOAD) {
      return response.status(413).json({ error: `Remote file exceeds ${Math.round(DOCLING_MAX_UPLOAD / 1024 / 1024)}MB limit.` });
    }
    const filename = safeFilename(decodeURIComponent(path.basename(new URL(r.url || url).pathname)) || 'remote.pdf');

    const payload = {
      options: {
        from_formats: ['pdf', 'docx', 'pptx', 'html', 'image', 'asciidoc', 'md', 'xlsx'],
        to_formats: ['md', 'json', 'text', 'html', 'doctags'],
        pdf_backend: 'dlparse_v2',
        do_ocr: true,
        abort_on_error: false,
        ...(options || {}),
      },
      sources: [{ kind: 'file', base64_string: buf.toString('base64'), filename }],
    };
    const dr = await fetch(`${DOCLING_SERVE_URL}/v1/convert/source`, {
      method: 'POST',
      headers: dlAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(DOCLING_TIMEOUT_MS),
    });
    const bodyText = await dr.text();
    if (!dr.ok) {
      return response.status(dr.status).json({ error: `docling-serve ${dr.status}`, detail: bodyText.slice(0, 2000) });
    }
    let data = null;
    try { data = JSON.parse(bodyText); } catch { data = { raw: bodyText.slice(0, 20000) }; }
    response.json({ ok: true, url: r.url || url, filename, options: options || {}, data });
  } catch (error) {
    await proxyJsonError(error, response, 'convert-url');
  }
});

// Convert an uploaded file ASYNC (returns task_id immediately, poll /job/:id).
// Same payload contract as /convert; docling-serve queues it and the client
// polls status until done. Keeps long conversions off the HTTP connection.
app.post('/api/docling/convert-async',
  express.raw({ type: () => true, limit: DOCLING_MAX_UPLOAD + (1024 * 1024) }),
  async (request, response) => {
    try {
      const filename = safeFilename(request.get('x-filename'));
      const options = parseJsonHeader(request.get('x-options'), {});
      if (!request.body || request.body.length === 0) {
        return response.status(400).json({ error: 'Empty upload body.' });
      }
      if (request.body.length > DOCLING_MAX_UPLOAD) {
        return response.status(413).json({ error: `File exceeds ${Math.round(DOCLING_MAX_UPLOAD / 1024 / 1024)}MB limit.` });
      }
      const payload = {
        options: {
          from_formats: ['pdf', 'docx', 'pptx', 'html', 'image', 'asciidoc', 'md', 'xlsx'],
          to_formats: ['md', 'json', 'text', 'html', 'doctags'],
          pdf_backend: 'dlparse_v2',
          do_ocr: true,
          abort_on_error: false,
          ...options,
        },
        sources: [{ kind: 'file', base64_string: request.body.toString('base64'), filename }],
      };
      const r = await fetch(`${DOCLING_SERVE_URL}/v1/convert/source/async`, {
        method: 'POST',
        headers: dlAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(30000),
      });
      const bodyText = await r.text();
      if (!r.ok) {
        return response.status(r.status).json({ error: `docling-serve ${r.status}`, detail: bodyText.slice(0, 2000) });
      }
      let data = null;
      try { data = JSON.parse(bodyText); } catch { data = { raw: bodyText.slice(0, 20000) }; }
      response.status(202).json({ ok: true, filename, options, task_id: data.task_id, status: data.task_status || 'pending' });
    } catch (error) {
      await proxyJsonError(error, response, 'convert-async');
    }
  });

// Poll an async conversion job. When done, returns the full conversion result
// (same shape as /convert). When still running, returns { status } so the
// client keeps polling every ~3s.
app.get('/api/docling/job/:id', async (request, response) => {
  try {
    const taskId = String(request.params.id || '').trim();
    if (!taskId) return response.status(400).json({ error: 'task id required' });

    const statusR = await fetch(`${DOCLING_SERVE_URL}/v1/status/poll/${encodeURIComponent(taskId)}`, {
      headers: dlAuthHeaders(),
      signal: AbortSignal.timeout(20000),
    });
    const statusText = await statusR.text();
    if (!statusR.ok) {
      return response.status(statusR.status).json({ error: `docling-serve ${statusR.status}`, detail: statusText.slice(0, 2000) });
    }
    let status = null;
    try { status = JSON.parse(statusText); } catch { status = { raw: statusText.slice(0, 2000) }; }

    const taskStatus = String(status.task_status || 'unknown').toLowerCase();
    // Terminal states (docling-serve v1): success, failure, timeout, cancelled
    const done = ['success', 'failed', 'failure', 'timeout', 'cancelled', 'error'].includes(taskStatus);
    if (!done) {
      return response.json({ ok: true, task_id: taskId, status: taskStatus, position: status.task_position });
    }

    if (taskStatus !== 'success') {
      return response.json({ ok: false, task_id: taskId, status: taskStatus, error_message: status.error_message || 'conversion failed' });
    }

    const resultR = await fetch(`${DOCLING_SERVE_URL}/v1/result/${encodeURIComponent(taskId)}`, {
      headers: dlAuthHeaders(),
      signal: AbortSignal.timeout(30000),
    });
    const resultText = await resultR.text();
    if (!resultR.ok) {
      return response.status(resultR.status).json({ error: `docling-serve ${resultR.status}`, detail: resultText.slice(0, 2000) });
    }
    let result = null;
    try { result = JSON.parse(resultText); } catch { result = { raw: resultText.slice(0, 20000) }; }
    response.json({ ok: true, task_id: taskId, status: 'success', data: result });
  } catch (error) {
    await proxyJsonError(error, response, 'job');
  }
});

// Extract tables from a docling JSON document (from a prior convert) — forwards
// to pdf-lab /extract-tables. Returns per-table CSV (default) or XLSX file.
app.post('/api/docling/extract-tables', express.json({ limit: '20mb' }), async (request, response) => {
  try {
    const body = request.body || {};
    // Accept either { document: <docling json> } or a bare docling JSON document.
    const document = (body.document && typeof body.document === 'object') ? body.document : (body.schema_name || body.tables ? body : null);
    const format = body.format || request.query.format || 'csv';
    if (!document || typeof document !== 'object') {
      return response.status(400).json({ error: 'A docling JSON document is required.' });
    }
    const r = await fetch(`${PDF_LAB_URL}/extract-tables?format=${format === 'xlsx' ? 'xlsx' : 'csv'}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(document),
      signal: AbortSignal.timeout(60000),
    });
    if (!r.ok) {
      const bodyText = await r.text();
      return response.status(r.status).json({ error: `pdf-lab ${r.status}`, detail: bodyText.slice(0, 2000) });
    }
    if (format === 'xlsx') {
      // Binary pass-through: read bytes, NOT text, to avoid zip corruption.
      const buf = Buffer.from(await r.arrayBuffer());
      response.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      response.setHeader('Content-Disposition', 'attachment; filename="tables.xlsx"');
      return response.send(buf);
    }
    const bodyText = await r.text();
    let data = null;
    try { data = JSON.parse(bodyText); } catch { data = { raw: bodyText.slice(0, 20000) }; }
    response.json({ ok: true, ...data });
  } catch (error) {
    await proxyJsonError(error, response, 'extract-tables');
  }
});

// Batch convert: multiple files in one request (multipart form-data, files[]).
// Each file is queued as its own async job; the response lists task_ids that
// the client polls with /job/:id.
app.post('/api/docling/convert-batch',
  express.raw({ type: () => true, limit: (DOCLING_MAX_UPLOAD * 5) + (1024 * 1024) }),
  async (request, response) => {
    try {
      if (!request.body || request.body.length === 0) {
        return response.status(400).json({ error: 'Empty upload body.' });
      }
      // Batch framing: X-Filenames is a JSON array of names, X-Options per file optional.
      const filenames = parseJsonHeader(request.get('x-filenames'), []);
      if (!Array.isArray(filenames) || filenames.length === 0) {
        return response.status(400).json({ error: 'X-Filenames header must be a JSON array.' });
      }
      const options = parseJsonHeader(request.get('x-options'), {});
      // Simple framing: files concatenated with a 16-byte length prefix per file.
      // Layout: [len:4BE][bytes]...  (native endianness — both sides are Node here)
      const parts = [];
      let offset = 0;
      const buf = request.body;
      for (const fname of filenames) {
        if (offset + 4 > buf.length) break;
        const len = buf.readUInt32BE(offset);
        offset += 4;
        const chunk = buf.subarray(offset, offset + len);
        offset += len;
        parts.push({ filename: safeFilename(fname), bytes: chunk });
      }
      if (parts.length !== filenames.length) {
        return response.status(400).json({ error: 'Batch framing mismatch (length-prefixed concat expected).' });
      }
      const tasks = [];
      for (const part of parts) {
        const payload = {
          options: {
            from_formats: ['pdf', 'docx', 'pptx', 'html', 'image', 'asciidoc', 'md', 'xlsx'],
            to_formats: ['md', 'json', 'text', 'html', 'doctags'],
            pdf_backend: 'dlparse_v2',
            do_ocr: true,
            abort_on_error: false,
            ...(options || {}),
          },
          sources: [{ kind: 'file', base64_string: part.bytes.toString('base64'), filename: part.filename }],
        };
        const r = await fetch(`${DOCLING_SERVE_URL}/v1/convert/source/async`, {
          method: 'POST',
          headers: dlAuthHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(30000),
        });
        const bodyText = await r.text();
        if (!r.ok) {
          return response.status(r.status).json({ error: `docling-serve ${r.status}`, detail: bodyText.slice(0, 2000) });
        }
        let data = null;
        try { data = JSON.parse(bodyText); } catch { data = { raw: bodyText.slice(0, 2000) }; }
        tasks.push({ filename: part.filename, task_id: data.task_id, status: data.task_status || 'pending' });
      }
      response.status(202).json({ ok: true, count: tasks.length, tasks });
    } catch (error) {
      await proxyJsonError(error, response, 'convert-batch');
    }
  });

// Forensic scan of an uploaded file (raw binary body) — forwards to pdf-lab.
app.post('/api/docling/scan',
  express.raw({ type: () => true, limit: DOCLING_MAX_UPLOAD + (1024 * 1024) }),
  async (request, response) => {
    try {
      const filename = safeFilename(request.get('x-filename'));
      if (!request.body || request.body.length === 0) {
        return response.status(400).json({ error: 'Empty upload body.' });
      }
      if (request.body.length > DOCLING_MAX_UPLOAD) {
        return response.status(413).json({ error: `File exceeds ${Math.round(DOCLING_MAX_UPLOAD / 1024 / 1024)}MB limit.` });
      }
      const r = await fetch(`${PDF_LAB_URL}/scan`, {
        method: 'POST',
        headers: {
          'Content-Type': request.get('content-type') || 'application/octet-stream',
          'X-Filename': filename,
        },
        body: request.body,
        signal: AbortSignal.timeout(DOCLING_TIMEOUT_MS),
      });
      const bodyText = await r.text();
      if (!r.ok) {
        return response.status(r.status).json({ error: `pdf-lab ${r.status}`, detail: bodyText.slice(0, 2000) });
      }
      let data = null;
      try { data = JSON.parse(bodyText); } catch { data = { raw: bodyText.slice(0, 20000) }; }
      response.json({ ok: true, filename, data });
    } catch (error) {
      await proxyJsonError(error, response, 'scan');
    }
  });

app.use((error, _request, response, _next) => {
  console.error(error);
  // Respect status from body-parser (413 PayloadTooLarge) and other typed errors;
  // default to 500 for anything else.
  const status = Number(error.status || error.statusCode || 500);
  const message = (status >= 400 && status < 500 && error.type === 'entity.too.large')
    ? `File exceeds ${Math.round(DOCLING_MAX_UPLOAD / 1024 / 1024)}MB limit.`
    : error.expose
      ? error.message
      : 'Internal server error.';
  response.status(status).json({ error: message });
});

app.listen(port, '127.0.0.1', () => {
  console.log(`Parent Data Force Tools listening on http://127.0.0.1:${port}`);
});

export { app, normalizeHttpUrl };
