const {
  SESSION_COOKIE_NAME,
  parseCookies,
  verifySessionToken,
  clearSessionCookie,
} = require('../lib/session-token');
const { findProfileByUsername } = require('../lib/profile-store');
const { fetchWholeSheetByTitle } = require('../lib/google-sheets');
const { appendSheetRow, isWriteConfigurationPresent } = require('../lib/google-sheets-write');
const crypto = require('crypto');

const FORM_TAB_DEFAULTS = {
  signup: 'Sign Ups',
  report: 'Siren Reports',
  suggestion: 'Suggestions',
};

const SUGGESTION_TYPE_LABELS = {
  bug: 'Bug / Something not working',
  improvement: 'Improvement idea',
  feature: 'New feature request',
  map: 'Map / siren information issue',
  process: 'Sign-up or reporting process',
};

const IMPORTANCE_LABELS = {
  nice: 'Nice to have 😄',
  helpful: 'Helpful 🙏',
  important: 'Important ❗',
  urgent: 'Urgent 🚨',
};

function getBody(req) {
  if (!req.body) return {};
  if (typeof req.body === 'object') return req.body;
  try { return JSON.parse(req.body); } catch { return {}; }
}

function cleanText(value, maxLength = 500) {
  const normalized = String(value ?? '').trim();
  if (normalized.length > maxLength) {
    throw new FormValidationError(`A submitted value exceeded the ${maxLength}-character limit.`);
  }
  return normalized;
}

function cleanStringArray(value, maxItems = 20, maxItemLength = 300) {
  if (!Array.isArray(value)) return [];
  if (value.length > maxItems) throw new FormValidationError('Too many options were submitted.');
  return value.map(item => cleanText(item, maxItemLength)).filter(Boolean);
}

function profileName(profile) {
  return `${cleanText(profile.FirstName || profile['First Name'], 100)} ${cleanText(profile.LastName || profile['Last Name'], 100)}`.trim()
    || cleanText(profile.Name || profile.Username || 'CERT Volunteer', 180);
}

function profileEmail(profile) {
  return cleanText(profile.EmailAddress || profile.Email || profile['Email Address'], 254);
}

function centralTimestamp() {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date());
}

function sheetNameFor(type) {
  const envMap = {
    signup: 'SIGNUPS_SHEET_NAME',
    report: 'SIREN_REPORTS_SHEET_NAME',
    suggestion: 'SUGGESTIONS_SHEET_NAME',
  };
  return cleanText(process.env[envMap[type]] || FORM_TAB_DEFAULTS[type], 100);
}

class FormValidationError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'FormValidationError';
    this.status = status;
  }
}


const SECRET_ENV_NAMES = [
  'SESSION_SECRET',
  'GOOGLE_SHEETS_API_KEY',
  'GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY',
  'GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY_BASE64',
  'GOOGLE_PRIVATE_KEY',
];

function hasEnv(name) {
  return Boolean(String(process.env[name] || '').trim());
}

function writeConfigurationStatus() {
  const privateKeyPresent = hasEnv('GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY')
    || hasEnv('GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY_BASE64')
    || hasEnv('GOOGLE_PRIVATE_KEY');
  return {
    GOOGLE_SHEET_ID: hasEnv('GOOGLE_SHEET_ID'),
    GOOGLE_SERVICE_ACCOUNT_EMAIL: hasEnv('GOOGLE_SERVICE_ACCOUNT_EMAIL'),
    GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: privateKeyPresent,
  };
}

function missingWriteConfiguration() {
  const status = writeConfigurationStatus();
  return Object.entries(status).filter(([, present]) => !present).map(([name]) => name);
}

