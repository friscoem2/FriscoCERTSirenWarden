const { requireEnv, readCellByGid } = require('../lib/google-sheets');

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: { message: 'Method not allowed.' } });
  }

  try {
    const gid = requireEnv('KILL_SWITCH_GID');
    const cell = String(process.env.KILL_SWITCH_CELL || 'B2').trim();
    const value = await readCellByGid(gid, cell);
    return res.status(200).json({ killed: value.toUpperCase() === 'TRUE' });
  } catch (error) {
    // Preserve the prior fail-open behavior, but do not expose configuration details.
    console.error('Kill-switch check failed:', error.message);
    return res.status(200).json({ killed: false });
  }
};
