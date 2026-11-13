async function checkKillSwitch() {
  try {
    const response = await fetch('/api/kill-switch', {
      method: 'GET',
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) return false;
    const data = await response.json();
    return data.killed === true;
  } catch (e) {
    console.warn('Kill switch check failed, defaulting to open:', e);
    return false;
  }
}

window.addEventListener('DOMContentLoaded', async () => {
  const killed = await checkKillSwitch();
  if (killed) {
    document.getElementById('kill-screen').classList.add('visible');
    return;
  }
  await initLogin();
  fetchWeather();
});

/* =====================================================
   LOGIN
   ===================================================== */
const REMEMBERED_USERNAME_KEY = 'cert_remembered_username';
const LOGIN_ATTEMPTS_PREFIX = 'cert_login_attempts:';
const LOGIN_ATTEMPT_GUIDANCE = 10;
const SUPPORT_EMAIL = 'sworden@friscotexas.gov';
const loginStorageFallback = new Map();
let loginInFlight = false;
let usernameLookupInFlight = false;
let currentUserProfile = null;
let sessionExpiresAt = 0;
let sessionExpiryTimer = null;
let appHasLoaded = false;

function readLoginStorage(key){
  try {
    return localStorage.getItem(key) ?? loginStorageFallback.get(key) ?? '';
  } catch {
    return loginStorageFallback.get(key) ?? '';
  }
}

function writeLoginStorage(key, value){
  loginStorageFallback.set(key, String(value));
  try { localStorage.setItem(key, String(value)); } catch { /* Keep login usable when storage is blocked. */ }
}

function loginAttemptsKey(username){
  return LOGIN_ATTEMPTS_PREFIX + encodeURIComponent(String(username || '').trim().toLowerCase());
}

function getLoginAttempts(username){
  if (!String(username || '').trim()) return 0;
  const count = Number(readLoginStorage(loginAttemptsKey(username)));
  return Number.isSafeInteger(count) && count > 0 ? count : 0;
}

function updateLoginAttempts(){
  const attempts = getLoginAttempts(document.getElementById('login-username').value);
  const el = document.getElementById('login-attempts');
  el.hidden = attempts === 0;
  el.classList.toggle('at-limit', attempts >= LOGIN_ATTEMPT_GUIDANCE);
  el.textContent = attempts > LOGIN_ATTEMPT_GUIDANCE
    ? `You have used ${attempts} attempts in this browser, exceeding 10 attempts.`
    : `You have used ${attempts} of 10 attempts in this browser.`;
  if (attempts >= LOGIN_ATTEMPT_GUIDANCE) {
    el.textContent += ' Please use Better Impact password reset before trying again.';
  }
  // This reminder does not enforce or claim to know Better Impact's account lockout state.
}

function toggleUsernameLookup(){
  if (usernameLookupInFlight || loginInFlight) return;
  const panel = document.getElementById('username-lookup');
  const toggle = document.getElementById('find-username-toggle');
  panel.hidden = !panel.hidden;
  toggle.setAttribute('aria-expanded', String(!panel.hidden));
  if (!panel.hidden) document.getElementById('username-lookup-email').focus();
  else toggle.focus();
}

function showUsernameLookupMessage(message, { isError = false, contactSupport = false } = {}){
  const result = document.getElementById('username-lookup-result');
  result.className = `username-lookup-result${isError ? ' error' : ''}`;
  result.textContent = message;
  if (contactSupport) {
    const link = document.createElement('a');
    link.href = `mailto:${SUPPORT_EMAIL}`;
    link.textContent = SUPPORT_EMAIL;
    result.append(' ', link, ' for help.');
  }
}

async function submitUsernameLookup(event){
  if (event) event.preventDefault();
  if (usernameLookupInFlight || loginInFlight) return;
  const form = document.getElementById('username-lookup-form');
  const input = document.getElementById('username-lookup-email');
  const btn = document.getElementById('username-lookup-btn');
  const toggle = document.getElementById('find-username-toggle');
  input.value = input.value.trim();
  if (!form.reportValidity()) return;

  usernameLookupInFlight = true;
  input.disabled = true;
  btn.disabled = true;
  toggle.disabled = true;
  btn.textContent = 'Looking up...';
  form.setAttribute('aria-busy', 'true');
  showUsernameLookupMessage('Checking the CERT member directory...');

  try {
    const response = await fetch('/api/find-username', {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ email: input.value }),
    });
    let data = {};
    try { data = await response.json(); } catch { /* A firewall may return a plain text error. */ }
    if (response.status === 429) {
      const seconds = Number(data.retryAfterSeconds);
      const minutes = Number.isFinite(seconds) && seconds > 0 && seconds <= 900 ? Math.ceil(seconds / 60) : 15;
      showUsernameLookupMessage(`Too many username searches. Please wait ${minutes} ${minutes === 1 ? 'minute' : 'minutes'} before trying again, or email`, { isError: true, contactSupport: true });
      return;
    }
    if (!response.ok) throw new Error('Username lookup failed.');

    const usernames = Array.isArray(data.usernames) ? data.usernames.filter(value => typeof value === 'string' && value.trim()) : [];
    if (data.found === false) {
      showUsernameLookupMessage('No username was found for that email address. Please email', { contactSupport: true });
    } else if (data.found === true && usernames.length) {
      showUsernameLookupMessage(usernames.length === 1
        ? `Your username is: ${usernames[0]}. It has been filled in above.`
        : `Usernames for this email: ${usernames.join(', ')}. Enter the username you want to use above.`);
      document.getElementById('username-lookup-result').classList.add('success');
      if (usernames.length === 1) {
        const usernameInput = document.getElementById('login-username');
        usernameInput.value = usernames[0];
        document.getElementById('login-error').textContent = '';
        updateLoginAttempts();
        if (!loginInFlight) document.getElementById('login-pw').focus();
      }
    } else {
      throw new Error('Invalid username lookup response.');
    }
  } catch {
    showUsernameLookupMessage('Username lookup is temporarily unavailable. Please try again or email', { isError: true, contactSupport: true });
  } finally {
    usernameLookupInFlight = false;
    input.disabled = false;
    btn.disabled = false;
    toggle.disabled = loginInFlight;
    btn.textContent = 'Find Username';
    form.setAttribute('aria-busy', 'false');
  }
}

