const crypto = require('node:crypto');

const COOKIE_NAME = '__Host-cert_username_lookup';
const LOOKUP_LIMIT = 3;
const WINDOW_MS = 15 * 60 * 1000;

function createUsernameLookupLimiter({ now = Date.now, maxClients = 10000 } = {}) {
  // This IP map belongs to one server instance. The signed browser cookie also
  // carries the counter between instances; neither is a shared firewall store.
  const clients = new Map();

  return function checkUsernameLookupLimit(req, res) {
    const secret = process.env.SESSION_SECRET || '';
    if (secret.length < 32) throw new Error('SESSION_SECRET is required for username lookup protection.');
    const at = now();
    const sign = value => crypto.createHmac('sha256', secret).update(`username-lookup:${value}`).digest('base64url');
    // Only trust forwarding headers when Vercel is the trusted ingress.
    const forwarded = process.env.VERCEL === '1'
      ? req.headers?.['x-vercel-forwarded-for'] || req.headers?.['x-forwarded-for']
      : '';
    const ip = String(forwarded || req.socket?.remoteAddress || 'unknown').split(',')[0].trim().toLowerCase();
    const key = sign(`ip:${ip}`);
    let ipState = clients.get(key);
    if (ipState?.resetAt <= at) { clients.delete(key); ipState = null; }

    let browserState = null;
    const token = String(req.headers?.cookie || '').match(/(?:^|;\s*)__Host-cert_username_lookup=([^;]*)/)?.[1] || '';
    if (token && token.length <= 512) {
      try {
        const [payload, signature, extra] = token.split('.');
        const expected = Buffer.from(sign(payload));
        const provided = Buffer.from(signature || '');
        if (extra === undefined && provided.length === expected.length && crypto.timingSafeEqual(provided, expected)) {
          const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
          if (Number.isInteger(parsed.count) && parsed.count >= 1 && parsed.count <= LOOKUP_LIMIT &&
              Number.isSafeInteger(parsed.resetAt) && parsed.resetAt > at && parsed.resetAt <= at + WINDOW_MS) {
            browserState = parsed;
          }
        }
      } catch { /* Invalid cookies cannot reset the IP counter. */ }
    }

    // Purge expired entries instead of evicting active limits during a flood.
    if (!ipState && clients.size >= maxClients) {
      for (const [client, state] of clients) if (state.resetAt <= at) clients.delete(client);
      if (clients.size >= maxClients) return { allowed: false, retryAfterSeconds: 60 };
    }

    const previous = [ipState, browserState].filter(Boolean);
    const count = Math.max(0, ...previous.map(state => state.count));
    const resetAt = previous.length ? Math.max(...previous.map(state => state.resetAt)) : at + WINDOW_MS;
    const allowed = count < LOOKUP_LIMIT;
    const state = { count: allowed ? count + 1 : count, resetAt };
    clients.set(key, state);
    const payload = Buffer.from(JSON.stringify(state)).toString('base64url');
    const retryAfterSeconds = Math.max(1, Math.ceil((resetAt - at) / 1000));
    res.setHeader('Set-Cookie', `${COOKIE_NAME}=${payload}.${sign(payload)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${retryAfterSeconds}`);
    return { allowed, retryAfterSeconds };
  };
}

module.exports = {
  createUsernameLookupLimiter,
  checkUsernameLookupLimit: createUsernameLookupLimiter(),
};
