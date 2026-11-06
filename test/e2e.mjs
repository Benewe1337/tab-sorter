// End-to-end test: real Chromium browser, throwaway profile, extension loaded
// unpacked. Drives the options UI like a user, checks grouping, pause,
// interval and the CLI page, and writes screenshots to docs/.
// Usage: npm run test:e2e
//   BROWSER_BIN=/path/to/chromium-binary   other browser (default: Brave on macOS)
//   SCREENSHOT_DIR=…                        where screenshots go (default: docs/)
//   E2E_LANG=de                             UI language (default: en)
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchBrowser, attach, waitFor, sleep } from './cdp.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const EXT_ID = 'caijclkncckacdfoedpobdbopbaeomda';
const BASE = `chrome-extension://${EXT_ID}`;
const shotDir = process.env.SCREENSHOT_DIR ?? join(root, 'docs');
mkdirSync(shotDir, { recursive: true });

const browser = launchBrowser({
  binary: process.env.BROWSER_BIN ?? '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
  extensionDir: join(root, 'extension'),
  port: 9334,
  lang: process.env.E2E_LANG ?? 'en',
});

const step = (text) => console.log(`✓ ${text}`);
const findTarget = (pred, what) => waitFor(async () => (await browser.targets()).find(pred), what);

const snapshot = `(async () => {
  const groups = await chrome.tabGroups.query({});
  const tabs = await chrome.tabs.query({});
  return tabs.map(t => ({ id: t.id, url: t.url || t.pendingUrl,
    group: groups.find(g => g.id === t.groupId)?.title ?? null }));
})()`;
const groupOf = (tabs, needle) => tabs.find((t) => t.url?.includes(needle))?.group;

const screenshot = async (page, file, { width, height, scheme }) => {
  // background tabs pause CSS transitions, which would freeze the old theme
  await page.send('Page.bringToFront');
  await page.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile: false });
  await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] });
  await page.evaluate('document.activeElement?.blur(); window.scrollTo(0, 0)');
  await sleep(400);
  const { data } = await page.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(shotDir, file), Buffer.from(data, 'base64'));
};