async function initLogin(){
  const usernameInput = document.getElementById('login-username');
  const passwordInput = document.getElementById('login-pw');
  const rememberedUsername = readLoginStorage(REMEMBERED_USERNAME_KEY);
  usernameInput.value = rememberedUsername;
  usernameInput.addEventListener('input', updateLoginAttempts);
  window.addEventListener('storage', event => {
    if (!event.key || event.key.startsWith(LOGIN_ATTEMPTS_PREFIX)) updateLoginAttempts();
  });

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && sessionExpiresAt && Date.now() >= sessionExpiresAt) {
      expireLocalSession();
    }
  });

  try {
    const response = await fetch('/api/session', {
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    });

    if (response.ok) {
      const data = await response.json();
      if (data.authenticated) {
        completeLogin(data);
        return;
      }
    }
  } catch (error) {
    console.warn('Existing session check failed:', error);
  }

  showLoginScreen();
  (rememberedUsername ? passwordInput : usernameInput).focus();
}

function shakeEl(element){
  if (!element) return;
  // Restart the existing CSS animation even when consecutive login attempts fail.
  element.classList.remove('shake');
  void element.offsetWidth;
  element.classList.add('shake');
  window.setTimeout(() => element.classList.remove('shake'), 450);
}

async function submitLogin(event){
  if (event) event.preventDefault();
  if (loginInFlight || usernameLookupInFlight) return;

  const usernameInput = document.getElementById('login-username');
  const passwordInput = document.getElementById('login-pw');
  const errEl = document.getElementById('login-error');
  const username = usernameInput.value.trim();
  const password = passwordInput.value;

  errEl.textContent = '';
  if (!username) {
    shakeEl(usernameInput);
    errEl.textContent = 'Please enter your username.';
    usernameInput.focus();
    return;
  }
  if (!password) {
    shakeEl(passwordInput);
    errEl.textContent = 'Please enter your password.';
    passwordInput.focus();
    return;
  }

  writeLoginStorage(REMEMBERED_USERNAME_KEY, username);
  loginInFlight = true;
  setLoginBusy(true);

  try {
    const response = await fetch('/api/login', {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ username, password }),
    });

    let data = {};
    try { data = await response.json(); } catch { data = {}; }

    if (response.status === 401) {
      writeLoginStorage(loginAttemptsKey(username), getLoginAttempts(username) + 1);
      updateLoginAttempts();
      throw new Error('Incorrect username or password.');
    }
    if (!response.ok || !data.authenticated) {
      throw new Error(data.error || 'Login was not accepted.');
    }

    writeLoginStorage(REMEMBERED_USERNAME_KEY, data.username || username);
    writeLoginStorage(loginAttemptsKey(username), 0);
    writeLoginStorage(loginAttemptsKey(data.username || username), 0);
    updateLoginAttempts();
    passwordInput.value = '';
    completeLogin(data);
  } catch (error) {
    passwordInput.value = '';
    shakeEl(passwordInput);
    errEl.textContent = error.message || 'Unable to log in. Please try again.';
  } finally {
    loginInFlight = false;
    setLoginBusy(false);
    if (errEl.textContent) passwordInput.focus();
  }
}

