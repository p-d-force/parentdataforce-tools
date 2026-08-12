// Parent Data Force — auth module (users + sessions)
// Zero-dependency: Node crypto scrypt for password hashing, JSON file store.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

export class Auth {
  constructor(dataDirectory) {
    this.dataDirectory = dataDirectory;
    this.usersPath = path.join(dataDirectory, 'users.json');
    this.sessionsPath = path.join(dataDirectory, 'sessions.json');
    this.resetsPath = path.join(dataDirectory, 'resets.json');
    fs.mkdirSync(dataDirectory, { recursive: true });
    this._ensureFile(this.usersPath);
    this._ensureFile(this.sessionsPath);
    this._ensureFile(this.resetsPath);
  }

  _ensureFile(p) {
    if (!fs.existsSync(p)) fs.writeFileSync(p, '{}\n', { mode: 0o600 });
  }

  _read(p) {
    try {
      const contents = fs.readFileSync(p, 'utf8').trim();
      if (!contents) return {};
      const parsed = JSON.parse(contents);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (error) {
      if (error.code === 'ENOENT') return {};
      throw error;
    }
  }

  _write(p, store) {
    const temporaryPath = `${p}.${process.pid}.tmp`;
    fs.writeFileSync(temporaryPath, `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(temporaryPath, p);
  }

  // ── Password hashing (scrypt) ──────────────────────────────────────
  hashPassword(password) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.scryptSync(password, salt, 64).toString('hex');
    return { salt, hash };
  }

  verifyPassword(password, salt, expectedHash) {
    const candidate = crypto.scryptSync(password, salt, 64);
    const expected = Buffer.from(expectedHash, 'hex');
    return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
  }

  // ── Users ──────────────────────────────────────────────────────────
  findUserByEmail(email) {
    const users = this._read(this.usersPath);
    const normalized = String(email || '').trim().toLowerCase();
    for (const [id, user] of Object.entries(users)) {
      if (user.email === normalized) return { id, ...user };
    }
    return null;
  }

  findUserById(userId) {
    const users = this._read(this.usersPath);
    const user = users[userId];
    if (!user) return null;
    return { id: userId, ...user };
  }

  createUser(email, password) {
    const users = this._read(this.usersPath);
    const normalized = String(email || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
      throw new Error('Enter a valid email address.');
    }
    if (!password || String(password).length < 8) {
      throw new Error('Password must be at least 8 characters.');
    }
    for (const user of Object.values(users)) {
      if (user.email === normalized) throw new Error('An account with that email already exists.');
    }
    const id = crypto.randomBytes(8).toString('hex');
    const { salt, hash } = this.hashPassword(String(password));
    users[id] = {
      email: normalized,
      salt,
      hash,
      plan: 'free',
      createdAt: new Date().toISOString(),
    };
    this._write(this.usersPath, users);
    return { id, email: normalized, plan: 'free', createdAt: users[id].createdAt };
  }

  // ── Sessions ───────────────────────────────────────────────────────
  createSession(userId) {
    const sessions = this._read(this.sessionsPath);
    // Garbage-collect expired sessions occasionally
    const now = Date.now();
    for (const [token, s] of Object.entries(sessions)) {
      if (s.expiresAt && s.expiresAt < now) delete sessions[token];
    }
    const token = crypto.randomBytes(32).toString('base64url');
    sessions[token] = {
      userId,
      createdAt: new Date().toISOString(),
      expiresAt: now + SESSION_TTL_MS,
    };
    this._write(this.sessionsPath, sessions);
    return token;
  }

  getUserBySessionToken(token) {
    if (!token) return null;
    const sessions = this._read(this.sessionsPath);
    const session = sessions[token];
    if (!session) return null;
    if (session.expiresAt && session.expiresAt < Date.now()) {
      delete sessions[token];
      this._write(this.sessionsPath, sessions);
      return null;
    }
    return this.findUserById(session.userId);
  }

  destroySession(token) {
    if (!token) return;
    const sessions = this._read(this.sessionsPath);
    if (sessions[token]) {
      delete sessions[token];
      this._write(this.sessionsPath, sessions);
    }
  }

  // ── Password reset ─────────────────────────────────────────────────
  createResetToken(userId) {
    const resets = this._read(this.resetsPath);
    const now = Date.now();
    // Garbage-collect expired tokens
    for (const [token, r] of Object.entries(resets)) {
      if (r.expiresAt && r.expiresAt < now) delete resets[token];
    }
    const token = crypto.randomBytes(32).toString('base64url');
    resets[token] = {
      userId,
      createdAt: new Date().toISOString(),
      expiresAt: now + RESET_TOKEN_TTL_MS,
    };
    this._write(this.resetsPath, resets);
    return token;
  }

  consumeResetToken(token) {
    if (!token) return null;
    const resets = this._read(this.resetsPath);
    const entry = resets[token];
    if (!entry) return null;
    if (entry.expiresAt && entry.expiresAt < Date.now()) {
      delete resets[token];
      this._write(this.resetsPath, resets);
      return null;
    }
    delete resets[token];
    this._write(this.resetsPath, resets);
    return entry.userId || null;
  }

  setPassword(userId, password) {
    if (!password || String(password).length < 8) {
      throw new Error('Password must be at least 8 characters.');
    }
    const users = this._read(this.usersPath);
    const user = users[userId];
    if (!user) throw new Error('Account not found.');
    const { salt, hash } = this.hashPassword(String(password));
    user.salt = salt;
    user.hash = hash;
    this._write(this.usersPath, users);
    return { id: userId, email: user.email, plan: user.plan };
  }

  destroyAllSessions(userId) {
    const sessions = this._read(this.sessionsPath);
    let changed = false;
    for (const [token, s] of Object.entries(sessions)) {
      if (s.userId === userId) {
        delete sessions[token];
        changed = true;
      }
    }
    if (changed) this._write(this.sessionsPath, sessions);
  }

  // ── Express helpers ────────────────────────────────────────────────
  parseCookies(req) {
    const header = req.headers.cookie || '';
    const out = {};
    header.split(';').forEach((pair) => {
      const idx = pair.indexOf('=');
      if (idx > -1) {
        const key = pair.slice(0, idx).trim();
        const val = pair.slice(idx + 1).trim();
        try { out[key] = decodeURIComponent(val); } catch { out[key] = val; }
      }
    });
    return out;
  }

  sessionCookie(token) {
    return `pdf_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`;
  }

  clearSessionCookie() {
    return 'pdf_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0';
  }
}
