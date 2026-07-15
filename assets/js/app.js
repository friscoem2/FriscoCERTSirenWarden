'use strict';

const CERT_LOGO_ID = '16Lg4zmmXXKSeqZXpguuJMuZVAh3Xu9dv';
const REMEMBERED_USERNAME_KEY = 'cert_remembered_username';
const STORAGE_PREFIX = 'frisco_cert_disaster_sim';

const state = {
  user: null,
  sessionExpiresAt: 0,
  sessionTimer: null,
  scenario: null,
  map: null,
  cityLayer: null,
  disasterLayer: null,
  poiLayers: new Map(),
  locationMarker: null,
  accuracyCircle: null,
  locationWatchId: null,
  location: null,
  insideDisaster: false,
  geigerOpen: false,
  followUser: false,
  soundOn: true,
  audioContext: null,
  audioTimer: null,
  activePoi: null,
  currentCpm: null,
  readings: {},
  submissionId: '',
  submitted: false,
  toastTimer: null,
  loginDebugText: '',
};

window.addEventListener('DOMContentLoaded', initializeApp);
window.addEventListener('resize', setViewportHeight);
window.addEventListener('orientationchange', () => setTimeout(setViewportHeight, 200));
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && state.sessionExpiresAt && Date.now() >= state.sessionExpiresAt) expireLocalSession();
});

function setViewportHeight() {
  document.documentElement.style.setProperty('--vh', `${window.innerHeight * 0.01}px`);
}

async function initializeApp() {
  setViewportHeight();
  const killed = await checkKillSwitch();
  if (killed) {
    showOnly('kill-screen');
    return;
  }
  await initializeLogin();
}

async function checkKillSwitch() {
  try {
    const response = await fetch('/api/kill-switch', { cache: 'no-store', headers: { Accept: 'application/json' } });
    if (!response.ok) return false;
    const data = await response.json();
    return data.killed === true;
  } catch (error) {
    console.warn('Kill switch unavailable; continuing in fail-open mode.', error);
    return false;
  }
}

async function initializeLogin() {
  const usernameInput = document.getElementById('login-username');
  const passwordInput = document.getElementById('login-password');
  const remembered = safeStorageGet(REMEMBERED_USERNAME_KEY) || '';
  usernameInput.value = remembered;

  try {
    const response = await fetch('/api/session', {
      method: 'GET', credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' },
    });
    if (response.ok) {
      const data = await response.json();
      if (data.authenticated) {
        await completeLogin(data);
        return;
      }
    }
  } catch (error) {
    console.warn('Existing session check failed.', error);
  }

  showOnly('login-screen');
  (remembered ? passwordInput : usernameInput).focus();
}

