function addLegend(){
  const ctrl = L.control({position:'bottomleft'});
  ctrl.onAdd=()=>{
    const div=L.DomUtil.create('div','legend-ctrl hidden');
    div.innerHTML=`
      <div class="legend-header">
        <div class="legend-title">Volunteer Status</div>
        <button class="legend-close" onclick="toggleLegend()" aria-label="Close legend">✕</button>
      </div>
      <div class="legend-row"><div class="legend-dot" style="background:#6b7280;"></div><span>Assigned ✓</span></div>
      <div class="legend-row"><div class="legend-dot" style="background:#10b981;"></div><span>1–7 days (Active)</span></div>
      <div class="legend-row"><div class="legend-dot" style="background:#f59e0b;"></div><span>8–14 days (Attention needed)</span></div>
      <div class="legend-row"><div class="legend-dot" style="background:#f97316;"></div><span>15–21 days (Action required)</span></div>
      <div class="legend-row"><div class="legend-dot" style="background:#dc2626;"></div><span>22+ days (Urgent)</span></div>
      <hr class="legend-sep">
      <div class="legend-row"><div class="legend-boundary"></div><span>City Boundary</span></div>
      <div style="margin-top:10px;font-size:11px;color:#9ca3af;font-style:italic;">Color = most recent of sign-up or visit</div>`;
    L.DomEvent.disableClickPropagation(div);
    L.DomEvent.disableScrollPropagation(div);
    legendDiv=div;
    return div;
  };
  ctrl.addTo(map);
}

function toggleLegend(){
  if(!legendDiv) return;
  legendVisible=!legendVisible;
  legendDiv.classList.toggle('hidden',!legendVisible);
}

/* =====================================================
   LEADERBOARD
   ===================================================== */
const RANK_COLORS = ['#f59e0b','#94a3b8','#cd7f32','#10b981','#6366f1','#ec4899','#0ea5e9','#84cc16','#f97316','#8b5cf6'];

function openLeaderboard(){
  document.getElementById('leaderboard-panel').classList.add('open');
  document.getElementById('lb-body').innerHTML='<div class="lb-empty">Loading rankings…</div>';
  fetchProtectedData('leaderboard')
    .then(d=>{ const rows=(d.values||[]).slice(1).filter(r=>r[0]); renderLeaderboard(rows); })
    .catch(err=>{ document.getElementById('lb-body').innerHTML=`<div class="lb-empty">⚠️ Could not load rankings.<br><small>${err.message}</small></div>`; });
}

function renderLeaderboard(rows){
  if(!rows.length){
    document.getElementById('lb-body').innerHTML='<div class="lb-empty">No rankings yet.<br>Get out there and volunteer! 🚨</div>';
    return;
  }
  rows.sort((a,b)=>{
    const visitDiff = (parseInt(b[1])||0) - (parseInt(a[1])||0);
    if(visitDiff !== 0) return visitDiff;
    return (parseInt(b[2])||0) - (parseInt(a[2])||0); // tiebreak: unique sites desc
  });
  const top3 = rows.slice(0,3);
  const rest  = rows.slice(3);
  const podiumOrder = [top3[1], top3[0], top3[2]].filter(Boolean);
  const podiumClass = top3[1] ? ['rank-2','rank-1','rank-3'] : ['rank-1'];
  const podiumBlockH= top3[1] ? ['rank-2-block','rank-1-block','rank-3-block'] : ['rank-1-block'];

  let podiumHtml='<div class="lb-podium">';
  podiumOrder.forEach((r,i)=>{
    if(!r) return;
    const origRank = rows.indexOf(r)+1;
    const initials = (r[0]||'?').split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2);
    const color = RANK_COLORS[origRank-1]||'#6b7280';
    podiumHtml+=`
      <div class="lb-podium-slot">
        <div class="lb-podium-avatar ${podiumClass[i]}-avatar" style="background:${color};">${initials}</div>
        <div class="lb-podium-name">${esc(r[0])}</div>
        <div class="lb-podium-visits">${r[1]||'0'} visits · ${r[2]||'0'} sites</div>
        <div class="lb-podium-block ${podiumBlockH[i]}">
          <div class="lb-podium-rank">${origRank===1?'🥇':origRank===2?'🥈':'🥉'}</div>
        </div>
      </div>`;
  });
  podiumHtml+='</div>';

  let listHtml='';
  if(rest.length){
    listHtml+='<div class="lb-section-label">Other Rankings</div><div class="lb-list">';
    rest.forEach((r,i)=>{
      const rank=i+4;
      const color=RANK_COLORS[rank-1]||'#6b7280';
      const initials=(r[0]||'?').split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2);
      listHtml+=`
        <div class="lb-row" style="animation-delay:${i*60}ms;">
          <div class="lb-rank-num">${rank}</div>
          <div class="lb-podium-avatar" style="background:${color};width:36px;height:36px;font-size:14px;border-width:2px;flex-shrink:0;">${initials}</div>
          <div class="lb-name">${esc(r[0])}</div>
          <div class="lb-stats">
            <div class="lb-stat-primary">${r[1]||0}</div>
            <div class="lb-stat-secondary">${r[2]||0} unique sites</div>
          </div>
        </div>`;
    });
    listHtml+='</div>';
  }
  document.getElementById('lb-body').innerHTML = podiumHtml + listHtml;
}

