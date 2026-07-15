const { inspectBetterImpactLoginPage } = require('../lib/better-impact-auth');
const { diagnoseProfileSheet, getProfileSheetSource, getProfileStoreDiagnostics } = require('../lib/profile-store');

function enabled() {
  return String(process.env.LOGIN_DEBUG || '').trim().toLowerCase() === 'true';
}

function configured(value) {
  return Boolean(String(value || '').trim());
}

function environmentSummary() {
  const sheetValue = String(process.env.GOOGLE_SHEET_ID || '').trim();
  const secret = String(process.env.SESSION_SECRET || '');
  return {
    googleSheetIdConfigured: configured(sheetValue),
    googleSheetIdFormat: sheetValue.includes('/spreadsheets/d/') ? 'url' : (sheetValue ? 'raw-id' : 'missing'),
    profileSheet: getProfileSheetSource(),
    serviceAccountEmailConfigured: configured(process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL),
    serviceAccountPrivateKeyBase64Configured: configured(process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY_BASE64),
    serviceAccountPrivateKeyConfigured: configured(process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY),
    googleSheetsApiKeyConfigured: configured(process.env.GOOGLE_SHEETS_API_KEY),
    sessionSecretConfigured: configured(secret),
    sessionSecretLength: secret.length,
    sessionSecretMeetsMinimum: secret.length >= 32,
    sessionTtlMinutes: Number.parseInt(process.env.SESSION_TTL_MINUTES || '240', 10),
    nodeVersion: process.version,
    vercelEnvironment: process.env.VERCEL_ENV || 'unknown',
  };
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (!enabled()) {
    return res.status(404).json({ error: 'Not found.' });
  }

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  const report = {
    generatedAt: new Date().toISOString(),
    environment: environmentSummary(),
    checks: {},
  };

  try {
    const page = await inspectBetterImpactLoginPage();
    report.checks.betterImpactLoginPage = {
      passed: true,
      ...page.diagnostics,
    };
  } catch (error) {
    report.checks.betterImpactLoginPage = {
      passed: false,
      error: error?.message || String(error),
      ...(error?.diagnostics || {}),
    };
  }

  try {
    const sheet = await diagnoseProfileSheet();
    report.checks.profileSheet = {
      passed: true,
      ...sheet,
    };
  } catch (error) {
    report.checks.profileSheet = {
      passed: false,
      error: error?.message || String(error),
      ...getProfileStoreDiagnostics(),
    };
  }

  report.checks.sessionSecret = {
    passed: report.environment.sessionSecretMeetsMinimum,
    configured: report.environment.sessionSecretConfigured,
    length: report.environment.sessionSecretLength,
    requirement: 'At least 32 characters',
  };

  const allPassed = Object.values(report.checks).every(check => check.passed === true);
  report.allPassed = allPassed;
  return res.status(allPassed ? 200 : 503).json(report);
};
