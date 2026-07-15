const crypto = require('crypto');

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets';

function requireEnv(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`${name} is not configured.`);
  return value;
}
let tokenCache = { accessToken: '', expiresAt: 0 };

function normalizeSpreadsheetId(value) {
  const normalized = String(value || '').trim();
  const match = normalized.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  return match ? match[1] : normalized;
}

class GoogleSheetsWriteError extends Error {
  constructor(message, { stage = 'google_sheets', httpStatus = 0, googleStatus = '', reason = '' } = {}) {
    super(message);
    this.name = 'GoogleSheetsWriteError';
    this.stage = stage;
    this.httpStatus = Number(httpStatus || 0);
    this.googleStatus = String(googleStatus || '');
    this.reason = String(reason || '');
  }
}

function base64url(value) {
  return Buffer.from(value).toString('base64url');
}

function getPrivateKey() {
  const base64Key = String(process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY_BASE64 || '').trim();
  if (base64Key) return Buffer.from(base64Key, 'base64').toString('utf8');

  const raw = String(
    process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY ||
    process.env.GOOGLE_PRIVATE_KEY ||
    ''
  ).trim();
  if (!raw) throw new Error('GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY is not configured.');
  return raw.replace(/\\n/g, '\n');
}

function getServiceAccountConfig() {
  return {
    spreadsheetId: normalizeSpreadsheetId(requireEnv('GOOGLE_SHEET_ID')),
    clientEmail: requireEnv('GOOGLE_SERVICE_ACCOUNT_EMAIL'),
    privateKey: getPrivateKey(),
  };
}

function createServiceAccountAssertion() {
  const { clientEmail, privateKey } = getServiceAccountConfig();
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64url(JSON.stringify({
    iss: clientEmail,
    scope: GOOGLE_SHEETS_SCOPE,
    aud: GOOGLE_TOKEN_URL,
    iat: now,
    exp: now + 3600,
  }));
  const unsignedToken = `${header}.${payload}`;
  const signature = crypto
    .createSign('RSA-SHA256')
    .update(unsignedToken)
    .end()
    .sign(privateKey, 'base64url');
  return `${unsignedToken}.${signature}`;
}

async function getAccessToken() {
  if (tokenCache.accessToken && Date.now() < tokenCache.expiresAt - 60_000) {
    return tokenCache.accessToken;
  }

  let assertion;
  try {
    assertion = createServiceAccountAssertion();
  } catch (error) {
    throw new GoogleSheetsWriteError(
      `Google service-account JWT creation failed: ${error.message}`,
      { stage: 'service_account_jwt', reason: error.message }
    );
  }

  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth2:grant-type:jwt-bearer',
      assertion,
    }).toString(),
  });

  let data = {};
  try { data = await response.json(); } catch { data = {}; }
  if (!response.ok || !data.access_token) {
    const message = data?.error_description || data?.error || `HTTP ${response.status}`;
    throw new GoogleSheetsWriteError(
      `Google service-account authorization failed: ${message}`,
      {
        stage: 'google_authorization',
        httpStatus: response.status,
        googleStatus: data?.error || '',
        reason: data?.error_description || data?.error || '',
      }
    );
  }

  const expiresInSeconds = Number(data.expires_in || 3600);
  tokenCache = {
    accessToken: data.access_token,
    expiresAt: Date.now() + expiresInSeconds * 1000,
  };
  return tokenCache.accessToken;
}

function quoteSheetTitle(title) {
  const normalized = String(title || '').trim();
  if (!normalized) throw new Error('A destination Google Sheet tab name is required.');
  return `'${normalized.replace(/'/g, "''")}'`;
}

async function appendSheetRows(sheetTitle, rows) {
  if (!Array.isArray(rows) || !rows.length || rows.some(row => !Array.isArray(row))) {
    throw new Error('At least one row is required for a Google Sheets append.');
  }

  const { spreadsheetId } = getServiceAccountConfig();
  const accessToken = await getAccessToken();
  const range = `${quoteSheetTitle(sheetTitle)}!A:Z`;
  const url = new URL(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}:append`
  );
  url.searchParams.set('valueInputOption', 'USER_ENTERED');
  url.searchParams.set('insertDataOption', 'INSERT_ROWS');
  url.searchParams.set('includeValuesInResponse', 'false');

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ majorDimension: 'ROWS', values: rows }),
  });

  let data = {};
  try { data = await response.json(); } catch { data = {}; }
  if (!response.ok) {
    const message = data?.error?.message || `HTTP ${response.status}`;
    throw new GoogleSheetsWriteError(
      `Google Sheets append failed: ${message}`,
      {
        stage: 'google_sheets_append',
        httpStatus: response.status,
        googleStatus: data?.error?.status || '',
        reason: data?.error?.message || '',
      }
    );
  }

  return {
    updatedRange: data?.updates?.updatedRange || '',
    updatedRows: Number(data?.updates?.updatedRows || 0),
  };
}

async function appendSheetRow(sheetTitle, values) {
  return appendSheetRows(sheetTitle, [values]);
}

async function submissionIdExists(sheetTitle, submissionId) {
  const target = String(submissionId || '').trim();
  if (!target) return false;
  const { spreadsheetId } = getServiceAccountConfig();
  const accessToken = await getAccessToken();
  const range = `${quoteSheetTitle(sheetTitle)}!A:A`;
  const url = new URL(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}`);
  url.searchParams.set('majorDimension', 'ROWS');
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
  });
  let data = {};
  try { data = await response.json(); } catch { data = {}; }
  if (!response.ok) {
    throw new GoogleSheetsWriteError(`Google Sheets duplicate check failed: ${data?.error?.message || `HTTP ${response.status}`}`);
  }
  return (data.values || []).slice(1).some(row => String(row?.[0] || '').trim() === target);
}

function isWriteConfigurationPresent() {
  return Boolean(
    String(process.env.GOOGLE_SHEET_ID || '').trim() &&
    String(process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '').trim() &&
    (
      String(process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || '').trim() ||
      String(process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY_BASE64 || '').trim() ||
      String(process.env.GOOGLE_PRIVATE_KEY || '').trim()
    )
  );
}

module.exports = {
  normalizeSpreadsheetId,
  appendSheetRow,
  appendSheetRows,
  submissionIdExists,
  GoogleSheetsWriteError,
  createServiceAccountAssertion,
  getAccessToken,
  isWriteConfigurationPresent,
};
