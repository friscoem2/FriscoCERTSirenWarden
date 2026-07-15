const { fetchWholeSheetByTitle } = require('./google-sheets');

const CACHE_TTL_MS = 20 * 1000;
let scenarioCache = { fetchedAt: 0, scenario: null };

function text(value, max = 10000) {
  return String(value ?? '').trim().slice(0, max);
}

function normalizeHeader(value) {
  return text(value, 100).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function parseBoolean(value) {
  return ['true', 'yes', 'y', '1', 'radioactive'].includes(text(value, 30).toLowerCase());
}

function parseNumber(value, fallback = 0) {
  const parsed = Number(String(value ?? '').replace(/,/g, '').trim());
  return Number.isFinite(parsed) ? parsed : fallback;
}

function sheetName(envName, fallback) {
  return text(process.env[envName] || fallback, 100);
}

function briefingDictionary(rows) {
  const dict = {};
  rows.forEach(row => {
    const key = normalizeHeader(row?.[0]);
    if (key) dict[key] = text(row?.[1]);
  });
  return dict;
}

function parseBriefing(rows) {
  const dict = briefingDictionary(rows);
  return {
    imageUrl: dict['image url'] || dict['briefing image url'] || text(rows?.[0]?.[1]),
    title: dict['title'] || dict['briefing title'] || text(rows?.[1]?.[1]) || 'CERT Disaster Simulation',
    description: dict['description'] || dict['briefing description'] || text(rows?.[2]?.[1]) || 'Review the incident briefing before accepting your assignment.',
    entryInstructions: dict['entry instructions'] || text(rows?.[3]?.[1]) || 'You have entered the exercise area. Keep the map open, visit each question-mark location, and use the simulated Geiger counter to record a reading inside every circle.',
    scenarioId: dict['scenario id'] || text(rows?.[4]?.[1]) || 'frisco-cert-drill',
    exerciseStatus: (dict['exercise status'] || text(rows?.[5]?.[1]) || 'ACTIVE').toUpperCase(),
  };
}

function findGeoJsonCell(rows) {
  for (const row of rows) {
    const key = normalizeHeader(row?.[0]);
    if (key.includes('disaster area') && key.includes('geojson')) return text(row?.[1], 100000);
  }
  return text(rows?.[0]?.[1], 100000);
}

function parseDisasterArea(rows) {
  const raw = findGeoJsonCell(rows);
  if (!raw) throw new Error('The Incident Map tab does not contain a disaster-area GeoJSON value.');
  let parsed;
  try { parsed = JSON.parse(raw); } catch { throw new Error('The disaster-area GeoJSON is not valid JSON.'); }

  if (parsed?.type === 'FeatureCollection') {
    parsed = parsed.features?.find(feature => ['Polygon', 'MultiPolygon'].includes(feature?.geometry?.type));
  }
  if (parsed?.type === 'Feature') {
    if (!['Polygon', 'MultiPolygon'].includes(parsed?.geometry?.type)) {
      throw new Error('The disaster-area feature must contain a Polygon or MultiPolygon geometry.');
    }
    return parsed;
  }
  if (['Polygon', 'MultiPolygon'].includes(parsed?.type)) {
    return { type: 'Feature', properties: { name: 'Disaster Area' }, geometry: parsed };
  }
  throw new Error('The disaster-area GeoJSON must be a Polygon, MultiPolygon, Feature, or FeatureCollection.');
}

function findPoiHeaderRow(rows) {
  return rows.findIndex(row => row.some(cell => normalizeHeader(cell) === 'poi number'));
}

function getColumnIndex(headers, aliases) {
  return headers.findIndex(header => aliases.includes(header));
}

function parsePois(rows) {
  const headerIndex = findPoiHeaderRow(rows);
  if (headerIndex < 0) throw new Error('The Incident Map tab is missing a POI Number header row.');
  const headers = rows[headerIndex].map(normalizeHeader);
  const indexes = {
    number: getColumnIndex(headers, ['poi number', 'poi', 'number']),
    title: getColumnIndex(headers, ['title name', 'title', 'name', 'poi title']),
    latitude: getColumnIndex(headers, ['latitude', 'lat']),
    longitude: getColumnIndex(headers, ['longitude', 'lng', 'lon']),
    maxCpm: getColumnIndex(headers, ['max cpm', 'maximum cpm']),
    radius: getColumnIndex(headers, ['poi radius meters', 'poi radius', 'radius meters', 'radius']),
    radioactive: getColumnIndex(headers, ['radioactive', 'is radioactive']),
    active: getColumnIndex(headers, ['active', 'enabled']),
  };

  const required = ['number', 'title', 'latitude', 'longitude', 'maxCpm', 'radius', 'radioactive'];
  required.forEach(key => {
    if (indexes[key] < 0) throw new Error(`The Incident Map tab is missing the ${key} column.`);
  });

  const pois = rows.slice(headerIndex + 1).map(row => {
    const number = text(row[indexes.number], 50);
    if (!number) return null;
    const latitude = parseNumber(row[indexes.latitude], NaN);
    const longitude = parseNumber(row[indexes.longitude], NaN);
    const radiusMeters = Math.min(Math.max(parseNumber(row[indexes.radius], 50), 5), 1000);
    const radioactive = parseBoolean(row[indexes.radioactive]);
    const maxCpm = radioactive
      ? Math.min(Math.max(parseNumber(row[indexes.maxCpm], 0.01), 0.01), 100000)
      : 0;
    const active = indexes.active < 0 ? true : !['false', 'no', 'n', '0', 'inactive'].includes(text(row[indexes.active], 20).toLowerCase());

    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) return null;
    if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) return null;

    return {
      number,
      title: text(row[indexes.title], 160) || `POI ${number}`,
      latitude,
      longitude,
      maxCpm,
      radiusMeters,
      radioactive,
      active,
    };
  }).filter(poi => poi && poi.active);

  if (!pois.length) throw new Error('The Incident Map tab has no active points of interest.');
  return pois;
}