async function submitLogin(event) {
  event?.preventDefault();
  const usernameInput = document.getElementById('login-username');
  const passwordInput = document.getElementById('login-password');
  const errorElement = document.getElementById('login-error');
  const username = usernameInput.value.trim();
  const password = passwordInput.value;
  errorElement.textContent = '';
  clearLoginDebug();

  if (!username) return rejectLoginInput(usernameInput, 'Please enter your username.');
  if (!password) return rejectLoginInput(passwordInput, 'Please enter your password.');

  safeStorageSet(REMEMBERED_USERNAME_KEY, username);
  setLoginBusy(true);
  try {
    const response = await fetch('/api/login', {
      method: 'POST', credentials: 'same-origin', cache: 'no-store',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const data = await parseJson(response);

    if (!response.ok || !data.authenticated) {
      const requestId = data.requestId || response.headers.get('X-Login-Request-Id') || '';
      const reference = requestId ? ` Reference: ${requestId}` : '';
      errorElement.textContent = `${data.error || `Login failed with HTTP ${response.status}.`}${reference}`;
      showLoginDebug(data.debug || {
        requestId,
        httpStatus: response.status,
        errorCode: data.code || 'UNKNOWN',
        note: 'Detailed diagnostics were not returned. Set LOGIN_DEBUG=true in Vercel and redeploy, then retry.',
      });
      throw new Error('LOGIN_ALREADY_DISPLAYED');
    }

    safeStorageSet(REMEMBERED_USERNAME_KEY, data.username || username);
    passwordInput.value = '';
    clearLoginDebug();
    await completeLogin(data);
  } catch (error) {
    passwordInput.value = '';
    passwordInput.classList.add('shake');
    setTimeout(() => passwordInput.classList.remove('shake'), 450);
    if (error.message !== 'LOGIN_ALREADY_DISPLAYED') {
      errorElement.textContent = error.message || 'Unable to log in. Please try again.';
      showLoginDebug({
        stage: 'browser-request',
        error: error.message || String(error),
        note: 'The browser could not complete or parse the /api/login request. Check the Network tab and Vercel deployment logs.',
      });
    }
    passwordInput.focus();
  } finally {
    setLoginBusy(false);
  }
}

function rejectLoginInput(input, message) {
  input.classList.add('shake');
  setTimeout(() => input.classList.remove('shake'), 450);
  document.getElementById('login-error').textContent = message;
  input.focus();
}

function setLoginBusy(busy) {
  const button = document.getElementById('login-button');
  document.getElementById('login-username').disabled = busy;
  document.getElementById('login-password').disabled = busy;
  button.disabled = busy;
  button.textContent = busy ? 'Checking…' : 'Log In';
}

function clearLoginDebug() {
  state.loginDebugText = '';
  document.getElementById('login-debug')?.classList.add('hidden');
  document.getElementById('login-debug-output')?.classList.add('hidden');
  document.getElementById('login-debug-copy')?.classList.add('hidden');
  const toggle = document.getElementById('login-debug-toggle');
  if (toggle) toggle.textContent = 'Show technical details';
}

function showLoginDebug(details) {
  const panel = document.getElementById('login-debug');
  const output = document.getElementById('login-debug-output');
  if (!panel || !output) return;
  state.loginDebugText = formatLoginDebug(details);
  output.textContent = state.loginDebugText;
  panel.classList.remove('hidden');
}

function formatLoginDebug(details) {
  const safe = details && typeof details === 'object' ? details : { details: String(details || '') };
  const lines = [];
  if (safe.requestId) lines.push(`Request ID: ${safe.requestId}`);
  if (safe.stage) lines.push(`Last stage: ${safe.stage}`);
  if (safe.totalDurationMs != null) lines.push(`Total time: ${safe.totalDurationMs} ms`);
  if (Array.isArray(safe.steps)) {
    lines.push('', 'Login sequence:');
    safe.steps.forEach(step => {
      const extras = Object.entries(step)
        .filter(([key]) => !['stage', 'status', 'atMs'].includes(key))
        .map(([key, value]) => `${key}=${typeof value === 'object' ? JSON.stringify(value) : value}`)
        .join(', ');
      lines.push(`• ${step.stage}: ${step.status} at ${step.atMs} ms${extras ? ` (${extras})` : ''}`);
    });
  }
  lines.push('', 'Full sanitized report:', JSON.stringify(safe, null, 2));
  return lines.join('\n');
}

function toggleLoginDebug() {
  const output = document.getElementById('login-debug-output');
  const copy = document.getElementById('login-debug-copy');
  const toggle = document.getElementById('login-debug-toggle');
  if (!output || !toggle) return;
  const opening = output.classList.contains('hidden');
  output.classList.toggle('hidden', !opening);
  copy?.classList.toggle('hidden', !opening);
  toggle.textContent = opening ? 'Hide technical details' : 'Show technical details';
}

async function runLoginDiagnostics() {
  const panel = document.getElementById('login-debug');
  const output = document.getElementById('login-debug-output');
  const copy = document.getElementById('login-debug-copy');
  const toggle = document.getElementById('login-debug-toggle');
  panel?.classList.remove('hidden');
  output?.classList.remove('hidden');
  copy?.classList.add('hidden');
  if (toggle) toggle.textContent = 'Hide technical details';
  if (output) output.textContent = 'Running server configuration checks…';

  try {
    const response = await fetch('/api/login-diagnostics', {
      method: 'GET', credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' },
    });
    const data = await parseJson(response);
    if (response.status === 404) {
      throw new Error('Login diagnostics are disabled. Set LOGIN_DEBUG=true in Vercel, save, and redeploy.');
    }
    state.loginDebugText = formatLoginDebug(data);
    if (output) output.textContent = state.loginDebugText;
    copy?.classList.remove('hidden');
  } catch (error) {
    state.loginDebugText = formatLoginDebug({
      stage: 'configuration-test',
      error: error.message || String(error),
    });
    if (output) output.textContent = state.loginDebugText;
    copy?.classList.remove('hidden');
  }
}

async function copyLoginDebug() {
  if (!state.loginDebugText) return;
  try {
    await navigator.clipboard.writeText(state.loginDebugText);
    showToast('Login diagnostics copied');
  } catch {
    const output = document.getElementById('login-debug-output');
    if (output) {
      const range = document.createRange();
      range.selectNodeContents(output);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    }
  }
}

async function completeLogin(data) {
  state.user = { username: data.username, profile: data.profile || {} };
  state.sessionExpiresAt = Number(data.expiresAt || 0);
  scheduleSessionExpiry();
  await loadScenario();
}

function scheduleSessionExpiry() {
  if (state.sessionTimer) clearTimeout(state.sessionTimer);
  if (!state.sessionExpiresAt) return;
  state.sessionTimer = setTimeout(expireLocalSession, Math.max(0, state.sessionExpiresAt - Date.now()));
}

function expireLocalSession() {
  if (state.sessionTimer) clearTimeout(state.sessionTimer);
  state.sessionTimer = null;
  state.sessionExpiresAt = 0;
  state.user = null;
  stopLocationWatch();
  closeGeiger();
  showOnly('login-screen');
  document.getElementById('login-password').value = '';
  document.getElementById('login-error').textContent = 'Your session expired. Your field readings remain saved on this device.';
}

async function logout() {
  try { await fetch('/api/logout', { method: 'POST', credentials: 'same-origin' }); } catch (error) { console.warn(error); }
  state.sessionExpiresAt = 0;
  state.user = null;
  stopLocationWatch();
  closeGeiger();
  showOnly('login-screen');
  document.getElementById('login-password').value = '';
  document.getElementById('login-error').textContent = '';
}

async function loadScenario() {
  showLoading('Loading exercise…');
  try {
    const response = await fetch('/api/scenario', {
      method: 'GET', credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' },
    });
    const data = await parseJson(response);
    if (response.status === 401) return expireLocalSession();
    if (!response.ok) throw new Error(data.error || 'The exercise could not be loaded.');

    if (state.map) resetMap();
    state.scenario = data;
    renderBriefing();
    loadRunCache();

    if (String(data.briefing.exerciseStatus || 'ACTIVE').toUpperCase() !== 'ACTIVE') {
      document.querySelector('#kill-screen h1').textContent = 'Exercise Not Active';
      document.querySelector('#kill-screen p').textContent = 'The spreadsheet marks this exercise as inactive. Contact CERT leadership for instructions.';
      showOnly('kill-screen');
      return;
    }

    const participation = safeStorageGet(participationKey());
    if (participation === 'yes') await enterMap();
    else if (participation === 'no') showOnly('decline-screen');
    else showOnly('briefing-screen');
  } catch (error) {
    showOnly('login-screen');
    document.getElementById('login-error').textContent = error.message || 'Unable to load the exercise.';
  }
}

function renderBriefing() {
  const briefing = state.scenario.briefing;
  document.getElementById('briefing-title').textContent = briefing.title;
  document.getElementById('briefing-description').textContent = briefing.description;
  document.getElementById('review-title').textContent = briefing.title;
  document.getElementById('review-description').textContent = briefing.description;
  document.getElementById('entry-instructions').textContent = briefing.entryInstructions;
  document.getElementById('map-title').textContent = briefing.title;
  document.getElementById('map-user').textContent = displayName();

  const image = document.getElementById('briefing-image');
  const imageUrl = normalizeImageUrl(briefing.imageUrl);
  if (imageUrl) {
    image.src = imageUrl;
    image.classList.remove('hidden');
    image.onerror = () => image.classList.add('hidden');
  } else {
    image.removeAttribute('src');
    image.classList.add('hidden');
  }
}

async function respondToBriefing(responseValue) {
  const yes = document.getElementById('accept-button');
  const no = document.getElementById('decline-button');
  const error = document.getElementById('briefing-error');
  yes.disabled = true;
  no.disabled = true;
  error.textContent = '';

  try {
    const response = await fetch('/api/participation', {
      method: 'POST', credentials: 'same-origin', cache: 'no-store',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ response: responseValue }),
    });
    const data = await parseJson(response);
    if (response.status === 401) return expireLocalSession();
    if (!response.ok) throw new Error(data.error || 'Your response could not be saved.');

    safeStorageSet(participationKey(), responseValue);
    if (responseValue === 'no') showOnly('decline-screen');
    else await enterMap();
  } catch (requestError) {
    error.textContent = requestError.message || 'Your response could not be saved.';
  } finally {
    yes.disabled = false;
    no.disabled = false;
  }
}

