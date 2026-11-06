import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sortTabs, planWindow, isOptedOut } from '../extension/lib/sorter.js';
import { compileGroups, normalizeConfig } from '../extension/lib/config.js';

const groups = compileGroups(normalizeConfig({ groups: [
  { id: 'k', title: 'Acme', color: 'red', patterns: ['acme.dev'] },
  { id: 'n', title: 'Uni', color: 'green', patterns: ['example.edu'] },
  { id: 'h', title: 'Games', color: 'cyan', patterns: ['op.gg'] },
] }).groups);

/** Minimal in-memory stand-in for chrome.tabs / tabGroups / windows. */
const fakeBrowser = (windows, existingGroups = []) => {
  let nextGroupId = 100 + existingGroups.length;
  const state = { windows, groups: [...existingGroups], calls: [] };
  const allTabs = () => state.windows.flatMap((w) => w.tabs);
  const api = {
    windows: { getAll: async () => state.windows },
    tabGroups: {
      query: async ({ windowId }) => state.groups.filter((g) => g.windowId === windowId),
      update: async (id, props) => {
        state.calls.push(['update', id, props]);
        Object.assign(state.groups.find((g) => g.id === id), props);
      },
    },
    tabs: {
      group: async ({ groupId, tabIds, createProperties }) => {
        state.calls.push(['group', groupId ?? 'new', tabIds]);
        let id = groupId;
        if (id === undefined) {
          id = nextGroupId++;
          state.groups.push({ id, windowId: createProperties.windowId, title: '' });
        }
        for (const tab of allTabs()) if (tabIds.includes(tab.id)) tab.groupId = id;
        return id;
      },
    },
  };
  return { api, state };
};

const tab = (id, url, title = '', extra = {}) => ({ id, url, title, groupId: -1, pinned: false, ...extra });

test('creates missing groups and reuses existing ones by title (case-insensitive)', async () => {
  const { api, state } = fakeBrowser(
    [{ id: 1, tabs: [
      tab(1, 'https://acme.dev/'),
      tab(2, 'https://learn.example.edu/'),
      tab(3, 'https://mail.example.edu/'),
      tab(4, 'https://chatgpt.com/'),
    ] }],
    [{ id: 50, windowId: 1, title: 'uni', color: 'purple' }],
  );
  const result = await sortTabs(api, groups);
  assert.equal(result.moved, 3);
  assert.deepEqual(result.created, ['Acme']);
  assert.deepEqual(state.calls.find((c) => c[1] === 50), ['group', 50, [2, 3]]);
  assert.equal(state.groups.find((g) => g.id === 50).color, 'purple', 'existing color kept');
  assert.equal(state.groups.find((g) => g.title === 'Acme').color, 'red');
  assert.equal(state.windows[0].tabs[3].groupId, -1, 'unmatched tab untouched');
});

test('no rules: nothing happens, no API calls', async () => {
  const { api, state } = fakeBrowser([{ id: 1, tabs: [tab(1, 'https://acme.dev/')] }]);
  const result = await sortTabs(api, []);
  assert.equal(result.moved, 0);
  assert.equal(state.calls.length, 0);
});

test('never touches pinned tabs or tabs already in any group', () => {
  const plan = planWindow([
    tab(1, 'https://acme.dev/', '', { pinned: true }),
    tab(2, 'https://acme.dev/', '', { groupId: 7 }),
    tab(3, 'https://acme.dev/'),
  ], groups);
  assert.deepEqual([...plan.values()].map((p) => p.tabs.map((t) => t.id)), [[3]]);
});

test('second run is a no-op', async () => {
  const { api } = fakeBrowser([{ id: 1, tabs: [tab(1, 'https://op.gg/')] }]);
  await sortTabs(api, groups);
  const again = await sortTabs(api, groups);
  assert.equal(again.moved, 0);
  assert.deepEqual(again.created, []);
});

test('groups are created per window', async () => {
  const { api, state } = fakeBrowser([
    { id: 1, tabs: [tab(1, 'https://op.gg/')] },
    { id: 2, tabs: [tab(2, 'https://op.gg/')] },
  ]);
  await sortTabs(api, groups);
  assert.deepEqual(state.groups.map((g) => [g.windowId, g.title]), [[1, 'Games'], [2, 'Games']]);
});

test('incognito windows are skipped', async () => {
  const { api, state } = fakeBrowser([{ id: 1, incognito: true, tabs: [tab(1, 'https://op.gg/')] }]);
  await sortTabs(api, groups);
  assert.equal(state.calls.length, 0);
});

test('opted-out tab is skipped until it changes host', () => {
  const optOuts = { 1: 'acme.dev' };
  assert.equal(isOptedOut(tab(1, 'https://acme.dev/play'), optOuts), true);
  assert.equal(isOptedOut(tab(1, 'https://other.dev/'), optOuts), false);
  assert.equal(planWindow([tab(1, 'https://acme.dev/')], groups, optOuts).size, 0);
});

test('an API error for one group does not stop the others', async () => {
  const { api } = fakeBrowser([{ id: 1, tabs: [tab(1, 'https://op.gg/'), tab(2, 'https://acme.dev/')] }]);
  const original = api.tabs.group;
  api.tabs.group = async (args) => {
    if (args.tabIds.includes(1)) throw new Error('Tabs cannot be edited right now (user may be dragging a tab).');
    return original(args);
  };
  const result = await sortTabs(api, groups);
  assert.equal(result.moved, 1);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /Games/);
});
