import {
  COLORS, INTERVAL_CHOICES, MAX_GROUPS, MAX_PATTERNS, compileGroups, classify, newId, normalizeConfig, validateImport,
} from '../lib/config.js';
import { parsePattern, normalizeTab, patternMatches } from '../lib/patterns.js';
import { PRESETS } from '../lib/presets.js';
import { loadConfig, saveConfig, onConfigChanged } from '../lib/store.js';
import { t, applyI18n } from './i18n.js';

const $ = (selector, root = document) => root.querySelector(selector);
const SAVE_DELAY_MS = 350;

let config = null;
let openTabs = [];
let lastSavedJson = '';

// ---------------------------------------------------------------- persistence
let saveTimer;
const scheduleSave = () => {
  clearTimeout(saveTimer);
  const state = $('#save-state');
  state.textContent = t('saving');
  state.classList.remove('fresh');
  saveTimer = setTimeout(async () => {
    const saved = await saveConfig(config);
    lastSavedJson = JSON.stringify(saved);
    state.textContent = t('saved');
    state.classList.add('fresh');
  }, SAVE_DELAY_MS);
};

/** Immutable update + save. `rerender` = rebuild the drawer list. */
const commit = (next, { rerender = true } = {}) => {
  config = next;
  scheduleSave();
  if (rerender) renderGroups();
};

const live = (id) => config.groups.find((g) => g.id === id);

const updateGroup = (id, patch, opts) =>
  commit({ ...config, groups: config.groups.map((g) => (g.id === id ? { ...g, ...patch } : g)) }, opts);

// ---------------------------------------------------------------- toast/undo
let toastTimer;
const toast = (message, undo) => {
  const el = $('#toast');
  $('.toast-text', el).textContent = message;
  const button = $('button', el);
  button.hidden = !undo;
  button.onclick = () => {
    el.hidden = true;
    undo?.();
  };
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 6000);
};

/**
 * Applies `next` and offers undo. `revert(current)` rebuilds only what this
 * action changed on top of the *current* config, so edits made while the
 * toast is visible survive the undo.
 */
const withUndo = (message, next, revert) => {
  commit(next);
  toast(message, () => {
    commit(revert(config));
    renderSettings();
  });
};

const insertAt = (list, index, item) => [...list.slice(0, index), item, ...list.slice(index)];

const revertGroupDelete = (group, index) => (current) =>
  current.groups.some((g) => g.id === group.id)
    ? current
    : { ...current, groups: insertAt(current.groups, Math.min(index, current.groups.length), group) };

const revertPatternRemove = (groupId, pattern, index) => (current) => ({
  ...current,
  groups: current.groups.map((g) =>
    g.id === groupId && !g.patterns.includes(pattern)
      ? { ...g, patterns: insertAt(g.patterns, Math.min(index, g.patterns.length), pattern) }
      : g),
});

// ---------------------------------------------------------------- matching helpers
const tabMatchesPattern = (parsed, tab) => patternMatches(parsed, normalizeTab(tab.url || tab.pendingUrl, tab.title));

/** Open tabs whose *first* matching group is `groupId` (priority aware). */
const hitsFor = (groupId, compiled) =>
  openTabs.filter((tab) => classify(tab.url || tab.pendingUrl, tab.title, compiled)?.id === groupId);

// ---------------------------------------------------------------- render: drawers
const focusKey = () => {
  const el = document.activeElement;
  const drawer = el?.closest?.('.drawer');
  return drawer && el.dataset.role ? { id: drawer.dataset.id, role: el.dataset.role, value: el.value } : null;
};

const restoreFocus = (key) => {
  if (!key) return;
  const el = document.querySelector(`.drawer[data-id="${CSS.escape(key.id)}"] [data-role="${key.role}"]`);
  if (!el) return;
  if (key.role === 'pattern' && typeof key.value === 'string') el.value = key.value;
  el.focus();
};

const chipEl = (group, pattern, index) => {
  const parsed = parsePattern(pattern);
  const li = document.createElement('li');
  li.className = `chip${parsed.ok ? '' : ' invalid'}`;
  li.title = parsed.ok ? '' : parsed.error;

  const kind = document.createElement('span');
  kind.className = 'kind';
  kind.textContent = parsed.ok ? t(`kind_${parsed.kind}`) : t('kind_invalid');

  const value = document.createElement('button');
  value.type = 'button';
  value.className = 'val';
  value.textContent = pattern;
  value.title = t('editPattern');
  value.addEventListener('click', () => {
    const input = $(`.drawer[data-id="${CSS.escape(group.id)}"] [data-role="pattern"]`);
    updateGroup(group.id, { patterns: group.patterns.filter((_, i) => i !== index) });
    const fresh = $(`.drawer[data-id="${CSS.escape(group.id)}"] [data-role="pattern"]`) ?? input;
    fresh.value = pattern;
    fresh.focus();
    fresh.dispatchEvent(new Event('input'));
  });

  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'icon-btn danger';
  remove.setAttribute('aria-label', t('removePattern', pattern));
  remove.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
  remove.addEventListener('click', () =>
    withUndo(t('patternRemoved', pattern), {
      ...config,
      groups: config.groups.map((g) => (g.id === group.id ? { ...g, patterns: g.patterns.filter((p) => p !== pattern) } : g)),
    }, revertPatternRemove(group.id, pattern, index)));

  li.append(kind, value, remove);
  return li;
};