async function getScenario({ force = false } = {}) {
  if (!force && scenarioCache.scenario && Date.now() - scenarioCache.fetchedAt < CACHE_TTL_MS) {
    return scenarioCache.scenario;
  }

  const briefingTab = sheetName('BRIEFING_SHEET_NAME', 'Briefing');
  const incidentTab = sheetName('INCIDENT_MAP_SHEET_NAME', 'Incident Map');
  const [briefingRows, incidentRows] = await Promise.all([
    fetchWholeSheetByTitle(briefingTab),
    fetchWholeSheetByTitle(incidentTab),
  ]);

  const scenario = {
    briefing: parseBriefing(briefingRows),
    disasterArea: parseDisasterArea(incidentRows),
    pois: parsePois(incidentRows),
  };
  scenarioCache = { fetchedAt: Date.now(), scenario };
  return scenario;
}

function distanceMeters(aLat, aLng, bLat, bLng) {
  const toRad = degrees => degrees * Math.PI / 180;
  const earthRadius = 6371008.8;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return earthRadius * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function calculateCpm(poi, distance) {
  if (!poi.radioactive) return 0;
  const minCpm = 0.01;
  const maxCpm = Math.max(minCpm, Number(poi.maxCpm || minCpm));
  const radius = Math.max(1, Number(poi.radiusMeters || 50));
  const normalizedDistance = Math.min(Math.max(distance / radius, 0), 1);
  const curve = 4.5;
  const exponential = (Math.exp(curve * (1 - normalizedDistance)) - 1) / (Math.exp(curve) - 1);
  return minCpm + (maxCpm - minCpm) * exponential;
}

function severityForCpm(cpm) {
  const value = Number(cpm || 0);
  if (value < 1) return 'Green';
  if (value < 10) return 'Yellow';
  if (value < 100) return 'Orange';
  if (value < 400) return 'Red';
  return 'Extreme';
}

module.exports = {
  getScenario,
  distanceMeters,
  calculateCpm,
  severityForCpm,
};
