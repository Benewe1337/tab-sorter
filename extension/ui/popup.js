import { compileGroups } from '../lib/config.js';
import { planWindow } from '../lib/sorter.js';
import {
  loadConfig, saveConfig, loadLastRun, loadOptOuts, onConfigChanged, onLastRunChanged,
} from '../lib/store.js';
import { t, applyI18n, relativeTime } from './i18n.js';

const $ = (selector) => document.querySelector(selector);

let config;

/** Ungrouped tabs (all normal windows) that would move, per group. */
const pending = async () => {
  const windows = await chrome.windows.getAll({ populate: true, windowTypes: ['normal'] });
  const compiled = compileGroups(config.groups);
  const optOuts = config.settings.respectManualUngroup ? await loadOptOuts() : {};
  const totals = new Map();
  for (const win of windows) {
    if (win.incognito) continue;
    for (const { group, tabs } of planWindow(win.tabs ?? [], compiled, optOuts).values()) {
      const entry = totals.get(group.id) ?? { group, count: 0 };
      totals.set(group.id, { ...entry, count: entry.count + tabs.length });
    }
  }
  return [...totals.values()];
};

const renderStatus = async () => {
  document.body.classList.toggle('paused', config.settings.paused);
  $('#active').checked = !config.settings.paused;
  const list = $('#breakdown');

  if (config.groups.length === 0) {
    $('#count').textContent = '0';
    $('#count-label').textContent = t('popupNoGroups');
    $('#sort').disabled = true;
    list.replaceChildren();
    return;
  }

  const rows = await pending();
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  $('#count').textContent = String(total);
  $('#count-label').textContent = config.settings.paused
    ? t('popupPaused')
    : total === 1 ? t('popupWaitingOne') : t('popupWaiting');
  $('#sort').disabled = total === 0;

  if (rows.length === 0) {
    const li = document.createElement('li');
    li.className = 'empty-row';
    li.textContent = t('popupAllSorted');
    list.replaceChildren(li);
    return;
  }
  list.replaceChildren(...rows.map(({ group, count }) => {
    const li = document.createElement('li');
    const peg = document.createElement('span');
    peg.className = 'peg';
    peg.dataset.color = group.color;
    const name = document.createElement('span');
    name.textContent = group.title;
    const n = document.createElement('span');
    n.className = 'n';
    n.textContent = String(count);
    li.append(peg, name, n);
    return li;
  }));
};

const renderLastRun = async () => {
  const lastRun = await loadLastRun();
  $('#last-run').textContent = lastRun ? t('lastRun', relativeTime(lastRun.at), lastRun.moved) : '';
};

const boot = async () => {
  applyI18n();
  ({ config } = await loadConfig());
  await Promise.all([renderStatus(), renderLastRun()]);

  // stay in sync with the options page and the worker
  onConfigChanged((next) => {
    config = next;
    renderStatus();
  });
  onLastRunChanged(() => renderLastRun());

  $('#active').addEventListener('change', async (e) => {
    config = await saveConfig({ ...config, settings: { ...config.settings, paused: !e.target.checked } });
    await renderStatus();
  });

  $('#sort').addEventListener('click', async () => {
    const result = $('#result');
    $('#sort').disabled = true;
    const response = await chrome.runtime.sendMessage({ type: 'sort', reason: 'popup' });
    result.classList.toggle('error', !response?.ok || response.result.errors.length > 0);
    result.textContent = response?.ok ? t('sortedCount', response.result.moved) : t('sortFailed', response?.error ?? '?');
    await Promise.all([renderStatus(), renderLastRun()]);
  });

  $('#open-options').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
    window.close();
  });
};

boot().catch((error) => {
  $('#count-label').textContent = String(error);
});