function redactSecrets(value) {
  let output = String(value || 'Unknown server error.');
  for (const name of SECRET_ENV_NAMES) {
    const secret = String(process.env[name] || '');
    if (secret && secret.length >= 6) output = output.split(secret).join('[redacted]');
  }
  return output
    .replace(/-----BEGIN [^-]+-----[\s\S]*?-----END [^-]+-----/gi, '[redacted private key]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, 'Bearer [redacted]')
    .replace(/\bya29\.[A-Za-z0-9._-]+/g, '[redacted access token]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[redacted JWT]')
    .replace(/\bAIza[0-9A-Za-z_-]{20,}\b/g, '[redacted API key]')
    .slice(0, 700);
}

function inferDebugStage(error) {
  if (error?.stage) return String(error.stage);
  const message = String(error?.message || '').toLowerCase();
  if (message.includes('private key') || message.includes('jwt')) return 'service_account_jwt';
  if (message.includes('authorization') || message.includes('oauth')) return 'google_authorization';
  if (message.includes('append') || message.includes('google sheets')) return 'google_sheets_append';
  if (message.includes('siren')) return 'siren_lookup';
  if (message.includes('profile')) return 'member_profile_lookup';
  return 'server';
}

function debugHints(error, missing = []) {
  if (missing.length) {
    return [
      `Add the missing Vercel variable${missing.length === 1 ? '' : 's'} and redeploy.`,
      'Make sure the variables are enabled for the environment you are testing: Production, Preview, or Development.',
    ];
  }

  const stage = inferDebugStage(error);
  const detail = String(error?.message || '').toLowerCase();
  if (stage === 'service_account_jwt') {
    return [
      'Verify that the private key includes the full BEGIN/END PRIVATE KEY block.',
      'If Vercel newline formatting is causing problems, use GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY_BASE64 instead.',
    ];
  }
  if (stage === 'google_authorization') {
    return [
      'Confirm the service-account email and private key came from the same Google service-account JSON file.',
      'Confirm the Google Sheets API is enabled in the Google Cloud project.',
    ];
  }
  if (stage === 'google_sheets_append') {
    const hints = [
      'Share the destination spreadsheet with the service-account email as an Editor.',
      'Confirm the destination tab name exactly matches the Vercel environment variable, including spaces and capitalization.',
    ];
    if (detail.includes('permission') || Number(error?.httpStatus) === 403) {
      hints.unshift('Google rejected the write permission for this service account.');
    }
    if (detail.includes('unable to parse range') || Number(error?.httpStatus) === 404) {
      hints.unshift('The spreadsheet or destination tab could not be found.');
    }
    return hints;
  }
  return ['Check the matching Vercel Function log using the request ID below.'];
}

function buildDebugPayload({ error, requestId, formType, destinationSheet, status = 500 }) {
  const missing = missingWriteConfiguration();
  return {
    requestId,
    status,
    stage: inferDebugStage(error),
    formType: formType || 'unknown',
    destinationSheet: destinationSheet || 'unknown',
    googleHttpStatus: Number(error?.httpStatus || 0) || null,
    googleStatus: redactSecrets(error?.googleStatus || ''),
    detail: redactSecrets(error?.reason || error?.message || error),
    missingEnvironmentVariables: missing,
    configurationPresent: writeConfigurationStatus(),
    hints: debugHints(error, missing),
  };
}

async function resolveSiren(sirenId) {
  const target = cleanText(sirenId, 50);
  if (!target) throw new FormValidationError('A warning siren must be selected from the map.');

  const tabName = cleanText(process.env.SIREN_SHEET_NAME || '', 100);
  if (!tabName) throw new Error('SIREN_SHEET_NAME is not configured.');

  const rows = await fetchWholeSheetByTitle(tabName);
  const row = rows.slice(1).find(candidate => cleanText(candidate?.[0], 50) === target);
  if (!row) throw new FormValidationError('The selected warning siren could not be found.', 404);

  return {
    id: cleanText(row[0], 50),
    friendlyName: cleanText(row[1] || row[2] || `Siren #${target}`, 200),
    systemName: cleanText(row[2], 200),
    signUpNeeded: cleanText(row[8], 20),
    currentSignup: cleanText(row[17], 254),
  };
}

function sirenDisplayName(siren) {
  return `Siren #${siren.id} — ${siren.friendlyName}`;
}

function ensureAssignedToProfile(siren, profile) {
  const expected = profileEmail(profile).toLowerCase();
  const assigned = cleanText(siren.currentSignup, 254).toLowerCase();
  if (!expected || !assigned || expected !== assigned) {
    throw new FormValidationError(
      'This siren report is limited to the volunteer currently assigned to the selected siren.',
      403
    );
  }
}

function validateEmail(value, optional = false) {
  const email = cleanText(value, 254);
  if (!email && optional) return '';
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new FormValidationError('Please provide a valid email address.');
  }
  return email;
}

function validateDate(value) {
  const date = cleanText(value, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new FormValidationError('Please select a valid observation date.');
  }
  return date;
}

async function submitSignup(body, profile) {
  const siren = await resolveSiren(body.sirenId);
  if (String(siren.signUpNeeded || '').trim().toLowerCase() !== 'yes') {
    throw new FormValidationError('This siren is already assigned and is no longer available for sign-up.', 409);
  }
  const name = profileName(profile);
  const email = validateEmail(profileEmail(profile));
  const username = cleanText(profile.Username, 200);

  const result = await appendSheetRow(sheetNameFor('signup'), [
    centralTimestamp(),
    name,
    sirenDisplayName(siren),
    email,
    username,
    siren.id,
    siren.friendlyName,
  ]);

  return { formType: 'signup', sirenId: siren.id, ...result };
}

