const TOUR_SLIDES = [
  // ── 1: WELCOME ──
  {
    title: 'Welcome',
    body: () => `
      <div class="tour-finish" style="padding:0;">
        <div class="tour-finish-icon">🚨</div>
        <div class="tour-finish-title">Frisco Siren Map</div>
        <div class="tour-finish-text" style="margin-bottom:16px;">
          Welcome, volunteer! This app helps you find, sign up for, and report on
          <strong>Frisco's outdoor warning sirens</strong> — tested every Wednesday at noon.<br><br>
          This quick tour will walk you through everything. Tap the interactive elements to try them out!
        </div>
      </div>
      <div class="demo-area">
        <div class="demo-label">Your Role</div>
        <div style="display:flex;flex-direction:column;gap:8px;">
          <div style="display:flex;align-items:flex-start;gap:10px;">
            <span style="font-size:20px;flex-shrink:0;">📍</span>
            <div style="font-size:12px;color:var(--gray-600);line-height:1.5;"><strong style="color:var(--gray-800);">Drive to your siren</strong> — each Wednesday before noon</div>
          </div>
          <div style="display:flex;align-items:flex-start;gap:10px;">
            <span style="font-size:20px;flex-shrink:0;">👂</span>
            <div style="font-size:12px;color:var(--gray-600);line-height:1.5;"><strong style="color:var(--gray-800);">Listen</strong> — can you hear it? Note any issues</div>
          </div>
          <div style="display:flex;align-items:flex-start;gap:10px;">
            <span style="font-size:20px;flex-shrink:0;">📋</span>
            <div style="font-size:12px;color:var(--gray-600);line-height:1.5;"><strong style="color:var(--gray-800);">Report</strong> — submit your findings through this app</div>
          </div>
        </div>
      </div>`
  },

  // ── 2: READING THE MAP ──
  {
    title: 'Reading the Map',
    body: () => `
      <p class="tour-desc">Every siren appears as a <strong>colored circle with a number</strong>. The color tells you how recently a volunteer has been active there. Tap a dot below to learn what it means.</p>
      <div class="demo-area">
        <div class="demo-label">Try tapping a siren dot</div>
        ${[
          { color:'#6b7280', num:'7',  name:'Assigned ✓',       desc:'Volunteer signed up for next test' },
          { color:'#10b981', num:'12', name:'Active (1–7 days)', desc:'Recently visited — looking good!' },
          { color:'#f59e0b', num:'3',  name:'Needs Attention',   desc:'8–14 days since last activity' },
          { color:'#f97316', num:'24', name:'Action Required',   desc:'15–21 days — needs a volunteer' },
          { color:'#dc2626', num:'35', name:'Urgent',            desc:'22+ days — no recent coverage!' },
        ].map(d => `
          <div class="demo-dot-row" onclick="tourTapDot(this)">
            <div class="demo-dot" style="background:${d.color};">${d.num}</div>
            <div class="demo-dot-info">
              <div class="demo-dot-name">${d.name}</div>
              <div class="demo-dot-desc">${d.desc}</div>
            </div>
            <div class="demo-tooltip">✓ Got it!</div>
          </div>`).join('')}
      </div>`
  },

  // ── 3: TAPPING A SIREN ──
  {
    title: 'Tapping a Siren',
    body: () => `
      <p class="tour-desc">Tap any siren on the map to open its popup. You'll see location info, volunteer status, and buttons to take action. Try the buttons below!</p>
      <div class="demo-area" style="padding:0;overflow:hidden;">
        <div class="demo-popup">
          <div class="demo-popup-header">
            <div class="demo-popup-id">Siren #7</div>
            <div class="demo-popup-name">Redbud Estates</div>
          </div>
          <div class="demo-popup-body">
            <div class="demo-popup-row"><span class="demo-popup-lbl">Status</span><span class="demo-popup-val"><span style="background:#d1fae5;color:#065f46;padding:1px 6px;border-radius:10px;font-size:10px;font-weight:700;">Online</span></span></div>
            <div class="demo-popup-row"><span class="demo-popup-lbl">Last Tested</span><span class="demo-popup-val">3/12/2026</span></div>
            <div class="demo-popup-row"><span class="demo-popup-lbl">Next Test</span><span class="demo-popup-val">3/19/2026 Noon</span></div>
            <hr style="border:none;border-top:1px solid var(--gray-200);margin:8px 0;">
            <div style="background:#fef3c7;color:#92400e;border:1px solid #fde68a;border-radius:6px;padding:6px 10px;font-size:11px;font-weight:600;margin-bottom:8px;">⚠️ Needs Attention — 12 days since last activity</div>
            <button class="demo-btn demo-btn-green" onclick="tourTapBtn(this,'✅ Form opened! Fill it out and submit.')">🙋 Volunteer for This Siren</button>
            <button class="demo-btn demo-btn-blue"  onclick="tourTapBtn(this,'📋 Report form opened!')">📋 Report on This Siren</button>
            <button class="demo-btn demo-btn-maps"  onclick="tourTapBtn(this,'📍 Google Maps would open here.')">📍 Open in Google Maps</button>
            <div class="demo-try-hint" id="tour-popup-result"></div>
          </div>
        </div>
      </div>`
  },

  // ── 4: THE MENU ──
  {
    title: 'The Menu Button',
    body: () => `
      <p class="tour-desc">The <strong>＋ Menu</strong> button in the bottom-right opens a speed-dial with all the main features. Tap each one below to see what it does.</p>
      <div class="demo-area">
        <div class="demo-label">Try tapping a menu item</div>
        <div class="demo-fab-list">
          ${[
            { icon:'📍', label:'Locate Me',      resp:'Shows your location on the map with a directional arrow compass.' },
            { icon:'🏆', label:'Leaderboard',    resp:'Rankings of all volunteers by total visits and unique sirens.' },
            { icon:'🗺️', label:'Legend',          resp:'Color guide explaining what each siren dot color means.' },
            { icon:'☁️', label:'Weather',         resp:'3, 5, or 7-day forecast for Frisco with Wednesday test day highlighted.' },
            { icon:'📋', label:'Report View',    resp:'Filters the map to only show assigned sirens for quick reporting.' },
            { icon:'🗳️', label:'Suggestion Box', resp:'Submit ideas or feedback to the CERT coordinator team.' },
          ].map((item, i) => `
            <div>
              <div class="demo-fab-item" onclick="tourTapFab(this)">
                <span>${item.icon}</span> ${item.label}
              </div>
              <div class="demo-fab-response">${item.resp}</div>
            </div>`).join('')}
        </div>
      </div>`
  },

  // ── 5: LEFT BUTTONS ──
  {
    title: 'Map Controls',
    body: () => `
      <p class="tour-desc">Three small buttons sit above the zoom controls on the <strong>bottom-left</strong> of the map. Here's what each one does.</p>
      <div class="demo-area">
        <div class="demo-label">Left-side map buttons</div>
        <div class="demo-left-btns">
          <div class="demo-left-row">
            <div class="demo-side-btn" style="font-size:16px;font-weight:900;font-family:var(--font-d);color:#1E5238;cursor:default;">?</div>
            <div class="demo-btn-label"><strong>Orientation Tour</strong>That's this! Opens this walkthrough anytime.</div>
          </div>
          <div class="demo-left-row">
            <div class="demo-side-btn" style="cursor:default;">🎧</div>
            <div class="demo-btn-label"><strong>Coverage Mode</strong>Shows all 1-mile audible range circles at once. View only — no popups.</div>
          </div>
          <div class="demo-left-row">
            <div class="demo-side-btn" style="cursor:default;">🌧️</div>
            <div class="demo-btn-label"><strong>Weather Radar</strong>Live RainViewer radar overlay with playback controls and opacity slider.</div>
          </div>
          <div class="demo-left-row">
            <div class="demo-side-btn" style="cursor:default;">
              <svg viewBox="0 0 16 16" fill="none" width="16" height="16"><path d="M1 3h14M3.5 7h9M6 11h4" stroke="#374151" stroke-width="1.8" stroke-linecap="round"/></svg>
            </div>
            <div class="demo-btn-label"><strong>Filter Sirens</strong>Show/hide sirens by urgency level. Default hides already-assigned ones.</div>
          </div>
        </div>
      </div>`
  },

  // ── 6: COUNTDOWN TIMER ──
  {
    title: 'Test Day Timer',
    body: () => `
      <p class="tour-desc">The countdown bar at the top of the map always shows you <strong>how long until the next Wednesday noon test</strong>. On test day, it switches to live status messages.</p>
      <div class="demo-area">
        <div class="demo-label">The timer has 3 states — tap each to preview</div>
        <div style="display:flex;flex-direction:column;gap:10px;">
          <div onclick="tourShowCountdown('next')" style="cursor:pointer;padding:8px;border-radius:8px;border:1.5px solid var(--gray-200);transition:border-color .15s;" id="cd-next">
            <div class="demo-countdown" style="margin-bottom:4px;">
              <div class="demo-dot-status" style="background:#10b981;"></div>
              Next test in 4d 16h 22m
            </div>
            <div style="font-size:11px;color:var(--gray-400);margin-left:4px;">Tap to highlight</div>
          </div>
          <div onclick="tourShowCountdown('progress')" style="cursor:pointer;padding:8px;border-radius:8px;border:1.5px solid var(--gray-200);transition:border-color .15s;" id="cd-progress">
            <div class="demo-countdown" style="margin-bottom:4px;">
              <div class="demo-dot-status" style="background:#dc2626;"></div>
              🚨 SIREN TEST IN PROGRESS
            </div>
            <div style="font-size:11px;color:var(--gray-400);margin-left:4px;">12:00 PM – 12:02 PM Wednesday</div>
          </div>
          <div onclick="tourShowCountdown('reports')" style="cursor:pointer;padding:8px;border-radius:8px;border:1.5px solid var(--gray-200);transition:border-color .15s;" id="cd-reports">
            <div class="demo-countdown" style="margin-bottom:4px;">
              <div class="demo-dot-status" style="background:#f59e0b;"></div>
              Reports due in 11:43:22
            </div>
            <div style="font-size:11px;color:var(--gray-400);margin-left:4px;">12:03 PM – midnight Wednesday</div>
          </div>
        </div>
      </div>`
  },

  // ── 7: SUBMITTING A REPORT ──
  {
    title: 'Submitting a Report',
    body: () => `
      <p class="tour-desc">After the test, tap your assigned siren → <strong>📋 Report on This Siren</strong>. You'll verify your email first, then fill out the form. Try it below!</p>
      <div class="demo-area">
        <div class="demo-label">Practice filling out a report</div>
        <div class="demo-form">
          <div class="demo-form-field">
            <label class="demo-form-label">Your Email</label>
            <input class="demo-form-input" type="email" placeholder="volunteer@email.com" id="demo-email-input">
          </div>
          <div class="demo-form-field">
            <label class="demo-form-label">Was the Siren Heard?</label>
            <select class="demo-form-select" id="demo-heard-select">
              <option value="">— Select —</option>
              <option>Yes, clearly heard</option>
              <option>Yes, faintly heard</option>
              <option>No — could not hear it</option>
              <option>I'm not sure</option>
            </select>
          </div>
          <div class="demo-form-field">
            <label class="demo-form-label">Any Visible Damage?</label>
            <select class="demo-form-select" id="demo-damage-select">
              <option value="">— Select —</option>
              <option>No visible damage</option>
              <option>Yes — minor damage</option>
              <option>Yes — significant damage</option>
            </select>
          </div>
          <button class="demo-form-submit" onclick="tourSubmitReport()">Submit Report</button>
          <div class="demo-submit-result" id="demo-submit-result">
            ✅ Report submitted! The coordinator team has been notified.
          </div>
        </div>
      </div>`
  },

  // ── 8: YOU'RE READY ──
  {
    title: "You're Ready!",
    body: () => `
      <div class="tour-finish">
        <div class="tour-finish-icon">🎖️</div>
        <div class="tour-finish-title">You're All Set!</div>
        <div class="tour-finish-text">
          You now know everything you need to be a great Frisco CERT Siren Warden.<br><br>
          <strong>Remember:</strong><br>
          📅 Show up each Wednesday before noon<br>
          👂 Listen for your siren<br>
          📋 Report back by midnight<br><br>
          You can reopen this tour anytime using the <strong>?</strong> button on the map.
        </div>
      </div>
      <div class="demo-area" style="margin-top:12px;">
        <div class="demo-label">Quick Reference</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
          ${[
            ['🔴','Urgent — needs you!'],['🟠','Action required'],
            ['🟡','Needs attention'],['🟢','Active — covered'],
            ['⚫','Assigned — taken'],['🌧️','Live radar overlay'],
            ['🎧','Coverage circles'],['🏆','Leaderboard & stats'],
          ].map(([e,t])=>`
            <div style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--gray-600);">
              <span style="font-size:16px;">${e}</span>${t}
            </div>`).join('')}
        </div>
      </div>`
  }
];