const swatchesEl = (group, fieldset) => {
  for (const color of COLORS) {
    const label = document.createElement('label');
    label.className = 'swatch';
    label.dataset.color = color;
    label.title = t(`color_${color}`);
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = `color-${group.id}`;
    input.value = color;
    input.checked = group.color === color;
    input.setAttribute('aria-label', t(`color_${color}`));
    input.addEventListener('change', () => {
      document.querySelector(`.drawer[data-id="${CSS.escape(group.id)}"]`).dataset.color = color;
      updateGroup(group.id, { color }, { rerender: false });
    });
    label.append(input, document.createElement('span'));
    fieldset.append(label);
  }
};

const setHint = (hintEl, text, state) => {
  hintEl.textContent = text;
  hintEl.className = `adder-hint${state ? ` ${state}` : ''}`;
};

const describeDraft = (text) => {
  if (!text.trim()) return { text: '', state: '' };
  const parsed = parsePattern(text);
  if (!parsed.ok) return { text: t('invalidPattern', parsed.error), state: 'error' };
  const count = openTabs.filter((tab) => tabMatchesPattern(parsed, tab)).length;
  return { text: t('draftOk', t(`kind_${parsed.kind}`), count), state: 'ok' };
};

const addPattern = (staleGroup, input, hint) => {
  const group = live(staleGroup.id) ?? staleGroup;
  const text = input.value.trim();
  if (!text) return;
  const parsed = parsePattern(text);
  if (!parsed.ok) {
    setHint(hint, t('invalidPattern', parsed.error), 'error');
    return;
  }
  if (group.patterns.includes(text)) {
    setHint(hint, t('duplicatePattern'), 'error');
    return;
  }
  if (group.patterns.length >= MAX_PATTERNS) {
    setHint(hint, t('tooManyPatterns', MAX_PATTERNS), 'error');
    return;
  }
  input.value = '';
  updateGroup(group.id, { patterns: [...group.patterns, text] });
  restoreFocus({ id: group.id, role: 'pattern', value: '' });
};

const moveGroup = (index, delta) => {
  const target = index + delta;
  if (target < 0 || target >= config.groups.length) return;
  const groups = [...config.groups];
  [groups[index], groups[target]] = [groups[target], groups[index]];
  commit({ ...config, groups });
  // keep keyboard focus on the moved drawer; at the top/bottom the pressed
  // button is now disabled, so fall back to the other direction
  const atEdge = target === 0 || target === groups.length - 1;
  const pressed = delta < 0 ? 'up' : 'down';
  const role = atEdge ? (pressed === 'up' ? 'down' : 'up') : pressed;
  restoreFocus({ id: groups[target].id, role: groups.length > 1 ? role : 'title' });
};

const drawerEl = (group, index, compiled) => {
  const node = $('#tpl-drawer').content.firstElementChild.cloneNode(true);
  applyI18n(node);
  node.dataset.id = group.id;
  node.dataset.color = group.color;
  $('.ord', node).textContent = String(index + 1).padStart(2, '0');

  const title = $('[data-role="title"]', node);
  title.value = group.title;
  title.addEventListener('input', () => updateGroup(group.id, { title: title.value }, { rerender: false }));
  title.addEventListener('blur', () => {
    if (!title.value.trim()) title.value = group.title || t('newGroupName');
    updateGroup(group.id, { title: title.value.trim() }, { rerender: false });
  });

  swatchesEl(group, $('.swatches', node));

  const up = $('[data-role="up"]', node);
  const down = $('[data-role="down"]', node);
  up.disabled = index === 0;
  down.disabled = index === config.groups.length - 1;
  up.addEventListener('click', () => moveGroup(index, -1));
  down.addEventListener('click', () => moveGroup(index, 1));
  $('[data-role="delete"]', node).addEventListener('click', () => {
    const current = live(group.id) ?? group;
    const position = config.groups.findIndex((g) => g.id === group.id);
    withUndo(
      t('groupDeleted', current.title),
      { ...config, groups: config.groups.filter((g) => g.id !== group.id) },
      revertGroupDelete(current, position),
    );
  });

  const chips = $('[data-role="chips"]', node);
  group.patterns.forEach((pattern, i) => chips.append(chipEl(group, pattern, i)));

  const input = $('[data-role="pattern"]', node);
  const hint = $('[data-role="hint"]', node);
  input.addEventListener('input', () => {
    const { text, state } = describeDraft(input.value);
    setHint(hint, text, state);
  });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      addPattern(group, input, hint);
    }
  });
  $('[data-role="add"]', node).addEventListener('click', () => addPattern(group, input, hint));

  fillHits($('[data-role="hits"]', node), hitsFor(group.id, compiled));
  return node;
};