let worker;
let options;
let popup;
try {
  const loadedVia = await browser.ensureExtension(EXT_ID);
  worker = await attach((await findTarget(
    (t) => t.type === 'service_worker' && t.url.startsWith(BASE), 'service worker')).webSocketDebuggerUrl);
  step(`extension loaded (via ${loadedVia === 'flag' ? '--load-extension' : 'CDP Extensions.loadUnpacked'})`);

  // --- fresh install opens the options page with the empty state
  const optionsTarget = await findTarget((t) => t.type === 'page' && t.url === `${BASE}/ui/options.html`, 'options page on install');
  options = await attach(optionsTarget.webSocketDebuggerUrl);
  await waitFor(() => options.evaluate(`!document.querySelector('#empty').hidden`), 'empty state');
  const stored = await worker.evaluate(`chrome.storage.local.get('config').then(r => r.config)`);
  assert.deepEqual(stored.groups, []);
  assert.equal(stored.settings.intervalMinutes, 5);
  step('fresh install: options page opens, empty config stored');

  // --- create a group by hand through the UI
  await options.evaluate(`(() => {
    document.querySelector('#add-group').click();
    const drawer = document.querySelector('.drawer:last-child');
    const title = drawer.querySelector('[data-role="title"]');
    title.value = 'Testgruppe';
    title.dispatchEvent(new Event('input', { bubbles: true }));
    drawer.querySelector('input[value="orange"]').click();
    const add = (text) => {
      const input = document.querySelector('.drawer:last-child [data-role="pattern"]');
      input.value = text;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    };
    add('example.com');
    add('title:/(/');          // invalid: must be rejected with a hint
  })()`);
  const hint = await options.evaluate(`document.querySelector('.drawer:last-child [data-role="hint"]').textContent`);
  assert.match(hint, /Ungültig|Invalid/);
  const chips = await options.evaluate(`[...document.querySelectorAll('.drawer:last-child .chip .val')].map(c => c.textContent)`);
  assert.deepEqual(chips, ['example.com']);
  await waitFor(async () => {
    const c = await worker.evaluate(`chrome.storage.local.get('config').then(r => r.config)`);
    return c.groups[0]?.title === 'Testgruppe' && c.groups[0].color === 'orange' && c.groups[0].patterns.join() === 'example.com';
  }, 'UI change saved to storage');
  step('group created in UI (title, color, pattern); invalid pattern rejected; saved');

  // --- load a preset through the empty-state/preset button flow: delete then preset
  await options.evaluate(`document.querySelector('.drawer [data-role="delete"]').click()`);
  await waitFor(() => options.evaluate(`!document.querySelector('#empty').hidden`), 'empty after delete');
  // an edit made while the undo toast is visible must survive the undo
  await options.evaluate(`document.querySelector('#set-navigate').click()`);
  await options.evaluate(`document.querySelector('#toast button').click()`); // undo
  await waitFor(() => options.evaluate(`document.querySelectorAll('.drawer').length === 1`), 'undo restores group');
  await waitFor(async () => {
    const c = await worker.evaluate(`chrome.storage.local.get('config').then(r => r.config)`);
    return c.groups.length === 1 && c.settings.sortOnNavigate === false;
  }, 'undo keeps later settings edit');
  assert.equal(await options.evaluate(`document.querySelector('#set-navigate').checked`), false);
  await options.evaluate(`document.querySelector('#set-navigate').click()`); // back on for the rest of the test
  await sleep(500);

  // typing is not disturbed by background tab updates
  await options.evaluate(`(() => { const i = document.querySelector('.drawer [data-role="pattern"]');
    i.focus(); i.value = 'half-typed'; })()`);
  await worker.evaluate(`chrome.tabs.create({ url: 'https://example.org/', active: false })`);
  await sleep(1500);
  assert.equal(await options.evaluate(`document.activeElement.value`), 'half-typed');
  await options.evaluate(`document.activeElement.value = ''`);
  step('undo only reverts its own change; background tab updates do not disturb typing');
  await options.evaluate(`document.querySelector('.drawer [data-role="delete"]').click()`);
  await options.evaluate(`document.querySelectorAll('#preset-buttons button')[0].click()`);
  await waitFor(async () => (await worker.evaluate(`chrome.storage.local.get('config').then(r => r.config.groups.length)`)) === 4, 'preset saved');
  assert.equal(await options.evaluate(`getComputedStyle(document.querySelector('#empty')).display`), 'none');
  step('delete + undo work; starter preset loaded (4 groups)');

  // --- tabs get grouped on navigation
  await worker.evaluate(`Promise.all(['https://github.com/torvalds/linux', 'https://stackoverflow.com/questions',
    'https://www.youtube.com/', 'https://www.twitch.tv/', 'https://example.com/']
    .map(url => chrome.tabs.create({ url, active: false })))`);
  const tabs = await waitFor(async () => {
    const t = await worker.evaluate(snapshot);
    return ['github.com', 'stackoverflow', 'youtube', 'twitch'].every((n) => groupOf(t, n)) ? t : null;
  }, 'grouping after navigation');
  assert.equal(groupOf(tabs, 'github.com'), 'Code');
  assert.equal(groupOf(tabs, 'stackoverflow'), 'Code');
  assert.equal(groupOf(tabs, 'youtube'), 'Video');
  assert.equal(groupOf(tabs, 'twitch'), 'Video');
  assert.equal(groupOf(tabs, 'example.com'), null);
  step('tabs grouped on navigation by stored rules');

  // --- editing a rule in the UI takes effect without reload
  await options.evaluate(`(async () => {
    const input = document.querySelector('.drawer:last-child [data-role="pattern"]');
    input.value = 'example.com';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  })()`);
  await sleep(600);
  const runTab = await worker.evaluate(`chrome.tabs.create({ url: chrome.runtime.getURL('run.html'), active: false }).then(t => t.id)`);
  assert.ok(runTab);
  await waitFor(async () => !(await worker.evaluate(snapshot)).some((t) => t.url?.endsWith('run.html')), 'run.html closes itself');
  assert.equal(groupOf(await worker.evaluate(snapshot), 'example.com'), 'Video');
  step('new rule from UI applied live; run.html (sort-tabs CLI) sorts and closes');

  // --- pause: nothing moves
  await worker.evaluate(`chrome.storage.local.get('config').then(({config}) =>
    chrome.storage.local.set({ config: { ...config, settings: { ...config.settings, paused: true } } }))`);
  await sleep(300);
  assert.equal(await worker.evaluate(`chrome.alarms.get('sort-tabs').then(a => a ?? null)`), null);
  await worker.evaluate(`chrome.tabs.create({ url: 'https://developer.mozilla.org/', active: false })`);
  await sleep(3500);
  assert.equal(groupOf(await worker.evaluate(snapshot), 'mozilla'), null);
  step('paused: alarm cleared, new tab not grouped');

  // --- popup shows the waiting tab; its button sorts even while paused
  popup = await attach((await (await fetch('http://127.0.0.1:9334/json/new?' + encodeURIComponent(`${BASE}/ui/popup.html`), { method: 'PUT' })).json()).webSocketDebuggerUrl);
  await waitFor(() => popup.evaluate(`document.querySelector('#count').textContent === '1'`), 'popup count');
  await screenshot(popup, 'popup-dark.png', { width: 376, height: 300, scheme: 'dark' });
  await popup.evaluate(`document.querySelector('#sort').click()`);
  await waitFor(async () => groupOf(await worker.evaluate(snapshot), 'mozilla') === 'Code', 'manual sort from popup');
  step('popup counts waiting tabs; its button sorts while paused');

  // --- interval setting drives the alarm
  await worker.evaluate(`chrome.storage.local.get('config').then(({config}) =>
    chrome.storage.local.set({ config: { ...config, settings: { ...config.settings, paused: false, intervalMinutes: 10 } } }))`);
  await waitFor(async () => (await worker.evaluate(`chrome.alarms.get('sort-tabs').then(a => a?.periodInMinutes)`)) === 10, 'alarm 10 min');
  await waitFor(() => popup.evaluate(`document.querySelector('#active').checked`), 'popup follows config change');
  step('interval change re-schedules the alarm (10 min)');

  // --- manual ungroup is respected, also for a whole group at once (opt-out race)
  const codeIds = (await worker.evaluate(snapshot)).filter((t) => t.group === 'Code').map((t) => t.id);
  assert.ok(codeIds.length >= 2, 'Code group has several tabs');
  await worker.evaluate(`chrome.tabs.ungroup(${JSON.stringify(codeIds)})`);
  await sleep(500);
  await options.evaluate(`document.querySelector('#sort-now').click()`);
  await sleep(800);
  const afterUngroup = await worker.evaluate(snapshot);
  assert.deepEqual(codeIds.map((id) => afterUngroup.find((t) => t.id === id).group), codeIds.map(() => null));
  step(`whole group ungrouped by hand (${codeIds.length} tabs) stays ungrouped`);

  // --- screenshots of the options page
  await options.evaluate(`(document.querySelector('#probe-url').value = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    document.querySelector('#probe-url').dispatchEvent(new Event('input')))`);
  await options.evaluate(`(() => { const i = document.querySelector('.drawer:nth-child(2) [data-role="pattern"]');
    i.value = 'title:Roadmap'; i.dispatchEvent(new Event('input')); })()`);
  await screenshot(options, 'options-dark.png', { width: 1360, height: 1100, scheme: 'dark' });
  await screenshot(options, 'options-light.png', { width: 1360, height: 1100, scheme: 'light' });
  await screenshot(popup, 'popup-light.png', { width: 376, height: 300, scheme: 'light' });
  const errors = await options.evaluate(`document.body.innerText.includes('Error')`);
  assert.equal(errors, false);
  step(`screenshots written to ${shotDir}`);

  console.log('\nE2E OK');
} finally {
  worker?.close();
  options?.close();
  popup?.close();
  await browser.close();
}