async function enterMap() {
  showOnly('map-screen');
  if (!state.map) await initializeMap();
  setTimeout(() => state.map?.invalidateSize(), 80);
  renderReadings();
  startLocationWatch();
}

async function initializeMap() {
  state.map = L.map('map', { zoomControl: false, preferCanvas: true, minZoom: 10, maxZoom: 20 });
  L.control.zoom({ position: 'bottomleft' }).addTo(state.map);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 20,
    attribution: '&copy; OpenStreetMap contributors',
  }).addTo(state.map);

  try {
    const cityResponse = await fetch('data/frisco-city-limits.geojson', { cache: 'force-cache' });
    if (!cityResponse.ok) throw new Error(`HTTP ${cityResponse.status}`);
    const cityGeoJson = await cityResponse.json();
    state.cityLayer = L.geoJSON(cityGeoJson, {
      style: { color: '#1E5238', weight: 3, opacity: .85, fillOpacity: 0 },
    }).addTo(state.map);
  } catch (error) {
    console.warn('Frisco boundary could not be loaded.', error);
  }

  state.disasterLayer = L.geoJSON(state.scenario.disasterArea, {
    style: { color: '#b91c1c', weight: 3, dashArray: '8 6', fillColor: '#dc2626', fillOpacity: .18 },
  }).addTo(state.map);

  state.scenario.pois.forEach(addPoiToMap);
  const bounds = state.cityLayer?.getBounds()?.isValid() ? state.cityLayer.getBounds() : state.disasterLayer.getBounds();
  if (bounds?.isValid()) state.map.fitBounds(bounds.pad(.04));
  else state.map.setView([33.1507, -96.8236], 12);
}

