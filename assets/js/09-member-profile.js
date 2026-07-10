/* =====================================================
   PUBLIC MEMBER PROFILES
   ===================================================== */
let ownMemberProfile = null;
let memberProfileReturnFocus = null;
let activeMemberBadges = [];
let memberProfileViewportTracking = false;

function syncMemberProfileViewport() {
  const panel = document.getElementById('member-profile-panel');
  if (!panel) return;
  const viewport = window.visualViewport;
  const height = Math.max(320, Math.round(viewport?.height || window.innerHeight));
  const top = Math.max(0, Math.round(viewport?.offsetTop || 0));
  panel.style.setProperty('--mp-viewport-height', `${height}px`);
  panel.style.setProperty('--mp-viewport-top', `${top}px`);
}

function startMemberProfileViewportTracking() {
  syncMemberProfileViewport();
  if (memberProfileViewportTracking) return;
  window.visualViewport?.addEventListener('resize', syncMemberProfileViewport);
  window.visualViewport?.addEventListener('scroll', syncMemberProfileViewport);
  window.addEventListener('orientationchange', syncMemberProfileViewport);
  window.addEventListener('resize', syncMemberProfileViewport);
  memberProfileViewportTracking = true;
}

function stopMemberProfileViewportTracking() {
  if (!memberProfileViewportTracking) return;
  window.visualViewport?.removeEventListener('resize', syncMemberProfileViewport);
  window.visualViewport?.removeEventListener('scroll', syncMemberProfileViewport);
  window.removeEventListener('orientationchange', syncMemberProfileViewport);
  window.removeEventListener('resize', syncMemberProfileViewport);
  memberProfileViewportTracking = false;
}

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
  startMemberProfileViewportTracking();
  panel.classList.add('open');
  panel.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
  const scroll = document.getElementById('member-profile-content');
  if (scroll) scroll.scrollTop = 0;
  requestAnimationFrame(syncMemberProfileViewport);
}

