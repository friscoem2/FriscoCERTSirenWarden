const { verifyBetterImpactCredentials } = require('../lib/better-impact-auth');
const { findProfileByUsername } = require('../lib/profile-store');
const { createSessionToken, makeSessionCookie } = require('../lib/session-token');

function getBody(req) {
  if (!req.body) return {};
  if (typeof req.body === 'object') return req.body;
  try { return JSON.parse(req.body); } catch { return {}; }
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  const { username: rawUsername, password: rawPassword } = getBody(req);
  const username = String(rawUsername || '').trim();
  const password = String(rawPassword || '');

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required.' });
  }

  if (username.length > 200 || password.length > 500) {
    return res.status(400).json({ error: 'Invalid login request.' });
  }

  try {
    const result = await verifyBetterImpactCredentials(username, password);
    if (!result.authenticated) {
      return res.status(401).json({ error: 'Incorrect username or password.' });
    }

    const profile = await findProfileByUsername(username);
    if (!profile) {
      return res.status(403).json({
        error: 'Your Better Impact login was accepted, but no app profile is configured for this username.',
      });
    }

    const canonicalUsername = profile.Username || username;
    const session = createSessionToken(canonicalUsername);
    res.setHeader('Set-Cookie', makeSessionCookie(session.token));

    return res.status(200).json({
      authenticated: true,
      username: canonicalUsername,
      expiresAt: session.expiresAt,
      profile,
    });
  } catch (error) {
    console.error('Login failed without credential details:', error.message);
    return res.status(502).json({
      error: 'The login service could not complete the request. Please try again.',
    });
  }
};
