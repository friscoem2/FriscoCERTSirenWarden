function getNextWednesdayNoon(){
  const now = new Date();
  const CT_OFFSET_MS = (() => {
    const ct = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Chicago', hour: 'numeric', hour12: false, minute: 'numeric'
    }).formatToParts(now);
    const ctHour = parseInt(ct.find(p=>p.type==='hour').value);
    const ctMin  = parseInt(ct.find(p=>p.type==='minute').value);
    const utcHour = now.getUTCHours();
    const utcMin  = now.getUTCMinutes();
    let offset = (utcHour * 60 + utcMin) - (ctHour * 60 + ctMin);
    if(offset > 720)  offset -= 1440;
    if(offset < -720) offset += 1440;
    return offset * 60 * 1000;
  })();

  const ctNow = new Date(now.getTime() - CT_OFFSET_MS);
  const ctDay  = ctNow.getUTCDay();
  const ctHour = ctNow.getUTCHours();
  let daysUntilWed = (3 - ctDay + 7) % 7;
  if(daysUntilWed === 0 && ctHour < 12){ daysUntilWed = 0; }
  else if(daysUntilWed === 0){ daysUntilWed = 7; }

  const nextWed = new Date(ctNow);
  nextWed.setUTCDate(ctNow.getUTCDate() + daysUntilWed);
  nextWed.setUTCHours(12, 0, 0, 0);
  return new Date(nextWed.getTime() + CT_OFFSET_MS);
}