function addPoiToMap(poi) {
  const circle = L.circle([poi.latitude, poi.longitude], {
    radius: poi.radiusMeters,
    color: '#d97706', weight: 2, dashArray: '5 5', fillColor: '#fbbf24', fillOpacity: .12,
  }).addTo(state.map);
  const marker = L.marker([poi.latitude, poi.longitude], { icon: poiIcon(Boolean(state.readings[poi.number])) }).addTo(state.map);
  marker.bindPopup(`<div class="poi-popup-title">${escapeHtml(poi.title)}</div><div class="poi-popup-sub">POI ${escapeHtml(poi.number)} • Enter the circle and use the Geiger counter.</div>`);
  state.poiLayers.set(String(poi.number), { marker, circle });
}

function poiIcon(complete) {
  return L.divIcon({
    className: '',
    html: `<div class="poi-question-marker${complete ? ' complete' : ''}"><span>${complete ? '✓' : '?'}</span></div>`,
    iconSize: [34, 34], iconAnchor: [17, 34], popupAnchor: [0, -34],
  });
}

function resetMap() {
  stopLocationWatch();
  if (state.map) state.map.remove();
  state.map = null;
  state.cityLayer = null;
  state.disasterLayer = null;
  state.poiLayers.clear();
  state.locationMarker = null;
  state.accuracyCircle = null;
  state.location = null;
}

function startLocationWatch() {
  const retry = document.getElementById('retry-location');
  retry.classList.add('hidden');
  if (!navigator.geolocation) {
    setLocationBanner('error', 'This browser does not support location services.');
    return;
  }
  if (!window.isSecureContext) {
    setLocationBanner('error', 'Location requires HTTPS. Open the deployed Vercel site.');
    return;
  }
  stopLocationWatch();
  setLocationBanner('waiting', 'Requesting current location…');
  state.locationWatchId = navigator.geolocation.watchPosition(
    updateLocation,
    handleLocationError,
    { enableHighAccuracy: true, maximumAge: 3000, timeout: 20000 }
  );
}

function stopLocationWatch() {
  if (state.locationWatchId !== null && navigator.geolocation) navigator.geolocation.clearWatch(state.locationWatchId);
  state.locationWatchId = null;
}

function updateLocation(position) {
  const coords = position.coords;
  state.location = {
    lat: coords.latitude,
    lng: coords.longitude,
    accuracy: Number(coords.accuracy || 0),
    heading: Number.isFinite(coords.heading) ? coords.heading : null,
    timestamp: position.timestamp,
  };

  if (!state.locationMarker) {
    state.locationMarker = L.marker([state.location.lat, state.location.lng], {
      icon: L.divIcon({ className: '', html: '<div class="user-location-marker"></div>', iconSize: [22, 22], iconAnchor: [11, 11] }),
      zIndexOffset: 1000,
    }).addTo(state.map);
    state.accuracyCircle = L.circle([state.location.lat, state.location.lng], {
      radius: state.location.accuracy, color: '#2563eb', weight: 1, fillColor: '#60a5fa', fillOpacity: .1, interactive: false,
    }).addTo(state.map);
  } else {
    state.locationMarker.setLatLng([state.location.lat, state.location.lng]);
    state.accuracyCircle.setLatLng([state.location.lat, state.location.lng]).setRadius(state.location.accuracy);
  }

  const wasInside = state.insideDisaster;
  state.insideDisaster = pointInsideGeoJson(state.location.lng, state.location.lat, state.scenario.disasterArea);
  if (state.insideDisaster) {
    setLocationBanner('inside', `Inside exercise area • GPS accuracy ±${Math.round(state.location.accuracy)} m`);
    if (!wasInside && safeStorageGet(instructionsKey()) !== 'shown') openInstructions();
  } else {
    setLocationBanner('outside', `Outside exercise area • GPS accuracy ±${Math.round(state.location.accuracy)} m`);
  }

  if (state.geigerOpen && state.followUser) {
    const targetZoom = Math.max(state.map.getZoom(), 17);
    state.map.setView([state.location.lat, state.location.lng], targetZoom, { animate: true, duration: .35 });
  }
  updateGeigerDisplay();
}