function openTour(){
  tourCurrentSlide = 0;
  renderTourSlide();
  document.getElementById('tour-backdrop').classList.add('open');
}

function closeTour(){
  document.getElementById('tour-backdrop').classList.remove('open');
}

function tourBgClose(e){
  if(e.target === document.getElementById('tour-backdrop')) closeTour();
}

function renderTourSlide(){
  const total   = TOUR_SLIDES.length;
  const slide   = TOUR_SLIDES[tourCurrentSlide];
  const pct     = ((tourCurrentSlide + 1) / total * 100).toFixed(1);
  const isLast  = tourCurrentSlide === total - 1;
  const isFirst = tourCurrentSlide === 0;

  document.getElementById('tour-step-label').textContent = `Step ${tourCurrentSlide + 1} of ${total}`;
  document.getElementById('tour-title').textContent       = slide.title;
  document.getElementById('tour-progress-fill').style.width = pct + '%';
  document.getElementById('tour-body').innerHTML          = slide.body();
  document.getElementById('tour-prev').disabled           = isFirst;

  const nextBtn = document.getElementById('tour-next');
  if(isLast){
    nextBtn.textContent = '✓ Done';
    nextBtn.classList.add('finish');
  } else {
    nextBtn.textContent = 'Next →';
    nextBtn.classList.remove('finish');
  }

  // Dots
  const dotsEl = document.getElementById('tour-dots');
  dotsEl.innerHTML = TOUR_SLIDES.map((_, i) =>
    `<div class="tour-dot-pip${i === tourCurrentSlide ? ' active' : ''}"></div>`
  ).join('');
}