function closeLeaderboard(){ document.getElementById('leaderboard-panel').classList.remove('open'); }
function closeLbIfBg(e){ if(e.target===document.getElementById('leaderboard-panel')) closeLeaderboard(); }

/* =====================================================
   FORM MODAL
   ===================================================== */
function openForm(id,name){
  document.getElementById('modal-title').textContent=`Volunteer — Siren #${id}: ${name}`;
  document.getElementById('formIframe').src=GOOGLE_FORM_URL+'?embedded=true';
  document.getElementById('formModal').classList.add('open');
  document.body.style.overflow='hidden';
  if (typeof closeAppMenu === 'function') closeAppMenu(false);
}
function closeModal(){
  document.getElementById('formModal').classList.remove('open');
  document.getElementById('formIframe').src='';
  document.body.style.overflow='';
  softRefresh();
}
window.addEventListener('click',e=>{ if(e.target===document.getElementById('formModal')) closeModal(); });

/* =====================================================
   SUGGESTION BOX
   ===================================================== */
function openSuggestionBox(){
  document.getElementById('suggestIframe').src='https://docs.google.com/forms/d/e/1FAIpQLSeozkeabv9CJDhsBopiHXz4_POYjnoZlC5IFXUQxgh1kSSkIg/viewform?embedded=true';
  document.getElementById('suggestModal').classList.add('open');
  document.body.style.overflow='hidden';
  if (typeof closeAppMenu === 'function') closeAppMenu(false);
}
function closeSuggestionBox(){
  document.getElementById('suggestModal').classList.remove('open');
  document.getElementById('suggestIframe').src='';
  document.body.style.overflow='';
  softRefresh();
}
window.addEventListener('click',e=>{ if(e.target===document.getElementById('suggestModal')) closeSuggestionBox(); });

/* =====================================================
   UI HELPERS
   ===================================================== */
function showLoadingScreen(){ document.getElementById('loading-screen').classList.remove('hidden'); }
function hideLoadingScreen(){ document.getElementById('loading-screen').classList.add('hidden'); }
function showError(msg){
  hideLoadingScreen();
  document.getElementById('error-msg').textContent=msg;
  document.getElementById('error-detail').textContent='Make sure your device has internet access and try again. If the problem persists, contact your CERT coordinator.';
  document.getElementById('error-screen').classList.add('visible');
}
function hideError(){ document.getElementById('error-screen').classList.remove('visible'); }

/* =====================================================
   SOFT REFRESH — re-fetches sheet data and redraws
   markers without disturbing map view, zoom, or UI
   ===================================================== */
function softRefresh(){
  fetchProtectedData('sirens')
    .then(d=>{
      const rows = d.values || [];
      if(rows.length < 2) return; // nothing to do
      const sirens = rowsToSirens(rows);

      // Store updated siren list for coverage mode
      allSirens = sirens;

      // Remove all existing markers from the map
      Object.values(markerRegistry).forEach(({marker}) => {
        if(map.hasLayer(marker)) map.removeLayer(marker);
      });
      markerRegistry = {};

      // Clear any open range circles
      Object.keys(activeCircles).forEach(id => clearCircle(id));

      // Re-add all markers with fresh data
      sirens.forEach(addMarker);

      // Update lives protected counter
      const lives = calcLivesProtected(sirens);
      document.getElementById('lives-count').textContent = lives.toLocaleString();

      // If coverage mode is active, redraw coverage circles with fresh data
      if(coverageMode) showAllCoverageCircles();
    })
    .catch(err => console.warn('Soft refresh failed:', err));
}

/* =====================================================
   NEXT TEST COUNTDOWN
   ===================================================== */
let freshnessInterval = null;
