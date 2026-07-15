const crypto = require('crypto');
const { requireEnv, fetchWholeSheetByGid } = require('./google-sheets');

const CACHE_TTL_MS = 60 * 1000;

let memberCache = { fetchedAt: 0, profiles: [] };
let badgeRuleCache = { fetchedAt: 0, rules: [] };

function normalizeHeader(value) {
  return String(value || '').trim().replace(/^\uFEFF/, '');
}

function rowsToObjects(rows) {
  if (!Array.isArray(rows) || !rows.length) return [];
  const headers = rows[0].map(normalizeHeader);

  return rows.slice(1).map(row => {
    const item = {};
    headers.forEach((header, index) => {
      if (header) item[header] = String(row[index] ?? '').trim();
    });
    return item;
  });
}

function normalizeUsername(value) {
  return String(value || '').trim().toLowerCase();
}

function toNumber(value) {
  const parsed = Number(String(value ?? '').replace(/,/g, '').trim());
  return Number.isFinite(parsed) ? parsed : 0;
}

function toBoolean(value) {
  return ['true', 'yes', 'y', '1'].includes(String(value || '').trim().toLowerCase());
}

function getProfileIdSecret() {
  const secret = String(process.env.SESSION_SECRET || '');
  if (secret.length < 32) throw new Error('SESSION_SECRET must be configured with at least 32 characters.');
  return secret;
}

function createPublicProfileId(username) {
  return crypto
    .createHmac('sha256', getProfileIdSecret())
    .update(`member-profile:${normalizeUsername(username)}`)
    .digest('base64url')
    .slice(0, 24);
}

async function fetchMemberProfiles() {
  if (Date.now() - memberCache.fetchedAt < CACHE_TTL_MS && memberCache.profiles.length) {
    return memberCache.profiles;
  }

  const rows = await fetchWholeSheetByGid(requireEnv('MEMBER_PROFILE_SHEET_GID'));
  const profiles = rowsToObjects(rows).filter(profile => profile.Username && profile['Public Name']);
  memberCache = { fetchedAt: Date.now(), profiles };
  return profiles;
}

async function fetchBadgeRules() {
  if (Date.now() - badgeRuleCache.fetchedAt < CACHE_TTL_MS && badgeRuleCache.rules.length) {
    return badgeRuleCache.rules;
  }

  const rows = await fetchWholeSheetByGid(requireEnv('BADGE_RULES_SHEET_GID'));
  const rules = rowsToObjects(rows).filter(rule => rule['Badge Name']);
  badgeRuleCache = { fetchedAt: Date.now(), rules };
  return rules;
}

async function findMemberProfileByUsername(username) {
  const target = normalizeUsername(username);
  if (!target) return null;
  const profiles = await fetchMemberProfiles();
  return profiles.find(profile => normalizeUsername(profile.Username) === target) || null;
}

async function findMemberProfileByPublicId(profileId) {
  const target = String(profileId || '').trim();
  if (!target) return null;
  const profiles = await fetchMemberProfiles();
  return profiles.find(profile => createPublicProfileId(profile.Username) === target) || null;
}

