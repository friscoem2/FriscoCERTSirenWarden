const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

function loadModule(file, dependencies = {}, globals = {}) {
  const sandbox = {
    module: { exports: {} },
    require(name) {
      if (name in dependencies) return dependencies[name];
      if (name === '../lib/username-lookup-limit') return { checkUsernameLookupLimit: () => ({ allowed: true }) };
      throw new Error(`Unexpected dependency: ${name}`);
    },
    console: { error() {} },
    ...globals,
  };
  vm.runInNewContext(read(file), sandbox, { filename: file });
  return sandbox.module.exports;
}

function response() {
  return {
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = JSON.parse(JSON.stringify(body)); return this; },
  };
}

function client(storage = new Map(), { storageBlocked = false } = {}) {
  const elements = new Map();
  function element(id) {
    if (!elements.has(id)) {
      const classes = new Set();
      elements.set(id, {
        value: '', textContent: '', hidden: false, disabled: false, attributes: {}, children: [], listeners: {},
        classList: {
          add(...values) { values.forEach(value => classes.add(value)); },
          remove(...values) { values.forEach(value => classes.delete(value)); },
          toggle(value, force) { if (force ?? !classes.has(value)) classes.add(value); else classes.delete(value); },
          contains(value) { return classes.has(value); },
        },
        setAttribute(name, value) { this.attributes[name] = value; },
        addEventListener(name, fn) { this.listeners[name] = fn; },
        append(...nodes) { this.children.push(...nodes); },
        focus() { this.focused = true; },
        reportValidity() { return this.valid !== false; },
      });
    }
    return elements.get(id);
  }
  const context = vm.createContext({
    console: { warn() {} },
    localStorage: {
      getItem(key) { if (storageBlocked) throw new Error('Blocked'); return storage.get(key) ?? null; },
      setItem(key, value) { if (storageBlocked) throw new Error('Blocked'); storage.set(key, value); },
    },
    document: { getElementById: element, createElement: () => ({}), addEventListener() {} },
    window: { addEventListener() {}, dispatchEvent() {}, setTimeout() {} },
    CustomEvent: class CustomEvent {},
    setTimeout() { return 1; },
    clearTimeout() {},
    fetch: async () => { throw new Error('Unexpected network request'); },
  });
  vm.runInContext(read('assets/js/01-auth-data-loading.js'), context);
  vm.runInContext('startLoad = () => {};', context);
  return { context, element, storage };
}

test('member records use header names, ignore empty usernames, and reject missing columns', () => {
  const lookup = loadModule('lib/username-lookup.js', { './google-sheets': {} });
  const records = lookup.rowsToUsernameRecords([
    ['\uFEFFEmailAddress ', 'HomePhone', 'Username'],
    [' Member@Example.TEST ', 'private', ' OriginalCase '],
    ['no-user@example.test', 'private', ''],
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(records)), [{ email: 'member@example.test', username: 'OriginalCase' }]);
  assert.throws(() => lookup.rowsToUsernameRecords([['Email'], ['member@example.test']]), /EmailAddress and Username/);
});

test('lookup reads the CERT Members GID, matches full emails without case sensitivity, and caches only minimal records', async () => {
  const calls = [];
  const lookup = loadModule('lib/username-lookup.js', {
    './google-sheets': { async fetchWholeSheetByGid(gid) {
      calls.push(gid);
      return [
        ['FirstName', 'Username', 'EmailAddress', 'CellPhone'],
        ['Private name', 'VolunteerA', 'member@example.test', 'private'],
        ['Private name', 'VolunteerA', 'MEMBER@example.test', 'private'],
        ['Private name', 'VolunteerB', 'member@example.test', 'private'],
        ['Private name', 'Other', 'other@example.test', 'private'],
      ];
    } },
  });
  assert.deepEqual(Array.from(await lookup.findUsernamesByEmail(' MEMBER@EXAMPLE.TEST ')), ['VolunteerA', 'VolunteerB']);
  assert.deepEqual(Array.from(await lookup.findUsernamesByEmail('ember@example.test')), []);
  assert.deepEqual(calls, ['1506659451']);
});

test('public lookup validates requests without reading the member directory', async () => {
  let reads = 0;
  const handler = loadModule('api/find-username.js', {
    '../lib/username-lookup': { async findUsernamesByEmail() { reads++; return []; } },
  });
  const get = response();
  await handler({ method: 'GET' }, get);
  assert.equal(get.statusCode, 405);
  assert.equal(get.headers.Allow, 'POST');
  assert.equal(get.headers['Cache-Control'], 'no-store');
  for (const body of [null, '{bad json', {}, { email: [] }, { email: 'bad' }, { email: 'a'.repeat(255) + '@example.test' }]) {
    const res = response();
    await handler({ method: 'POST', body }, res);
    assert.equal(res.statusCode, 400);
  }
  assert.equal(reads, 0);
});

