import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePattern, normalizeTab, patternMatches } from '../extension/lib/patterns.js';

const matches = (pattern, url, title = '') => patternMatches(parsePattern(pattern), normalizeTab(url, title));

test('domain includes subdomains but not lookalikes', () => {
  assert.equal(parsePattern('example.com').kind, 'domain');
  assert.ok(matches('example.com', 'https://example.com/'));
  assert.ok(matches('example.com', 'https://docs.example.com/x'));
  assert.ok(matches('*.example.com', 'https://app.example.com/'));
  assert.ok(matches('EXAMPLE.com', 'https://docs.example.com/'));
  assert.ok(!matches('example.com', 'https://evilexample.com/'));
  assert.ok(!matches('example.com', 'https://example.com.evil.com/'));
});

test('domain with path is a case-insensitive prefix', () => {
  assert.equal(parsePattern('github.com/acme-corp').kind, 'path');
  assert.ok(matches('github.com/acme-corp', 'https://github.com/acme-corp/rocket/pull/1'));
  assert.ok(matches('github.com/ACME-CORP', 'https://github.com/acme-corp'));
  assert.ok(!matches('github.com/acme-corp', 'https://github.com/notifications'));
  assert.ok(!matches('github.com/acme-corp', 'https://gitlab.com/acme-corp'));
});

test('host with port', () => {
  assert.ok(matches('localhost:5173', 'http://localhost:5173/app'));
  assert.ok(!matches('localhost:5173', 'http://localhost:3000/'));
  assert.ok(matches('localhost', 'http://localhost:3000/'));
});

test('title contains and title regex', () => {
  assert.equal(parsePattern('title:Roadmap').kind, 'title');
  assert.ok(matches('title:roadmap', 'https://docs.google.com/x', 'Roadmap 2027 - Google Sheets'));
  assert.ok(matches('title:/pr(ü|ue)fung/', 'file:///a.pdf', 'Prüfungsaufgaben.pdf'), 'NFD title normalized');
  assert.ok(!matches('title:roadmap', 'https://acme.dev', 'Home'));
});

test('url regex, with or without url: prefix', () => {
  assert.equal(parsePattern('/docs\\.google\\.com\\/spreadsheets/').kind, 'regex');
  assert.ok(matches('/docs\\.google\\.com\\/spreadsheets/', 'https://docs.google.com/spreadsheets/d/1'));
  assert.ok(matches('url:/^file:.*\\/Uni\\//', 'file:///Users/x/Uni/a.pdf'));
});

test('scheme prefix', () => {
  assert.equal(parsePattern('file://').kind, 'prefix');
  assert.ok(matches('file://', 'file:///Users/x/a.pdf'));
  assert.ok(!matches('file://', 'https://x.de'));
});

test('combined terms must all match', () => {
  const parsed = parsePattern('outlook.office.com & title:/\\bWork\\b/');
  assert.equal(parsed.kind, 'combo');
  assert.ok(matches('outlook.office.com & title:/\\bWork\\b/', 'https://outlook.office.com/mail', 'Jane Doe - Work – Outlook'));
  assert.ok(!matches('outlook.office.com & title:/\\bWork\\b/', 'https://outlook.office.com/mail', 'Private – Outlook'));
});

test('" & " inside title text or regex literals is not a combo separator', () => {
  assert.equal(parsePattern('title:Terms & Conditions').kind, 'title');
  assert.ok(matches('title:Terms & Conditions', 'https://x.de', 'Terms & Conditions – Shop'));
  assert.ok(!matches('title:Terms & Conditions', 'https://x.de', 'Terms of use'));
  assert.equal(parsePattern('title:/a & b/').kind, 'title');
  assert.ok(matches('title:/rock & roll/', 'https://x.de', 'Rock & Roll'));
  assert.equal(parsePattern('url:/a & b/').kind, 'regex');
  assert.equal(parsePattern('x.de & title:Shop').kind, 'combo');
  assert.equal(parsePattern('title:Shop & x.de').kind, 'combo', 'valid domain after title is still a combo');
});

test('explicit default port matches', () => {
  assert.ok(matches('example.com:443', 'https://example.com/'));
  assert.ok(matches('example.com:80', 'http://example.com/'));
  assert.ok(!matches('example.com:443', 'http://example.com/'));
  assert.ok(matches('example.com:8443', 'https://api.example.com:8443/'));
});

test('regexes with nested quantifiers are rejected', () => {
  for (const bad of ['/(a+)+$/', 'title:/(\\w*)*x/', 'url:/(x|y+){2,}/']) {
    const parsed = parsePattern(bad);
    assert.equal(parsed.ok, false, bad);
    assert.match(parsed.error, /nested/);
  }
  assert.ok(parsePattern('/(ab)+c/').ok, 'plain repeated group is fine');
  assert.ok(parsePattern('title:/(Uni|Studium)\\//').ok);
});

test('regex input is capped so huge URLs stay cheap', () => {
  const huge = `https://x.de/${'a'.repeat(100000)}END`;
  assert.ok(!matches('/END$/', huge));
});

test('invalid patterns report an error instead of throwing', () => {
  for (const bad of ['', '   ', 'title:', 'title:/(/', '/[/', 'url:github', 'not a domain', 'a..b', 'x.de & ', 'title:/x/g', 'jira']) {
    const parsed = parsePattern(bad);
    assert.equal(parsed.ok, false, `expected "${bad}" to be invalid`);
    assert.equal(typeof parsed.error, 'string');
  }
  assert.equal(parsePattern(undefined).ok, false);
});

test('unparseable URLs never match host rules', () => {
  assert.ok(!matches('github.com', 'not a url'));
  assert.ok(!matches('github.com', ''));
});
