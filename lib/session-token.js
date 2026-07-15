const crypto = require('crypto');

const SESSION_COOKIE_NAME = 'cert_session';
const DEFAULT_SESSION_TTL_MINUTES = 240;

function getSessionTtlSeconds() {
  const configured = Number.parseInt(process.env.SESSION_TTL_MINUTES || '', 10);
  const minutes = Number.isFinite(configured)
    ? Math.min(Math.max(configured, 30), 720)
    : DEFAULT_SESSION_TTL_MINUTES;
  return minutes * 60;
}

function base64url(input) {
  return Buffer.from(input).toString('base64url');
}

function getSecret() {
  const secret = process.env.SESSION_SECRET || '';
  if (secret.length < 32) {
    throw new Error('SESSION_SECRET must be configured with at least 32 characters.');
  }
  return secret;
}

function sign(encodedPayload) {
  return crypto
    .createHmac('sha256', getSecret())
    .update(encodedPayload)
    .digest('base64url');
}

function createSessionToken(username) {
  const now = Math.floor(Date.now() / 1000);
  const ttlSeconds = getSessionTtlSeconds();
  const payload = {
    sub: String(username || '').trim(),
    iat: now,
    exp: now + ttlSeconds,
  };

  if (!payload.sub) throw new Error('A username is required to create a session.');

  const encodedPayload = base64url(JSON.stringify(payload));
  return {
    token: `${encodedPayload}.${sign(encodedPayload)}`,
    expiresAt: payload.exp * 1000,
  };
}

function verifySessionToken(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;

  const [encodedPayload, providedSignature] = parts;
  const expectedSignature = sign(encodedPayload);
  const provided = Buffer.from(providedSignature);
  const expected = Buffer.from(expectedSignature);

  if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
    if (!payload.sub || !payload.exp || payload.exp <= Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

function parseCookies(header) {
  return String(header || '').split(';').reduce((cookies, item) => {
    const index = item.indexOf('=');
    if (index < 1) return cookies;
    const name = item.slice(0, index).trim();
    const value = item.slice(index + 1).trim();
    if (name) cookies[name] = decodeURIComponent(value);
    return cookies;
  }, {});
}

function makeSessionCookie(token) {
  return [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
    `Max-Age=${getSessionTtlSeconds()}`,
  ].join('; ');
}

function clearSessionCookie() {
  return [
    `${SESSION_COOKIE_NAME}=`,
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
    'Max-Age=0',
  ].join('; ');
}

module.exports = {
  SESSION_COOKIE_NAME,
  createSessionToken,
  verifySessionToken,
  parseCookies,
  makeSessionCookie,
  clearSessionCookie,
  getSessionTtlSeconds,
};
