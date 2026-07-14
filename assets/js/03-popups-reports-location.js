function esc(s){ return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function inlineArg(s){ return esc(s).replace(/\\/g,'\\\\').replace(/'/g,"\\'").replace(/[\r\n]+/g,' '); }

function maskEmail(email){
  if(!email || email.length < 5) return '***';
  return email.slice(0, 4) + '***' + email[email.length - 1];
}

function buildPopup(siren, color){
  const sLow   = (siren.status||'').toLowerCase();
  const needsSU= (siren.signUpNeeded||'').toLowerCase()==='yes';
  const ul     = urgencyLabel(siren);
  const mapsUrl= `https://www.google.com/maps?q=${siren.lat},${siren.lng}`;
  const imgSrc = driveImgSrc(siren.imageUrl,'w400');
  const imgSrcFull = driveImgSrc(siren.imageUrl,'w1200');
  const isMyAssignment = typeof canCurrentUserReport === 'function' && canCurrentUserReport(siren);

  let badgeCls='badge-online';
  if(sLow==='canceled')      badgeCls='badge-canceled';
  if(sLow==='not scheduled') badgeCls='badge-notscheduled';

  const photoHtml = imgSrc
    ? `<div class="popup-photo-col">
         <img class="popup-photo-thumb"
              src="${imgSrc}"
              alt="Siren ${esc(siren.id)}"
              onclick="openLightbox('${imgSrcFull}','Siren #${esc(siren.id)}: ${esc(siren.friendlyName)}')"
              onerror="this.parentElement.innerHTML='<div class=\\'popup-photo-placeholder\\'><span>📷</span>No Photo</div>'">
         <div class="popup-photo-hint">Tap to enlarge</div>
       </div>`
    : `<div class="popup-photo-col">
         <div class="popup-photo-placeholder"><span>📷</span>No Photo</div>
       </div>`;

  let h=`
  <div style="display:flex;flex-direction:column;height:100%;min-height:0;">
    <div class="popup-header">
      <div class="popup-siren-id">Siren #${esc(siren.id)}</div>
      <div class="popup-title">${esc(siren.friendlyName)}</div>
    </div>
    <div class="popup-body">
      <div class="popup-inner">
        <div class="popup-info">
          <div class="popup-row"><span class="popup-label">System</span><span class="popup-value">${esc(siren.systemName)}</span></div>
          <div class="popup-row"><span class="popup-label">Status</span><span class="popup-value"><span class="popup-badge ${badgeCls}">${esc(siren.status)}</span></span></div>
          <div class="popup-row"><span class="popup-label">Last Tested</span><span class="popup-value">${esc(siren.lastTested)}</span></div>
          <div class="popup-row"><span class="popup-label">Next Test</span><span class="popup-value">${esc(siren.nextTest)}</span></div>
          <div class="popup-row"><span class="popup-label">Coordinates</span><span class="popup-value">${Number(siren.lat).toFixed(5)}, ${Number(siren.lng).toFixed(5)}</span></div>
        </div>
        ${photoHtml}
      </div>
      <hr class="popup-divider">`;

  if(needsSU && ul){
    h+=`<div class="popup-section-title">Volunteer Status</div>
        <div class="volunteer-urgency" style="background:${ul.bg};color:${ul.color};">
          <div class="urgency-dot" style="background:${ul.color};"></div>
          <span>${ul.text}</span>
        </div>
        <div class="popup-row"><span class="popup-label">Sign-up</span><span class="popup-value">${siren.daysSinceSignup} days ago &nbsp;(${esc(siren.lastSignUpDate)})</span></div>
        <div class="popup-row"><span class="popup-label">Last Visit</span><span class="popup-value">${siren.daysSinceVisit} days ago &nbsp;(${esc(siren.lastVisitDate)})</span></div>`;
  } else {
    const masked = maskEmail(siren.currentSignup);
    const reportName = inlineArg(siren.friendlyName);
    h+=`<div class="assigned-chip">✅ <span>${isMyAssignment ? 'Your Assignment' : `Assigned: <strong>${esc(masked)}</strong>`}</span></div>
        <div class="popup-row"><span class="popup-label">Last Sign Up</span><span class="popup-value">${siren.daysSinceSignup} days ago &nbsp;(${esc(siren.lastSignUpDate)})</span></div>`;
    if(isMyAssignment){
      h+=`<button class="popup-btn popup-btn-report" onclick="openReportForm('${inlineArg(siren.id)}','${reportName}')">📋 Report on This Siren</button>`;
    } else {
      h+=`<div class="popup-report-note">🔒 Reporting is available to the assigned volunteer.</div>`;
    }
  }
  if(siren.description && siren.description!=='N/A'){
    h+=`<hr class="popup-divider"><div class="info-box"><div class="info-box-label">📍 Location Notes</div>${esc(siren.description)}</div>`;
  }
  if(siren.instructions && siren.instructions!=='N/A'){
    h+=`<div class="info-box"><div class="info-box-label">🚗 Parking / Access</div>${esc(siren.instructions)}</div>`;
  }

  h+=`</div><div class="popup-footer"><a href="${mapsUrl}" target="_blank" class="popup-btn popup-btn-maps">📍 Open in Google Maps</a>`;

  if(needsSU){
    const sn=inlineArg(siren.friendlyName);
    h+=`<button class="popup-btn popup-btn-green" onclick="openForm('${inlineArg(siren.id)}','${sn}')">🙋 Volunteer for This Siren</button>`;
  }

  h+=`</div></div>`;
  return h;
}

/* =====================================================
   NATIVE REPORT FORM
   Session-based report authorization and UI now live in
   10-native-forms.js. The legacy email gate was removed.
   ===================================================== */

/* =====================================================
   PHOTO LIGHTBOX
   ===================================================== */
function openLightbox(src, caption){
  document.getElementById('lightbox-img').src = src;
  document.getElementById('lightbox-caption').textContent = caption;
  document.getElementById('lightbox').classList.add('open');
  document.body.style.overflow='hidden';
}
function closeLightbox(){
  document.getElementById('lightbox').classList.remove('open');
  document.getElementById('lightbox-img').src='';
  document.body.style.overflow='';
}

/* =====================================================
   LOCATE ME
   ===================================================== */
/* ── Helper: build the SVG arrow icon HTML ── */
function locationIconHtml(heading){
  // If no heading, show a simple dot
  if(heading === null){
    return `<div class="user-location-wrap"><div class="user-location-dot"></div></div>`;
  }
  // Arrow SVG pointing up, rotated to compass heading
  return `<div class="user-location-wrap">
    <div class="user-location-arrow" style="transform:rotate(${heading}deg);">
      <svg width="36" height="36" viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
        <!-- Shadow/glow -->
        <circle cx="18" cy="18" r="12" fill="rgba(66,133,244,0.2)"/>
        <!-- White border circle -->
        <circle cx="18" cy="18" r="10" fill="white"/>
        <!-- Blue fill circle -->
        <circle cx="18" cy="18" r="8.5" fill="#4285f4"/>
        <!-- Direction arrow (points up = north) -->
        <polygon points="18,6 23,20 18,17 13,20" fill="white" opacity="0.95"/>
      </svg>
    </div>
  </div>`;
}

function updateLocationMarkerIcon(){
  if(!locationMarker) return;
  const html = locationIconHtml(compassHeading);
  const icon = L.divIcon({
    className: '',
    html,
    iconSize:   [36, 36],
    iconAnchor: [18, 18]
  });
  locationMarker.setIcon(icon);
}

function setLocateMenuLabel(icon, label){
  const btn = document.getElementById('fab-locate');
  if(!btn) return;
  btn.innerHTML = `<span>${icon}</span><span>${label}</span>`;
}

function locateMe(){
  const btn = document.getElementById('fab-locate');
  if(location.protocol === 'file:'){
    alert('📍 Location unavailable\n\nBrowsers block location access when opening HTML files directly from your computer.\n\nTo use Locate Me, open this file via a shared link instead of double-clicking it locally.');
    return;
  }
  if(!navigator.geolocation){ alert('Geolocation is not supported by your browser.'); return; }

  // Toggle off
  if(watchId !== null){
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
    if(locationMarker){ map.removeLayer(locationMarker); locationMarker = null; }
    if(locationCircle){ map.removeLayer(locationCircle); locationCircle = null; }
    // Remove compass listener
    if(compassHandler){
      window.removeEventListener('deviceorientationabsolute', compassHandler);
      window.removeEventListener('deviceorientation', compassHandler);
      compassHandler = null;
    }
    compassHeading = null;
    btn.classList.remove('locating','located');
    setLocateMenuLabel('📍', 'Locate Me');
    return;
  }

  btn.classList.add('locating');
  setLocateMenuLabel('⏳', 'Locating…');

  // ── Start compass ──
  // DeviceOrientationEvent.requestPermission() required on iOS 13+
  function startCompass(){
    compassHandler = (e) => {
      let heading = null;

      // deviceorientationabsolute gives true north directly
      if(e.absolute && e.alpha !== null){
        heading = (360 - e.alpha) % 360;
      }
      // iOS: webkitCompassHeading is already degrees from true north
      else if(e.webkitCompassHeading !== undefined && e.webkitCompassHeading !== null){
        heading = e.webkitCompassHeading;
      }
      // Fallback: non-absolute alpha (magnetic, not true north — close enough)
      else if(e.alpha !== null){
        heading = (360 - e.alpha) % 360;
      }

      if(heading !== null){
        compassHeading = Math.round(heading);
        updateLocationMarkerIcon();
      }
    };

    // Prefer absolute (true north) event
    window.addEventListener('deviceorientationabsolute', compassHandler, true);
    // Also listen to standard event for broader support
    window.addEventListener('deviceorientation', compassHandler, true);
  }

  // iOS 13+ requires permission for DeviceOrientation
  if(typeof DeviceOrientationEvent !== 'undefined' &&
     typeof DeviceOrientationEvent.requestPermission === 'function'){
    DeviceOrientationEvent.requestPermission()
      .then(state => { if(state === 'granted') startCompass(); })
      .catch(() => {}); // silently skip if denied — dot mode still works
  } else {
    // Android and desktop — no permission prompt needed
    startCompass();
  }

  // ── Start GPS ──
  watchId = navigator.geolocation.watchPosition(
    pos => {
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      const acc = pos.coords.accuracy;

      // If GPS gives us a heading (walking/driving speed) use it when no compass
      if(pos.coords.heading !== null && !isNaN(pos.coords.heading) && compassHeading === null){
        compassHeading = Math.round(pos.coords.heading);
      }

      btn.classList.remove('locating');
      btn.classList.add('located');
      setLocateMenuLabel('✓', 'Located');

      const html = locationIconHtml(compassHeading);
      const icon = L.divIcon({ className:'', html, iconSize:[36,36], iconAnchor:[18,18] });

      if(!locationMarker){
        locationMarker = L.marker([lat, lng], { icon, zIndexOffset:1000 }).addTo(map);
        locationCircle = L.circle([lat, lng], {
          radius: acc, color:'#4285f4', fillColor:'#4285f4',
          fillOpacity:.08, weight:1, opacity:.5
        }).addTo(map);
        map.setView([lat, lng], 15);
      } else {
        locationMarker.setLatLng([lat, lng]);
        locationMarker.setIcon(icon);
        locationCircle.setLatLng([lat, lng]);
        locationCircle.setRadius(acc);
      }
    },
    err => {
      btn.classList.remove('locating');
      setLocateMenuLabel('📍', 'Locate Me');
      watchId = null;
      if(err.code === 1) alert('📍 Location permission denied\n\nTo fix this:\n1. Click the lock/info icon in your browser address bar\n2. Set Location to "Allow"\n3. Reload the page and try again');
      else alert('Could not get your location. Please try again.');
    },
    { enableHighAccuracy:true, timeout:15000, maximumAge:5000 }
  );
}

/* =====================================================
   LEGEND
   ===================================================== */
