const {
  fetchWholeSheetByGid,
  fetchWholeSheetByTitle,
} = require('./google-sheets');

const CACHE_TTL_MS = 60 * 1000;
const DEFAULT_PROFILE_SHEET_NAME = 'Members';

let profileCache = {
  fetchedAt: 0,
  profiles: [],
};

let lastDiagnostics = {
  attempted: false,
  source: null,
  cacheHit: false,
  rowCount: 0,
  profileCount: 0,
  headers: [],
  durationMs: null,
  error: '',
};

function normalizeHeader(value) {
  return String(value || '').trim().replace(/^\uFEFF/, '');
}

function rowsToProfiles(rows) {
  if (!Array.isArray(rows) || !rows.length) return [];
  const headers = rows[0].map(normalizeHeader);

  if (!headers.some(header => header.toLowerCase() === 'username')) {
    throw new Error('The member profile sheet must contain a Username column in row 1.');
  }

  const usernameHeader = headers.find(header => header.toLowerCase() === 'username') || 'Username';

  return rows.slice(1).map(row => {
    const profile = {};
    headers.forEach((header, index) => {
      if (header) profile[header] = String(row[index] || '').trim();
    });

    profile.Username = String(profile[usernameHeader] || '').trim();
    return profile;
  }).filter(profile => profile.Username);
}

function getProfileSheetSource() {
  const configuredName = String(process.env.PROFILE_SHEET_NAME || '').trim();
  const configuredGid = String(process.env.PROFILE_SHEET_GID || '').trim();

  if (configuredName) return { type: 'title', value: configuredName };
  if (configuredGid) return { type: 'gid', value: configuredGid };
  return { type: 'title', value: DEFAULT_PROFILE_SHEET_NAME };
}

function getProfileStoreDiagnostics() {
  return JSON.parse(JSON.stringify(lastDiagnostics));
}

async function fetchProfiles(options = {}) {
  const startedAt = Date.now();
  const source = getProfileSheetSource();
  const cacheValid = Date.now() - profileCache.fetchedAt < CACHE_TTL_MS && profileCache.profiles.length;

  lastDiagnostics = {
    attempted: true,
    source,
    cacheHit: Boolean(cacheValid && !options.forceRefresh),
    rowCount: 0,
    profileCount: 0,
    headers: [],
    durationMs: null,
    error: '',
  };

  if (cacheValid && !options.forceRefresh) {
    lastDiagnostics.profileCount = profileCache.profiles.length;
    lastDiagnostics.durationMs = Date.now() - startedAt;
    return profileCache.profiles;
  }

  try {
    const rows = source.type === 'gid'
      ? await fetchWholeSheetByGid(source.value)
      : await fetchWholeSheetByTitle(source.value);

    lastDiagnostics.rowCount = Array.isArray(rows) ? rows.length : 0;
    lastDiagnostics.headers = Array.isArray(rows?.[0]) ? rows[0].map(normalizeHeader).filter(Boolean) : [];

    const profiles = rowsToProfiles(rows);
    profileCache = { fetchedAt: Date.now(), profiles };
    lastDiagnostics.profileCount = profiles.length;
    lastDiagnostics.durationMs = Date.now() - startedAt;
    return profiles;
  } catch (error) {
    lastDiagnostics.durationMs = Date.now() - startedAt;
    lastDiagnostics.error = error?.message || String(error);
    throw error;
  }
}

async function findProfileByUsername(username) {
  const target = String(username || '').trim().toLowerCase();
  if (!target) return null;
  const profiles = await fetchProfiles();
  const profile = profiles.find(item => String(item.Username || '').trim().toLowerCase() === target) || null;
  lastDiagnostics.usernameMatch = Boolean(profile);
  return profile;
}

async function diagnoseProfileSheet() {
  const profiles = await fetchProfiles({ forceRefresh: true });
  return {
    ...getProfileStoreDiagnostics(),
    readable: true,
    profileCount: profiles.length,
  };
}

module.exports = {
  DEFAULT_PROFILE_SHEET_NAME,
  rowsToProfiles,
  getProfileSheetSource,
  getProfileStoreDiagnostics,
  diagnoseProfileSheet,
  findProfileByUsername,
};