const MAX_LISTED_HITS = 30;

/** Writes the "open tabs that belong here" list; hidden when empty (CSS). */
const fillHits = (details, hits) => {
  const list = $('ul', details);
  if (!hits.length) {
    delete details.dataset.count;
    list.replaceChildren();
    return;
  }
  details.dataset.count = String(hits.length);
  $('summary', details).textContent = t('hitsSummary', hits.length);
  list.replaceChildren(...hits.slice(0, MAX_LISTED_HITS).map((tab) => {
    const li = document.createElement('li');
    li.textContent = tab.title || tab.url;
    const host = document.createElement('small');
    host.textContent = normalizeTab(tab.url).parsed?.hostname ?? '';
    li.append(host);
    return li;
  }));
};

/** Updates only hit lists in place: never touches inputs, so typing is safe. */
const updateHits = () => {
  const compiled = compileGroups(config.groups);
  for (const drawer of document.querySelectorAll('.drawer')) {
    fillHits($('[data-role="hits"]', drawer), hitsFor(drawer.dataset.id, compiled));
  }
};

const renderGroups = () => {
  const key = focusKey();
  const openDetails = new Set([...document.querySelectorAll('.drawer details[open]')].map((d) => d.closest('.drawer').dataset.id));
  const compiled = compileGroups(config.groups);
  const list = $('#groups');
  list.replaceChildren(...config.groups.map((group, i) => drawerEl(group, i, compiled)));
  for (const id of openDetails) {
    const details = document.querySelector(`.drawer[data-id="${CSS.escape(id)}"] details`);
    if (details) details.open = true;
  }
  $('#empty').hidden = config.groups.length > 0;
  $('#add-group').disabled = config.groups.length >= MAX_GROUPS;
  restoreFocus(key);
  renderProbe();
};

// ---------------------------------------------------------------- render: settings
const renderSettings = () => {
  const { settings } = config;
  $('#set-active').checked = !settings.paused;
  $('#set-interval').value = String(settings.intervalMinutes);
  $('#set-navigate').checked = settings.sortOnNavigate;
  $('#set-respect').checked = settings.respectManualUngroup;
  for (const id of ['#set-interval', '#set-navigate', '#set-respect']) $(id).disabled = settings.paused;
};

const updateSettings = (patch) => {
  config = { ...config, settings: { ...config.settings, ...patch } };
  scheduleSave();
  renderSettings();
};

const initSettings = () => {
  const select = $('#set-interval');
  for (const minutes of INTERVAL_CHOICES) {
    const option = document.createElement('option');
    option.value = String(minutes);
    option.textContent = minutes === 0 ? t('intervalOff') : t('intervalMinutes', minutes);
    select.append(option);
  }
  $('#set-active').addEventListener('change', (e) => updateSettings({ paused: !e.target.checked }));
  select.addEventListener('change', (e) => updateSettings({ intervalMinutes: Number(e.target.value) }));
  $('#set-navigate').addEventListener('change', (e) => updateSettings({ sortOnNavigate: e.target.checked }));
  $('#set-respect').addEventListener('change', (e) => updateSettings({ respectManualUngroup: e.target.checked }));

  $('#sort-now').addEventListener('click', async () => {
    const out = $('#sort-result');
    out.textContent = '…';
    const response = await chrome.runtime.sendMessage({ type: 'sort', reason: 'options' });
    out.textContent = response?.ok ? t('sortedCount', response.result.moved) : t('sortFailed', response?.error ?? '?');
    await refreshTabs();
  });
};