function handleLocationError(error) {
  const messages = {
    1: 'Location permission was denied. Enable location access for this site.',
    2: 'Your current location could not be determined.',
    3: 'Location request timed out. Move outdoors and try again.',
  };
  setLocationBanner('error', messages[error.code] || 'Location services are unavailable.');
  document.getElementById('retry-location').classList.remove('hidden');
}

function setLocationBanner(level, message) {
  const banner = document.getElementById('location-banner');
  banner.className = `location-banner ${level}`;
  document.getElementById('location-text').textContent = message;
}

function centerOnUser() {
  if (!state.location) {
    showToast('Waiting for your location.');
    startLocationWatch();
    return;
  }
  state.map.setView([state.location.lat, state.location.lng], Math.max(state.map.getZoom(), 17), { animate: true });
}

function openInstructions() {
  safeStorageSet(instructionsKey(), 'shown');
  document.getElementById('instructions-modal').classList.remove('hidden');
}
function closeInstructions() { document.getElementById('instructions-modal').classList.add('hidden'); }
function toggleBriefingReview() { document.getElementById('briefing-review-modal').classList.toggle('hidden'); }
function closeModalFromBackdrop(event, id) { if (event.target.id === id) document.getElementById(id).classList.add('hidden'); }

async function openGeiger() {
  state.geigerOpen = true;
  state.followUser = true;
  document.getElementById('geiger-panel').classList.remove('hidden');
  document.getElementById('geiger-panel').setAttribute('aria-hidden', 'false');
  await ensureAudioContext();
  centerOnUser();
  updateGeigerDisplay();
  scheduleGeigerTick(true);
}

function closeGeiger() {
  state.geigerOpen = false;
  state.followUser = false;
  document.getElementById('geiger-panel')?.classList.add('hidden');
  document.getElementById('geiger-panel')?.setAttribute('aria-hidden', 'true');
  if (state.audioTimer) clearTimeout(state.audioTimer);
  state.audioTimer = null;
}

async function ensureAudioContext() {
  if (!state.audioContext) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass) state.audioContext = new AudioContextClass();
  }
  if (state.audioContext?.state === 'suspended') {
    try { await state.audioContext.resume(); } catch (error) { console.warn(error); }
  }
}

function toggleGeigerSound() {
  state.soundOn = !state.soundOn;
  document.getElementById('sound-button').textContent = state.soundOn ? '🔊' : '🔇';
  scheduleGeigerTick(true);
}

function scheduleGeigerTick(immediate = false) {
  if (state.audioTimer) clearTimeout(state.audioTimer);
  state.audioTimer = null;
  if (!state.geigerOpen || !state.soundOn) return;
  const delay = immediate ? 60 : geigerTickInterval(state.currentCpm);
  state.audioTimer = setTimeout(() => {
    if (state.activePoi && !document.hidden) playGeigerClick();
    scheduleGeigerTick(false);
  }, delay);
}

function geigerTickInterval(cpm) {
  if (cpm === null || cpm === undefined) return 1800;
  if (cpm >= 400) return 55;
  const normalized = Math.log10(Math.max(0, cpm) + 1) / Math.log10(401);
  return Math.max(75, Math.round(1650 - normalized * 1520));
}

function playGeigerClick() {
  const context = state.audioContext;
  if (!context || context.state !== 'running') return;
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = 'square';
  oscillator.frequency.setValueAtTime(920 + Math.random() * 170, context.currentTime);
  gain.gain.setValueAtTime(0.0001, context.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.08, context.currentTime + .002);
  gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + .025);
  oscillator.connect(gain).connect(context.destination);
  oscillator.start();
  oscillator.stop(context.currentTime + .03);
}

