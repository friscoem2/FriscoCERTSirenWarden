const LOGIN_URL = 'https://app.betterimpact.com/Login/Login';
const EXPECTED_SUCCESS_PATH = '/Volunteer/Main';

function decodeHtml(value) {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function extractHiddenInput(html, name) {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const inputPattern = new RegExp(`<input\\b[^>]*\\bname=["']${escapedName}["'][^>]*>`, 'i');
  const input = html.match(inputPattern)?.[0];
  if (!input) return '';
  return decodeHtml(input.match(/\bvalue=["']([^"']*)["']/i)?.[1] || '');
}

function getSetCookieHeaders(headers) {
  if (typeof headers.getSetCookie === 'function') return headers.getSetCookie();
  const combined = headers.get('set-cookie');
  if (!combined) return [];
  return combined.split(/,(?=\s*[^;,\s]+=)/g);
}

function cookieHeaderFromResponses(...responses) {
  const cookies = new Map();
  responses.forEach(response => {
    getSetCookieHeaders(response.headers).forEach(setCookie => {
      const pair = setCookie.split(';', 1)[0];
      const index = pair.indexOf('=');
      if (index > 0) cookies.set(pair.slice(0, index).trim(), pair.slice(index + 1).trim());
    });
  });
  return [...cookies.entries()].map(([name, value]) => `${name}=${value}`).join('; ');
}

function isExpectedSuccessRedirect(location) {
  if (!location) return false;
  try {
    const url = new URL(location, LOGIN_URL);
    return url.origin === new URL(LOGIN_URL).origin && url.pathname.replace(/\/$/, '') === EXPECTED_SUCCESS_PATH;
  } catch {
    return false;
  }
}

function safeRedirectDetails(location) {
  if (!location) return { present: false, origin: '', path: '' };
  try {
    const url = new URL(location, LOGIN_URL);
    return { present: true, origin: url.origin, path: url.pathname };
  } catch {
    return { present: true, origin: 'unparseable', path: '' };
  }
}

function makeAuthError(message, diagnostics) {
  const error = new Error(message);
  error.name = 'BetterImpactAuthError';
  error.diagnostics = diagnostics;
  return error;
}

async function inspectBetterImpactLoginPage() {
  const startedAt = Date.now();
  const diagnostics = {
    url: LOGIN_URL,
    getStatus: null,
    getDurationMs: null,
    contentType: '',
    verificationTokenFound: false,
    returnUrlFound: false,
    agencyGuidFound: false,
    cookieCount: 0,
  };

  let response;
  try {
    response = await fetch(LOGIN_URL, {
      method: 'GET',
      redirect: 'manual',
      headers: {
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'User-Agent': 'Frisco-CERT-Disaster-Simulation/1.0',
      },
    });
  } catch (error) {
    diagnostics.getDurationMs = Date.now() - startedAt;
    diagnostics.networkError = error?.message || String(error);
    throw makeAuthError(`Better Impact login page request failed: ${diagnostics.networkError}`, diagnostics);
  }

  diagnostics.getStatus = response.status;
  diagnostics.getDurationMs = Date.now() - startedAt;
  diagnostics.contentType = response.headers.get('content-type') || '';
  diagnostics.cookieCount = getSetCookieHeaders(response.headers).length;

  if (!response.ok) {
    throw makeAuthError(`Better Impact login page returned HTTP ${response.status}.`, diagnostics);
  }

  const html = await response.text();
  const verificationToken = extractHiddenInput(html, '__RequestVerificationToken');
  const returnUrl = extractHiddenInput(html, 'ReturnUrl');
  const agencyGuid = extractHiddenInput(html, 'AgencyGuid');

  diagnostics.verificationTokenFound = Boolean(verificationToken);
  diagnostics.returnUrlFound = Boolean(returnUrl);
  diagnostics.agencyGuidFound = Boolean(agencyGuid);
  diagnostics.htmlLength = html.length;

  if (!verificationToken) {
    throw makeAuthError('Better Impact verification token was not found.', diagnostics);
  }

  return {
    response,
    verificationToken,
    returnUrl,
    agencyGuid,
    diagnostics,
  };
}

async function verifyBetterImpactCredentials(username, password) {
  const page = await inspectBetterImpactLoginPage();
  const diagnostics = { ...page.diagnostics };

  const body = new URLSearchParams({
    __RequestVerificationToken: page.verificationToken,
    UserName: username,
    Password: password,
    ReturnUrl: page.returnUrl,
    AgencyGuid: page.agencyGuid,
  });

  const cookieHeader = cookieHeaderFromResponses(page.response);
  diagnostics.postCookieHeaderPresent = Boolean(cookieHeader);

  const postStartedAt = Date.now();
  let loginResponse;
  try {
    loginResponse = await fetch(LOGIN_URL, {
      method: 'POST',
      redirect: 'manual',
      headers: {
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Content-Type': 'application/x-www-form-urlencoded',
        Cookie: cookieHeader,
        Origin: 'https://app.betterimpact.com',
        Referer: LOGIN_URL,
        'User-Agent': 'Frisco-CERT-Disaster-Simulation/1.0',
      },
      body: body.toString(),
    });
  } catch (error) {
    diagnostics.postDurationMs = Date.now() - postStartedAt;
    diagnostics.postNetworkError = error?.message || String(error);
    throw makeAuthError(`Better Impact credential request failed: ${diagnostics.postNetworkError}`, diagnostics);
  }

  const location = loginResponse.headers.get('location') || '';
  const redirect = safeRedirectDetails(location);
  const authenticated = [301, 302, 303, 307, 308].includes(loginResponse.status) && isExpectedSuccessRedirect(location);

  Object.assign(diagnostics, {
    postStatus: loginResponse.status,
    postDurationMs: Date.now() - postStartedAt,
    redirectPresent: redirect.present,
    redirectOrigin: redirect.origin,
    redirectPath: redirect.path,
    expectedRedirectPath: EXPECTED_SUCCESS_PATH,
    authenticated,
  });

  return {
    authenticated,
    status: loginResponse.status,
    location,
    diagnostics,
  };
}

module.exports = {
  LOGIN_URL,
  EXPECTED_SUCCESS_PATH,
  extractHiddenInput,
  getSetCookieHeaders,
  isExpectedSuccessRedirect,
  inspectBetterImpactLoginPage,
  verifyBetterImpactCredentials,
};
