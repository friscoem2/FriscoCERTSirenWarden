const { findUsernamesByEmail } = require('../lib/username-lookup');
const { checkUsernameLookupLimit } = require('../lib/username-lookup-limit');

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = null; }
  }
  const email = typeof body?.email === 'string' ? body.email.trim() : '';
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Please enter a valid email address.' });
  }

  try {
    const limit = checkUsernameLookupLimit(req, res);
    if (!limit.allowed) {
      res.setHeader('Retry-After', String(limit.retryAfterSeconds));
      return res.status(429).json({
        error: 'Too many username searches. Please wait before trying again or email sworden@friscotexas.gov for help.',
        retryAfterSeconds: limit.retryAfterSeconds,
      });
    }
    const usernames = await findUsernamesByEmail(email);
    return res.status(200).json({ found: usernames.length > 0, usernames });
  } catch {
    // Keep member details and upstream request URLs out of public errors and logs.
    console.error('CERT username lookup could not read the member directory.');
    return res.status(503).json({ error: 'Username lookup is temporarily unavailable. Please try again or email sworden@friscotexas.gov for help.' });
  }
};
