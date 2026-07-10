const { requireEnv, fetchWholeSheetByGid } = require('./google-sheets');

const CACHE_TTL_MS = 60 * 1000;

let profileCache = {
  fetchedAt: 0,
  profiles: [],
};

function normalizeHeader(value) {
  return String(value || '').trim().replace(/^\uFEFF/, '');
}

function rowsToProfiles(rows) {
  if (!rows.length) return [];
  const headers = rows[0].map(normalizeHeader);

  return rows.slice(1).map(row => {
    const profile = {};
    headers.forEach((header, index) => {
      if (header) profile[header] = String(row[index] || '').trim();
    });
    return profile;
  }).filter(profile => profile.Username);
}

async function fetchProfiles() {
  if (Date.now() - profileCache.fetchedAt < CACHE_TTL_MS && profileCache.profiles.length) {
    return profileCache.profiles;
  }

  const gid = requireEnv('PROFILE_SHEET_GID');
  const rows = await fetchWholeSheetByGid(gid);
  const profiles = rowsToProfiles(rows);
  profileCache = { fetchedAt: Date.now(), profiles };
  return profiles;
}

async function findProfileByUsername(username) {
  const target = String(username || '').trim().toLowerCase();
  if (!target) return null;
  const profiles = await fetchProfiles();
  return profiles.find(profile => String(profile.Username || '').trim().toLowerCase() === target) || null;
}

module.exports = {
  rowsToProfiles,
  findProfileByUsername,
};
