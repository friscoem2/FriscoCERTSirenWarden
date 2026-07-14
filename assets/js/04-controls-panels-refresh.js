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

async function openLeaderboard(){
  document.getElementById('leaderboard-panel').classList.add('open');
  document.getElementById('lb-body').innerHTML='<div class="lb-empty">Loading rankings…</div>';
  try {
    const response = await fetch('/api/profile?view=leaderboard', {
      method:'GET',
      credentials:'same-origin',
      cache:'no-store',
      headers:{ Accept:'application/json' },
    });
    let data={};
    try { data=await response.json(); } catch { data={}; }
    if(response.status===401 && typeof expireLocalSession==='function') expireLocalSession();
    if(!response.ok) throw new Error(data.error?.message || data.error || `HTTP ${response.status}`);
    renderLeaderboard(Array.isArray(data.profiles) ? data.profiles : []);
  } catch(err) {
    document.getElementById('lb-body').innerHTML=`<div class="lb-empty">⚠️ Could not load rankings.<br><small>${esc(err.message)}</small></div>`;
  }
}

function leaderboardAvatar(profile, rank, compact=false){
  const color=RANK_COLORS[rank-1]||'#6b7280';
  const avatar=profile.avatar || '🧑‍🚒';
  const compactStyle=compact ? 'width:36px;height:36px;font-size:17px;border-width:2px;flex-shrink:0;' : '';
  return `<div class="lb-podium-avatar" style="background:${color};${compactStyle}">${esc(avatar)}</div>`;
}

function renderLeaderboard(profiles){
  const rows=(profiles||[]).filter(profile=>profile && profile.publicName);
  if(!rows.length){
    document.getElementById('lb-body').innerHTML='<div class="lb-empty">No rankings yet.<br>Get out there and volunteer! 🚨</div>';
    return;
  }

  const top3=rows.slice(0,3);
  const rest=rows.slice(3);
  const podiumOrder=[top3[1],top3[0],top3[2]].filter(Boolean);
  const podiumClass=top3[1] ? ['rank-2','rank-1','rank-3'] : ['rank-1'];
  const podiumBlockH=top3[1] ? ['rank-2-block','rank-1-block','rank-3-block'] : ['rank-1-block'];

  let podiumHtml='<div class="lb-podium">';
  podiumOrder.forEach((profile,index)=>{
    const origRank=rows.indexOf(profile)+1;
    podiumHtml+=`
      <button class="lb-podium-slot" type="button" onclick="openProfileById('${esc(profile.profileId)}')" aria-label="View ${esc(profile.publicName)} profile">
        <div class="lb-podium-avatar ${podiumClass[index]}-avatar">${esc(profile.avatar || '🧑‍🚒')}</div>
        <div class="lb-podium-name">${esc(profile.publicName)}</div>
        <div class="lb-podium-visits">${Number(profile.totalSignups||0)} signups · ${Number(profile.uniqueSites||0)} sites</div>
        <div class="lb-podium-rank-label">${esc(profile.rankEmoji||'🌱')} ${esc(profile.rankName||'New')}</div>
        <div class="lb-podium-block ${podiumBlockH[index]}">
          <div class="lb-podium-rank">${origRank===1?'🥇':origRank===2?'🥈':'🥉'}</div>
        </div>
      </button>`;
  });
  podiumHtml+='</div>';

  let listHtml='';
  if(rest.length){
    listHtml+='<div class="lb-section-label">Other Rankings</div><div class="lb-list">';
    rest.forEach((profile,index)=>{
      const rank=index+4;
      listHtml+=`
        <button class="lb-row" type="button" style="animation-delay:${index*60}ms" onclick="openProfileById('${esc(profile.profileId)}')" aria-label="View ${esc(profile.publicName)} profile">
          <div class="lb-rank-num">${rank}</div>
          ${leaderboardAvatar(profile,rank,true)}
          <div class="lb-name-wrap">
            <div class="lb-name">${esc(profile.publicName)}</div>
            <div class="lb-rank-name">${esc(profile.rankEmoji||'🌱')} ${esc(profile.rankName||'New')}</div>
          </div>
          <div class="lb-stats">
            <div class="lb-stat-primary">${Number(profile.totalSignups||0)}</div>
            <div class="lb-stat-secondary">${Number(profile.uniqueSites||0)} unique sites</div>
          </div>
        </button>`;
    });
    listHtml+='</div>';
  }
  document.getElementById('lb-body').innerHTML=podiumHtml+listHtml;
}

function closeLeaderboard(){ document.getElementById('leaderboard-panel').classList.remove('open'); }
function closeLbIfBg(e){ if(e.target===document.getElementById('leaderboard-panel')) closeLeaderboard(); }

/* =====================================================
   NATIVE FORMS
   Form opening and submission now live in 10-native-forms.js.
   ===================================================== */

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
