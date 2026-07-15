const { getAccessToken } = require('./google-sheets-write');

const METADATA_CACHE_TTL_MS = 5 * 60 * 1000;
let metadataCache = { fetchedAt: 0, sheets: [] };

function requireEnv(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`${name} is not configured.`);
  return value;
}

function hasServiceAccountReadConfig() {
  return Boolean(
    String(process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '').trim() &&
    (
      String(process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || '').trim() ||
      String(process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY_BASE64 || '').trim() ||
      String(process.env.GOOGLE_PRIVATE_KEY || '').trim()
    )
  );
}

function normalizeSpreadsheetId(value) {
  const normalized = String(value || '').trim();
  const match = normalized.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  return match ? match[1] : normalized;
}

function getGoogleSheetsConfig() {
  return {
    spreadsheetId: normalizeSpreadsheetId(requireEnv('GOOGLE_SHEET_ID')),
    apiKey: String(process.env.GOOGLE_SHEETS_API_KEY || '').trim(),
  };
}

async function fetchGoogleJson(url, description, useServiceAccount) {
  const headers = { Accept: 'application/json' };
  if (useServiceAccount) headers.Authorization = `Bearer ${await getAccessToken()}`;
  const response = await fetch(url, { method: 'GET', redirect: 'follow', headers });
  let data = {};
  try { data = await response.json(); } catch { data = {}; }
  if (!response.ok) {
    const googleMessage = data?.error?.message;
    throw new Error(`${description} returned HTTP ${response.status}${googleMessage ? `: ${googleMessage}` : '.'}`);
  }
  return data;
}

function applyReadAuthentication(url) {
  const useServiceAccount = hasServiceAccountReadConfig();
  if (!useServiceAccount) {
    const apiKey = String(process.env.GOOGLE_SHEETS_API_KEY || '').trim();
    if (!apiKey) throw new Error('Google Sheets read access requires service-account credentials or GOOGLE_SHEETS_API_KEY.');
    url.searchParams.set('key', apiKey);
  }
  return useServiceAccount;
}

async function fetchSheetMetadata() {
  if (metadataCache.sheets.length && Date.now() - metadataCache.fetchedAt < METADATA_CACHE_TTL_MS) {
    return metadataCache.sheets;
  }

  const { spreadsheetId } = getGoogleSheetsConfig();
  const url = new URL(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}`);
  url.searchParams.set('fields', 'sheets.properties(sheetId,title)');
  const useServiceAccount = applyReadAuthentication(url);
  const data = await fetchGoogleJson(url, 'Google Sheets metadata request', useServiceAccount);
  const sheets = (data.sheets || []).map(sheet => sheet?.properties).filter(Boolean);
  metadataCache = { fetchedAt: Date.now(), sheets };
  return sheets;
}

async function getSheetTitleByGid(gid) {
  const raw = String(gid || '').trim();
  const gidMatch = raw.match(/[?&#]gid=(\d+)/i);
  const target = Number(gidMatch ? gidMatch[1] : raw);
  if (!Number.isInteger(target)) throw new Error('A valid numeric sheet GID is required.');
  const sheets = await fetchSheetMetadata();
  const match = sheets.find(sheet => Number(sheet.sheetId) === target);
  if (!match) throw new Error(`No Google Sheet tab exists for GID ${target}.`);
  return match.title;
}

function quoteSheetTitle(title) {
  return `'${String(title).replace(/'/g, "''")}'`;
}

async function fetchSheetValues(range) {
  const { spreadsheetId } = getGoogleSheetsConfig();
  const url = new URL(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}`);
  url.searchParams.set('majorDimension', 'ROWS');
  const useServiceAccount = applyReadAuthentication(url);
  const data = await fetchGoogleJson(url, 'Google Sheets values request', useServiceAccount);
  return data.values || [];
}

async function fetchWholeSheetByTitle(title) {
  const normalizedTitle = String(title || '').trim();
  if (!normalizedTitle) throw new Error('A Google Sheet tab name is required.');
  return fetchSheetValues(quoteSheetTitle(normalizedTitle));
}

async function fetchWholeSheetByGid(gid) {
  const title = await getSheetTitleByGid(gid);
  return fetchWholeSheetByTitle(title);
}

async function readCellByGid(gid, cell = 'B2') {
  const title = await getSheetTitleByGid(gid);
  const normalizedCell = String(cell || 'B2').trim().toUpperCase();
  if (!/^[A-Z]+[1-9][0-9]*$/.test(normalizedCell)) throw new Error('The configured cell is invalid.');
  const values = await fetchSheetValues(`${quoteSheetTitle(title)}!${normalizedCell}`);
  return String(values?.[0]?.[0] || '').trim();
}

module.exports = {
  normalizeSpreadsheetId,
  requireEnv,
  getSheetTitleByGid,
  fetchSheetValues,
  fetchWholeSheetByTitle,
  fetchWholeSheetByGid,
  readCellByGid,
};
