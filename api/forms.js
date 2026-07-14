const {
  SESSION_COOKIE_NAME,
  parseCookies,
  verifySessionToken,
  clearSessionCookie,
} = require('../lib/session-token');
const { findProfileByUsername } = require('../lib/profile-store');
const { fetchWholeSheetByTitle } = require('../lib/google-sheets');
const { appendSheetRow, isWriteConfigurationPresent } = require('../lib/google-sheets-write');

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

    if (!isWriteConfigurationPresent()) {
      return res.status(503).json({
        error: {
          message: 'Form writing is ready, but Google service-account credentials have not been configured in Vercel yet.',
        },
      });
    }

    const body = getBody(req);
    const formType = cleanText(body.formType, 30).toLowerCase();
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
    console.error('Native form submission failed:', error.message);
    return res.status(500).json({
      error: { message: 'The form could not be written to Google Sheets. Please try again.' },
    });
  }
};
