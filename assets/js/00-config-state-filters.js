/* =====================================================
   PUBLIC CLIENT CONFIG
   Sensitive Google Sheets configuration now lives only in
   Vercel environment variables and server-side functions.
   ===================================================== */

/* =====================================================
   STATE
   ===================================================== */
let map            = null;
let legendDiv      = null;
let legendVisible  = false;
let activeCircles  = {};
let locationMarker = null;
let locationCircle = null;
let watchId        = null;
let compassHeading = null;  // degrees, null = unavailable
let compassHandler = null;  // event listener ref for cleanup
let currentWxDays  = 3;
let wxFabOpen      = false;

// Filter state — matches data-filter attrs; false = hidden
let activeFilters = { assigned:false, active:true, attention:true, action:true, urgent:true };
// Marker registry for filtering: { sirenId: { marker, category } }
let markerRegistry = {};
let filterPanelOpen = false;

/* Map siren data → filter category */
function sirenCategory(s){
  if((s.signUpNeeded||'').toLowerCase()!=='yes') return 'assigned';
  const d = urgencyDays(s);
  if(d<=7)  return 'active';
  if(d<=14) return 'attention';
  if(d<=21) return 'action';
  return 'urgent';
}

function toggleFilterPanel(){
  filterPanelOpen = !filterPanelOpen;
  document.getElementById('filter-panel').classList.toggle('open', filterPanelOpen);
}

function toggleFilter(row){
  const key = row.dataset.filter;
  activeFilters[key] = !activeFilters[key];
  row.classList.toggle('checked', activeFilters[key]);
  applyFilters();
  updateFilterBtnState();
}

function resetFilters(){
  activeFilters = { assigned:false, active:true, attention:true, action:true, urgent:true };
  document.querySelectorAll('#filter-panel .fp-row').forEach(r=>{
    r.classList.toggle('checked', activeFilters[r.dataset.filter]);
  });
  applyFilters();
  updateFilterBtnState();
}

function updateFilterBtnState(){
  const isDefault = !activeFilters.assigned && activeFilters.active && activeFilters.attention && activeFilters.action && activeFilters.urgent;
  document.getElementById('filter-btn').classList.toggle('filtered', !isDefault);
  // Report view active = assigned only — highlight the drawer menu item
  const isReportView = activeFilters.assigned && !activeFilters.active && !activeFilters.attention && !activeFilters.action && !activeFilters.urgent;
  const fabReport = document.getElementById('fab-report');
  if(fabReport) fabReport.classList.toggle('active', isReportView);
}

function toggleReportView(){
  // If already in report view, reset to default; otherwise switch to assigned-only
  const isReportView = activeFilters.assigned && !activeFilters.active && !activeFilters.attention && !activeFilters.action && !activeFilters.urgent;
  if(isReportView){
    activeFilters = { assigned:false, active:true, attention:true, action:true, urgent:true };
  } else {
    activeFilters = { assigned:true, active:false, attention:false, action:false, urgent:false };
  }
  document.querySelectorAll('#filter-panel .fp-row').forEach(r=>{
    r.classList.toggle('checked', activeFilters[r.dataset.filter]);
  });
  // Close filter panel if open
  filterPanelOpen = false;
  document.getElementById('filter-panel').classList.remove('open');
  applyFilters();
  updateFilterBtnState();
}

function applyFilters(){
  if(!map) return;
  Object.entries(markerRegistry).forEach(([id, {marker, category}])=>{
    if(activeFilters[category]){
      if(!map.hasLayer(marker)) marker.addTo(map);
    } else {
      if(map.hasLayer(marker)) map.removeLayer(marker);
    }
  });
}

// Close filter panel when clicking outside
document.addEventListener('click', e=>{
  if(filterPanelOpen
    && !document.getElementById('filter-panel').contains(e.target)
    && !document.getElementById('filter-btn').contains(e.target)){
    filterPanelOpen = false;
    document.getElementById('filter-panel').classList.remove('open');
  }
});

/* =====================================================
   FRISCO BOUNDARY
   ===================================================== */
