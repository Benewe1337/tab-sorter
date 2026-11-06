import { parsePattern, normalizeTab, patternMatches } from './patterns.js';

export const CONFIG_VERSION = 2;
export const COLORS = ['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange'];
export const MAX_GROUPS = 50;
export const MAX_PATTERNS = 200;
export const MAX_TITLE = 60;
export const MAX_PATTERN_LENGTH = 300;
export const INTERVAL_CHOICES = [0, 1, 2, 5, 10, 15, 30, 60];

/**
 * @typedef {{id: string, title: string, color: string, patterns: string[]}} Group
 * @typedef {{intervalMinutes: number, sortOnNavigate: boolean, respectManualUngroup: boolean, paused: boolean}} Settings
 * @typedef {{version: number, groups: Group[], settings: Settings}} Config
 */

/** @type {Settings} */
export const DEFAULT_SETTINGS = Object.freeze({
  intervalMinutes: 5,
  sortOnNavigate: true,
  respectManualUngroup: true,
  paused: false,
});

export const newId = () =>
  (globalThis.crypto?.randomUUID?.() ?? `g${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`);

/** @returns {Config} */
export const emptyConfig = () => ({ version: CONFIG_VERSION, groups: [], settings: { ...DEFAULT_SETTINGS } });

const asString = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

const normalizeGroup = (raw, index) => {
  const source = raw && typeof raw === 'object' ? raw : {};
  const patterns = Array.isArray(source.patterns) ? source.patterns : [];
  const cleaned = [...new Set(patterns.map((p) => asString(p, MAX_PATTERN_LENGTH)).filter(Boolean))];
  return {
    id: asString(source.id, 64) || newId(),
    title: asString(source.title, MAX_TITLE) || `Group ${index + 1}`,
    color: COLORS.includes(source.color) ? source.color : COLORS[index % COLORS.length],
    patterns: cleaned.slice(0, MAX_PATTERNS),
  };
};

const normalizeSettings = (raw) => {
  const source = raw && typeof raw === 'object' ? raw : {};
  const interval = Number(source.intervalMinutes);
  return {
    intervalMinutes: INTERVAL_CHOICES.includes(interval) ? interval : DEFAULT_SETTINGS.intervalMinutes,
    sortOnNavigate: typeof source.sortOnNavigate === 'boolean' ? source.sortOnNavigate : DEFAULT_SETTINGS.sortOnNavigate,
    respectManualUngroup:
      typeof source.respectManualUngroup === 'boolean' ? source.respectManualUngroup : DEFAULT_SETTINGS.respectManualUngroup,
    paused: typeof source.paused === 'boolean' ? source.paused : DEFAULT_SETTINGS.paused,
  };
};

/**
 * Turns anything (stored value, imported JSON) into a valid Config.
 * Unknown fields are dropped, bad values replaced by defaults, ids made unique.
 * @param {unknown} raw
 * @returns {Config}
 */
export const normalizeConfig = (raw) => {
  const source = raw && typeof raw === 'object' ? raw : {};
  const groups = (Array.isArray(source.groups) ? source.groups : []).slice(0, MAX_GROUPS).map(normalizeGroup);
  const seen = new Set();
  const uniqueGroups = groups.map((group) => {
    if (!seen.has(group.id)) {
      seen.add(group.id);
      return group;
    }
    const id = newId();
    seen.add(id);
    return { ...group, id };
  });
  return { version: CONFIG_VERSION, groups: uniqueGroups, settings: normalizeSettings(source.settings) };
};

/**
 * Strict check for imports: returns a list of human readable problems
 * (empty = fine). Invalid patterns are reported but do not block saving.
 * @param {unknown} raw
 */
export const validateImport = (raw) => {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.groups)) {
    return { fatal: 'File has no "groups" list.', warnings: [] };
  }
  const warnings = [];
  raw.groups.forEach((group, i) => {
    const name = typeof group?.title === 'string' && group.title.trim() ? group.title.trim() : `#${i + 1}`;
    if (group?.patterns !== undefined && !Array.isArray(group.patterns)) {
      warnings.push(`${name}: "patterns" is not a list`);
      return;
    }
    (group?.patterns ?? []).forEach((pattern) => {
      const parsed = parsePattern(pattern);
      if (!parsed.ok) warnings.push(`${name}: "${String(pattern)}" – ${parsed.error}`);
    });
  });
  return { fatal: null, warnings };
};

/**
 * What to store on install/update: an empty config when nothing is stored
 * yet, otherwise null (the stored config must be left alone).
 * @param {{stored: boolean}} info
 * @returns {Config|null}
 */
export const initialConfig = ({ stored }) => (stored ? null : emptyConfig());

/** Pre-parses all patterns once. Invalid patterns are ignored. */
export const compileGroups = (groups) =>
  groups.map((group) => ({
    ...group,
    compiled: group.patterns.map(parsePattern).filter((parsed) => parsed.ok),
  }));

/**
 * First group (by order = priority) with a matching pattern, or null.
 * @param {ReturnType<typeof compileGroups>} compiledGroups
 */
export const classify = (url, title, compiledGroups) => {
  if (!url && !title) return null;
  const tab = normalizeTab(url, title);
  return compiledGroups.find((group) => group.compiled.some((parsed) => patternMatches(parsed, tab))) ?? null;
};
