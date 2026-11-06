// Thin wrapper around chrome.storage so every surface (worker, popup, options)
// reads and writes the same shapes.
import { normalizeConfig, emptyConfig } from './config.js';

const CONFIG_KEY = 'config';
const LAST_RUN_KEY = 'lastRun';
const OPTOUT_KEY = 'optOuts';

/** @returns {Promise<{config: import('./config.js').Config, stored: boolean}>} */
export const loadConfig = async () => {
  const { [CONFIG_KEY]: raw } = await chrome.storage.local.get(CONFIG_KEY);
  return raw ? { config: normalizeConfig(raw), stored: true } : { config: emptyConfig(), stored: false };
};

export const saveConfig = async (config) => {
  const clean = normalizeConfig(config);
  await chrome.storage.local.set({ [CONFIG_KEY]: clean });
  return clean;
};

export const onConfigChanged = (callback) =>
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[CONFIG_KEY]) callback(normalizeConfig(changes[CONFIG_KEY].newValue));
  });

export const loadLastRun = async () => (await chrome.storage.local.get(LAST_RUN_KEY))[LAST_RUN_KEY] ?? null;
export const saveLastRun = (lastRun) => chrome.storage.local.set({ [LAST_RUN_KEY]: lastRun });
export const onLastRunChanged = (callback) =>
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[LAST_RUN_KEY]) callback(changes[LAST_RUN_KEY].newValue);
  });

export const loadOptOuts = async () => (await chrome.storage.session.get(OPTOUT_KEY))[OPTOUT_KEY] ?? {};
export const saveOptOuts = (optOuts) => chrome.storage.session.set({ [OPTOUT_KEY]: optOuts });
