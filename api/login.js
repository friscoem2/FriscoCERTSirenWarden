const crypto = require('crypto');
const { verifyBetterImpactCredentials } = require('../lib/better-impact-auth');
const {
  findProfileByUsername,
  getProfileSheetSource,
  getProfileStoreDiagnostics,
} = require('../lib/profile-store');
const { createSessionToken, makeSessionCookie } = require('../lib/session-token');

function getBody(req) {
  if (!req.body) return {};
  if (typeof req.body === 'object') return req.body;
  try { return JSON.parse(req.body); } catch { return {}; }
}

function debugEnabled() {
  return String(process.env.LOGIN_DEBUG || '').trim().toLowerCase() === 'true';
}

function requestId() {
  return crypto.randomBytes(6).toString('hex');
}

function envDiagnostics() {
  const sheetValue = String(process.env.GOOGLE_SHEET_ID || '').trim();
  const secret = String(process.env.SESSION_SECRET || '');
  const privateKey = String(
    process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY_BASE64 ||
    process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY ||
    process.env.GOOGLE_PRIVATE_KEY || ''
  ).trim();

  return {
    googleSheetIdConfigured: Boolean(sheetValue),
    googleSheetIdFormat: sheetValue.includes('/spreadsheets/d/') ? 'url' : (sheetValue ? 'raw-id' : 'missing'),
    profileSheet: getProfileSheetSource(),
    serviceAccountEmailConfigured: Boolean(String(process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '').trim()),
    serviceAccountPrivateKeyConfigured: Boolean(privateKey),
    googleSheetsApiKeyConfigured: Boolean(String(process.env.GOOGLE_SHEETS_API_KEY || '').trim()),
    sessionSecretConfigured: Boolean(secret),
    sessionSecretLength: secret.length,
    sessionSecretMeetsMinimum: secret.length >= 32,
    nodeVersion: process.version,
    vercelEnvironment: process.env.VERCEL_ENV || 'unknown',
  };
}

function sendJson(res, status, body, diagnostics, includeDebug) {
  const payload = { ...body };
  if (includeDebug) payload.debug = diagnostics;
  return res.status(status).json(payload);
}

function logStep(id, event, details = {}) {
  console.log(JSON.stringify({
    type: 'cert-login-debug',
    requestId: id,
    event,
    timestamp: new Date().toISOString(),
    ...details,
  }));
}

