/* =====================================================
   PUBLIC MEMBER PROFILES
   ===================================================== */
let ownMemberProfile = null;
let memberProfileReturnFocus = null;

async function fetchMemberProfileJson(url) {
  const response = await fetch(url, {
    method: 'GET',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { Accept: 'application/json' },
  });

  let data = {};
  try { data = await response.json(); } catch { data = {}; }

  if (response.status === 401 && typeof expireLocalSession === 'function') {
    expireLocalSession();
  }
  if (!response.ok) {
    throw new Error(data.error?.message || data.error || `HTTP ${response.status}`);
  }
  return data;
}

function openMemberProfilePanel() {
  const panel = document.getElementById('member-profile-panel');
  if (!panel) return;
  memberProfileReturnFocus = document.activeElement;
  panel.classList.add('open');
  panel.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
}

function closeMemberProfile() {
  const panel = document.getElementById('member-profile-panel');
  if (!panel) return;
  panel.classList.remove('open');
  panel.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
  if (memberProfileReturnFocus && typeof memberProfileReturnFocus.focus === 'function') {
    memberProfileReturnFocus.focus();
  }
  memberProfileReturnFocus = null;
}

function closeMemberProfileFromBackdrop(event) {
  if (event.target === document.getElementById('member-profile-panel')) closeMemberProfile();
}

function showMemberProfileLoading() {
  const content = document.getElementById('member-profile-content');
  if (!content) return;
  content.innerHTML = `
    <div class="member-profile-loading">
      <div class="spinner"></div>
      <div>Loading member profile…</div>
    </div>`;
}

function showMemberProfileError(message) {
  const content = document.getElementById('member-profile-content');
  if (!content) return;
  content.innerHTML = `
    <div class="member-profile-error">
      <span>⚠️</span>
      <div>${esc(message || 'Profile information could not be loaded.')}</div>
    </div>`;
}

async function openOwnProfile() {
  openMemberProfilePanel();
  memberProfileReturnFocus = document.getElementById('app-menu-button') || memberProfileReturnFocus;
  showMemberProfileLoading();
  try {
    const data = ownMemberProfile
      ? { profile: ownMemberProfile }
      : await fetchMemberProfileJson('/api/profile');
    ownMemberProfile = data.profile;
    window.currentMemberProfile = ownMemberProfile;
    if (typeof updateMemberProfileMenuSummary === 'function') {
      updateMemberProfileMenuSummary(ownMemberProfile);
    }
    renderMemberProfile(ownMemberProfile);
  } catch (error) {
    showMemberProfileError(error.message);
  }
}

async function openProfileById(profileId) {
  if (!profileId) return;
  openMemberProfilePanel();
  showMemberProfileLoading();
  try {
    const data = await fetchMemberProfileJson(`/api/profile?id=${encodeURIComponent(profileId)}`);
    renderMemberProfile(data.profile);
  } catch (error) {
    showMemberProfileError(error.message);
  }
}

function normalizeNone(value) {
  const text = String(value || '').trim();
  return !text || text.toLowerCase() === 'none' ? '' : text;
}

function badgeTooltipText(badge) {
  const parts = [];
  if (badge.criteria) parts.push(badge.criteria);
  if (badge.progressText) parts.push(badge.progressText);
  return parts.join(' · ');
}

function renderProfileBadge(badge, index) {
  const tier = String(badge.tier || 'locked').toLowerCase();
  const tierLabel = tier === 'earned'
    ? 'Earned'
    : tier === 'locked'
      ? 'Locked'
      : `${tier.charAt(0).toUpperCase()}${tier.slice(1)}`;
  const tooltip = badgeTooltipText(badge);

  return `
    <div class="mp-badge-item ${esc(tier)}" style="animation-delay:${Math.min(index * 35, 300)}ms" tabindex="0" aria-label="${esc(`${badge.name}: ${tierLabel}. ${tooltip}`)}">
      <span class="mp-badge-emoji">${esc(badge.emoji || '🏅')}</span>
      <span class="mp-badge-name">${esc(badge.name)}</span>
      <span class="mp-badge-tier">${esc(tierLabel)}</span>
      <span class="mp-badge-tooltip">${esc(tooltip)}</span>
    </div>`;
}

