const { requireAuthenticatedUser } = require('../lib/request-auth');
const { getScenario } = require('../lib/scenario-store');

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  try {
    const user = await requireAuthenticatedUser(req, res);
    if (!user) return;
    const scenario = await getScenario();
    return res.status(200).json({
      briefing: scenario.briefing,
      disasterArea: scenario.disasterArea,
      pois: scenario.pois,
    });
  } catch (error) {
    console.error('Scenario load failed:', error.message);
    return res.status(500).json({ error: 'The exercise scenario could not be loaded from Google Sheets.' });
  }
};