module.exports = async function handler(req, res) {
  const id = requestId();
  const includeDebug = debugEnabled();
  const startedAt = Date.now();
  const diagnostics = {
    requestId: id,
    debugEnabled: includeDebug,
    stage: 'request-validation',
    request: {
      method: req.method,
      contentType: req.headers?.['content-type'] || '',
      bodyPresent: Boolean(req.body),
    },
    environment: envDiagnostics(),
    steps: [],
  };

  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Login-Request-Id', id);

  function mark(stage, status, details = {}) {
    diagnostics.stage = stage;
    const step = { stage, status, atMs: Date.now() - startedAt, ...details };
    diagnostics.steps.push(step);
    logStep(id, `${stage}:${status}`, details);
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    mark('request-validation', 'failed', { reason: 'method-not-allowed' });
    return sendJson(res, 405, { error: 'Method not allowed.', code: 'METHOD_NOT_ALLOWED', requestId: id }, diagnostics, includeDebug);
  }

  const { username: rawUsername, password: rawPassword } = getBody(req);
  const username = String(rawUsername || '').trim();
  const password = String(rawPassword || '');
  diagnostics.request.usernamePresent = Boolean(username);
  diagnostics.request.usernameLength = username.length;
  diagnostics.request.passwordPresent = Boolean(password);
  diagnostics.request.passwordLength = password.length;

  if (!username || !password) {
    mark('request-validation', 'failed', { reason: 'missing-credentials' });
    return sendJson(res, 400, {
      error: 'Username and password are required.',
      code: 'MISSING_CREDENTIALS',
      requestId: id,
    }, diagnostics, includeDebug);
  }

  if (username.length > 200 || password.length > 500) {
    mark('request-validation', 'failed', { reason: 'credential-length-limit' });
    return sendJson(res, 400, {
      error: 'Invalid login request.',
      code: 'INVALID_LOGIN_REQUEST',
      requestId: id,
    }, diagnostics, includeDebug);
  }

  mark('request-validation', 'passed');

  let stage = 'better-impact';
  try {
    mark('better-impact', 'started');
    const result = await verifyBetterImpactCredentials(username, password);
    diagnostics.betterImpact = result.diagnostics || {
      postStatus: result.status,
      authenticated: result.authenticated,
    };
    mark('better-impact', result.authenticated ? 'passed' : 'rejected', {
      httpStatus: result.status,
      redirectPath: diagnostics.betterImpact.redirectPath || '',
      durationMs: (diagnostics.betterImpact.getDurationMs || 0) + (diagnostics.betterImpact.postDurationMs || 0),
    });

    if (!result.authenticated) {
      diagnostics.totalDurationMs = Date.now() - startedAt;
      return sendJson(res, 401, {
        error: 'Incorrect username or password.',
        code: 'CREDENTIALS_REJECTED',
        requestId: id,
      }, diagnostics, includeDebug);
    }

    stage = 'profile-sheet';
    mark('profile-sheet', 'started', { source: getProfileSheetSource() });
    const profile = await findProfileByUsername(username);
    diagnostics.profileSheet = getProfileStoreDiagnostics();

    if (!profile) {
      const source = getProfileSheetSource();
      const location = source.type === 'title' ? `the “${source.value}” tab` : 'the configured member profile tab';
      mark('profile-sheet', 'member-not-listed', {
        profileCount: diagnostics.profileSheet.profileCount,
        source,
      });
      diagnostics.totalDurationMs = Date.now() - startedAt;
      return sendJson(res, 403, {
        error: `Your Better Impact login was accepted, but your username is not listed in ${location}.`,
        code: 'MEMBER_NOT_LISTED',
        requestId: id,
      }, diagnostics, includeDebug);
    }

    mark('profile-sheet', 'passed', {
      cacheHit: diagnostics.profileSheet.cacheHit,
      profileCount: diagnostics.profileSheet.profileCount,
      source: diagnostics.profileSheet.source,
    });

    stage = 'session';
    mark('session', 'started');
    const canonicalUsername = profile.Username || username;
    const session = createSessionToken(canonicalUsername);
    const cookie = makeSessionCookie(session.token);
    res.setHeader('Set-Cookie', cookie);
    diagnostics.session = {
      created: true,
      expiresAt: session.expiresAt,
      cookieName: 'cert_session',
      secure: cookie.includes('Secure'),
      httpOnly: cookie.includes('HttpOnly'),
      sameSite: 'Lax',
    };
    mark('session', 'passed', { expiresAt: session.expiresAt });

    diagnostics.totalDurationMs = Date.now() - startedAt;
    mark('login', 'complete', { totalDurationMs: diagnostics.totalDurationMs });

    return sendJson(res, 200, {
      authenticated: true,
      username: canonicalUsername,
      expiresAt: session.expiresAt,
      profile,
      requestId: id,
    }, diagnostics, includeDebug);
  } catch (error) {
    if (stage === 'better-impact' && error?.diagnostics) diagnostics.betterImpact = error.diagnostics;
    if (stage === 'profile-sheet') diagnostics.profileSheet = getProfileStoreDiagnostics();

    diagnostics.failure = {
      stage,
      name: error?.name || 'Error',
      message: error?.message || String(error),
    };
    diagnostics.totalDurationMs = Date.now() - startedAt;
    mark(stage, 'error', {
      errorName: diagnostics.failure.name,
      errorMessage: diagnostics.failure.message,
      totalDurationMs: diagnostics.totalDurationMs,
    });

    console.error(`[login:${id}] Login service failure at ${stage}:`, error?.stack || error);

    if (stage === 'profile-sheet') {
      return sendJson(res, 502, {
        error: 'Your Better Impact login was accepted, but the member sheet could not be read. Check the Google Sheet ID, service-account access, and Members tab.',
        code: 'PROFILE_SHEET_UNAVAILABLE',
        requestId: id,
      }, diagnostics, includeDebug);
    }

    if (stage === 'session') {
      return sendJson(res, 502, {
        error: 'Your login was accepted, but the session could not be created. Check SESSION_SECRET in Vercel.',
        code: 'SESSION_CONFIGURATION_ERROR',
        requestId: id,
      }, diagnostics, includeDebug);
    }

    return sendJson(res, 502, {
      error: 'The Better Impact login service could not complete the request. Please try again.',
      code: 'BETTER_IMPACT_UNAVAILABLE',
      requestId: id,
    }, diagnostics, includeDebug);
  }
};