function setLoginBusy(isBusy){
  const btn = document.getElementById('login-btn');
  const usernameInput = document.getElementById('login-username');
  const passwordInput = document.getElementById('login-pw');
  btn.disabled = isBusy;
  usernameInput.disabled = isBusy;
  passwordInput.disabled = isBusy;
  document.getElementById('find-username-toggle').disabled = isBusy || usernameLookupInFlight;
  document.getElementById('username-lookup-btn').disabled = isBusy || usernameLookupInFlight;
  btn.textContent = isBusy ? 'Checking…' : 'Log In';
}

function completeLogin(data){
  const username = data.username || data.profile?.Username;
  if (username) writeLoginStorage(loginAttemptsKey(username), 0);
  updateLoginAttempts();
  currentUserProfile = data.profile || null;
  sessionExpiresAt = Number(data.expiresAt || 0);
  window.currentUserProfile = currentUserProfile;
  if (typeof updateLoggedInUserUI === 'function') updateLoggedInUserUI(currentUserProfile);
  window.dispatchEvent(new CustomEvent('cert:user-ready', { detail: currentUserProfile }));

  document.getElementById('login-screen').classList.add('hidden');
  scheduleSessionExpiry();

  if (!appHasLoaded) {
    appHasLoaded = true;
    startLoad();
  }
}

function scheduleSessionExpiry(){
  if (sessionExpiryTimer) clearTimeout(sessionExpiryTimer);
  if (!sessionExpiresAt) return;
  const delay = Math.max(0, sessionExpiresAt - Date.now());
  sessionExpiryTimer = setTimeout(expireLocalSession, delay);
}

function expireLocalSession(){
  if (sessionExpiryTimer) clearTimeout(sessionExpiryTimer);
  sessionExpiryTimer = null;
  sessionExpiresAt = 0;
  currentUserProfile = null;
  window.currentUserProfile = null;
  if (typeof clearAssignedReportMode === 'function') clearAssignedReportMode();
  if (typeof clearLoggedInUserUI === 'function') clearLoggedInUserUI();
  showLoginScreen('Your 30-minute session has expired. Please log in again.');
}

function showLoginScreen(message = ''){
  const screen = document.getElementById('login-screen');
  const errEl = document.getElementById('login-error');
  const passwordInput = document.getElementById('login-pw');
  screen.classList.remove('hidden');
  passwordInput.type = 'password';
  passwordInput.value = '';
  errEl.textContent = message;
  updateLoginAttempts();
}

async function logout(){
  try {
    await fetch('/api/logout', { method: 'POST', credentials: 'same-origin' });
  } catch (error) {
    console.warn('Logout request failed:', error);
  }
  expireLocalSession();
}

/* =====================================================
   DATA LOADING
   ===================================================== */
function apiUrl(resource){
  return `/api/data?resource=${encodeURIComponent(resource)}`;
}

async function fetchProtectedData(resource){
  const response = await fetch(apiUrl(resource), {
    method: 'GET',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { Accept: 'application/json' },
  });

  let data = {};
  try { data = await response.json(); } catch { data = {}; }

  if (response.status === 401) {
    expireLocalSession();
  }
  if (!response.ok) {
    throw new Error(data.error?.message || data.error || `HTTP ${response.status}`);
  }
  return data;
}