const BOUNDARY = [
  [33.13608,-96.92283],[33.1402,-96.9226],[33.14084,-96.92209],[33.14111,-96.9213],
  [33.14102,-96.91412],[33.14678,-96.91406],[33.14675,-96.91181],[33.15463,-96.91185],
  [33.1546,-96.89955],[33.14656,-96.89948],[33.14651,-96.89778],[33.15152,-96.89776],
  [33.15145,-96.89077],[33.15863,-96.89068],[33.15894,-96.88658],[33.16319,-96.88654],
  [33.16302,-96.88221],[33.16436,-96.88221],[33.16457,-96.88205],[33.17828,-96.88195],
  [33.1784,-96.88734],[33.1899,-96.88702],[33.19162,-96.88644],[33.20144,-96.88086],
  [33.20275,-96.88048],[33.20388,-96.88044],[33.20397,-96.88787],[33.20559,-96.88776],
  [33.20577,-96.88718],[33.2062,-96.88664],[33.20704,-96.88663],[33.20716,-96.88676],
  [33.20572,-96.88775],[33.21134,-96.8878],[33.21129,-96.89236],[33.21404,-96.89233],
  [33.21514,-96.89097],[33.21592,-96.88956],[33.21655,-96.88876],[33.21917,-96.8872],
  [33.21885,-96.88048],[33.21913,-96.88026],[33.21948,-96.8388],[33.21905,-96.80285],
  [33.2189,-96.76761],[33.21863,-96.75029],[33.21191,-96.75031],[33.21191,-96.75128],
  [33.21164,-96.75153],[33.21158,-96.75206],[33.21072,-96.75206],[33.21072,-96.75547],
  [33.21854,-96.75539],[33.21859,-96.76741],[33.1965,-96.76751],[33.19641,-96.76238],
  [33.19473,-96.76239],[33.18912,-96.76248],[33.18912,-96.76782],[33.18201,-96.7679],
  [33.18187,-96.75798],[33.1819,-96.75748],[33.18226,-96.75747],[33.18219,-96.75009],
  [33.18166,-96.75011],[33.18162,-96.74158],[33.1852,-96.74151],[33.18524,-96.73296],
  [33.18896,-96.733],[33.18896,-96.73289],[33.17994,-96.73276],[33.16685,-96.73309],
  [33.13837,-96.73338],[33.13309,-96.7331],[33.12697,-96.73345],[33.12624,-96.73332],
  [33.1253,-96.7329],[33.11969,-96.74959],[33.11635,-96.75846],[33.09937,-96.80035],
  [33.09593,-96.8086],[33.09483,-96.81026],[33.09402,-96.81208],[33.09223,-96.81797],
  [33.08381,-96.84824],[33.08232,-96.8521],[33.08287,-96.85249],[33.08127,-96.85586],
  [33.08965,-96.85689],[33.09119,-96.85702],[33.09222,-96.85693],[33.10366,-96.85454],
  [33.10635,-96.85356],[33.10631,-96.86016],[33.10644,-96.86076],[33.10794,-96.86066],
  [33.10822,-96.86085],[33.10825,-96.86923],[33.10548,-96.86925],[33.10549,-96.87183],
  [33.10569,-96.87249],[33.10522,-96.87277],[33.10528,-96.88181],[33.1026,-96.88183],
  [33.10264,-96.88351],[33.10212,-96.88367],[33.09909,-96.88219],[33.09896,-96.88367],
  [33.10046,-96.88482],[33.10304,-96.88521],[33.10306,-96.88634],[33.10384,-96.88941],
  [33.10525,-96.8888],[33.10586,-96.88899],[33.10722,-96.89154],[33.11646,-96.89152],
  [33.1166,-96.89092],[33.11831,-96.88757],[33.1188,-96.88771],[33.11837,-96.88865],
  [33.11864,-96.88949],[33.1183,-96.89014],[33.11822,-96.89151],[33.1201,-96.8915],
  [33.12008,-96.89315],[33.12098,-96.89313],[33.1227,-96.89215],[33.123,-96.89282],
  [33.12257,-96.89365],[33.12155,-96.89449],[33.12174,-96.89465],[33.12008,-96.89535],
  [33.12011,-96.90142],[33.12048,-96.9014],[33.12018,-96.90266],[33.12024,-96.90511],
  [33.12254,-96.9051],[33.12317,-96.90587],[33.12437,-96.90586],[33.12359,-96.90509],
  [33.12452,-96.90509],[33.12373,-96.90475],[33.12413,-96.90464],[33.12378,-96.90396],
  [33.12436,-96.9044],[33.12581,-96.90491],[33.12604,-96.90438],[33.12539,-96.90356],
  [33.1261,-96.90342],[33.12628,-96.90306],[33.12606,-96.90264],[33.12504,-96.90218],
  [33.12443,-96.90228],[33.12446,-96.9019],[33.12515,-96.90165],[33.12539,-96.90131],
  [33.12523,-96.90079],[33.12613,-96.90126],[33.12688,-96.90107],[33.12728,-96.90079],
  [33.12746,-96.90019],[33.12738,-96.89996],[33.12701,-96.89948],[33.12659,-96.89932],
  [33.12698,-96.89913],[33.12695,-96.89885],[33.12756,-96.89856],[33.12844,-96.89904],
  [33.12874,-96.89882],[33.12883,-96.89903],[33.12903,-96.89829],[33.12967,-96.89828],
  [33.12965,-96.89778],[33.1299,-96.89761],[33.12997,-96.89671],[33.13108,-96.89557],
  [33.13145,-96.89493],[33.13193,-96.895],[33.13226,-96.89436],[33.13291,-96.8944],
  [33.13296,-96.89472],[33.13242,-96.89521],[33.13292,-96.89552],[33.13256,-96.89566],
  [33.13215,-96.89559],[33.13224,-96.89679],[33.13201,-96.89704],[33.13163,-96.8986],
  [33.13113,-96.89917],[33.13111,-96.8999],[33.13016,-96.90061],[33.12988,-96.90064],
  [33.12903,-96.9027],[33.12866,-96.90507],[33.1294,-96.9091],[33.13152,-96.90636],
  [33.13126,-96.90993],[33.13077,-96.91088],[33.13629,-96.91152],[33.13381,-96.91214],
  [33.13381,-96.91176],[33.13216,-96.91238],[33.13086,-96.91635],[33.13284,-96.91748],
  [33.13041,-96.919],[33.13067,-96.92007],[33.12936,-96.92065],[33.13386,-96.92076],
  [33.13379,-96.92281],[33.13608,-96.92283]
];

