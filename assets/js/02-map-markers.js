function initMap(sirens){
  hideLoadingScreen();
  document.getElementById('data-source-bar').style.display='flex';
  startFreshnessTimer();

  allSirens = sirens; // store for coverage mode

  const lives = calcLivesProtected(sirens);
  const livesEl = document.getElementById('lives-count');
  setTimeout(()=>animateCount(livesEl, lives, 1800), 400);

  if(map){ map.remove(); map=null; }

  map = L.map('map',{
    zoomControl:false, touchZoom:true, scrollWheelZoom:false,
    doubleClickZoom:true, boxZoom:false, dragging:true, tap:true, tapTolerance:25,
    zoomDelta:0.5, zoomSnap:0.5
  }).setView([33.1507,-96.8236],12);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{
    attribution:'© <a href="https://openstreetmap.org">OpenStreetMap</a>', maxZoom:18
  }).addTo(map);

  const boundary = L.polygon(BOUNDARY,{
    color:'#1e3a8a', weight:2.5, fillColor:'#3b82f6', fillOpacity:.07
  }).addTo(map);

  map.fitBounds(boundary.getBounds(),{padding:[30,30]});
  L.control.zoom({position:'bottomleft'}).addTo(map);

  const popupPane = map.getPane('popupPane');
  if(popupPane) popupPane.style.zIndex = '2000';

  sirens.forEach(addMarker);
  addLegend();

  // Soft-refresh data whenever a popup is closed
  map.on('popupclose', () => softRefresh());

  setTimeout(()=>{ if(map) map.invalidateSize(); },80);
  setTimeout(()=>{ if(map) map.invalidateSize(); },300);
}

/* =====================================================
   MARKERS
   ===================================================== */
function addMarker(siren){
  const color   = sirenColor(siren);
  const sLow    = (siren.status||'').toLowerCase();
  const needsSU = (siren.signUpNeeded||'').toLowerCase()==='yes';
  const isUrgent= needsSU && urgencyDays(siren)>21;

  let cls='siren-marker';
  if(sLow==='canceled')       cls+=' status-canceled';
  if(sLow==='not scheduled')  cls+=' status-notscheduled';
  if(isUrgent)                cls+=' urgent';

  const icon = L.divIcon({
    className:'custom-siren-icon',
    html:`<div class="${cls}" style="background-color:${color};">${siren.id}</div>`,
    iconSize:[32,32], iconAnchor:[16,16], popupAnchor:[0,-18]
  });

  const marker = L.marker([siren.lat,siren.lng],{icon}).addTo(map);

  // Register for filter system
  const category = sirenCategory(siren);
  markerRegistry[siren.id] = { marker, category };
  // Apply current filter immediately (in case map was already filtered)
  if(!activeFilters[category]) map.removeLayer(marker);
  marker.bindPopup(buildPopup(siren,color),{
    maxWidth:400, autoPan:true, autoPanPadding:[40,40], closeButton:false
  });

  marker.on('click',()=>{
    clearCircle(siren.id);
    const circle = L.circle([siren.lat,siren.lng],{
      radius:1609.34, color, fillColor:color, fillOpacity:.07,
      weight:2, dashArray:'8 8', opacity:.7
    }).addTo(map);
    const label = L.marker([siren.lat,siren.lng],{
      icon:L.divIcon({
        className:'',
        html:`<div style="background:rgba(255,255,255,.95);padding:6px 12px;border-radius:8px;font-family:'Barlow Condensed',sans-serif;font-size:13px;font-weight:700;color:#4b5563;letter-spacing:.5px;text-transform:uppercase;white-space:nowrap;box-shadow:0 3px 8px rgba(0,0,0,.2);">~ 1 Mile Audible Range</div>`,
        iconSize:[160,28], iconAnchor:[80,-18]
      }), interactive:false
    }).addTo(map);
    activeCircles[siren.id]={circle,label};
  });

  marker.on('popupclose',()=>clearCircle(siren.id));
}

function clearCircle(id){
  if(activeCircles[id]){
    map.removeLayer(activeCircles[id].circle);
    map.removeLayer(activeCircles[id].label);
    delete activeCircles[id];
  }
}

/* =====================================================
   POPUP
   ===================================================== */
