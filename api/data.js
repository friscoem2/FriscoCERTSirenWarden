const {
  SESSION_COOKIE_NAME,
  parseCookies,
  verifySessionToken,
  clearSessionCookie,
} = require('../lib/session-token');
const { requireEnv, fetchWholeSheetByTitle } = require('../lib/google-sheets');

function getResourceName(req) {
  const value = req.query?.resource;
  return Array.isArray(value) ? value[0] : value;
}

function getConfiguredSheet(resource) {
  const resources = {
    sirens: 'SIREN_SHEET_NAME',
    leaderboard: 'LEADERBOARD_SHEET_NAME',
  };

  const envName = resources[resource];
  if (!envName) return null;
  return requireEnv(envName);
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

    const resource = String(getResourceName(req) || '').trim().toLowerCase();
    const sheetTitle = getConfiguredSheet(resource);
    if (!sheetTitle) {
      return res.status(400).json({ error: { message: 'Unknown data resource.' } });
    }

    const values = await fetchWholeSheetByTitle(sheetTitle);
    return res.status(200).json({ values });
  } catch (error) {
    console.error('Protected sheet request failed:', error.message);
    return res.status(500).json({ error: { message: 'The requested data could not be loaded.' } });
  }
};
