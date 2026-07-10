/* =====================================================
   LOGGED-IN USER + LEFT NAVIGATION DRAWER
   ===================================================== */
let appMenuOpen = false;
let appMenuReturnFocus = null;

function getProfileField(profile, ...names) {
  if (!profile || typeof profile !== 'object') return '';
  for (const name of names) {
    const exact = profile[name];
    if (exact !== undefined && exact !== null && String(exact).trim()) {
      return String(exact).trim();
    }
    const key = Object.keys(profile).find(k => k.toLowerCase() === name.toLowerCase());
    if (key && profile[key] !== undefined && profile[key] !== null && String(profile[key]).trim()) {
      return String(profile[key]).trim();
    }
  }
  return '';
}

function updateLoggedInUserUI(profile) {
  const firstName = getProfileField(profile, 'FirstName', 'First Name') || 'Volunteer';
  const lastName = getProfileField(profile, 'LastName', 'Last Name');
  const username = getProfileField(profile, 'Username');
  const email = getProfileField(profile, 'EmailAddress', 'Email Address', 'Email');
  const fullName = [firstName, lastName].filter(Boolean).join(' ');
  const initials = `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase() || 'V';

  const greeting = document.getElementById('header-greeting');
  const hello = document.getElementById('app-user-hello');
  const name = document.getElementById('app-user-name');
  const usernameEl = document.getElementById('app-user-username');
  const emailEl = document.getElementById('app-user-email');
  const avatar = document.getElementById('app-user-avatar');

  if (greeting) greeting.textContent = `Hello, ${firstName}`;
  if (hello) hello.textContent = `Hello, ${firstName}`;
  if (name) name.textContent = fullName || 'Volunteer Profile';
  if (usernameEl) usernameEl.textContent = username ? `Username: ${username}` : '';
  if (emailEl) emailEl.textContent = email;
  if (avatar) avatar.textContent = initials;
}

function clearLoggedInUserUI() {
  const greeting = document.getElementById('header-greeting');
  const hello = document.getElementById('app-user-hello');
  const name = document.getElementById('app-user-name');
  const usernameEl = document.getElementById('app-user-username');
  const emailEl = document.getElementById('app-user-email');
  const avatar = document.getElementById('app-user-avatar');

  if (greeting) greeting.textContent = 'Welcome';
  if (hello) hello.textContent = 'Hello, Volunteer';
  if (name) name.textContent = 'Volunteer Profile';
  if (usernameEl) usernameEl.textContent = '';
  if (emailEl) emailEl.textContent = '';
  if (avatar) avatar.textContent = 'V';
  closeAppMenu(false);
}

function openAppMenu() {
  if (!window.currentUserProfile) return;
  const backdrop = document.getElementById('app-menu-backdrop');
  const button = document.getElementById('app-menu-button');
  if (!backdrop || !button) return;

  appMenuReturnFocus = document.activeElement;
  appMenuOpen = true;
  backdrop.classList.add('open');
  backdrop.setAttribute('aria-hidden', 'false');
  button.setAttribute('aria-expanded', 'true');

  window.setTimeout(() => {
    const closeButton = backdrop.querySelector('.app-menu-close');
    if (closeButton) closeButton.focus();
  }, 80);
}

function closeAppMenu(restoreFocus = true) {
  const backdrop = document.getElementById('app-menu-backdrop');
  const button = document.getElementById('app-menu-button');
  if (!backdrop || !button) return;

  appMenuOpen = false;
  backdrop.classList.remove('open');
  backdrop.setAttribute('aria-hidden', 'true');
  button.setAttribute('aria-expanded', 'false');

  if (restoreFocus && appMenuReturnFocus && typeof appMenuReturnFocus.focus === 'function') {
    appMenuReturnFocus.focus();
  }
  appMenuReturnFocus = null;
}

function closeAppMenuFromBackdrop(event) {
  if (event.target === document.getElementById('app-menu-backdrop')) closeAppMenu();
}

function runAppMenuAction(action) {
  closeAppMenu(false);
  if (typeof action === 'function') action();
}

document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && appMenuOpen) closeAppMenu();
});
