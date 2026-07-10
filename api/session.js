const { findProfileByUsername } = require('../lib/profile-store');
const {
  SESSION_COOKIE_NAME,
  parseCookies,
  verifySessionToken,
  clearSessionCookie,
} = require('../lib/session-token');

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  try {
    const cookies = parseCookies(req.headers.cookie || '');
    const payload = verifySessionToken(cookies[SESSION_COOKIE_NAME]);
    if (!payload) {
      res.setHeader('Set-Cookie', clearSessionCookie());
      return res.status(401).json({ authenticated: false });
    }

    const profile = await findProfileByUsername(payload.sub);
    if (!profile) {
      res.setHeader('Set-Cookie', clearSessionCookie());
      return res.status(403).json({ authenticated: false });
    }

    return res.status(200).json({
      authenticated: true,
      username: profile.Username || payload.sub,
      expiresAt: payload.exp * 1000,
      profile,
    });
  } catch (error) {
    console.error('Session check failed:', error.message);
    return res.status(500).json({ authenticated: false });
  }
};
