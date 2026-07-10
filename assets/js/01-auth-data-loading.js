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
let currentUserProfile = null;
let sessionExpiresAt = 0;
let sessionExpiryTimer = null;
let appHasLoaded = false;

async function initLogin(){
  const usernameInput = document.getElementById('login-username');
  const passwordInput = document.getElementById('login-pw');
  const rememberedUsername = localStorage.getItem(REMEMBERED_USERNAME_KEY) || '';
  usernameInput.value = rememberedUsername;

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

async function submitLogin(event){
  if (event) event.preventDefault();

  const btn = document.getElementById('login-btn');
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

  localStorage.setItem(REMEMBERED_USERNAME_KEY, username);
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

    if (!response.ok || !data.authenticated) {
      throw new Error(data.error || 'Login was not accepted.');
    }

    localStorage.setItem(REMEMBERED_USERNAME_KEY, data.username || username);
    passwordInput.value = '';
    completeLogin(data);
  } catch (error) {
    passwordInput.value = '';
    shakeEl(passwordInput);
    errEl.textContent = error.message || 'Unable to log in. Please try again.';
    passwordInput.focus();
  } finally {
    setLoginBusy(false);
  }
}

function setLoginBusy(isBusy){
  const btn = document.getElementById('login-btn');
  const usernameInput = document.getElementById('login-username');
  const passwordInput = document.getElementById('login-pw');
  btn.disabled = isBusy;
  usernameInput.disabled = isBusy;
  passwordInput.disabled = isBusy;
  btn.textContent = isBusy ? 'Checking…' : 'Log In';
}

function completeLogin(data){
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
  fetchProtectedData('sirens')
    .then(d=>{ const rows=d.values||[]; if(rows.length<2) throw new Error('No data rows found.'); initMap(rowsToSirens(rows)); })
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
  if((s.signUpNeeded||'').toLowerCase()!=='yes') return '#6b7280';
  const d=urgencyDays(s);
  if(d<=7)  return '#10b981';
  if(d<=14) return '#f59e0b';
  if(d<=21) return '#f97316';
  return '#dc2626';
}
function urgencyLabel(s){
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
