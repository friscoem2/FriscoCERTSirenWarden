/* =====================================================
   NATIVE CERT FORMS
   Sign-up, siren report, and suggestion submission UI.
   ===================================================== */
(() => {
  const FORM_ENDPOINT = '/api/forms';
  let formState = { type: '', siren: null, submitting: false };

  const SIREN_DAMAGE_OPTIONS = [
    'Physical damage to the siren housing',
    'Visible leaning or misalignment',
    'Missing, loose, or broken components',
    'Graffiti or vandalism',
    'Bird nests or animal activity',
    'Corrosion or rust',
    'Wiring or electrical components exposed',
    'Siren appears unstable or unsafe',
  ];

  const SITE_DAMAGE_OPTIONS = [
    'Cracked or damaged concrete pad',
    'Leaning pole or support structure',
    'Erosion or ground instability',
    'Obstructions around the siren (vegetation, debris, etc.)',
    'Graffiti or vandalism in the area',
    'Damaged fencing, signage, or nearby structures',
    'Bird nests or animal activity',
    'Flooding, standing water, or drainage issues',
  ];

  const SUGGESTION_TYPES = [
    ['bug', 'Bug / Something not working', 'Something is broken or behaving unexpectedly.'],
    ['improvement', 'Improvement idea', 'A better way to handle something that already exists.'],
    ['feature', 'New feature request', 'Something new you would like the app to do.'],
    ['map', 'Map / siren information issue', 'Incorrect location, status, name, or siren information.'],
    ['process', 'Sign-up or reporting process', 'Feedback about volunteering or submitting reports.'],
  ];

  const SYSTEM_AREAS = [
    'Login screen',
    'Main map',
    'Siren popup',
    'Volunteer sign-up form',
    'Report form',
    'Leaderboard',
    'Weather',
    'Mobile layout',
    "I don't know!",
  ];

  const IMPORTANCE_OPTIONS = [
    ['nice', 'Nice to have 😄'],
    ['helpful', 'Helpful 🙏'],
    ['important', 'Important ❗'],
    ['urgent', 'Urgent 🚨'],
  ];

  function htmlEscape(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function currentProfile() {
    return window.currentUserProfile || {};
  }

  function profileName(profile = currentProfile()) {
    const first = String(profile.FirstName || profile['First Name'] || '').trim();
    const last = String(profile.LastName || profile['Last Name'] || '').trim();
    const combined = `${first} ${last}`.trim();
    return combined || String(profile.Name || profile['Public Name'] || profile.Username || 'CERT Volunteer').trim();
  }

  function profileEmail(profile = currentProfile()) {
    return String(profile.EmailAddress || profile.Email || profile['Email Address'] || '').trim();
  }

  function profileUsername(profile = currentProfile()) {
    return String(profile.Username || '').trim();
  }

  function findSiren(sirenId, sirenName = '') {
    const target = String(sirenId ?? '').trim();
    const source = Array.isArray(window.allSirens) ? window.allSirens : (typeof allSirens !== 'undefined' ? allSirens : []);
    const match = source.find(item => String(item.id ?? '').trim() === target);
    return match || {
      id: target,
      friendlyName: String(sirenName || '').trim() || `Siren #${target}`,
      currentSignup: '',
    };
  }

  function normalizedEmail(value) {
    return String(value || '').trim().toLowerCase();
  }

  function canCurrentUserReport(sirenOrId) {
    const siren = typeof sirenOrId === 'object' && sirenOrId
      ? sirenOrId
      : findSiren(sirenOrId);
    const memberEmail = normalizedEmail(profileEmail());
    const assignedEmail = normalizedEmail(siren?.currentSignup);
    return Boolean(memberEmail && assignedEmail && memberEmail === assignedEmail);
  }

  function summaryCards(siren, options = {}) {
    const profile = currentProfile();
    const name = profileName(profile);
    const email = profileEmail(profile) || 'No email on CERT Members profile';
    const sirenLabel = siren
      ? `Siren #${htmlEscape(siren.id)} — ${htmlEscape(siren.friendlyName || siren.systemName || 'Unnamed Siren')}`
      : '';

    return `
      <div class="native-form-card">
        <span class="native-form-card-label">Signed-in volunteer</span>
        <div class="native-profile-summary">
          <span class="native-summary-icon">👤</span>
          <span class="native-summary-copy">
            <span class="native-summary-primary">${htmlEscape(name)}</span>
            <span class="native-summary-secondary">${htmlEscape(email)}</span>
          </span>
          <span class="native-trusted-pill">✓ Profile verified</span>
        </div>
      </div>
      ${siren ? `
      <div class="native-form-card">
        <span class="native-form-card-label">Selected warning siren</span>
        <div class="native-siren-summary">
          <span class="native-summary-icon">🚨</span>
          <span class="native-summary-copy">
            <span class="native-summary-primary">${sirenLabel}</span>
            <span class="native-summary-secondary">${htmlEscape(options.sirenNote || 'Selected from the map')}</span>
          </span>
        </div>
      </div>` : ''}`;
  }

  function setHeading(icon, kicker, title, subtitle) {
    document.getElementById('native-form-icon').textContent = icon;
    document.getElementById('native-form-kicker').textContent = kicker;
    document.getElementById('native-form-title').textContent = title;
    document.getElementById('native-form-subtitle').textContent = subtitle;
  }

  function openModal() {
    const modal = document.getElementById('native-form-modal');
    updateNativeFormViewport();
    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    if (typeof closeAppMenu === 'function') closeAppMenu(false);
    requestAnimationFrame(() => {
      const scroll = document.getElementById('native-form-scroll');
      if (scroll) scroll.scrollTop = 0;
    });
  }

  function closeNativeForm(options = {}) {
    if (formState.submitting && !options.force) return;
    const modal = document.getElementById('native-form-modal');
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
    formState = { type: '', siren: null, submitting: false };
    if (options.refresh !== false && typeof softRefresh === 'function') softRefresh();
  }

  function closeNativeFormFromBackdrop(event) {
    if (event.target === document.getElementById('native-form-modal')) closeNativeForm({ refresh: false });
  }

  function openSignupForm(sirenId, sirenName = '') {
    const siren = findSiren(sirenId, sirenName);
    formState = { type: 'signup', siren, submitting: false };
    setHeading('🙋', 'Volunteer sign-up', `Siren #${siren.id}`, siren.friendlyName || 'Outdoor warning siren');

    document.getElementById('native-form-scroll').innerHTML = `
      <form class="native-form-inner" data-form-type="signup" onsubmit="submitNativeForm(event)" novalidate>
        <div class="native-form-intro">
          You are volunteering to observe <strong>Siren #${htmlEscape(siren.id)}</strong>. Your name and email come directly from your CERT Members profile, so you do not need to enter them again.
        </div>
        ${summaryCards(siren, { sirenNote: 'This siren will be tied to your account for reporting.' })}
        <div class="native-form-section">
          <div class="native-form-section-title">Before you submit</div>
          <p class="native-form-help">Your submission will reserve this siren under your logged-in account. The siren ID and username are also stored behind the scenes so future reports can be matched correctly.</p>
          <div class="native-check-row">
            <input id="signup-confirm" name="confirm" type="checkbox" required>
            <label for="signup-confirm"><span class="native-check-mark"></span><span>I confirm that I intend to observe this siren during the scheduled test.</span></label>
          </div>
        </div>
        ${formErrorBlock()}
        ${submitActions('Sign Up for This Siren', '🙋')}
      </form>`;
    openModal();
  }

  function todayLocalDate() {
    const now = new Date();
    const offset = now.getTimezoneOffset() * 60000;
    return new Date(now.getTime() - offset).toISOString().slice(0, 10);
  }

  function damageCheckboxes(groupName, options) {
    return options.map((option, index) => {
      const id = `${groupName}-${index}`;
      return `<div class="native-check-row">
        <input id="${id}" name="${groupName}" type="checkbox" value="${htmlEscape(option)}">
        <label for="${id}"><span class="native-check-mark"></span><span>${htmlEscape(option)}</span></label>
      </div>`;
    }).join('');
  }

  function openReportForm(sirenId, sirenName = '') {
    const siren = findSiren(sirenId, sirenName);
    if (!canCurrentUserReport(siren)) {
      showTransientFormError(
        'This report is limited to the volunteer currently assigned to this siren. Open the siren assigned to your CERT profile and try again.'
      );
      return;
    }

    formState = { type: 'report', siren, submitting: false };
    setHeading('📋', 'Siren observation', `Report Siren #${siren.id}`, siren.friendlyName || 'Outdoor warning siren');
    document.getElementById('native-form-scroll').innerHTML = `
      <form class="native-form-inner" data-form-type="report" onsubmit="submitNativeForm(event)" novalidate>
        <div class="native-form-intro">
          Submit what you observed during the scheduled noon test. Your identity and assigned siren are verified from your active login session.
        </div>
        ${summaryCards(siren, { sirenNote: 'Verified as your current assignment' })}

        <div class="native-form-section">
          <div class="native-form-section-title">Test observation</div>
          <div class="native-field">
            <label class="native-field-label" for="report-date">What day is your observation? <span class="native-required">*</span></label>
            <input class="native-input" id="report-date" name="observationDate" type="date" value="${todayLocalDate()}" required>
          </div>
          <div class="native-field">
            <span class="native-field-label">Did you hear the siren during the test at noon? <span class="native-required">*</span></span>
            <div class="native-segmented" style="--segment-count:3">
              <input id="heard-yes" type="radio" name="heardSiren" value="Yes" required><label for="heard-yes">🔊 Yes</label>
              <input id="heard-no" type="radio" name="heardSiren" value="No"><label for="heard-no">🔇 No</label>
              <input id="heard-unsure" type="radio" name="heardSiren" value="Unsure"><label for="heard-unsure">🤔 Unsure</label>
            </div>
          </div>
        </div>

        <div class="native-form-section">
          <div class="native-form-section-title">Damage and abnormalities</div>
          <p class="native-form-help">Include anything unusual about the siren equipment or the surrounding site.</p>
          <div class="native-field">
            <span class="native-field-label">Did you see any damage, vandalism, or abnormalities? <span class="native-required">*</span></span>
            <div class="native-segmented">
              <input id="damage-no" type="radio" name="damageOverall" value="No" required onchange="toggleDamageDetails(false)"><label for="damage-no">✅ No issues</label>
              <input id="damage-yes" type="radio" name="damageOverall" value="Yes" onchange="toggleDamageDetails(true)"><label for="damage-yes">⚠️ Yes</label>
            </div>
          </div>

          <div id="native-damage-groups" class="native-damage-groups is-hidden">
            <div class="native-subsection">
              <div class="native-subsection-title">Issues with the siren itself</div>
              <div class="native-check-list">${damageCheckboxes('sirenDamage', SIREN_DAMAGE_OPTIONS)}</div>
              <div class="native-field" style="margin-top:9px">
                <label class="native-field-label" for="siren-damage-other">Other siren issue</label>
                <input class="native-input" id="siren-damage-other" name="sirenDamageOther" type="text" maxlength="250" placeholder="Describe another issue">
              </div>
            </div>
            <div class="native-subsection">
              <div class="native-subsection-title">Issues with the surrounding site</div>
              <div class="native-check-list">${damageCheckboxes('siteDamage', SITE_DAMAGE_OPTIONS)}</div>
              <div class="native-field" style="margin-top:9px">
                <label class="native-field-label" for="site-damage-other">Other site issue</label>
                <input class="native-input" id="site-damage-other" name="siteDamageOther" type="text" maxlength="250" placeholder="Describe another issue">
              </div>
            </div>
          </div>
        </div>
        ${formErrorBlock()}
        ${submitActions('Submit Siren Report', '📋')}
      </form>`;
    openModal();
  }

  function suggestionChoices(name, options, extraClass = '') {
    return `<div class="native-choice-grid ${extraClass}">` + options.map(([value, title, note], index) => {
      const id = `${name}-${index}`;
      return `<div class="native-choice">
        <input id="${id}" type="radio" name="${name}" value="${htmlEscape(value)}" required>
        <label for="${id}"><span class="native-choice-mark"></span><span><span class="native-choice-title">${htmlEscape(title)}</span>${note ? `<span class="native-choice-note">${htmlEscape(note)}</span>` : ''}</span></label>
      </div>`;
    }).join('') + '</div>';
  }

  function openSuggestionBox() {
    const profile = currentProfile();
    formState = { type: 'suggestion', siren: null, submitting: false };
    setHeading('🗳️', 'Help improve the app', 'Have a Suggestion?', 'Ideas, issues, and feature requests');
    document.getElementById('native-form-scroll').innerHTML = `
      <form class="native-form-inner" data-form-type="suggestion" onsubmit="submitNativeForm(event)" novalidate>
        <div class="native-form-intro">
          We’d love your feedback. If you have an idea, notice something confusing, or want to suggest a feature, submit it here. Your input helps us improve the Frisco Outdoor Warning Siren Map.
        </div>

        <div class="native-form-section">
          <div class="native-form-section-title">Your information</div>
          <p class="native-form-help">These fields are prefilled from your profile, but both are optional. Clear them to submit without including your name or email.</p>
          <div class="native-field">
            <label class="native-field-label" for="suggestion-name">Name <span class="native-optional">(Optional)</span></label>
            <input class="native-input" id="suggestion-name" name="name" type="text" maxlength="160" value="${htmlEscape(profileName(profile))}" autocomplete="name">
          </div>
          <div class="native-field">
            <label class="native-field-label" for="suggestion-email">Email <span class="native-optional">(Optional)</span></label>
            <input class="native-input" id="suggestion-email" name="email" type="email" maxlength="254" value="${htmlEscape(profileEmail(profile))}" autocomplete="email">
          </div>
        </div>

        <div class="native-form-section">
          <div class="native-form-section-title">Suggestion type</div>
          ${suggestionChoices('suggestionType', SUGGESTION_TYPES)}
        </div>

        <div class="native-form-section">
          <div class="native-form-section-title">Part of the system</div>
          ${suggestionChoices('systemArea', SYSTEM_AREAS.map(value => [value, value, '']), 'two-column')}
        </div>

        <div class="native-form-section">
          <div class="native-form-section-title">Your suggestion</div>
          <div class="native-field">
            <label class="native-field-label" for="suggestion-text">What would you like us to know? <span class="native-required">*</span></label>
            <textarea class="native-textarea" id="suggestion-text" name="suggestion" maxlength="3000" required placeholder="Describe the issue, idea, or feature request…"></textarea>
          </div>
        </div>

        <div class="native-form-section">
          <div class="native-form-section-title">Importance</div>
          ${suggestionChoices('importance', IMPORTANCE_OPTIONS.map(([value, title]) => [value, title, '']), 'two-column')}
        </div>
        ${formErrorBlock()}
        ${submitActions('Send Suggestion', '🗳️')}
      </form>`;
    openModal();
  }

  function formErrorBlock() {
    return '<div class="native-form-error" id="native-form-error" role="alert" aria-live="polite"></div>';
  }

  function submitActions(label, icon) {
    return `<div class="native-form-actions"><button class="native-submit-button" id="native-submit-button" type="submit"><span>${icon}</span><span>${htmlEscape(label)}</span></button></div>`;
  }

  function toggleDamageDetails(show) {
    const element = document.getElementById('native-damage-groups');
    if (element) element.classList.toggle('is-hidden', !show);
  }

  function checkedValues(form, name) {
    return Array.from(form.querySelectorAll(`input[name="${name}"]:checked`)).map(input => input.value);
  }

  function selectedValue(form, name) {
    return form.querySelector(`input[name="${name}"]:checked`)?.value || '';
  }

  function buildPayload(form, type) {
    if (type === 'signup') {
      return {
        formType: 'signup',
        sirenId: String(formState.siren?.id || ''),
        sirenName: String(formState.siren?.friendlyName || ''),
      };
    }

    if (type === 'report') {
      const sirenDamage = checkedValues(form, 'sirenDamage');
      const siteDamage = checkedValues(form, 'siteDamage');
      const sirenOther = String(form.elements.sirenDamageOther?.value || '').trim();
      const siteOther = String(form.elements.siteDamageOther?.value || '').trim();
      if (sirenOther) sirenDamage.push(`Other: ${sirenOther}`);
      if (siteOther) siteDamage.push(`Other: ${siteOther}`);

      const damageOverall = selectedValue(form, 'damageOverall');
      if (damageOverall === 'Yes' && !sirenDamage.length && !siteDamage.length) {
        throw new Error('Select at least one siren or site issue, or describe it in an Other field.');
      }

      return {
        formType: 'report',
        sirenId: String(formState.siren?.id || ''),
        sirenName: String(formState.siren?.friendlyName || ''),
        observationDate: String(form.elements.observationDate?.value || ''),
        heardSiren: selectedValue(form, 'heardSiren'),
        damageOverall,
        sirenDamage,
        siteDamage,
      };
    }

    if (type === 'suggestion') {
      return {
        formType: 'suggestion',
        name: String(form.elements.name?.value || '').trim(),
        email: String(form.elements.email?.value || '').trim(),
        suggestionType: selectedValue(form, 'suggestionType'),
        systemArea: selectedValue(form, 'systemArea'),
        suggestion: String(form.elements.suggestion?.value || '').trim(),
        importance: selectedValue(form, 'importance'),
      };
    }

    throw new Error('Unknown form type.');
  }

  function showFormError(message) {
    const error = document.getElementById('native-form-error');
    if (!error) return;
    error.textContent = message;
    error.classList.add('visible');
    error.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function clearFormError() {
    const error = document.getElementById('native-form-error');
    if (!error) return;
    error.textContent = '';
    error.classList.remove('visible');
  }

  async function submitNativeForm(event) {
    event.preventDefault();
    const form = event.currentTarget;
    if (formState.submitting) return;
    clearFormError();

    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }

    let payload;
    try {
      payload = buildPayload(form, form.dataset.formType);
    } catch (error) {
      showFormError(error.message || 'Please review the form before submitting.');
      return;
    }

    const button = document.getElementById('native-submit-button');
    const originalButtonHtml = button?.innerHTML || '';
    formState.submitting = true;
    if (button) {
      button.disabled = true;
      button.innerHTML = '<span>⏳</span><span>Submitting…</span>';
    }

    try {
      const response = await fetch(FORM_ENDPOINT, {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(payload),
      });

      let data = {};
      try { data = await response.json(); } catch { data = {}; }

      if (response.status === 401) {
        if (typeof expireLocalSession === 'function') expireLocalSession();
        throw new Error('Your login session expired. Please log in and submit again.');
      }
      if (!response.ok) {
        throw new Error(data.error?.message || data.error || `Submission failed with HTTP ${response.status}.`);
      }

      showFormSuccess(form.dataset.formType, data);
    } catch (error) {
      showFormError(error.message || 'The form could not be submitted. Please try again.');
      formState.submitting = false;
      if (button) {
        button.disabled = false;
        button.innerHTML = originalButtonHtml;
      }
    }
  }

  function showFormSuccess(type, data) {
    const messages = {
      signup: ['You’re Signed Up!', `Siren #${htmlEscape(formState.siren?.id || '')} is now linked to your submission. The map may take a moment to reflect the new assignment.`],
      report: ['Report Submitted', 'Thank you. Your observation was added to the siren report sheet.'],
      suggestion: ['Suggestion Sent', 'Thank you for helping improve the Frisco Outdoor Warning Siren Map.'],
    };
    const [title, message] = messages[type] || ['Submitted', 'Your response was received.'];
    document.getElementById('native-form-scroll').innerHTML = `
      <div class="native-form-inner">
        <div class="native-form-success">
          <div class="native-success-icon">✓</div>
          <h3>${title}</h3>
          <p>${message}</p>
          <button class="native-success-close" type="button" onclick="closeNativeForm({force:true})">Return to Map</button>
        </div>
      </div>`;
    formState.submitting = false;
  }

  function showTransientFormError(message) {
    formState = { type: 'error', siren: null, submitting: false };
    setHeading('🔒', 'Report access', 'Assignment Required', 'Reports are tied to the signed-in volunteer');
    document.getElementById('native-form-scroll').innerHTML = `
      <div class="native-form-inner">
        <div class="native-form-success">
          <div class="native-success-icon" style="background:#fff7ed;border-color:#fed7aa;color:#c2410c">!</div>
          <h3 style="color:#9a3412">Not Your Assignment</h3>
          <p>${htmlEscape(message)}</p>
          <button class="native-success-close" type="button" onclick="closeNativeForm({force:true,refresh:false})">Return to Map</button>
        </div>
      </div>`;
    openModal();
  }

  function updateNativeFormViewport() {
    const modal = document.getElementById('native-form-modal');
    if (!modal) return;
    const viewport = window.visualViewport;
    const height = viewport ? viewport.height : window.innerHeight;
    const top = viewport ? viewport.offsetTop : 0;
    modal.style.setProperty('--native-form-height', `${Math.round(height)}px`);
    modal.style.setProperty('--native-form-top', `${Math.round(top)}px`);
  }

  window.openForm = openSignupForm;
  window.openSignupForm = openSignupForm;
  window.openReportForm = openReportForm;
  window.openSuggestionBox = openSuggestionBox;
  window.closeNativeForm = closeNativeForm;
  window.closeNativeFormFromBackdrop = closeNativeFormFromBackdrop;
  window.submitNativeForm = submitNativeForm;
  window.toggleDamageDetails = toggleDamageDetails;
  window.canCurrentUserReport = canCurrentUserReport;
  window.updateNativeFormViewport = updateNativeFormViewport;

  window.addEventListener('resize', updateNativeFormViewport);
  window.addEventListener('orientationchange', () => setTimeout(updateNativeFormViewport, 180));
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', updateNativeFormViewport);
    window.visualViewport.addEventListener('scroll', updateNativeFormViewport);
  }

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && document.getElementById('native-form-modal')?.classList.contains('open')) {
      closeNativeForm({ refresh: false });
    }
  });
})();
