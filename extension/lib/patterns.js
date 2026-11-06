// Pattern language for rules. One pattern is one line typed by the user.
//
//   example.com                domain, includes subdomains (docs.example.com)
//   *.example.com              same, the "*." is optional
//   github.com/acme            domain + path prefix
//   localhost:5173             host with port
//   title:Invoice              tab title contains text (case-insensitive)
//   title:/exam|quiz/          tab title matches a regular expression
//   /docs\.google\.com\/.*sheet/   URL matches a regular expression (also url:/…/)
//   file://                    URL starts with this (any scheme://…)
//   outlook.com & title:Work   all parts joined with & must match
//
// Pure module: no browser APIs, unit tested in Node.

/** @typedef {'domain'|'path'|'title'|'regex'|'prefix'} TermKind */
/** @typedef {{kind: TermKind, test: (tab: NormalizedTab) => boolean}} Term */
/** @typedef {{url: string, parsed: URL|null, title: string}} NormalizedTab */
/**
 * @typedef {{ok: true, kind: TermKind|'combo', terms: Term[]}
 *         | {ok: false, error: string}} ParseResult
 */

const REGEX_LITERAL = /^\/(.+)\/([a-z]*)$/s;
const SCHEME_PREFIX = /^[a-z][a-z0-9+.-]*:\/\//i;
const HOST = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*(:\d{1,5})?$/i;
const ALLOWED_FLAGS = /^[imsu]*$/;
// A quantified group that itself contains a quantifier, e.g. (a+)+ or (\w*)*:
// the classic catastrophic-backtracking shape. Rules can come from imported
// files, and one bad regex would freeze the worker on every tab.
const NESTED_QUANTIFIER = /\((?:[^()\\]|\\.)*[+*}](?:[^()\\]|\\.)*\)\s*(?:[+*]|\{\d+,\d*\})/;
// Upper bound for text a regex is run against (URLs can be megabytes as data: URLs).
export const MAX_TEST_LENGTH = 2048;
const DEFAULT_PORTS = { 'http:': '80', 'https:': '443', 'ws:': '80', 'wss:': '443' };

const compileRegex = (source, flags) => {
  if (!ALLOWED_FLAGS.test(flags)) return { error: `unsupported regex flag in "${flags}"` };
  if (NESTED_QUANTIFIER.test(source)) return { error: 'nested quantifiers like (a+)+ can freeze the browser' };
  try {
    const finalFlags = flags.includes('i') ? flags : `${flags}i`;
    const regex = new RegExp(source, finalFlags);
    return { regex: { test: (text) => regex.test(text.slice(0, MAX_TEST_LENGTH)) } };
  } catch (error) {
    return { error: error.message };
  }
};

const hostMatches = (hostname, domain) => hostname === domain || hostname.endsWith(`.${domain}`);

const effectivePort = (parsed) => parsed.port || DEFAULT_PORTS[parsed.protocol] || '';

const parseHostTerm = (raw) => {
  const text = raw.replace(/^\*\./, '');
  const slash = text.indexOf('/');
  const host = (slash === -1 ? text : text.slice(0, slash)).toLowerCase();
  const path = slash === -1 ? '' : text.slice(slash).toLowerCase();
  if (!HOST.test(host)) return { error: `"${host}" is not a valid domain` };

  const [hostname, port] = host.split(':');
  // Single words are almost always a typo or a stray word from "a & b" text;
  // allow them only for localhost or with an explicit port.
  if (!hostname.includes('.') && hostname !== 'localhost' && !port) {
    return { error: `"${host}" is not a valid domain (missing a dot)` };
  }
  const testHost = (parsed) =>
    parsed !== null &&
    hostMatches(parsed.hostname.toLowerCase(), hostname) &&
    (port === undefined || effectivePort(parsed) === port);

  if (!path || path === '/') {
    return { term: { kind: 'domain', test: (tab) => testHost(tab.parsed) } };
  }
  return {
    term: {
      kind: 'path',
      test: (tab) => {
        if (!testHost(tab.parsed)) return false;
        const rest = `${tab.parsed.pathname}${tab.parsed.search}${tab.parsed.hash}`.toLowerCase();
        return decodeURIComponentSafe(rest).startsWith(path) || rest.startsWith(path);
      },
    },
  };
};

