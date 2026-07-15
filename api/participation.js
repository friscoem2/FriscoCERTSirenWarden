const { requireAuthenticatedUser, profileDisplayName } = require('../lib/request-auth');
const { appendSheetRow, isWriteConfigurationPresent } = require('../lib/google-sheets-write');
const { getScenario } = require('../lib/scenario-store');

function bodyOf(req) {
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

  try {
    const user = await requireAuthenticatedUser(req, res);
    if (!user) return;
    if (!isWriteConfigurationPresent()) {
      return res.status(503).json({ error: 'Google Sheets write access is not configured.' });
    }

    const { response } = bodyOf(req);
    const normalized = String(response || '').trim().toLowerCase();
    if (!['yes', 'no'].includes(normalized)) {
      return res.status(400).json({ error: 'Response must be yes or no.' });
    }

    const scenario = await getScenario();
    const tabName = String(process.env.DRILL_RESPONSES_SHEET_NAME || 'Drill Responses').trim();
    await appendSheetRow(tabName, [
      new Date().toISOString(),
      scenario.briefing.scenarioId,
      scenario.briefing.title,
      user.username,
      profileDisplayName(user.profile, user.username),
      normalized === 'yes' ? 'Yes - Signed Up' : 'No - Unavailable',
      String(req.headers['user-agent'] || '').slice(0, 500),
    ]);

    return res.status(200).json({ saved: true, response: normalized });
  } catch (error) {
    console.error('Participation response failed:', error.message);
    return res.status(500).json({ error: 'Your response could not be saved. Please try again.' });
  }
};
