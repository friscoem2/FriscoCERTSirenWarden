const {
  SESSION_COOKIE_NAME,
  parseCookies,
  verifySessionToken,
  clearSessionCookie,
} = require('../lib/session-token');
const {
  getPublicMemberProfileByUsername,
  getPublicMemberProfileById,
  getLeaderboardProfiles,
} = require('../lib/member-profile-store');

function queryValue(req, name) {
  const value = req.query?.[name];
  return Array.isArray(value) ? value[0] : value;
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: { message: 'Method not allowed.' } });
  }

  try {
    const cookies = parseCookies(req.headers.cookie || '');
    const session = verifySessionToken(cookies[SESSION_COOKIE_NAME]);
    if (!session) {
      res.setHeader('Set-Cookie', clearSessionCookie());
      return res.status(401).json({ error: { message: 'Your session has expired. Please log in again.' } });
    }

    const view = String(queryValue(req, 'view') || '').trim().toLowerCase();
    if (view === 'leaderboard') {
      const profiles = await getLeaderboardProfiles();
      return res.status(200).json({ profiles });
    }

    const publicId = String(queryValue(req, 'id') || '').trim();
    const profile = publicId
      ? await getPublicMemberProfileById(publicId)
      : await getPublicMemberProfileByUsername(session.sub);

    if (!profile) {
      return res.status(404).json({ error: { message: 'This member profile could not be found.' } });
    }

    return res.status(200).json({ profile });
  } catch (error) {
    console.error('Member profile request failed:', error.message);
    return res.status(500).json({ error: { message: 'Profile information could not be loaded.' } });
  }
};