function updateGeigerDisplay() {
  const valueElement = document.getElementById('geiger-value');
  const unitElement = document.getElementById('geiger-unit');
  const display = document.getElementById('geiger-display');
  const target = document.getElementById('geiger-target');
  const distanceElement = document.getElementById('geiger-distance');
  const takeButton = document.getElementById('take-reading-button');
  const skull = document.getElementById('geiger-skull');
  const meter = document.getElementById('meter-fill');
  if (!valueElement) return;

  state.activePoi = nearestContainingPoi();
  if (!state.location) {
    state.currentCpm = null;
    valueElement.textContent = '--';
    unitElement.textContent = 'CPM';
    target.textContent = 'Waiting for your current location.';
    distanceElement.textContent = 'Location unavailable';
    takeButton.disabled = true;
    setGeigerLevel(display, 'green');
    skull.classList.add('hidden');
    meter.style.width = '0%';
    return;
  }

  if (!state.activePoi || !state.insideDisaster) {
    state.currentCpm = null;
    valueElement.textContent = '--';
    unitElement.textContent = 'CPM';
    target.textContent = state.insideDisaster
      ? 'Move into a question-mark circle to take a reading.'
      : 'Enter the exercise polygon before taking readings.';
    distanceElement.textContent = nearestPoiDistanceText();
    takeButton.disabled = true;
    setGeigerLevel(display, 'green');
    skull.classList.add('hidden');
    meter.style.width = '0%';
    return;
  }

  const { poi, distance } = state.activePoi;
  state.currentCpm = calculateCpm(poi, distance);
  const severity = severityForCpm(state.currentCpm);
  setGeigerLevel(display, severity);
  skull.classList.toggle('hidden', state.currentCpm < 400);
  target.textContent = `${poi.title} • POI ${poi.number}`;
  distanceElement.textContent = `${Math.round(distance)} m from center • Zone radius ${Math.round(poi.radiusMeters)} m`;
  takeButton.disabled = false;

  if (!poi.radioactive) {
    valueElement.textContent = 'CLEAR';
    unitElement.textContent = 'NO RADIATION DETECTED';
  } else {
    valueElement.textContent = formatCpm(state.currentCpm);
    unitElement.textContent = 'CPM';
  }
  meter.style.width = `${Math.min(100, Math.log10(Math.max(0, state.currentCpm) + 1) / Math.log10(401) * 100)}%`;
}

function setGeigerLevel(element, severity) {
  element.classList.remove('level-green', 'level-yellow', 'level-orange', 'level-red', 'level-extreme');
  element.classList.add(`level-${severity}`);
  const colors = { green: '#22c55e', yellow: '#facc15', orange: '#fb923c', red: '#ef4444', extreme: '#991b1b' };
  const meter = document.getElementById('meter-fill');
  if (meter) meter.style.background = colors[severity] || colors.green;
}

function nearestContainingPoi() {
  if (!state.location || !state.scenario) return null;
  const candidates = state.scenario.pois.map(poi => ({
    poi,
    distance: distanceMeters(state.location.lat, state.location.lng, poi.latitude, poi.longitude),
  })).filter(item => item.distance <= item.poi.radiusMeters);
  candidates.sort((a, b) => (a.distance / a.poi.radiusMeters) - (b.distance / b.poi.radiusMeters));
  return candidates[0] || null;
}

function nearestPoiDistanceText() {
  if (!state.location || !state.scenario?.pois?.length) return 'Location unavailable';
  const nearest = state.scenario.pois.map(poi => ({ poi, distance: distanceMeters(state.location.lat, state.location.lng, poi.latitude, poi.longitude) }))
    .sort((a, b) => a.distance - b.distance)[0];
  return `Nearest POI is approximately ${Math.round(nearest.distance)} m away`;
}

function takeReading() {
  if (!state.activePoi || !state.location || !state.insideDisaster) return;
  const { poi, distance } = state.activePoi;
  const cpm = calculateCpm(poi, distance);
  state.readings[String(poi.number)] = {
    poiNumber: String(poi.number),
    poiTitle: poi.title,
    latitude: Number(state.location.lat.toFixed(7)),
    longitude: Number(state.location.lng.toFixed(7)),
    accuracy: Number(state.location.accuracy.toFixed(1)),
    distanceMeters: Number(distance.toFixed(1)),
    cpm: Number(cpm.toFixed(2)),
    readingType: poi.radioactive ? 'Radiation Detected' : 'Clear',
    severity: severityForCpm(cpm),
    takenAt: new Date().toISOString(),
  };
  state.submitted = false;
  saveRunCache();
  updatePoiMarker(poi.number);
  renderReadings();
  showToast(poi.radioactive ? `Reading saved: ${formatCpm(cpm)} CPM` : 'Reading saved: Clear');
}

function updatePoiMarker(poiNumber) {
  const layer = state.poiLayers.get(String(poiNumber));
  if (layer) layer.marker.setIcon(poiIcon(Boolean(state.readings[String(poiNumber)])));
}