async function submitReport(body, profile) {
  const siren = await resolveSiren(body.sirenId);
  ensureAssignedToProfile(siren, profile);

  const observationDate = validateDate(body.observationDate);
  const heardSiren = cleanText(body.heardSiren, 20);
  if (!['Yes', 'No', 'Unsure'].includes(heardSiren)) {
    throw new FormValidationError('Please indicate whether you heard the siren.');
  }

  const damageOverall = cleanText(body.damageOverall, 10);
  if (!['Yes', 'No'].includes(damageOverall)) {
    throw new FormValidationError('Please indicate whether you observed any damage or abnormalities.');
  }

  const sirenDamage = damageOverall === 'Yes' ? cleanStringArray(body.sirenDamage) : [];
  const siteDamage = damageOverall === 'Yes' ? cleanStringArray(body.siteDamage) : [];
  if (damageOverall === 'Yes' && !sirenDamage.length && !siteDamage.length) {
    throw new FormValidationError('Select or describe at least one siren or site issue.');
  }

  const result = await appendSheetRow(sheetNameFor('report'), [
    centralTimestamp(),
    profileName(profile),
    validateEmail(profileEmail(profile)),
    sirenDisplayName(siren),
    observationDate,
    heardSiren,
    damageOverall,
    sirenDamage.join('; '),
    siteDamage.join('; '),
    cleanText(profile.Username, 200),
    siren.id,
    siren.friendlyName,
  ]);

  return { formType: 'report', sirenId: siren.id, ...result };
}

async function submitSuggestion(body) {
  const name = cleanText(body.name, 160);
  const email = validateEmail(body.email, true);
  const suggestionTypeKey = cleanText(body.suggestionType, 40);
  const suggestionType = SUGGESTION_TYPE_LABELS[suggestionTypeKey];
  if (!suggestionType) throw new FormValidationError('Please select a suggestion type.');

  const systemArea = cleanText(body.systemArea, 100);
  const allowedAreas = [
    'Login screen', 'Main map', 'Siren popup', 'Volunteer sign-up form',
    'Report form', 'Leaderboard', 'Weather', 'Mobile layout', "I don't know!",
  ];
  if (!allowedAreas.includes(systemArea)) throw new FormValidationError('Please select which part of the system this is about.');

  const suggestion = cleanText(body.suggestion, 3000);
  if (!suggestion) throw new FormValidationError('Please enter your suggestion.');

  const importanceKey = cleanText(body.importance, 30);
  const importance = IMPORTANCE_LABELS[importanceKey];
  if (!importance) throw new FormValidationError('Please select how important this is.');

  const result = await appendSheetRow(sheetNameFor('suggestion'), [
    centralTimestamp(),
    name,
    email,
    suggestionType,
    systemArea,
    suggestion,
    importance,
  ]);

  return { formType: 'suggestion', ...result };
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const requestId = crypto.randomUUID();
  res.setHeader('X-Form-Request-Id', requestId);
  let formType = '';
  let destinationSheet = '';

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: { message: 'Method not allowed.' } });
  }

  try {
    const cookies = parseCookies(req.headers.cookie || '');
    const session = verifySessionToken(cookies[SESSION_COOKIE_NAME]);
    if (!session) {
      res.setHeader('Set-Cookie', clearSessionCookie());
      return res.status(401).json({ error: { message: 'Your session has expired. Please log in again.' } });
    }

    const profile = await findProfileByUsername(session.sub);
    if (!profile) {
      return res.status(403).json({ error: { message: 'No CERT Members profile is configured for this login.' } });
    }

    const body = getBody(req);
    formType = cleanText(body.formType, 30).toLowerCase();
    destinationSheet = ['signup', 'report', 'suggestion'].includes(formType) ? sheetNameFor(formType) : '';

    if (!isWriteConfigurationPresent()) {
      const setupError = new Error('One or more Google Sheets write environment variables are missing.');
      setupError.stage = 'configuration';
      return res.status(503).json({
        error: {
          message: 'Form writing is ready, but Google service-account credentials have not been configured in Vercel yet.',
          debug: buildDebugPayload({
            error: setupError,
            requestId,
            formType,
            destinationSheet,
            status: 503,
          }),
        },
      });
    }

    let result;

    if (formType === 'signup') result = await submitSignup(body, profile);
    else if (formType === 'report') result = await submitReport(body, profile);
    else if (formType === 'suggestion') result = await submitSuggestion(body, profile);
    else throw new FormValidationError('Unknown form type.');

    return res.status(201).json({ success: true, ...result });
  } catch (error) {
    if (error instanceof FormValidationError) {
      return res.status(error.status || 400).json({ error: { message: error.message } });
    }
    const debug = buildDebugPayload({
      error,
      requestId,
      formType,
      destinationSheet,
      status: 500,
    });
    console.error('Native form submission failed:', {
      requestId,
      stage: debug.stage,
      formType: debug.formType,
      destinationSheet: debug.destinationSheet,
      detail: debug.detail,
    });
    return res.status(500).json({
      error: {
        message: 'The form could not be written to Google Sheets. Please try again.',
        debug,
      },
    });
  }
};