function renderMemberProfile(profile) {
  const content = document.getElementById('member-profile-content');
  if (!content || !profile) return;

  const assignmentNumber = normalizeNone(profile.currentAssignment);
  const assignmentName = normalizeNone(profile.assignmentName);
  const assigned = Boolean(assignmentNumber || assignmentName);
  const rankTarget = Math.max(Number(profile.rankTarget || 0), Number(profile.totalSignups || 0));
  const progressPercent = rankTarget > 0
    ? Math.min(100, Math.round((Number(profile.totalSignups || 0) / rankTarget) * 100))
    : 100;
  const classText = profile.certClassOf
    ? `CERT Class of ${profile.certClassOf}`
    : 'Frisco CERT Member';
  const adminText = profile.admin ? ' · Admin' : '';
  const badges = Array.isArray(profile.badges) ? profile.badges : [];

  content.innerHTML = `
    <div class="mp-page">
      <section class="mp-hero">
        <div class="mp-rank-stripe"></div>
        <div class="mp-hero-top">
          <div class="mp-avatar-wrap">
            ${profile.admin ? '<div class="mp-admin-crown" title="CERT Admin">👑</div>' : ''}
            <div class="mp-avatar">${esc(profile.avatar || '🧑‍🚒')}</div>
            <div class="mp-online-dot"></div>
          </div>
          <div class="mp-identity">
            <div class="mp-member-name">${esc(profile.publicName || 'CERT Member')}</div>
            <div class="mp-member-sub">${esc(classText + adminText)}</div>
            <div class="mp-rank-pill">${esc(profile.rankEmoji || '🌱')} ${esc(profile.rankName || 'New')}</div>
          </div>
        </div>
        <div class="mp-stats-row">
          <div class="mp-stat-cell"><span class="mp-stat-value">${Number(profile.totalSignups || 0).toLocaleString()}</span><span class="mp-stat-label">Total Signups</span></div>
          <div class="mp-stat-cell"><span class="mp-stat-value">${Number(profile.uniqueSites || 0).toLocaleString()}</span><span class="mp-stat-label">Unique Sites</span></div>
          <div class="mp-stat-cell"><span class="mp-stat-value">${Number(profile.reportsSubmitted || 0).toLocaleString()}</span><span class="mp-stat-label">Reports</span></div>
        </div>
      </section>

      <div class="mp-section-label">Assignment & Progress</div>
      <div class="mp-mid-row">
        <section class="mp-card">
          <div class="mp-assignment-inner">
            <div class="mp-assignment-number ${assigned ? '' : 'unassigned'}">${esc(assignmentNumber || '—')}</div>
            <div class="mp-assignment-info">
              <div class="mp-assignment-name">${esc(assignmentName || 'No Assignment')}</div>
              <div class="mp-assignment-meta">${assigned ? 'Current siren assignment' : 'Available for assignment'}</div>
              <div class="mp-assignment-status ${assigned ? '' : 'unassigned'}">${assigned ? '✓ Assigned' : 'Unassigned'}</div>
            </div>
          </div>
        </section>
        <section class="mp-card">
          <div class="mp-rank-label-row">
            <span class="mp-rank-current">${esc(profile.rankEmoji || '🌱')} ${esc(profile.rankName || 'New')}</span>
            <span class="mp-rank-next">${profile.nextRank ? `${esc(profile.nextRank)} →` : 'Top Rank'}</span>
          </div>
          <div class="mp-rank-bar-wrap"><div class="mp-rank-bar-fill" style="width:${progressPercent}%"></div></div>
          <div class="mp-rank-progress"><span>${Number(profile.totalSignups || 0)} / ${rankTarget}</span> signups</div>
        </section>
      </div>

      <div class="mp-section-label">Badges</div>
      <div class="mp-badge-grid">
        ${badges.map(renderProfileBadge).join('') || '<div class="member-profile-error">No badge data available.</div>'}
      </div>

      <div class="mp-profile-footer">
        <div class="mp-footer-cert">Frisco <span>C.E.R.T.</span> — Siren Warden Program</div>
      </div>
    </div>`;
}

async function hydrateOwnMemberProfile() {
  if (!window.currentUserProfile) return;
  try {
    const data = await fetchMemberProfileJson('/api/profile');
    ownMemberProfile = data.profile;
    window.currentMemberProfile = ownMemberProfile;
    if (typeof updateMemberProfileMenuSummary === 'function') {
      updateMemberProfileMenuSummary(ownMemberProfile);
    }
  } catch (error) {
    console.warn('Member profile summary could not be loaded:', error.message);
  }
}

function clearMemberProfileState() {
  ownMemberProfile = null;
  window.currentMemberProfile = null;
  closeMemberProfile();
}

window.addEventListener('cert:user-ready', hydrateOwnMemberProfile);

document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && document.getElementById('member-profile-panel')?.classList.contains('open')) {
    closeMemberProfile();
  }
});