test('public lookup returns only matched usernames and distinguishes no match from directory failures', async () => {
  for (const match of [true, false, 'error']) {
    const handler = loadModule('api/find-username.js', {
      '../lib/username-lookup': { async findUsernamesByEmail(email) {
        assert.equal(email, 'Member@example.test');
        if (match === 'error') throw new Error('private upstream URL');
        return match ? ['VolunteerA'] : [];
      } },
    });
    const res = response();
    await handler({ method: 'POST', body: JSON.stringify({ email: ' Member@example.test ' }) }, res);
    assert.equal(res.statusCode, match === 'error' ? 503 : 200);
    if (match === 'error') {
      assert.match(res.body.error, /temporarily unavailable/);
      assert.doesNotMatch(JSON.stringify(res.body), /private/);
    } else assert.deepEqual(res.body, { found: match, usernames: match ? ['VolunteerA'] : [] });
  }
});

test('Better Impact HTTP errors are service failures and rejected credentials remain HTTP 401', async () => {
  for (const status of [200, 429, 500, 503]) {
    const handler = loadModule('api/login.js', {
      '../lib/better-impact-auth': { async verifyBetterImpactCredentials() { return { status, authenticated: false }; } },
      '../lib/profile-store': { findProfileByUsername() { assert.fail('Unexpected profile read'); } },
      '../lib/session-token': {},
    });
    const res = response();
    await handler({ method: 'POST', body: { username: 'VolunteerA', password: 'test' } }, res);
    assert.equal(res.statusCode, status === 200 ? 401 : 502);
  }
});

test('failed credentials persist across reloads per normalized username; other errors do not count', async () => {
  const storage = new Map();
  const app = client(storage);
  app.element('login-username').value = ' VolunteerA ';
  app.context.fetch = async () => ({ status: 401, ok: false, json: async () => ({}) });
  for (let i = 0; i < 10; i++) {
    app.element('login-pw').value = 'bad';
    await app.context.submitLogin();
    assert.match(app.element('login-attempts').textContent, new RegExp(`${i + 1} of 10`));
  }
  assert.match(app.element('login-attempts').textContent, /password reset/);
  assert.equal(app.element('login-btn').disabled, false);
  const reloaded = client(storage);
  reloaded.element('login-username').value = 'volunteera';
  reloaded.context.updateLoginAttempts();
  assert.match(reloaded.element('login-attempts').textContent, /10 of 10/);
  reloaded.element('login-username').value = 'VolunteerB';
  reloaded.context.updateLoginAttempts();
  assert.equal(reloaded.element('login-attempts').hidden, true);
  for (const status of [400, 403, 429, 502]) {
    app.element('login-pw').value = 'test';
    app.context.fetch = async () => ({ status, ok: false, json: async () => ({ error: 'Service message' }) });
    await app.context.submitLogin();
    assert.equal(app.context.getLoginAttempts('volunteera'), 10);
  }
  app.element('login-pw').value = 'test';
  app.context.fetch = async () => { throw new Error('Offline'); };
  await app.context.submitLogin();
  assert.equal(app.context.getLoginAttempts('volunteera'), 10);
});

test('successful login clears the counter and password, including when browser storage is blocked', async () => {
  for (const storageBlocked of [false, true]) {
    const app = client(new Map(), { storageBlocked });
    app.element('login-username').value = 'VolunteerA';
    app.element('login-pw').value = 'bad';
    app.context.fetch = async () => ({ status: 401, ok: false, json: async () => ({}) });
    await app.context.submitLogin();
    assert.equal(app.context.getLoginAttempts('VolunteerA'), 1);
    app.element('login-pw').value = 'good';
    app.context.fetch = async () => ({ status: 200, ok: true, json: async () => ({ authenticated: true, username: 'VolunteerA', profile: {} }) });
    await app.context.submitLogin();
    assert.equal(app.context.getLoginAttempts('VolunteerA'), 0);
    assert.equal(app.element('login-attempts').hidden, true);
    assert.equal(app.element('login-pw').value, '');
    assert.equal(app.element('login-screen').classList.contains('hidden'), true);
  }
});

