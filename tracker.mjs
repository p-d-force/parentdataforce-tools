// Parent Data Force — click tracking + geolocation enrichment
// Stores per-click history per link (capped), with cached IP geolocation.
// Geo lookups are async post-response (never block the redirect).

import fs from 'node:fs';
import path from 'node:path';

const HISTORY_CAP = 200;

export class Tracker {
  constructor(dataDirectory, storeIo) {
    // storeIo: { readStore(), writeStore(store) } — wired from server.mjs
    this.storeIo = storeIo;
    this.geoPath = path.join(dataDirectory, 'geo-cache.json');
    try {
      if (!fs.existsSync(this.geoPath)) fs.writeFileSync(this.geoPath, '{}\n', { mode: 0o600 });
    } catch { /* ignore */ }
  }

  _readCache() {
    try {
      const contents = fs.readFileSync(this.geoPath, 'utf8').trim();
      if (!contents) return {};
      const parsed = JSON.parse(contents);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }

  _writeCache(cache) {
    const temporaryPath = `${this.geoPath}.${process.pid}.tmp`;
    fs.writeFileSync(temporaryPath, `${JSON.stringify(cache, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(temporaryPath, this.geoPath);
  }

  // ── Client IP ───────────────────────────────────────────────────────
  clientIp(req) {
    const xff = req.headers['x-forwarded-for'];
    if (xff) {
      const first = String(xff).split(',')[0].trim();
      if (first) return first;
    }
    return req.socket?.remoteAddress || 'unknown';
  }

  isPrivateIp(ip) {
    const clean = String(ip || '').replace(/^::ffff:/, '');
    if (!clean || clean === 'unknown' || clean === '::1' || clean === '127.0.0.1') return true;
    if (/^10\./.test(clean) || /^192\.168\./.test(clean) || /^172\.(1[6-9]|2\d|3[01])\./.test(clean)) return true;
    if (/^169\.254\./.test(clean)) return true;
    return false;
  }

  // ── Geo lookup (cached 30d) ─────────────────────────────────────────
  async lookUpGeo(ip) {
    if (this.isPrivateIp(ip)) return { source: 'private' };
    const cache = this._readCache();
    const cached = cache[ip];
    if (cached && cached.at && Date.now() - cached.at < 30 * 24 * 60 * 60 * 1000) {
      return cached.data;
    }

    const geo = await this._fetchGeo(ip);
    if (geo) {
      cache[ip] = { data: geo, at: Date.now() };
      this._writeCache(cache);
    }
    return geo || null;
  }

  async _fetchGeo(ip) {
    // Primary: ip-api.com (free, no key, 45 req/min)
    try {
      const res = await fetch(
        `http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,country,countryCode,regionName,city,lat,lon,isp,query`,
        { signal: AbortSignal.timeout(3000) }
      );
      if (res.ok) {
        const d = await res.json();
        if (d.status === 'success') {
          return {
            source: 'ip-api',
            country: d.country,
            countryCode: d.countryCode,
            region: d.regionName,
            city: d.city,
            lat: d.lat,
            lon: d.lon,
            isp: d.isp,
          };
        }
      }
    } catch { /* fall through */ }

    // Fallback: ipwho.is
    try {
      const res = await fetch(`https://ipwho.is/${encodeURIComponent(ip)}`, {
        signal: AbortSignal.timeout(3000),
      });
      if (res.ok) {
        const d = await res.json();
        if (d.success) {
          return {
            source: 'ipwho',
            country: d.country,
            countryCode: d.country_code,
            region: d.region,
            city: d.city,
            lat: d.latitude,
            lon: d.longitude,
            isp: d.connection?.isp || null,
          };
        }
      }
    } catch { /* give up */ }

    return null;
  }

  // ── Device/browser parsing (lightweight, no deps) ───────────────────
  parseUserAgent(ua) {
    const s = String(ua || '');
    let browser = 'Unknown';
    if (/Edg\//.test(s)) browser = 'Edge';
    else if (/OPR\//.test(s) || /Opera/.test(s)) browser = 'Opera';
    else if (/Chrome\//.test(s)) browser = 'Chrome';
    else if (/Safari\//.test(s) && !/Chrome/.test(s)) browser = 'Safari';
    else if (/Firefox\//.test(s)) browser = 'Firefox';
    else if (/MSIE|Trident/.test(s)) browser = 'Internet Explorer';
    else if (/curl|wget/.test(s)) browser = 'CLI';

    let os = 'Unknown';
    if (/Windows NT 10/.test(s)) os = 'Windows 10/11';
    else if (/Windows NT 6\.1/.test(s)) os = 'Windows 7';
    else if (/Android/.test(s)) os = 'Android';
    else if (/iPhone|iPad|iPod/.test(s)) os = 'iOS';
    else if (/Mac OS X/.test(s)) os = 'macOS';
    else if (/Linux/.test(s)) os = 'Linux';

    let device = 'Unknown';
    if (/iPhone/.test(s)) device = 'Phone';
    else if (/iPad/.test(s)) device = 'Tablet';
    else if (/Android/.test(s)) device = /Mobile/.test(s) ? 'Phone' : 'Tablet';
    else if (/Windows|Macintosh|Linux/.test(s)) device = 'Desktop';

    return { browser, os, device };
  }

  // ── Click history ───────────────────────────────────────────────────
  recordClick(item, req) {
    const ip = this.clientIp(req);
    const entry = {
      t: new Date().toISOString(),
      ip,
      ua: String(req.headers['user-agent'] || ''),
      ref: String(req.headers['referer'] || ''),
      geo: null,
    };
    const { browser, os, device } = this.parseUserAgent(entry.ua);
    entry.device = device;
    entry.os = os;
    entry.browser = browser;

    if (!Array.isArray(item.history)) item.history = [];
    item.history.push(entry);
    if (item.history.length > HISTORY_CAP) item.history = item.history.slice(-HISTORY_CAP);
    return entry;
  }

  // Async enrichment — fill geo for a click entry after response sent
  async enrichWithGeo(item, entry) {
    const geo = await this.lookUpGeo(entry.ip);
    if (!geo) return;
    entry.geo = geo;
    try {
      const store = this.storeIo.readStore();
      const target = Object.values(store).find((it) =>
        Array.isArray(it.history) &&
        it.history.some((h) => h.t === entry.t && h.ip === entry.ip)
      );
      if (target) {
        const hit = target.history.find((h) => h.t === entry.t && h.ip === entry.ip);
        if (hit) hit.geo = geo;
        this.storeIo.writeStore(store);
      }
    } catch { /* best effort */ }
  }
}