function tourNext(){
  if(tourCurrentSlide >= TOUR_SLIDES.length - 1){ closeTour(); return; }
  tourCurrentSlide++;
  renderTourSlide();
  document.getElementById('tour-body').scrollTop = 0;
}

function tourPrev(){
  if(tourCurrentSlide <= 0) return;
  tourCurrentSlide--;
  renderTourSlide();
  document.getElementById('tour-body').scrollTop = 0;
}

/* ── Interactive helpers ── */
function tourTapDot(row){
  document.querySelectorAll('.demo-dot-row').forEach(r => r.classList.remove('tapped'));
  row.classList.add('tapped');
}

function tourTapBtn(btn, msg){
  btn.classList.add('tapped');
  document.getElementById('tour-popup-result').textContent = msg;
  setTimeout(()=> btn.classList.remove('tapped'), 800);
}

function tourTapFab(item){
  // Toggle this item's tapped state
  const wasActive = item.classList.contains('tapped');
  document.querySelectorAll('.demo-fab-item').forEach(i => i.classList.remove('tapped'));
  if(!wasActive) item.classList.add('tapped');
}

function tourToggleBtn(btn, activeClass, responseId){
  const isActive = btn.classList.contains(activeClass);
  // Reset all demo side buttons
  document.querySelectorAll('.demo-side-btn').forEach(b => {
    b.classList.remove('active-blue','active-purple','active-amber');
  });
  document.querySelectorAll('[id^="tour-"],[id^="tour-"]').forEach(el => {
    if(el.style !== undefined) el.style.display = 'none';
  });
  // Hide all responses
  ['tour-q-resp','tour-cov-resp','tour-rad-resp','tour-flt-resp'].forEach(id => {
    const el = document.getElementById(id);
    if(el) el.style.display = 'none';
  });
  if(!isActive){
    btn.classList.add(activeClass);
    const resp = document.getElementById(responseId);
    if(resp) resp.style.display = 'block';
  }
}

function tourShowCountdown(state){
  ['cd-next','cd-progress','cd-reports'].forEach(id => {
    const el = document.getElementById(id);
    if(el) el.style.borderColor = 'var(--gray-200)';
  });
  const map = { next:'cd-next', progress:'cd-progress', reports:'cd-reports' };
  const target = document.getElementById(map[state]);
  if(target) target.style.borderColor = 'var(--cert-green)';
}

function tourSubmitReport(){
  const email  = document.getElementById('demo-email-input').value.trim();
  const heard  = document.getElementById('demo-heard-select').value;
  const damage = document.getElementById('demo-damage-select').value;
  const result = document.getElementById('demo-submit-result');
  if(!email || !heard || !damage){
    result.style.display = 'block';
    result.style.background = '#fee2e2';
    result.style.borderColor = '#fca5a5';
    result.style.color = '#991b1b';
    result.textContent = '⚠️ Please fill in all fields before submitting.';
    return;
  }
  result.style.display = 'block';
  result.style.background = '#d1fae5';
  result.style.borderColor = '#6ee7b7';
  result.style.color = '#065f46';
  result.textContent = '✅ Report submitted! The coordinator team has been notified. Great work!';
}
