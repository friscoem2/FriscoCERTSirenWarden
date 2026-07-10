const crypto = require('crypto');

const SESSION_COOKIE_NAME = 'cert_session';
const SESSION_TTL_SECONDS = 30 * 60;

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
  const payload = {
    sub: String(username || '').trim(),
    iat: now,
    exp: now + SESSION_TTL_SECONDS,
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

  let payload;
  try {
    payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }

  const now = Math.floor(Date.now() / 1000);
  if (!payload.sub || !payload.exp || payload.exp <= now) return null;

  return payload;
}

function parseCookies(cookieHeader = '') {
  return cookieHeader.split(';').reduce((cookies, part) => {
    const index = part.indexOf('=');
    if (index < 0) return cookies;
    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
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
    `Max-Age=${SESSION_TTL_SECONDS}`,
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
  SESSION_TTL_SECONDS,
  createSessionToken,
  verifySessionToken,
  parseCookies,
  makeSessionCookie,
  clearSessionCookie,
};
