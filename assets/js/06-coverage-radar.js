function toggleCoverageMode(){
  coverageMode = !coverageMode;
  const btn    = document.getElementById('coverage-btn');
  const banner = document.getElementById('coverage-banner');

  btn.classList.toggle('active', coverageMode);
  banner.classList.toggle('visible', coverageMode);

  if(coverageMode){
    // Clear any open individual circles first
    Object.keys(activeCircles).forEach(id => clearCircle(id));
    // Close any open popups
    if(map) map.closePopup();
    showAllCoverageCircles();
    // Disable interaction via CSS only — don't touch Leaflet event system
    Object.values(markerRegistry).forEach(({marker}) => {
      const el = marker.getElement();
      if(el) el.style.pointerEvents = 'none';
    });
  } else {
    hideAllCoverageCircles();
    // Clear any stale individual circles that may have leaked in
    Object.keys(activeCircles).forEach(id => clearCircle(id));
    // Re-enable interaction — CSS only, Leaflet events were never removed
    Object.values(markerRegistry).forEach(({marker}) => {
      const el = marker.getElement();
      if(el) el.style.pointerEvents = '';
    });
  }
}

function showAllCoverageCircles(){
  hideAllCoverageCircles(); // clear any existing first
  allSirens.forEach(siren => {
    if(isNaN(siren.lat) || isNaN(siren.lng)) return;
    const color = sirenColor(siren);
    const circle = L.circle([siren.lat, siren.lng], {
      radius: 1609.34,
      color: '#8b5cf6',
      fillColor: '#8b5cf6',
      fillOpacity: 0.06,
      weight: 1.5,
      dashArray: '6 6',
      opacity: 0.55
    }).addTo(map);
    coverageLayers.push(circle);
  });
}

function hideAllCoverageCircles(){
  coverageLayers.forEach(l => { if(map.hasLayer(l)) map.removeLayer(l); });
  coverageLayers = [];
}

/* =====================================================
   WEATHER RADAR — RainViewer
   ===================================================== */
const RADAR_API   = 'https://api.rainviewer.com/public/weather-maps.json';
const RADAR_SIZE  = 512;
const RADAR_COLOR = 1;    // Classic NOAA color scheme (green→yellow→red)
const RADAR_OPTS  = '1_1'; // smooth=1, snow=1

let radarFrames      = [];   // [{time, path, label}]
let radarLayers      = {};   // path → L.tileLayer (pre-loaded cache)
let radarCurrentIdx  = 0;
let radarPlaying     = false;
let radarPlayTimer   = null;
let radarPanelOpen   = false;
let radarOverlayOn   = false; // whether a layer is visible on map
let radarSpeeds      = [600, 300, 150]; // ms per frame: 1×, 2×, 4×
let radarSpeedIdx    = 0;
let radarOpacity     = 0.70;
let radarHost        = 'https://tilecache.rainviewer.com';
let radarDataLoaded  = false;

function toggleRadarPanel(){
  if(radarPanelOpen){
    closeRadarPanel();
  } else {
    openRadarPanel();
  }
}

function openRadarPanel(){
  radarPanelOpen = true;
  document.getElementById('radar-overlay').classList.add('open');
  // Don't mark button active here — only the layer toggle does that
  if(!radarDataLoaded) loadRadarData();
}

function closeRadarPanel(){
  radarPanelOpen = false;
  document.getElementById('radar-overlay').classList.remove('open');
  // Button stays blue only if layer is on
  document.getElementById('radar-btn').classList.toggle('active', radarOverlayOn);
  if(radarPlaying) pauseRadar();
}

function closeRadarIfBg(e){
  // No backdrop — not needed for overlay
}