function closeMemberProfile() {
  const panel = document.getElementById('member-profile-panel');
  if (!panel) return;
  panel.classList.remove('open');
  panel.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
  stopMemberProfileViewportTracking();
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

const PROFILE_BADGE_TIERS = ['bronze', 'silver', 'gold', 'diamond'];

function profileTierLabel(tier) {
  const normalized = String(tier || 'locked').toLowerCase();
  if (normalized === 'earned') return 'Earned';
  if (normalized === 'locked') return 'Locked';
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function profileBadgeProgress(badge) {
  const value = Math.max(0, Number(badge.value || 0));
  const tier = String(badge.tier || 'locked').toLowerCase();
  const thresholds = badge.thresholds || {};
  const currentTierIndex = PROFILE_BADGE_TIERS.indexOf(tier);
  const nextTier = badge.nextTier || PROFILE_BADGE_TIERS.find(name => {
    const target = Number(thresholds[name]);
    return Number.isFinite(target) && value < target;
  }) || null;

  if (!nextTier) {
    return {
      percent: 100,
      value,
      startThreshold: Number(thresholds.diamond || value),
      nextThreshold: null,
      nextTier: null,
      currentTierIndex,
      countText: `${value} complete`,
      statusText: 'All tiers complete',
    };
  }

  const nextThreshold = Math.max(0, Number(thresholds[nextTier] || badge.nextThreshold || 0));
  const startThreshold = currentTierIndex >= 0
    ? Math.max(0, Number(thresholds[PROFILE_BADGE_TIERS[currentTierIndex]] || 0))
    : 0;
  const range = Math.max(1, nextThreshold - startThreshold);
  const percent = Math.max(0, Math.min(100, Math.round(((value - startThreshold) / range) * 100)));

  return {
    percent,
    value,
    startThreshold,
    nextThreshold,
    nextTier,
    currentTierIndex,
    countText: `${value} / ${nextThreshold}`,
    statusText: `${percent}% to ${profileTierLabel(nextTier)}`,
  };
}

function renderTierMarkers(progress) {
  return PROFILE_BADGE_TIERS.map((tier, index) => {
    const state = index <= progress.currentTierIndex
      ? 'complete'
      : tier === progress.nextTier
        ? 'next'
        : '';
    return `<span class="mp-tier-marker ${state}" title="${esc(profileTierLabel(tier))}" aria-hidden="true"></span>`;
  }).join('');
}

function renderTieredProfileBadge(badge, index) {
  const tier = String(badge.tier || 'locked').toLowerCase();
  const tierLabel = profileTierLabel(tier);
  const tooltip = badgeTooltipText(badge);
  const progress = profileBadgeProgress(badge);
  const ringLabel = progress.nextTier ? `${progress.percent}% to ${profileTierLabel(progress.nextTier)}` : 'Diamond complete';

  return `
    <button type="button" class="mp-badge-item mp-tier-medal-card ${esc(tier)}" style="animation-delay:${Math.min(index * 35, 300)}ms" data-badge-index="${index}" aria-expanded="false" aria-label="${esc(`${badge.name}: ${tierLabel}. ${tooltip}`)}" onclick="showProfileBadgeDetail(${index})">
      <span class="mp-medal-wrap" aria-hidden="true">
        <svg class="mp-progress-ring" viewBox="0 0 76 76">
          <circle class="mp-progress-track" cx="38" cy="38" r="33" pathLength="100"></circle>
          <circle class="mp-progress-value" cx="38" cy="38" r="33" pathLength="100" stroke-dasharray="${progress.percent} 100"></circle>
        </svg>
        <span class="mp-medal-core"><span class="mp-badge-emoji">${esc(badge.emoji || '🏅')}</span></span>
        <span class="mp-medal-percent">${progress.nextTier ? `${progress.percent}%` : '◆'}</span>
      </span>
      <span class="mp-badge-name">${esc(badge.name)}</span>
      <span class="mp-badge-tier">${esc(tierLabel)}</span>
      <span class="mp-badge-progress">${esc(progress.countText)}</span>
      <span class="mp-tier-markers" aria-label="${esc(ringLabel)}">${renderTierMarkers(progress)}</span>
      <span class="mp-badge-tooltip">${esc(tooltip)}</span>
    </button>`;
}

function renderMilestoneProfileBadge(badge, index) {
  const unlocked = Boolean(badge.unlocked);
  const state = unlocked ? 'earned' : 'locked';
  const tooltip = badgeTooltipText(badge);

  return `
    <button type="button" class="mp-badge-item mp-ribbon-card ${state}" style="animation-delay:${Math.min(index * 35, 300)}ms" data-badge-index="${index}" aria-expanded="false" aria-label="${esc(`${badge.name}: ${unlocked ? 'Earned' : 'Locked'}. ${tooltip}`)}" onclick="showProfileBadgeDetail(${index})">
      <span class="mp-ribbon-wrap" aria-hidden="true">
        <span class="mp-ribbon-tail left"></span>
        <span class="mp-ribbon-tail right"></span>
        <span class="mp-ribbon-medallion"><span class="mp-badge-emoji">${esc(badge.emoji || '🏅')}</span></span>
        ${unlocked ? '<span class="mp-ribbon-check">✓</span>' : '<span class="mp-ribbon-lock">•</span>'}
      </span>
      <span class="mp-badge-name">${esc(badge.name)}</span>
      <span class="mp-badge-tier">${unlocked ? 'Earned' : 'Locked'}</span>
      <span class="mp-badge-progress">${unlocked ? 'Permanent award' : 'Not earned yet'}</span>
      <span class="mp-badge-tooltip">${esc(tooltip)}</span>
    </button>`;
}

function renderProfileBadge(badge, index) {
  return badge.type === 'milestone'
    ? renderMilestoneProfileBadge(badge, index)
    : renderTieredProfileBadge(badge, index);
}

function positionProfileBadgeTooltip(item) {
  const tooltip = item?.querySelector('.mp-badge-tooltip');
  const scroll = document.getElementById('member-profile-content');
  if (!tooltip || !scroll) return;

  tooltip.classList.remove('tooltip-below');
  requestAnimationFrame(() => {
    const itemRect = item.getBoundingClientRect();
    const scrollRect = scroll.getBoundingClientRect();
    const tooltipRect = tooltip.getBoundingClientRect();
    const needed = tooltipRect.height + 10;
    const spaceAbove = itemRect.top - scrollRect.top;
    const spaceBelow = scrollRect.bottom - itemRect.bottom;
    if (spaceAbove < needed && spaceBelow > spaceAbove) {
      tooltip.classList.add('tooltip-below');
    }
  });
}

function initializeProfileBadgeTooltips() {
  document.querySelectorAll('.mp-badge-item').forEach(item => {
    item.addEventListener('pointerenter', () => positionProfileBadgeTooltip(item));
    item.addEventListener('focus', () => positionProfileBadgeTooltip(item));
    item.addEventListener('touchstart', () => positionProfileBadgeTooltip(item), { passive:true });
  });
}

function closeProfileBadgeDetail() {
  const detail = document.getElementById('mp-badge-detail');
  if (detail) {
    detail.hidden = true;
    detail.innerHTML = '';
  }
  document.querySelectorAll('.mp-badge-item[aria-expanded="true"]').forEach(item => {
    item.setAttribute('aria-expanded', 'false');
    item.classList.remove('selected');
  });
}

function showProfileBadgeDetail(index) {
  const badge = activeMemberBadges[index];
  const detail = document.getElementById('mp-badge-detail');
  if (!badge || !detail) return;

  document.querySelectorAll('.mp-badge-item').forEach(item => {
    const selected = Number(item.dataset.badgeIndex) === index;
    item.setAttribute('aria-expanded', selected ? 'true' : 'false');
    item.classList.toggle('selected', selected);
    if (selected) positionProfileBadgeTooltip(item);
  });

  const tier = String(badge.tier || 'locked').toLowerCase();
  const tierLabel = profileTierLabel(tier);
  let detailBody = '';

  if (badge.type === 'milestone') {
    detailBody = `
      <div class="mp-detail-status ${badge.unlocked ? 'earned' : 'locked'}">${badge.unlocked ? '✓ Award earned' : 'Locked milestone'}</div>
      <div class="mp-detail-copy">${esc(badge.criteria || 'Complete the milestone to unlock this award.')}</div>`;
  } else {
    const progress = profileBadgeProgress(badge);
    const thresholdChips = PROFILE_BADGE_TIERS.map(name => {
      const threshold = badge.thresholds?.[name];
      if (threshold === null || threshold === undefined || threshold === '') return '';
      const reached = progress.value >= Number(threshold);
      return `<span class="mp-threshold-chip ${reached ? 'reached' : ''}"><b>${esc(name.charAt(0).toUpperCase())}</b>${Number(threshold)}</span>`;
    }).join('');
    const nextCopy = progress.nextTier
      ? `Next: ${profileTierLabel(progress.nextTier)} at ${progress.nextThreshold}`
      : 'Diamond tier completed';

    detailBody = `
      <div class="mp-detail-copy">${esc(badge.criteria || 'Complete the activity to advance this medal.')}</div>
      <div class="mp-detail-progress-row"><span>Current: <b>${progress.value}</b></span><span>${esc(nextCopy)}</span></div>
      <div class="mp-detail-progress-track"><span style="width:${progress.percent}%"></span></div>
      <div class="mp-detail-progress-caption">${esc(progress.statusText)}</div>
      <div class="mp-threshold-list" aria-label="Badge thresholds">${thresholdChips}</div>`;
  }

  detail.hidden = false;
  detail.innerHTML = `
    <button type="button" class="mp-detail-close" aria-label="Close badge details" onclick="closeProfileBadgeDetail()">×</button>
    <div class="mp-detail-icon ${esc(tier)}">${esc(badge.emoji || '🏅')}</div>
    <div class="mp-detail-main">
      <div class="mp-detail-title-row"><strong>${esc(badge.name)}</strong><span>${esc(tierLabel)}</span></div>
      ${detailBody}
    </div>`;

  detail.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
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
  activeMemberBadges = badges;

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
      <div id="mp-badge-detail" class="mp-badge-detail" hidden></div>

      <div class="mp-profile-footer">
        <div class="mp-footer-cert">Frisco <span>C.E.R.T.</span> — Siren Warden Program</div>
      </div>
    </div>`;

  initializeProfileBadgeTooltips();
  requestAnimationFrame(syncMemberProfileViewport);
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
  activeMemberBadges = [];
  window.currentMemberProfile = null;
  closeMemberProfile();
}

window.addEventListener('cert:user-ready', hydrateOwnMemberProfile);

document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && document.getElementById('member-profile-panel')?.classList.contains('open')) {
    closeMemberProfile();
  }
});