test('username lookup fills the sign in field and renders usernames as text', async () => {
  const app = client();
  app.element('username-lookup-email').value = ' found@example.test ';
  const username = '<img src=x onerror=alert(1)>';
  app.context.fetch = async (url, options) => {
    assert.equal(url, '/api/find-username');
    assert.deepEqual(JSON.parse(options.body), { email: 'found@example.test' });
    return { ok: true, json: async () => ({ found: true, usernames: [username] }) };
  };
  await app.context.submitUsernameLookup();
  assert.equal(app.element('login-username').value, username);
  assert.match(app.element('username-lookup-result').textContent, /<img/);
  assert.equal(app.element('username-lookup-result').children.length, 0);
  assert.equal(app.element('username-lookup-btn').disabled, false);
});

test('no match and unavailable lookup show a clickable support email; multiple usernames are not chosen arbitrarily', async () => {
  for (const result of ['no-match', 'error', 'multiple']) {
    const app = client();
    app.element('username-lookup-email').value = 'member@example.test';
    app.context.fetch = async () => ({
      ok: result !== 'error',
      json: async () => ({ found: result === 'multiple', usernames: result === 'multiple' ? ['First', 'Second'] : [] }),
    });
    await app.context.submitUsernameLookup();
    const el = app.element('username-lookup-result');
    if (result === 'multiple') {
      assert.match(el.textContent, /First, Second/);
      assert.equal(app.element('login-username').value, '');
    } else {
      assert.match(el.textContent, result === 'no-match' ? /No username was found/ : /temporarily unavailable/);
      assert.equal(el.children[1].href, 'mailto:sworden@friscotexas.gov');
    }
  }
});

test('duplicate submissions do not send duplicate credential checks', async () => {
  const app = client();
  app.element('login-username').value = 'VolunteerA';
  app.element('login-pw').value = 'bad';
  let finish;
  let calls = 0;
  app.context.fetch = () => { calls++; return new Promise(resolve => { finish = resolve; }); };
  const pending = app.context.submitLogin();
  await app.context.submitLogin();
  assert.equal(calls, 1);
  finish({ status: 401, ok: false, json: async () => ({}) });
  await pending;
  assert.equal(app.context.getLoginAttempts('VolunteerA'), 1);
});

function lookupLimiterModule(env = {}) {
  return loadModule('lib/username-lookup-limit.js', {
    'node:crypto': require('node:crypto'),
  }, { Buffer, process: { env: { SESSION_SECRET: 'test-secret-used-only-for-lookup-tests-12345', ...env } } });
}

const lookupRequest = (ip = '192.0.2.1', cookie = '') => ({
  method: 'POST', headers: { cookie }, socket: { remoteAddress: ip },
  body: { email: 'member@example.test' },
});

test('three username searches are allowed per IP, and deleting cookies cannot reset that IP counter', () => {
  const limiter = lookupLimiterModule().createUsernameLookupLimiter();
  for (let i = 0; i < 3; i++) assert.equal(limiter(lookupRequest(), response()).allowed, true);
  const blocked = limiter(lookupRequest(), response());
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.retryAfterSeconds > 0 && blocked.retryAfterSeconds <= 900);
  assert.equal(limiter(lookupRequest('192.0.2.2'), response()).allowed, true);
});

test('signed browser counter survives server instance changes and uses a secure HttpOnly cookie', () => {
  const module = lookupLimiterModule();
  let cookie = '';
  for (let i = 0; i < 4; i++) {
    const res = response();
    const result = module.createUsernameLookupLimiter()(lookupRequest('192.0.2.1', cookie), res);
    assert.equal(result.allowed, i < 3);
    assert.match(res.headers['Set-Cookie'], /^__Host-cert_username_lookup=/);
    assert.match(res.headers['Set-Cookie'], /Path=\/; HttpOnly; Secure; SameSite=Lax; Max-Age=/);
    cookie = res.headers['Set-Cookie'].split(';')[0];
  }
});

test('lookup limit expires after 15 minutes and blocked requests do not extend the wait', () => {
  let clock = 1700000000000;
  const limiter = lookupLimiterModule().createUsernameLookupLimiter({ now: () => clock });
  let cookie = '';
  for (let i = 0; i < 3; i++) {
    const res = response();
    limiter(lookupRequest('192.0.2.1', cookie), res);
    cookie = res.headers['Set-Cookie'].split(';')[0];
  }
  clock += 14 * 60 * 1000;
  const blocked = limiter(lookupRequest('192.0.2.1', cookie), response());
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.retryAfterSeconds, 60);
  clock += 60 * 1000;
  assert.equal(limiter(lookupRequest('192.0.2.1', cookie), response()).allowed, true);
});

