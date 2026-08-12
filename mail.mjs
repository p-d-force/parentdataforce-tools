// Parent Data Force — Gmail API mail sender (zero dependency, Node 18+ fetch)
// Sends email through joey@parentdataforce.com via OAuth2 refresh token.
// Credentials come from the same OAuth token used by the Hermes google_api tooling.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Allow MAIL_* env overrides, else fall back to the Hermes OAuth token file (dev convenience)
const TOKEN_FILE = process.env.GMAIL_TOKEN_FILE || path.join(__dirname, '.gmail-token.json');

function loadCreds() {
  if (process.env.GMAIL_CLIENT_ID && process.env.GMAIL_CLIENT_SECRET && process.env.GMAIL_REFRESH_TOKEN) {
    return {
      client_id: process.env.GMAIL_CLIENT_ID,
      client_secret: process.env.GMAIL_CLIENT_SECRET,
      refresh_token: process.env.GMAIL_REFRESH_TOKEN,
    };
  }
  try {
    const t = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
    if (t.client_id && t.client_secret && t.refresh_token) return t;
  } catch {
    /* fall through */
  }
  return null;
}

async function accessToken() {
  const creds = loadCreds();
  if (!creds) throw new Error('Gmail credentials not configured (GMAIL_CLIENT_ID/SECRET/REFRESH_TOKEN).');
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: creds.client_id,
      client_secret: creds.client_secret,
      refresh_token: creds.refresh_token,
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Token refresh failed (${res.status}): ${body.slice(0, 200)}`);
  }
  const data = await res.json();
  return data.access_token;
}

function base64url(str) {
  return Buffer.from(str, 'utf8').toString('base64url');
}

// Build a minimal RFC-822 message
function buildMessage({ to, subject, html }) {
  const lines = [
    `To: ${to}`,
    'From: Parent Data Force <joey@parentdataforce.com>',
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    html,
  ];
  return base64url(lines.join('\r\n'));
}

export async function sendEmail({ to, subject, html }) {
  const token = await accessToken();
  const raw = buildMessage({ to, subject, html });
  const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ raw }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Gmail send failed (${res.status}): ${body.slice(0, 300)}`);
  }
  return res.json();
}
