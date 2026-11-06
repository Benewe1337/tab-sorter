import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeConfig, validateImport, compileGroups, classify, initialConfig, DEFAULT_SETTINGS, MAX_TITLE,
} from '../extension/lib/config.js';
import { parsePattern } from '../extension/lib/patterns.js';
import { PRESETS } from '../extension/lib/presets.js';

// A realistic rule set covering every pattern kind and priority interplay.
const fixture = compileGroups(normalizeConfig({ groups: [
  { title: 'Acme', color: 'red', patterns: ['acme.dev', 'github.com/acme-corp', 'title:/acme|roadrunner/'] },
  { title: 'Club', color: 'blue', patterns: ['club.example.org', 'github.com/orgs/example-club', 'title:Example Club'] },
  { title: 'Games', color: 'cyan', patterns: ['op.gg', 'speedrun.com', 'title:/\\bspeedrun\\b/'] },
  {
    title: 'Uni',
    color: 'green',
    patterns: [
      'uni.example.edu',
      'outlook.office.com & title:/\\bStudent\\b/',
      'url:/^file:.*\\/(Uni|Lectures)\\//',
      'file:// & title:/exam|lecture|quiz/',
    ],
  },
  { title: 'Code', color: 'purple', patterns: ['github.com', 'vercel.app', 'localhost', 'example.com/tools'] },
] }).groups);

const cases = [
  ['https://acme.dev/', 'Acme', 'Acme'],
  ['https://docs.acme.dev/guide', 'Guide', 'Acme'],
  ['https://github.com/acme-corp/rocket/pull/12', 'PR', 'Acme'],
  ['https://docs.google.com/spreadsheets/d/abc/edit', 'Acme roadmap - Google Sheets', 'Acme'],
  ['https://club.example.org/members', 'Members', 'Club'],
  ['https://github.com/orgs/example-club/repositories', 'repos', 'Club'],
  ['https://teams.example.net/', 'Chat | Example Club | General', 'Club'],
  ['https://www.op.gg/summoners/euw/x', 'OP.GG', 'Games'],
  ['https://www.speedrun.com/games', 'Games', 'Games'],
  ['https://uni.example.edu/login', 'Login', 'Uni'],
  ['https://outlook.office.com/mail/inbox', 'Inbox – Jane Doe - Student – Outlook', 'Uni'],
  ['file:///Users/jane/Uni/notes.pdf', 'notes.pdf', 'Uni'],
  ['file:///Users/jane/Downloads/Exam-2.pdf', 'Exam-2.pdf', 'Uni'],
  ['https://github.com/notifications', 'Notifications', 'Code'],
  ['https://my-tool.vercel.app/', 'My tool', 'Code'],
  ['http://localhost:5173/', 'Vite', 'Code'],
  ['https://example.com/tools/convert', 'Converter', 'Code'],
  ['https://chatgpt.com/c/1', 'Chat', null],
  ['https://outlook.office.com/mail/', 'Inbox – private – Outlook', null],
  ['https://example.com/blog', 'Blog', null],
  ['chrome://newtab/', 'New Tab', null],
  ['', '', null],
];

for (const [url, title, expected] of cases) {
  test(`fixture: ${url || '(empty)'} -> ${expected}`, () => {
    assert.equal(classify(url, title, fixture)?.title ?? null, expected);
  });
}

test('decomposed umlauts in PDF titles still match (macOS NFD)', () => {
  const groups = compileGroups(normalizeConfig({ groups: [{ title: 'Uni', patterns: ['file:// & title:/prüfung/'] }] }).groups);
  assert.equal(classify('file:///a.pdf', 'Prüfungsaufgaben.pdf', groups)?.title, 'Uni');
});

test('every preset pattern parses', () => {
  for (const [name, preset] of Object.entries(PRESETS)) {
    for (const group of preset.groups) {
      for (const pattern of group.patterns) {
        assert.ok(parsePattern(pattern).ok, `${name}/${group.title}: ${pattern}`);
      }
    }
  }
});

test('presets sort typical tabs', () => {
  const starter = compileGroups(normalizeConfig({ groups: PRESETS.starter.groups }).groups);
  assert.equal(classify('https://github.com/torvalds/linux', '', starter)?.title, 'Code');
  assert.equal(classify('https://www.youtube.com/watch?v=1', '', starter)?.title, 'Video');
  assert.equal(classify('https://mail.google.com/mail/u/0', '', starter)?.title, 'Mail');
  const everyday = compileGroups(normalizeConfig({ groups: PRESETS.everyday.groups }).groups);
  assert.equal(classify('https://www.reddit.com/r/chrome', '', everyday)?.title, 'Social');
  assert.equal(classify('https://www.google.com/maps/place/x', '', everyday)?.title, 'Travel');
});

test('group order is priority', () => {
  const groups = compileGroups(normalizeConfig({ groups: [
    { title: 'General', patterns: ['github.com'] },
    { title: 'Specific', patterns: ['github.com/acme'] },
  ] }).groups);
  assert.equal(classify('https://github.com/acme/x', '', groups).title, 'General');
});

test('normalizeConfig repairs garbage', () => {
  const config = normalizeConfig({
    groups: [
      { id: 'a', title: '  ', color: 'magenta', patterns: ['x.de', 'x.de', '', 42, ' y.de '] },
      { id: 'a', title: 'T'.repeat(200), color: 'red' },
      null,
    ],
    settings: { intervalMinutes: 7, sortOnNavigate: 'yes', paused: true },
    extra: 'dropped',
  });
  assert.equal(config.groups.length, 3);
  assert.equal(config.groups[0].title, 'Group 1');
  assert.equal(config.groups[0].color, 'grey');
  assert.deepEqual(config.groups[0].patterns, ['x.de', 'y.de']);
  assert.notEqual(config.groups[1].id, 'a', 'duplicate id replaced');
  assert.equal(config.groups[1].title.length, MAX_TITLE);
  assert.equal(config.settings.intervalMinutes, DEFAULT_SETTINGS.intervalMinutes);
  assert.equal(config.settings.sortOnNavigate, true);
  assert.equal(config.settings.paused, true);
  assert.equal('extra' in config, false);
});

test('normalizeConfig accepts nothing at all', () => {
  assert.deepEqual(normalizeConfig(undefined).groups, []);
  assert.deepEqual(normalizeConfig('nope').settings, { ...DEFAULT_SETTINGS });
});

test('validateImport: fatal without groups, warnings for bad patterns', () => {
  assert.ok(validateImport({}).fatal);
  assert.ok(validateImport(null).fatal);
  const { fatal, warnings } = validateImport({ groups: [{ title: 'A', patterns: ['ok.de', 'title:/(/'] }] });
  assert.equal(fatal, null);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /^A: "title:\/\(\/"/);
});

test('validateImport never throws on malformed groups', () => {
  const { fatal, warnings } = validateImport({ groups: [
    { title: 'S', patterns: 'github.com' },
    { patterns: 42 },
    null,
    { title: 'N', patterns: [null, 7] },
  ] });
  assert.equal(fatal, null);
  assert.equal(warnings.length, 4);
  assert.match(warnings[0], /not a list/);
});

test('initialConfig: empty config when nothing is stored, untouched otherwise', () => {
  assert.deepEqual(initialConfig({ stored: false }).groups, []);
  assert.equal(initialConfig({ stored: true }), null);
});

test('invalid patterns are skipped when compiling', () => {
  const [group] = compileGroups([{ id: '1', title: 'A', color: 'red', patterns: ['/[/', 'ok.de'] }]);
  assert.equal(group.compiled.length, 1);
});