const decodeURIComponentSafe = (value) => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

const parseTerm = (raw) => {
  const text = raw.trim();
  if (!text) return { error: 'empty pattern' };

  const titleMatch = /^title:\s*(.*)$/is.exec(text);
  if (titleMatch) {
    const value = titleMatch[1].trim().normalize('NFC');
    if (!value) return { error: 'title: needs a text' };
    const literal = REGEX_LITERAL.exec(value);
    if (literal) {
      const { regex, error } = compileRegex(literal[1], literal[2]);
      return error ? { error } : { term: { kind: 'title', test: (tab) => regex.test(tab.title) } };
    }
    const needle = value.toLowerCase();
    return { term: { kind: 'title', test: (tab) => tab.title.toLowerCase().includes(needle) } };
  }

  const urlRegex = /^url:\s*(.*)$/is.exec(text);
  const literal = REGEX_LITERAL.exec(urlRegex ? urlRegex[1].trim() : text);
  if (literal) {
    const { regex, error } = compileRegex(literal[1], literal[2]);
    return error ? { error } : { term: { kind: 'regex', test: (tab) => regex.test(tab.url) } };
  }
  if (urlRegex) return { error: 'url: expects a regex like url:/github\\.com/' };

  if (SCHEME_PREFIX.test(text)) {
    const prefix = text.toLowerCase();
    return { term: { kind: 'prefix', test: (tab) => tab.url.toLowerCase().startsWith(prefix) } };
  }
  return parseHostTerm(text);
};

const OPEN_REGEX = /^(?:title:|url:)?\s*(\/.*)$/is;
const PLAIN_TITLE = /^title:\s*(?!\/)/i;

/**
 * Splits "a & b" into terms, but keeps " & " that belongs to a regex literal
 * ("title:/a & b/") or to plain title text ("title:Terms & Conditions").
 */
export const splitTerms = (pattern) => {
  const pieces = pattern.split(/(\s+&\s+)/);
  const terms = [];
  for (let i = 0; i < pieces.length; i += 2) {
    const piece = pieces[i];
    const last = terms.at(-1);
    const separator = pieces[i - 1];
    const lastIsOpenRegex = last !== undefined && OPEN_REGEX.test(last) && !REGEX_LITERAL.test(OPEN_REGEX.exec(last)[1].trim());
    const continuesTitle = last !== undefined && PLAIN_TITLE.test(last) && piece.trim() !== '' && parseTerm(piece).error;
    if (lastIsOpenRegex || continuesTitle) {
      terms[terms.length - 1] = `${last}${separator}${piece}`;
    } else {
      terms.push(piece);
    }
  }
  return terms;
};

/**
 * Parses one user pattern. Never throws.
 * @param {string} pattern
 * @returns {ParseResult}
 */
export const parsePattern = (pattern) => {
  if (typeof pattern !== 'string' || !pattern.trim()) return { ok: false, error: 'empty pattern' };
  const parts = splitTerms(pattern);
  const terms = [];
  for (const part of parts) {
    const { term, error } = parseTerm(part);
    if (error) return { ok: false, error };
    terms.push(term);
  }
  return { ok: true, kind: terms.length > 1 ? 'combo' : terms[0].kind, terms };
};

/**
 * @param {string|undefined} url
 * @param {string|undefined} title
 * @returns {NormalizedTab}
 */
export const normalizeTab = (url, title) => {
  // NFC: macOS file names (and so PDF tab titles) arrive decomposed ("u" + "¨").
  const cleanUrl = (url || '').normalize('NFC');
  let parsed = null;
  try {
    parsed = new URL(cleanUrl);
  } catch {
    parsed = null;
  }
  return { url: cleanUrl, parsed, title: (title || '').normalize('NFC') };
};

/** @param {ParseResult} parsed @param {NormalizedTab} tab */
export const patternMatches = (parsed, tab) => parsed.ok && parsed.terms.every((term) => term.test(tab));