function openReadingsPanel() {
  renderReadings();
  const panel = document.getElementById('readings-panel');
  panel.classList.remove('hidden');
  panel.setAttribute('aria-hidden', 'false');
}
function closeReadingsPanel() {
  const panel = document.getElementById('readings-panel');
  panel.classList.add('hidden');
  panel.setAttribute('aria-hidden', 'true');
}
function closeReadingsFromBackdrop(event) { if (event.target.id === 'readings-panel') closeReadingsPanel(); }

function renderReadings() {
  if (!state.scenario) return;
  const list = document.getElementById('readings-list');
  list.innerHTML = '';
  state.scenario.pois.forEach(poi => {
    const reading = state.readings[String(poi.number)];
    const row = document.createElement('div');
    row.className = `reading-row${reading ? ' complete' : ''}`;
    const value = reading
      ? (reading.readingType === 'Clear' ? 'Clear' : `${formatCpm(reading.cpm)} CPM`)
      : 'Pending';
    row.innerHTML = `
      <div class="reading-number">${escapeHtml(poi.number)}</div>
      <div><div class="reading-title">${escapeHtml(poi.title)}</div><div class="reading-meta">${reading ? `Saved ${formatLocalTime(reading.takenAt)}` : `Enter the ${Math.round(poi.radiusMeters)} m zone`}</div></div>
      <div class="reading-value${reading ? '' : ' pending'}">${escapeHtml(value)}</div>`;
    list.appendChild(row);
  });

  const completeCount = Object.keys(state.readings).filter(number => state.scenario.pois.some(poi => String(poi.number) === number)).length;
  const total = state.scenario.pois.length;
  document.getElementById('progress-count').textContent = `${completeCount} / ${total}`;
  const submitButton = document.getElementById('submit-button');
  const note = document.getElementById('submit-note');
  if (state.submitted) {
    submitButton.disabled = true;
    submitButton.textContent = 'Readings Submitted';
    note.textContent = 'This exercise run has already been submitted.';
  } else {
    submitButton.disabled = completeCount !== total;
    submitButton.textContent = 'Submit All Readings';
    note.textContent = completeCount === total
      ? 'All points are complete. Submit the field log when ready.'
      : `Complete ${total - completeCount} more point${total - completeCount === 1 ? '' : 's'} before submitting.`;
  }
}

async function submitReadings() {
  const button = document.getElementById('submit-button');
  const errorElement = document.getElementById('submit-error');
  const readings = state.scenario.pois.map(poi => state.readings[String(poi.number)]).filter(Boolean);
  if (readings.length !== state.scenario.pois.length) return;
  button.disabled = true;
  button.textContent = 'Submitting…';
  errorElement.textContent = '';

  try {
    const response = await fetch('/api/readings', {
      method: 'POST', credentials: 'same-origin', cache: 'no-store',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        scenarioId: state.scenario.briefing.scenarioId,
        submissionId: state.submissionId,
        readings,
      }),
    });
    const data = await parseJson(response);
    if (response.status === 401) return expireLocalSession();
    if (!response.ok) throw new Error(data.error || 'The field log could not be submitted.');

    state.submitted = true;
    if (data.submissionId) state.submissionId = data.submissionId;
    if (Array.isArray(data.readings)) {
      data.readings.forEach(serverReading => {
        const cached = state.readings[String(serverReading.poiNumber)];
        if (cached) {
          cached.cpm = serverReading.cpm;
          cached.readingType = serverReading.readingType;
          cached.severity = serverReading.severity;
          cached.withinPoi = serverReading.withinPoi;
        }
      });
    }
    saveRunCache();
    renderReadings();
    closeReadingsPanel();
    document.getElementById('success-modal').classList.remove('hidden');
  } catch (error) {
    errorElement.textContent = error.message || 'Submission failed. Your readings remain saved.';
    button.disabled = false;
    button.textContent = 'Submit All Readings';
  }
}

function closeSuccessModal() { document.getElementById('success-modal').classList.add('hidden'); }

function loadRunCache() {
  const cached = safeStorageJson(runCacheKey());
  state.readings = cached?.readings && typeof cached.readings === 'object' ? cached.readings : {};
  state.submissionId = cached?.submissionId || generateSubmissionId();
  state.submitted = cached?.submitted === true;
  const validNumbers = new Set(state.scenario.pois.map(poi => String(poi.number)));
  Object.keys(state.readings).forEach(number => { if (!validNumbers.has(number)) delete state.readings[number]; });
}

function saveRunCache() {
  safeStorageSet(runCacheKey(), JSON.stringify({
    scenarioId: state.scenario.briefing.scenarioId,
    username: state.user.username,
    submissionId: state.submissionId,
    submitted: state.submitted,
    readings: state.readings,
    savedAt: new Date().toISOString(),
  }));
}

