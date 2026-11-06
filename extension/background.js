import { compileGroups, initialConfig } from './lib/config.js';
import { sortTabs, hostOf } from './lib/sorter.js';
import {
  loadConfig, saveConfig, onConfigChanged, saveLastRun, loadOptOuts, saveOptOuts,
} from './lib/store.js';

const ALARM = 'sort-tabs';
const DEBOUNCE_MS = 1500;

const api = { tabs: chrome.tabs, tabGroups: chrome.tabGroups, windows: chrome.windows };

// --- config cache -------------------------------------------------------------
let cache = null; // { config, compiled }
const current = async () => {
  if (!cache) {
    const { config } = await loadConfig();
    cache = { config, compiled: compileGroups(config.groups) };
  }
  return cache;
};

const applyAlarm = async ({ intervalMinutes, paused }) => {
  const existing = await chrome.alarms.get(ALARM);
  if (paused || intervalMinutes === 0) {
    if (existing) await chrome.alarms.clear(ALARM);
    return;
  }
  if (existing?.periodInMinutes === intervalMinutes) return;
  await chrome.alarms.create(ALARM, { periodInMinutes: intervalMinutes, delayInMinutes: Math.min(intervalMinutes, 0.5) });
};

onConfigChanged(async (config) => {
  cache = { config, compiled: compileGroups(config.groups) };
  await applyAlarm(config.settings);
});

// --- serialized runs: never two sorts at once (avoids duplicate groups) -------
let queue = Promise.resolve();

const runSort = (reason, { force = false } = {}) => {
  const job = queue.then(async () => {
    const { config, compiled } = await current();
    if (config.settings.paused && !force) return { moved: 0, created: [], errors: [], skipped: 'paused' };
    const optOuts = config.settings.respectManualUngroup ? await loadOptOuts() : {};
    const result = await sortTabs(api, compiled, optOuts);
    await saveLastRun({ at: Date.now(), reason, moved: result.moved, errors: result.errors });
    if (result.errors.length) console.warn('[tab-sorter]', reason, result.errors);
    return result;
  });
  queue = job.catch((error) => console.error('[tab-sorter]', reason, error));
  return job;
};

let debounceTimer;
const scheduleSort = (reason) => {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => runSort(reason), DEBOUNCE_MS);
};

const flashBadge = async (result) => {
  const text = result.moved > 0 ? String(result.moved) : '✓';
  await chrome.action.setBadgeBackgroundColor({ color: result.errors.length ? '#b3261e' : '#3d6b3a' });
  await chrome.action.setBadgeText({ text });
  setTimeout(() => chrome.action.setBadgeText({ text: '' }), 3000);
};

// --- install / update ---------------------------------------------------------
chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  const { stored } = await loadConfig();
  const seeded = initialConfig({ stored });
  if (seeded) {
    await saveConfig(seeded);
    if (reason === 'install') chrome.runtime.openOptionsPage();
  }
  await applyAlarm((await loadConfig()).config.settings);
});

chrome.runtime.onStartup.addListener(async () => applyAlarm((await current()).config.settings));

// --- triggers -----------------------------------------------------------------
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM) runSort('alarm');
});

// Opt-out map updates are serialized: "Ungroup" on a whole group fires one
// onUpdated per tab at the same moment, and parallel read-modify-writes
// would drop all but the last entry.
let optOutQueue = Promise.resolve();
const updateOptOuts = (change) => {
  optOutQueue = optOutQueue
    .then(async () => {
      const next = change(await loadOptOuts());
      if (next !== null) await saveOptOuts(next);
    })
    .catch((error) => console.error('[tab-sorter] opt-out update failed', error));
  return optOutQueue;
};

chrome.tabs.onUpdated.addListener(async (tabId, change, tab) => {
  if (change.groupId === chrome.tabGroups.TAB_GROUP_ID_NONE) {
    // The sorter only ever moves tabs *into* groups, so this was the user.
    // Leave the tab alone while it stays on this host.
    await updateOptOuts((optOuts) => ({ ...optOuts, [tabId]: hostOf(tab.url || tab.pendingUrl || '') }));
    return;
  }
  if (!(change.url || change.title)) return;
  const { settings } = (await current()).config;
  if (settings.sortOnNavigate && !settings.paused) scheduleSort('navigate');
});

chrome.tabs.onRemoved.addListener((tabId) =>
  updateOptOuts((optOuts) => {
    if (!(tabId in optOuts)) return null;
    const { [tabId]: _removed, ...rest } = optOuts;
    return rest;
  }));

chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'sort-tabs') flashBadge(await runSort('shortcut', { force: true }));
});

// From popup, options page and run.html (the `sort-tabs` terminal command).
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'sort') return false;
  runSort(message.reason ?? 'message', { force: true })
    .then((result) => {
      flashBadge(result);
      sendResponse({ ok: true, result });
    })
    .catch((error) => sendResponse({ ok: false, error: String(error) }));
  return true;
});

current().then(({ config }) => applyAlarm(config.settings));