function parseThreshold(value) {
  const normalized = String(value || '').trim();
  if (!normalized || normalized.toUpperCase() === 'N/A') return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function buildBadge(rule, profile) {
  const name = String(rule['Badge Name'] || '').trim();
  const emoji = String(rule.Emoji || '').trim() || '🏅';
  const criteria = String(rule.Criteria || '').trim();
  const rawValue = profile[name];
  const thresholds = {
    bronze: parseThreshold(rule.Bronze),
    silver: parseThreshold(rule.Silver),
    gold: parseThreshold(rule.Gold),
    diamond: parseThreshold(rule.Diamond),
  };
  const isTiered = Object.values(thresholds).some(value => value !== null);

  if (!isTiered) {
    const unlocked = toBoolean(rawValue);
    return {
      name,
      emoji,
      criteria,
      type: 'milestone',
      unlocked,
      tier: unlocked ? 'earned' : 'locked',
      value: unlocked ? 1 : 0,
      nextTier: null,
      nextThreshold: null,
      progressText: unlocked ? 'Earned' : 'Not earned yet',
    };
  }

  const value = toNumber(rawValue);
  const tierOrder = ['bronze', 'silver', 'gold', 'diamond'];
  let tier = 'locked';
  for (const candidate of tierOrder) {
    const threshold = thresholds[candidate];
    if (threshold !== null && value >= threshold) tier = candidate;
  }

  const nextTier = tierOrder.find(candidate => {
    const threshold = thresholds[candidate];
    return threshold !== null && value < threshold;
  }) || null;
  const nextThreshold = nextTier ? thresholds[nextTier] : null;

  return {
    name,
    emoji,
    criteria,
    type: 'tiered',
    unlocked: tier !== 'locked',
    tier,
    value,
    thresholds,
    nextTier,
    nextThreshold,
    progressText: nextTier ? `${value} / ${nextThreshold} to ${nextTier}` : `${value} · Diamond complete`,
  };
}

function cleanClassOf(value) {
  const normalized = String(value || '').trim();
  return normalized && normalized !== '??' ? normalized : '';
}

function buildPublicMemberProfile(profile, badgeRules) {
  const totalSignups = toNumber(profile['Total Signups']);
  const signupsNeeded = toNumber(profile['Signups Needed']);
  const rankTarget = totalSignups + signupsNeeded;

  return {
    profileId: createPublicProfileId(profile.Username),
    publicName: String(profile['Public Name'] || 'CERT Member').trim(),
    certClassOf: cleanClassOf(profile['CERT Class of']),
    admin: toBoolean(profile.Admin),
    avatar: String(profile.Avatar || '').trim() || '🧑‍🚒',
    currentAssignment: String(profile['Current Assignment'] || '').trim(),
    assignmentName: String(profile['Assignment Name'] || '').trim(),
    reportsSubmitted: toNumber(profile['Reports Submitted']),
    totalSignups,
    uniqueSites: toNumber(profile['Unique Sites']),
    signupsNeeded,
    rankEmoji: String(profile['Rank Emoji'] || '').trim() || '🌱',
    rankName: String(profile['Rank Name'] || '').trim() || 'New',
    nextRank: String(profile['Next Rank'] || '').trim(),
    rankTarget,
    badges: badgeRules.map(rule => buildBadge(rule, profile)),
  };
}

async function getPublicMemberProfileByUsername(username) {
  const [profile, badgeRules] = await Promise.all([
    findMemberProfileByUsername(username),
    fetchBadgeRules(),
  ]);
  return profile ? buildPublicMemberProfile(profile, badgeRules) : null;
}

async function getPublicMemberProfileById(profileId) {
  const [profile, badgeRules] = await Promise.all([
    findMemberProfileByPublicId(profileId),
    fetchBadgeRules(),
  ]);
  return profile ? buildPublicMemberProfile(profile, badgeRules) : null;
}

async function getLeaderboardProfiles() {
  const profiles = await fetchMemberProfiles();
  return profiles
    .map(profile => ({
      profileId: createPublicProfileId(profile.Username),
      publicName: String(profile['Public Name'] || 'CERT Member').trim(),
      avatar: String(profile.Avatar || '').trim() || '🧑‍🚒',
      reportsSubmitted: toNumber(profile['Reports Submitted']),
      totalSignups: toNumber(profile['Total Signups']),
      uniqueSites: toNumber(profile['Unique Sites']),
      rankEmoji: String(profile['Rank Emoji'] || '').trim() || '🌱',
      rankName: String(profile['Rank Name'] || '').trim() || 'New',
    }))
    .sort((a, b) =>
      b.totalSignups - a.totalSignups ||
      b.uniqueSites - a.uniqueSites ||
      b.reportsSubmitted - a.reportsSubmitted ||
      a.publicName.localeCompare(b.publicName)
    );
}

module.exports = {
  rowsToObjects,
  buildBadge,
  buildPublicMemberProfile,
  createPublicProfileId,
  getPublicMemberProfileByUsername,
  getPublicMemberProfileById,
  getLeaderboardProfiles,
};
