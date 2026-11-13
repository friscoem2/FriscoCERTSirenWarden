const { fetchWholeSheetByGid } = require('./google-sheets');

const CERT_MEMBERS_GID = '1506659451';
const CACHE_TTL_MS = 60 * 1000;
let memberCache = { fetchedAt: 0, members: null };

function rowsToUsernameRecords(rows) {
  const headers = (rows[0] || []).map(value => String(value || '').replace(/^\uFEFF/, '').trim().toLowerCase());
  const emailIndex = headers.indexOf('emailaddress');
  const usernameIndex = headers.indexOf('username');
  if (emailIndex < 0 || usernameIndex < 0) {
    throw new Error('CERT Members must contain EmailAddress and Username headers.');
  }

  return rows.slice(1).map(row => ({
    email: String(row[emailIndex] || '').trim().toLowerCase(),
    username: String(row[usernameIndex] || '').trim(),
  })).filter(member => member.email && member.username);
}

async function findUsernamesByEmail(email) {
  if (!memberCache.members || Date.now() - memberCache.fetchedAt >= CACHE_TTL_MS) {
    const rows = await fetchWholeSheetByGid(CERT_MEMBERS_GID);
    memberCache = { fetchedAt: Date.now(), members: rowsToUsernameRecords(rows) };
  }

  const target = String(email || '').trim().toLowerCase();
  return [...new Set(memberCache.members.filter(member => member.email === target).map(member => member.username))];
}

module.exports = { rowsToUsernameRecords, findUsernamesByEmail };
