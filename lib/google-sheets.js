const METADATA_CACHE_TTL_MS = 5 * 60 * 1000;

let metadataCache = {
  fetchedAt: 0,
  sheets: [],
};

function requireEnv(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) {
    throw new Error(`${name} is not configured.`);
  }
  return value;
}

function getGoogleSheetsConfig() {
  return {
    spreadsheetId: requireEnv('GOOGLE_SHEET_ID'),
    apiKey: requireEnv('GOOGLE_SHEETS_API_KEY'),
  };
}

async function fetchGoogleJson(url, description) {
  const response = await fetch(url, {
    method: 'GET',
    redirect: 'follow',
    headers: { Accept: 'application/json' },
  });

  let data = {};
  try {
    data = await response.json();
  } catch {
    data = {};
  }

  if (!response.ok) {
    const googleMessage = data?.error?.message;
    throw new Error(`${description} returned HTTP ${response.status}${googleMessage ? `: ${googleMessage}` : '.'}`);
  }

  return data;
}

async function fetchSheetMetadata() {
  if (
    metadataCache.sheets.length &&
    Date.now() - metadataCache.fetchedAt < METADATA_CACHE_TTL_MS
  ) {
    return metadataCache.sheets;
  }

  const { spreadsheetId, apiKey } = getGoogleSheetsConfig();
  const url = new URL(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}`);
  url.searchParams.set('key', apiKey);
  url.searchParams.set('fields', 'sheets.properties(sheetId,title)');

  const data = await fetchGoogleJson(url, 'Google Sheets metadata request');
  const sheets = (data.sheets || [])
    .map(sheet => sheet?.properties)
    .filter(properties => properties && properties.title !== undefined);

  metadataCache = { fetchedAt: Date.now(), sheets };
  return sheets;
}

async function getSheetTitleByGid(gid) {
  const target = Number(gid);
  if (!Number.isInteger(target)) {
    throw new Error('A valid numeric sheet GID is required.');
  }

  const sheets = await fetchSheetMetadata();
  const match = sheets.find(sheet => Number(sheet.sheetId) === target);
  if (!match) {
    throw new Error(`No Google Sheet tab exists for GID ${target}.`);
  }
  return match.title;
}

function quoteSheetTitle(title) {
  return `'${String(title).replace(/'/g, "''")}'`;
}

async function fetchSheetValues(range) {
  const { spreadsheetId, apiKey } = getGoogleSheetsConfig();
  const url = new URL(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}`
  );
  url.searchParams.set('key', apiKey);
  url.searchParams.set('majorDimension', 'ROWS');

  const data = await fetchGoogleJson(url, 'Google Sheets values request');
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
  if (!/^[A-Z]+[1-9][0-9]*$/.test(normalizedCell)) {
    throw new Error('The configured kill-switch cell is invalid.');
  }

  const values = await fetchSheetValues(`${quoteSheetTitle(title)}!${normalizedCell}`);
  return String(values?.[0]?.[0] || '').trim();
}

module.exports = {
  requireEnv,
  getSheetTitleByGid,
  fetchSheetValues,
  fetchWholeSheetByTitle,
  fetchWholeSheetByGid,
  readCellByGid,
};