function startFreshnessTimer(){
  if(freshnessInterval) clearInterval(freshnessInterval);
  const dot   = document.getElementById('freshness-dot');
  const label = document.getElementById('freshness-label');

  function getCTNow(){
    // Returns current time expressed as a CT "virtual" Date (UTC fields = CT clock values)
    const now = new Date();
    const ct = new Intl.DateTimeFormat('en-US', {
      timeZone:'America/Chicago', hour:'numeric', hour12:false,
      minute:'numeric', second:'numeric', weekday:'short',
      year:'numeric', month:'numeric', day:'numeric'
    }).formatToParts(now);
    const get = type => parseInt(ct.find(p=>p.type===type)?.value||'0');
    // Build a plain object with CT clock values
    return {
      dayOfWeek: ct.find(p=>p.type==='weekday')?.value, // 'Wed' etc
      wday: ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].indexOf(ct.find(p=>p.type==='weekday')?.value||''),
      hour:   get('hour'),
      minute: get('minute'),
      second: get('second'),
      nowMs:  now.getTime()
    };
  }

  function tick(){
    const ct  = getCTNow();
    const dot   = document.getElementById('freshness-dot');
    const label = document.getElementById('freshness-label');

    const isWednesday  = ct.wday === 3;
    const totalSecsCT  = ct.hour * 3600 + ct.minute * 60 + ct.second;
    const noon         = 12 * 3600;          // 12:00:00
    const noonPlus3    = 12 * 3600 + 3 * 60; // 12:03:00
    const midnight     = 24 * 3600;          // end of day

    // ── STATE 1: Test in progress (Wed 12:00:00 – 12:02:59) ──
    if(isWednesday && totalSecsCT >= noon && totalSecsCT < noonPlus3){
      label.innerHTML = '🚨&nbsp;<strong>SIREN TEST IN PROGRESS</strong>';
      dot.style.background = '#dc2626';
      return;
    }

    // ── STATE 2: Reports due countdown (Wed 12:03:00 – 23:59:59) ──
    if(isWednesday && totalSecsCT >= noonPlus3 && totalSecsCT < midnight){
      const secsUntilMidnight = midnight - totalSecsCT;
      const h = Math.floor(secsUntilMidnight / 3600);
      const m = Math.floor((secsUntilMidnight % 3600) / 60);
      const s = secsUntilMidnight % 60;
      label.textContent = `Reports due in ${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
      dot.style.background = '#f59e0b';
      return;
    }

    // ── STATE 3: Countdown to next test ──
    const next = getNextWednesdayNoon();
    const diff = Math.max(0, Math.floor((next - ct.nowMs) / 1000));
    const days  = Math.floor(diff / 86400);
    const hours = Math.floor((diff % 86400) / 3600);
    const mins  = Math.floor((diff % 3600) / 60);
    const secs  = diff % 60;

    if(days > 0)        label.textContent = `Next test in ${days}d ${String(hours).padStart(2,'0')}h ${String(mins).padStart(2,'0')}m`;
    else if(hours > 0)  label.textContent = `Next test in ${hours}h ${String(mins).padStart(2,'0')}m ${String(secs).padStart(2,'0')}s`;
    else                label.textContent = `Next test in ${String(mins).padStart(2,'0')}m ${String(secs).padStart(2,'0')}s`;

    dot.style.background = diff > 86400 ? '#10b981' : diff > 3600 ? '#f59e0b' : '#dc2626';
  }

  tick();
  freshnessInterval = setInterval(tick, 1000);
}

/* =====================================================
   WEATHER — Open-Meteo, 7-day fetch, tabbed display
   ===================================================== */
const WMO = {
  0:  ['☀️','Clear'],
  1:  ['🌤️','Mostly Clear'],  2: ['⛅','Partly Cloudy'], 3: ['☁️','Overcast'],
  45: ['🌫️','Fog'],           48: ['🌫️','Icy Fog'],
  51: ['🌦️','Light Drizzle'], 53: ['🌦️','Drizzle'],     55: ['🌧️','Heavy Drizzle'],
  61: ['🌧️','Light Rain'],    63: ['🌧️','Rain'],         65: ['🌧️','Heavy Rain'],
  71: ['🌨️','Light Snow'],    73: ['🌨️','Snow'],         75: ['❄️','Heavy Snow'],
  77: ['🌨️','Snow Grains'],
  80: ['🌦️','Light Showers'], 81: ['🌧️','Showers'],      82: ['⛈️','Heavy Showers'],
  85: ['🌨️','Snow Showers'],  86: ['❄️','Heavy Snow Showers'],
  95: ['⛈️','Thunderstorm'],  96: ['⛈️','T-Storm + Hail'], 99: ['⛈️','T-Storm + Hail'],
};

let wxData = null;

function fetchWeather(){
  // Always fetch 7 days so all tabs work
  const url = 'https://api.open-meteo.com/v1/forecast?latitude=33.1507&longitude=-96.8236&daily=weathercode,temperature_2m_max,temperature_2m_min,windspeed_10m_max,windgusts_10m_max,winddirection_10m_dominant&temperature_unit=fahrenheit&windspeed_unit=mph&timezone=America%2FChicago&forecast_days=7';
  fetch(url)
    .then(r => r.json())
    .then(d => {
      wxData = d.daily;
      // Update the weather menu icon to reflect today's conditions
      const code = wxData.weathercode[0];
      const icon = (WMO[code] || ['🌡️',''])[0];
      const btn = document.getElementById('fab-weather');
      if(btn) btn.innerHTML = `<span>${icon}</span><span>Weather</span>`;
    })
    .catch(() => { wxData = null; });
}

function openWeatherPanel(){
  wxFabOpen = true;
  document.getElementById('weather-panel').classList.add('open');
  renderWeather(currentWxDays);
}
function closeWeatherPanel(){
  wxFabOpen = false;
  document.getElementById('weather-panel').classList.remove('open');
}
function closeWxIfBg(e){ if(e.target===document.getElementById('weather-panel')) closeWeatherPanel(); }

function switchWxTab(days){
  currentWxDays = days;
  // Update tab active state
  document.querySelectorAll('.wx-tab').forEach(t=>{
    t.classList.toggle('active', parseInt(t.dataset.days)===days);
  });
  // Update subtitle
  document.getElementById('wx-subtitle').textContent = `${days}-Day Forecast — Frisco, TX`;
  renderWeather(days);
}

function degToCompass(deg){
  return ['N','NE','E','SE','S','SW','W','NW'][Math.round(deg/45)%8];
}

/* Determine the display label for a date index.
   Returns "Today", "Tomorrow", or the day name.
   Also returns whether the real calendar day is Wednesday. */
function getDayInfo(dateStr, index){
  // dateStr is "YYYY-MM-DD" from Open-Meteo (CT local date)
  const parts = dateStr.split('-');
  const d = new Date(parseInt(parts[0]), parseInt(parts[1])-1, parseInt(parts[2]));
  const isWed = d.getDay() === 3; // 3 = Wednesday

  const DAYS = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  let label;
  if(index === 0)      label = 'Today';
  else if(index === 1) label = 'Tomorrow';
  else                 label = DAYS[d.getDay()];

  return { label, isWed };
}

function renderWeather(days){
  const body = document.getElementById('wx-panel-body');
  if(!body) return;

  if(!wxData){
    body.innerHTML = '<div class="wx-error">⚠️ Weather unavailable. Please check your connection.</div>';
    return;
  }

  const count = Math.min(days, wxData.time.length);
  let html = `<div class="wx-days-wrap days-${days}"><div class="wx-days">`;

  for(let i = 0; i < count; i++){
    const { label, isWed } = getDayInfo(wxData.time[i], i);
    const code  = wxData.weathercode[i];
    const hi    = Math.round(wxData.temperature_2m_max[i]);
    const lo    = Math.round(wxData.temperature_2m_min[i]);
    const wind  = Math.round(wxData.windspeed_10m_max[i]);
    const gust  = wxData.windgusts_10m_max ? Math.round(wxData.windgusts_10m_max[i]) : null;
    const dir   = wxData.winddirection_10m_dominant ? degToCompass(wxData.winddirection_10m_dominant[i]) : null;
    const [emoji, cond] = WMO[code] || ['🌡️','Unknown'];

    const wedClass  = isWed ? ' is-wednesday' : '';
    const wedBadge  = isWed ? '<div class="wx-wed-badge">⭐ Test Day</div>' : '';
    const nameClass = isWed ? ' is-wednesday' : '';
    const windLine  = dir ? `💨 ${dir} ${wind} mph` : `💨 ${wind} mph`;
    const gustLine  = gust ? `<div class="wx-gust">Gusts ${gust} mph</div>` : '';

    html += `<div class="wx-day${wedClass}">
      ${wedBadge}
      <div class="wx-day-name${nameClass}">${label}</div>
      <div class="wx-emoji">${emoji}</div>
      <div class="wx-cond">${cond}</div>
      <div class="wx-temps">${hi}° <span>/ ${lo}°</span></div>
      <div class="wx-wind">${windLine}</div>
      ${gustLine}
    </div>`;
  }

  html += '</div></div>';
  body.innerHTML = html;
}

/* =====================================================
   AUDIBLE RANGE COVERAGE MODE
   ===================================================== */
let coverageMode    = false;
let coverageLayers  = []; // { circle, label } for each siren
let allSirens       = []; // full siren list, stored on load
