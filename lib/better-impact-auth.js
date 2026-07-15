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

async function verifyBetterImpactCredentials(username, password) {
  const loginPageResponse = await fetch(LOGIN_URL, {
    method: 'GET',
    redirect: 'manual',
    headers: {
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'User-Agent': 'Frisco-CERT-Siren-Map/1.0',
    },
  });

  if (!loginPageResponse.ok) {
    throw new Error(`Better Impact login page returned HTTP ${loginPageResponse.status}.`);
  }

  const loginHtml = await loginPageResponse.text();
  const verificationToken = extractHiddenInput(loginHtml, '__RequestVerificationToken');
  if (!verificationToken) {
    throw new Error('Better Impact verification token was not found.');
  }

  const body = new URLSearchParams({
    __RequestVerificationToken: verificationToken,
    UserName: username,
    Password: password,
    ReturnUrl: extractHiddenInput(loginHtml, 'ReturnUrl'),
    AgencyGuid: extractHiddenInput(loginHtml, 'AgencyGuid'),
  });

  const loginResponse = await fetch(LOGIN_URL, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Content-Type': 'application/x-www-form-urlencoded',
      Cookie: cookieHeaderFromResponses(loginPageResponse),
      Origin: 'https://app.betterimpact.com',
      Referer: LOGIN_URL,
      'User-Agent': 'Frisco-CERT-Siren-Map/1.0',
    },
    body: body.toString(),
  });

  const location = loginResponse.headers.get('location') || '';
  return {
    authenticated: loginResponse.status === 302 && isExpectedSuccessRedirect(location),
    status: loginResponse.status,
    location,
  };
}

module.exports = {
  extractHiddenInput,
  isExpectedSuccessRedirect,
  verifyBetterImpactCredentials,
};