/* =====================================================
   VIEWPORT HEIGHT FIX
   ===================================================== */
function setVh(){ document.documentElement.style.setProperty('--vh',(window.innerHeight*.01)+'px'); }
setVh();
window.addEventListener('resize', setVh);
window.addEventListener('orientationchange',()=>setTimeout(setVh,200));

/* =====================================================
   PINCH ZOOM — block on everything EXCEPT #map
   Uses a touch event listener to cancel multi-touch
   gestures that start outside the map element.
   ===================================================== */
document.addEventListener('touchstart', function(e){
  if(e.touches.length > 1){
    // Allow pinch only if all touches are inside #map
    const mapEl = document.getElementById('map');
    const rect  = mapEl ? mapEl.getBoundingClientRect() : null;
    if(rect){
      const allInMap = Array.from(e.touches).every(t =>
        t.clientX >= rect.left && t.clientX <= rect.right &&
        t.clientY >= rect.top  && t.clientY <= rect.bottom
      );
      if(!allInMap) e.preventDefault();
    } else {
      e.preventDefault();
    }
  }
}, { passive: false });

/* Also block gesturestart (Safari) outside map */
document.addEventListener('gesturestart', function(e){
  const mapEl = document.getElementById('map');
  if(mapEl && !mapEl.contains(e.target)) e.preventDefault();
}, { passive: false });

/* =====================================================
   KILL SWITCH
   ===================================================== */