function participationKey() { return `${STORAGE_PREFIX}:participation:${scenarioUserKey()}`; }
function instructionsKey() { return `${STORAGE_PREFIX}:instructions:${scenarioUserKey()}`; }
function runCacheKey() { return `${STORAGE_PREFIX}:run:${scenarioUserKey()}`; }
function scenarioUserKey() {
  return `${state.scenario?.briefing?.scenarioId || 'unknown'}:${state.user?.username || 'anonymous'}`.toLowerCase();
}

function calculateCpm(poi, distance) {
  if (!poi.radioactive) return 0;
  const minCpm = 0.01;
  const maxCpm = Math.max(minCpm, Number(poi.maxCpm || minCpm));
  const radius = Math.max(1, Number(poi.radiusMeters || 50));
  const normalizedDistance = clamp(distance / radius, 0, 1);
  const curve = 4.5;
  const exponential = (Math.exp(curve * (1 - normalizedDistance)) - 1) / (Math.exp(curve) - 1);
  return minCpm + (maxCpm - minCpm) * exponential;
}

function severityForCpm(cpm) {
  const value = Number(cpm || 0);
  if (value < 1) return 'green';
  if (value < 10) return 'yellow';
  if (value < 100) return 'orange';
  if (value < 400) return 'red';
  return 'extreme';
}

function formatCpm(value) {
  const number = Number(value || 0);
  if (number < 1) return number.toFixed(2);
  if (number < 100) return number.toFixed(1);
  return Math.round(number).toString();
}

function pointInsideGeoJson(lng, lat, feature) {
  const geometry = feature?.type === 'Feature' ? feature.geometry : feature;
  if (!geometry) return false;
  if (geometry.type === 'Polygon') return pointInsidePolygon([lng, lat], geometry.coordinates);
  if (geometry.type === 'MultiPolygon') return geometry.coordinates.some(polygon => pointInsidePolygon([lng, lat], polygon));
  return false;
}

function pointInsidePolygon(point, rings) {
  if (!rings?.length || !pointInsideRing(point, rings[0])) return false;
  for (let index = 1; index < rings.length; index += 1) {
    if (pointInsideRing(point, rings[index])) return false;
  }
  return true;
}

function pointInsideRing([x, y], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersects = ((yi > y) !== (yj > y)) && (x < ((xj - xi) * (y - yi)) / ((yj - yi) || Number.EPSILON) + xi);
    if (intersects) inside = !inside;
  }
  return inside;
}

function distanceMeters(aLat, aLng, bLat, bLng) {
  const radians = degrees => degrees * Math.PI / 180;
  const earthRadius = 6371008.8;
  const dLat = radians(bLat - aLat);
  const dLng = radians(bLng - aLng);
  const lat1 = radians(aLat);
  const lat2 = radians(bLat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return earthRadius * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function displayName() {
  const profile = state.user?.profile || {};
  return profile.Name || profile['Display Name'] || profile.FullName || profile['Full Name'] ||
    [profile['First Name'], profile['Last Name']].filter(Boolean).join(' ') || state.user?.username || 'CERT Member';
}

function normalizeImageUrl(url) {
  const value = String(url || '').trim();
  if (!value) return '';
  const drivePath = value.match(/\/file\/d\/([^/?&]+)/);
  const driveQuery = value.match(/[?&]id=([^&]+)/);
  const id = drivePath?.[1] || driveQuery?.[1];
  if (id) return `https://drive.google.com/thumbnail?id=${encodeURIComponent(id)}&sz=w1200`;
  return /^https:\/\//i.test(value) ? value : '';
}

function showLoading(message) {
  document.getElementById('loading-message').textContent = message;
  showOnly('loading-screen');
}

function showOnly(id) {
  ['kill-screen', 'login-screen', 'loading-screen', 'briefing-screen', 'decline-screen', 'map-screen'].forEach(screenId => {
    document.getElementById(screenId)?.classList.toggle('hidden', screenId !== id);
  });
}

function showToast(message) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.classList.remove('hidden');
  if (state.toastTimer) clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => toast.classList.add('hidden'), 2500);
}

function safeStorageGet(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function safeStorageSet(key, value) {
  try { localStorage.setItem(key, value); } catch (error) { console.warn('Browser storage unavailable.', error); }
}
function safeStorageJson(key) {
  try { return JSON.parse(safeStorageGet(key) || 'null'); } catch { return null; }
}
function generateSubmissionId() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID().replace(/-/g, '');
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
}
function parseJson(response) { return response.json().catch(() => ({})); }
function clamp(value, min, max) { return Math.min(Math.max(value, min), max); }
function formatLocalTime(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character]));
}