function startLoad(){
  hideError();
  showLoadingScreen();
  Promise.all([
    fetchProtectedData('sirens'),
    fetchProtectedData('assignment-status'),
  ])
    .then(([d, assignmentStatus])=>{
      const rows=d.values||[];
      if(rows.length<2) throw new Error('No data rows found.');
      if(typeof setAssignmentServerStatus === 'function') setAssignmentServerStatus(assignmentStatus);
      initMap(rowsToSirens(rows));
    })
    .catch(err=>{
      if (sessionExpiresAt) showError(err.message);
    });
}

function rowsToSirens(rows){
  return rows.slice(1).filter(r=>r[0]).map(r=>({
    id:             r[0],
    friendlyName:   r[1]  ||'TBD',
    systemName:     r[2]  ||'TBD',
    lat:            parseFloat(r[3]),
    lng:            parseFloat(r[4]),
    status:         r[5]  ||'Unknown',
    lastTested:     r[6]  ||'N/A',
    nextTest:       r[7]  ||'N/A',
    signUpNeeded:   r[8]  ||'Yes',
    daysSinceSignup:parseFloat(r[9]) ||0,
    lastSignUpDate: r[10] ||'N/A',
    daysSinceVisit: parseFloat(r[11])||0,
    lastVisitDate:  r[12] ||'N/A',
    description:    r[13] ||'',
    instructions:   r[14] ||'',
    population:     parseInt(String(r[15]||'0').replace(/,/g,''))||0,
    imageUrl:       r[16] ||'',
    currentSignup:  r[17] ||'',
  }));
}

function driveImgSrc(url, size){
  if(!url) return '';
  size = size||'w400';
  let id = '';
  const m1 = url.match(/\/file\/d\/([^\/\?&]+)/);
  const m2 = url.match(/[?&]id=([^&]+)/);
  if(m1) id = m1[1];
  else if(m2) id = m2[1];
  if(!id) return '';
  return `https://drive.google.com/thumbnail?id=${id}&sz=${size}`;
}

/* =====================================================
   URGENCY
   ===================================================== */
function urgencyDays(s){
  const a=isNaN(s.daysSinceSignup)?9999:s.daysSinceSignup;
  const b=isNaN(s.daysSinceVisit) ?9999:s.daysSinceVisit;
  return Math.min(a,b);
}
function sirenColor(s){
  const assignedId = typeof currentAssignedSirenId === 'function' ? currentAssignedSirenId() : '';
  if(assignedId && String(s.id) === String(assignedId)) return '#6b7280';
  if((s.signUpNeeded||'').toLowerCase()!=='yes') return '#6b7280';
  const d=urgencyDays(s);
  if(d<=7)  return '#10b981';
  if(d<=14) return '#f59e0b';
  if(d<=21) return '#f97316';
  return '#dc2626';
}
function urgencyLabel(s){
  const assignedId = typeof currentAssignedSirenId === 'function' ? currentAssignedSirenId() : '';
  if(assignedId && String(s.id) === String(assignedId)) return null;
  if((s.signUpNeeded||'').toLowerCase()!=='yes') return null;
  const d=urgencyDays(s);
  if(d<=7)  return{text:'Recent Activity ✓',      bg:'#d1fae5',color:'#065f46'};
  if(d<=14) return{text:'Needs Attention',          bg:'#fef3c7',color:'#92400e'};
  if(d<=21) return{text:'Action Required!',         bg:'#ffedd5',color:'#9a3412'};
  return          {text:'URGENT — No Recent Activity',bg:'#fee2e2',color:'#991b1b'};
}

/* =====================================================
   LIVES PROTECTED
   ===================================================== */
function calcLivesProtected(sirens){
  return sirens.filter(s=>s.daysSinceVisit<=21).reduce((sum,s)=>sum+s.population,0);
}

function animateCount(el, target, duration){
  const start = performance.now();
  function step(now){
    const p = Math.min((now-start)/duration,1);
    const ease = 1-Math.pow(1-p,3);
    el.textContent = Math.floor(target*ease).toLocaleString();
    if(p<1) requestAnimationFrame(step);
    else el.textContent = target.toLocaleString();
  }
  requestAnimationFrame(step);
}

/* =====================================================
   MAP INIT
   ===================================================== */
