const { findProfileByUsername } = require('./profile-store');
const {
  SESSION_COOKIE_NAME,
  parseCookies,
  verifySessionToken,
  clearSessionCookie,
} = require('./session-token');

async function requireAuthenticatedUser(req, res) {
  const cookies = parseCookies(req.headers.cookie || '');
  const session = verifySessionToken(cookies[SESSION_COOKIE_NAME]);
  if (!session) {
    res.setHeader('Set-Cookie', clearSessionCookie());
    res.status(401).json({ error: 'Your session has expired. Please log in again.' });
    return null;
  }

  const profile = await findProfileByUsername(session.sub);
  if (!profile) {
    res.setHeader('Set-Cookie', clearSessionCookie());
    res.status(403).json({ error: 'No application profile is configured for this member.' });
    return null;
  }

  return {
    username: String(profile.Username || session.sub).trim(),
    profile,
    session,
  };
}

function profileDisplayName(profile, fallback = 'CERT Member') {
  const direct = profile?.Name || profile?.['Display Name'] || profile?.FullName || profile?.['Full Name'];
  if (direct) return String(direct).trim();
  const joined = [profile?.['First Name'], profile?.['Last Name']].filter(Boolean).join(' ').trim();
  return joined || fallback;
}

module.exports = { requireAuthenticatedUser, profileDisplayName };
