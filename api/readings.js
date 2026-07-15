const crypto = require('crypto');
const { requireAuthenticatedUser, profileDisplayName } = require('../lib/request-auth');
const {
  appendSheetRows,
  submissionIdExists,
  isWriteConfigurationPresent,
} = require('../lib/google-sheets-write');
const {
  getScenario,
  distanceMeters,
  calculateCpm,
  severityForCpm,
} = require('../lib/scenario-store');

function bodyOf(req) {
  if (!req.body) return {};
  if (typeof req.body === 'object') return req.body;
  try { return JSON.parse(req.body); } catch { return {}; }
}

function numeric(value, fallback = NaN) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function cleanSubmissionId(value) {
  const id = String(value || '').trim();
  if (/^[a-zA-Z0-9_-]{12,100}$/.test(id)) return id;
  return crypto.randomUUID();
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

    const body = bodyOf(req);
    const readings = Array.isArray(body.readings) ? body.readings : [];
    if (!readings.length || readings.length > 100) {
      return res.status(400).json({ error: 'A valid set of readings is required.' });
    }

    const scenario = await getScenario({ force: true });
    if (String(body.scenarioId || '') !== scenario.briefing.scenarioId) {
      return res.status(409).json({ error: 'The active exercise has changed. Reload the app before submitting.' });
    }

    const officialPois = new Map(scenario.pois.map(poi => [String(poi.number), poi]));
    const received = new Map();
    readings.forEach(reading => {
      const number = String(reading?.poiNumber || '').trim();
      if (officialPois.has(number) && !received.has(number)) received.set(number, reading);
    });

    const missing = [...officialPois.keys()].filter(number => !received.has(number));
    if (missing.length) {
      return res.status(400).json({ error: `Readings are still missing for POI ${missing.join(', ')}.` });
    }

    const tabName = String(process.env.RADIATION_READINGS_SHEET_NAME || 'Radiation Readings').trim();
    const submissionId = cleanSubmissionId(body.submissionId);
    if (await submissionIdExists(tabName, submissionId)) {
      return res.status(200).json({ saved: true, duplicate: true, submissionId });
    }

    const submittedAt = new Date().toISOString();
    const displayName = profileDisplayName(user.profile, user.username);
    const summaries = [];
    const rows = scenario.pois.map(poi => {
      const reading = received.get(String(poi.number));
      const latitude = numeric(reading.latitude);
      const longitude = numeric(reading.longitude);
      const accuracy = Math.min(Math.max(numeric(reading.accuracy, 0), 0), 5000);
      const validCoordinates = Number.isFinite(latitude) && Number.isFinite(longitude)
        && latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180;
      const distance = validCoordinates
        ? distanceMeters(latitude, longitude, poi.latitude, poi.longitude)
        : Number.POSITIVE_INFINITY;
      const withinPoi = validCoordinates && distance <= poi.radiusMeters + Math.max(accuracy, 10);
      const cpm = poi.radioactive
        ? calculateCpm(poi, Math.min(distance, poi.radiusMeters))
        : 0;
      const readingType = poi.radioactive ? 'Radiation Detected' : 'Clear';
      const severity = severityForCpm(cpm);

      summaries.push({
        poiNumber: poi.number,
        poiTitle: poi.title,
        readingType,
        cpm: Number(cpm.toFixed(cpm < 1 ? 2 : cpm < 100 ? 1 : 0)),
        severity,
        withinPoi,
      });

      return [
        submissionId,
        submittedAt,
        scenario.briefing.scenarioId,
        user.username,
        displayName,
        poi.number,
        poi.title,
        validCoordinates ? latitude : '',
        validCoordinates ? longitude : '',
        accuracy,
        Number.isFinite(distance) ? Number(distance.toFixed(1)) : '',
        poi.radiusMeters,
        readingType,
        Number(cpm.toFixed(2)),
        severity,
        withinPoi ? 'Yes' : 'No',
        String(reading.takenAt || '').slice(0, 50),
      ];
    });

    await appendSheetRows(tabName, rows);
    return res.status(200).json({
      saved: true,
      submissionId,
      submittedAt,
      readings: summaries,
    });
  } catch (error) {
    console.error('Reading submission failed:', error.message);
    return res.status(500).json({ error: 'The readings could not be submitted. They remain saved on this device.' });
  }
};