test('unsigned or altered cookies cannot reset an existing IP limit', () => {
  const limiter = lookupLimiterModule().createUsernameLookupLimiter();
  let cookie;
  for (let i = 0; i < 3; i++) {
    const res = response(); limiter(lookupRequest(), res);
    cookie = res.headers['Set-Cookie'].split(';')[0];
  }
  const altered = cookie.replace(/\.[^.]+$/, '.forged-signature');
  assert.equal(limiter(lookupRequest('192.0.2.1', altered), response()).allowed, false);
  assert.equal(limiter(lookupRequest('192.0.2.1', '__Host-cert_username_lookup=not-json'), response()).allowed, false);
});

test('forwarding headers are ignored off Vercel and the trusted Vercel IP is used on Vercel', () => {
  const local = lookupLimiterModule().createUsernameLookupLimiter();
  for (let i = 0; i < 4; i++) {
    const req = lookupRequest();
    req.headers['x-forwarded-for'] = `192.0.2.${20 + i}`;
    assert.equal(local(req, response()).allowed, i < 3);
  }
  const vercel = lookupLimiterModule({ VERCEL: '1' }).createUsernameLookupLimiter();
  for (let i = 0; i < 4; i++) {
    const req = lookupRequest(`192.0.2.${20 + i}`);
    req.headers['x-vercel-forwarded-for'] = '198.51.100.1';
    assert.equal(vercel(req, response()).allowed, i < 3);
  }
  const different = lookupRequest();
  different.headers['x-vercel-forwarded-for'] = '198.51.100.2';
  assert.equal(vercel(different, response()).allowed, true);
});

test('limiter bounds memory without evicting active limits, and reclaims expired entries', () => {
  let clock = 1700000000000;
  const limiter = lookupLimiterModule().createUsernameLookupLimiter({ now: () => clock, maxClients: 1 });
  assert.equal(limiter(lookupRequest('192.0.2.1'), response()).allowed, true);
  assert.equal(limiter(lookupRequest('192.0.2.2'), response()).allowed, false);
  clock += 900000;
  assert.equal(limiter(lookupRequest('192.0.2.2'), response()).allowed, true);
});

test('limited requests return HTTP 429 and Retry-After before reading the directory, regardless of email', async () => {
  const limit = lookupLimiterModule().createUsernameLookupLimiter();
  let reads = 0;
  const handler = loadModule('api/find-username.js', {
    '../lib/username-lookup-limit': { checkUsernameLookupLimit: limit },
    '../lib/username-lookup': { async findUsernamesByEmail() { reads++; return []; } },
  });
  for (let i = 0; i < 6; i++) {
    const req = lookupRequest(); req.body.email = `person${i}@example.test`;
    const res = response(); await handler(req, res);
    assert.equal(res.statusCode, i < 3 ? 200 : 429);
    if (i >= 3) {
      assert.equal(Number(res.headers['Retry-After']), res.body.retryAfterSeconds);
      assert.deepEqual(Object.keys(res.body).sort(), ['error', 'retryAfterSeconds']);
    }
  }
  assert.equal(reads, 3);
});

test('missing signing configuration fails closed without reading member usernames', async () => {
  const limit = lookupLimiterModule({ SESSION_SECRET: '' }).createUsernameLookupLimiter();
  const handler = loadModule('api/find-username.js', {
    '../lib/username-lookup-limit': { checkUsernameLookupLimit: limit },
    '../lib/username-lookup': { findUsernamesByEmail() { assert.fail('Directory must not be read'); } },
  });
  const res = response(); await handler(lookupRequest(), res);
  assert.equal(res.statusCode, 503);
  assert.doesNotMatch(JSON.stringify(res.body), /SESSION_SECRET/);
});

test('rate limited lookup shows the remaining wait and support link without claiming no match', async () => {
  const app = client(); app.element('username-lookup-email').value = 'member@example.test';
  app.context.fetch = async () => ({ status: 429, ok: false, json: async () => ({ retryAfterSeconds: 120 }) });
  await app.context.submitUsernameLookup();
  const el = app.element('username-lookup-result');
  assert.match(el.textContent, /Too many username searches/);
  assert.match(el.textContent, /wait 2 minutes/);
  assert.doesNotMatch(el.textContent, /No username/);
  assert.equal(el.children[1].href, 'mailto:sworden@friscotexas.gov');
  assert.equal(app.element('username-lookup-btn').disabled, false);
});