function loadRadarData(){
  document.getElementById('radar-loading').style.display = 'block';
  document.getElementById('radar-controls-wrap').style.display = 'none';

  // Clear any cached layers from a previous load
  if(map) Object.values(radarLayers).forEach(l => { if(map.hasLayer(l)) map.removeLayer(l); });
  radarLayers = {};

  fetch(RADAR_API, { mode: 'cors' })
    .then(r => {
      if(!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    })
    .then(data => {
      radarHost   = data.host || 'https://tilecache.rainviewer.com';
      const past  = (data.radar && data.radar.past) ? data.radar.past : [];
      if(!past.length){ throw new Error('No radar frames in response.'); }

      radarFrames = past.map(f => ({
        time: f.time,
        path: f.path,
        label: formatRadarTime(f.time)
      }));

      radarDataLoaded = true;
      radarCurrentIdx = radarFrames.length - 1;

      // Auto-enable the layer on first load
      radarOverlayOn = true;
      document.getElementById('radar-layer-toggle').checked = true;
      document.getElementById('radar-btn').classList.add('active');

      buildRadarTicks();
      showRadarLayer(radarCurrentIdx);

      document.getElementById('radar-loading').style.display = 'none';
      document.getElementById('radar-controls-wrap').style.display = 'flex';
    })
    .catch(err => {
      console.error('Radar load error:', err);
      document.getElementById('radar-loading').textContent = '⚠️ ' + (err.message || 'Could not load radar. Check your connection.');
    });
}

function formatRadarTime(unixTs){
  const d = new Date(unixTs * 1000);
  return d.toLocaleTimeString('en-US', {
    timeZone: 'America/Chicago',
    hour: 'numeric', minute: '2-digit', hour12: true
  });
}

function radarTileUrl(path){
  return `${radarHost}${path}/${RADAR_SIZE}/{z}/{x}/{y}/${RADAR_COLOR}/${RADAR_OPTS}.png`;
}

function getOrCreateLayer(idx){
  const path = radarFrames[idx].path;
  if(!radarLayers[path]){
    radarLayers[path] = L.tileLayer(radarTileUrl(path), {
      opacity: radarOpacity,
      zIndex: 900,
      tileSize: 512,
      zoomOffset: -1,
      maxNativeZoom: 7,
      maxZoom: 18,
      attribution: '© RainViewer'
    });
  }
  return radarLayers[path];
}

function toggleRadarLayer(on){
  radarOverlayOn = on;
  document.getElementById('radar-btn').classList.toggle('active', on);
  if(on){
    // Show current frame
    if(radarFrames.length) showRadarLayer(radarCurrentIdx);
  } else {
    // Remove all layers from map
    if(radarPlaying) pauseRadar();
    Object.values(radarLayers).forEach(l => { if(map && map.hasLayer(l)) map.removeLayer(l); });
  }
}

function showRadarLayer(idx){
  if(!map || !radarFrames.length) return;

  // Hide all layers first
  Object.values(radarLayers).forEach(l => { if(map.hasLayer(l)) map.removeLayer(l); });

  // Pre-load adjacent frames silently
  [-1, 0, 1].forEach(offset => {
    const i = idx + offset;
    if(i >= 0 && i < radarFrames.length) getOrCreateLayer(i);
  });

  // Only add to map if toggle is on
  if(radarOverlayOn){
    const layer = getOrCreateLayer(idx);
    if(!map.hasLayer(layer)) layer.addTo(map);
  }

  updateRadarUI(idx);
}

function updateRadarUI(idx){
  const frame = radarFrames[idx];
  const isLatest = idx === radarFrames.length - 1;

  document.getElementById('radar-time-label').textContent = frame.label;
  const badge = document.getElementById('radar-time-badge');
  badge.textContent = isLatest ? 'Latest' : 'Past';
  badge.className   = 'ro-badge' + (isLatest ? ' live' : '');

  const scrubber = document.getElementById('radar-scrubber');
  scrubber.value = idx;

  document.querySelectorAll('.ro-tick').forEach((t, i) => {
    t.classList.toggle('active', i === idx);
  });
}

function buildRadarTicks(){
  const container = document.getElementById('radar-ticks');
  const scrubber  = document.getElementById('radar-scrubber');
  scrubber.max    = radarFrames.length - 1;
  scrubber.value  = radarFrames.length - 1;

  container.innerHTML = radarFrames.map((_, i) =>
    `<div class="ro-tick${i === radarFrames.length - 1 ? ' active' : ''}"></div>`
  ).join('');
}

function onRadarScrub(val){
  radarCurrentIdx = parseInt(val);
  if(radarPlaying) pauseRadar();
  showRadarLayer(radarCurrentIdx);
}

function toggleRadarPlay(){
  radarPlaying ? pauseRadar() : playRadar();
}

function playRadar(){
  radarPlaying = true;
  document.getElementById('radar-play-btn').textContent = '⏸';
  // If at end, restart from beginning
  if(radarCurrentIdx >= radarFrames.length - 1) radarCurrentIdx = 0;
  stepRadar();
}

function pauseRadar(){
  radarPlaying = false;
  document.getElementById('radar-play-btn').textContent = '▶';
  if(radarPlayTimer){ clearTimeout(radarPlayTimer); radarPlayTimer = null; }
}

function stepRadar(){
  if(!radarPlaying) return;
  showRadarLayer(radarCurrentIdx);
  radarCurrentIdx++;
  if(radarCurrentIdx >= radarFrames.length){
    // Hold on last frame for 1.5s then stop
    radarCurrentIdx = radarFrames.length - 1;
    radarPlayTimer = setTimeout(pauseRadar, 1500);
  } else {
    radarPlayTimer = setTimeout(stepRadar, radarSpeeds[radarSpeedIdx]);
  }
}

function cycleRadarSpeed(){
  radarSpeedIdx = (radarSpeedIdx + 1) % radarSpeeds.length;
  const labels = ['1×','2×','4×'];
  document.getElementById('radar-speed-btn').textContent = labels[radarSpeedIdx];
}

function setRadarOpacity(val){
  radarOpacity = parseInt(val) / 100;
  Object.values(radarLayers).forEach(l => l.setOpacity(radarOpacity));
}

/* =====================================================
   VOLUNTEER ORIENTATION TOUR
   ===================================================== */
let tourCurrentSlide = 0;