// ---------------------------------------------------------------- probe
const renderProbe = () => {
  const out = $('#probe-result');
  const url = $('#probe-url').value.trim();
  const title = $('#probe-title').value.trim();
  out.replaceChildren();
  if (!url && !title) return;
  const tab = normalizeTab(url, title);
  for (const group of config.groups) {
    const pattern = group.patterns.find((p) => patternMatches(parsePattern(p), tab));
    if (pattern) {
      const peg = document.createElement('span');
      peg.className = 'peg';
      peg.dataset.color = group.color;
      const strong = document.createElement('strong');
      strong.textContent = group.title;
      const via = document.createElement('span');
      via.textContent = ` ${t('probeVia')} `;
      const code = document.createElement('code');
      code.textContent = pattern;
      out.append(peg, strong, via, code);
      return;
    }
  }
  out.textContent = t('probeNoMatch');
};

// ---------------------------------------------------------------- import / export / presets
const exportConfig = () => {
  const payload = { app: 'tab-sorter', exportedAt: new Date().toISOString(), ...config };
  const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `tab-sorter-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

const importConfig = async (file) => {
  const out = $('#import-result');
  let raw;
  try {
    raw = JSON.parse(await file.text());
  } catch {
    out.textContent = t('importNotJson');
    return;
  }
  const { fatal, warnings } = validateImport(raw);
  if (fatal) {
    out.textContent = t('importFailed', fatal);
    return;
  }
  const previous = config;
  const imported = normalizeConfig(raw);
  withUndo(t('importDone', imported.groups.length), imported, () => previous);
  renderSettings();
  out.textContent = warnings.length ? t('importWarnings', warnings.length, warnings[0]) : '';
};

const loadPreset = (name) => {
  const previousGroups = config.groups;
  const groups = normalizeConfig({ groups: PRESETS[name].groups }).groups;
  withUndo(t('presetLoaded', t(PRESETS[name].labelKey)), { ...config, groups },
    (current) => ({ ...current, groups: previousGroups }));
};

const initBackup = () => {
  $('#export').addEventListener('click', exportConfig);
  $('#import-file').addEventListener('change', async (e) => {
    const [file] = e.target.files;
    try {
      if (file) await importConfig(file);
    } catch (error) {
      $('#import-result').textContent = t('importFailed', error?.message ?? String(error));
    } finally {
      e.target.value = '';
    }
  });
  const presetRow = $('#preset-buttons');
  for (const [name, preset] of Object.entries(PRESETS)) {
    const button = document.createElement('button');
    button.className = name === 'starter' ? 'btn btn-primary' : 'btn';
    button.type = 'button';
    button.textContent = t(preset.labelKey);
    button.addEventListener('click', () => loadPreset(name));
    presetRow.append(button);
  }
};

const addGroup = () => {
  const used = new Set(config.groups.map((g) => g.color));
  const color = COLORS.find((c) => !used.has(c)) ?? COLORS[config.groups.length % COLORS.length];
  const group = { id: newId(), title: t('newGroupName'), color, patterns: [] };
  commit({ ...config, groups: [...config.groups, group] });
  const title = $(`.drawer[data-id="${CSS.escape(group.id)}"] [data-role="title"]`);
  title.focus();
  title.select();
  title.scrollIntoView({ block: 'center', behavior: 'smooth' });
};

// ---------------------------------------------------------------- open tabs (for live hit counts)
const refreshTabs = async () => {
  openTabs = (await chrome.tabs.query({})).filter((tab) => !tab.url?.startsWith(chrome.runtime.getURL('')));
  if (config) updateHits();
};

let tabsTimer;
const scheduleTabsRefresh = () => {
  clearTimeout(tabsTimer);
  tabsTimer = setTimeout(refreshTabs, 600);
};

// ---------------------------------------------------------------- boot
const boot = async () => {
  applyI18n();
  document.documentElement.lang = chrome.i18n.getUILanguage().split('-')[0];
  ({ config } = await loadConfig());
  lastSavedJson = JSON.stringify(config);

  initSettings();
  initBackup();
  $('#add-group').addEventListener('click', addGroup);
  $('#probe-url').addEventListener('input', renderProbe);
  $('#probe-title').addEventListener('input', renderProbe);

  renderSettings();
  await refreshTabs();
  renderGroups();

  // Changes from the popup (pause) or another options tab.
  onConfigChanged((next) => {
    if (JSON.stringify(next) === lastSavedJson) return;
    lastSavedJson = JSON.stringify(next);
    config = next;
    renderSettings();
    renderGroups();
  });
  chrome.tabs.onUpdated.addListener((_id, change) => { if (change.url || change.title) scheduleTabsRefresh(); });
  chrome.tabs.onRemoved.addListener(scheduleTabsRefresh);
  chrome.tabs.onCreated.addListener(scheduleTabsRefresh);
};

boot().catch((error) => {
  console.error('[tab-sorter] options failed to load', error);
  document.body.prepend(Object.assign(document.createElement('p'), { textContent: String(error), className: 'quiet' }));
});
