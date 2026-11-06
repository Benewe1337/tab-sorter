import { classify } from './config.js';

export const TAB_GROUP_ID_NONE = -1;

export const hostOf = (url) => {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
};

/**
 * A tab the user pulled out of a group by hand stays ungrouped until it
 * navigates to another host. optOuts maps tabId -> host at opt-out time.
 */
export const isOptedOut = (tab, optOuts) => {
  const host = optOuts[String(tab.id)];
  return host !== undefined && host === hostOf(tab.url || tab.pendingUrl || '');
};

/**
 * Which tabs of one window go where. Only ungrouped, unpinned tabs count.
 * @returns {Map<string, {group: object, tabs: object[]}>} keyed by group id
 */
export const planWindow = (tabs, compiledGroups, optOuts = {}) => {
  const plan = new Map();
  for (const tab of tabs) {
    if (tab.pinned || tab.groupId !== TAB_GROUP_ID_NONE) continue;
    if (isOptedOut(tab, optOuts)) continue;
    const group = classify(tab.url || tab.pendingUrl, tab.title, compiledGroups);
    if (!group) continue;
    const entry = plan.get(group.id) ?? { group, tabs: [] };
    plan.set(group.id, { ...entry, tabs: [...entry.tabs, tab] });
  }
  return plan;
};

const findGroup = (existingGroups, title) =>
  existingGroups.find((g) => (g.title || '').trim().toLowerCase() === title.trim().toLowerCase());

/**
 * Moves every ungrouped tab that matches a rule into its group, creating the
 * group in that window if needed. Existing groups are found by title
 * (case-insensitive) and keep their color.
 *
 * @param {{tabs: any, tabGroups: any, windows: any}} api  the chrome.* namespaces
 * @returns {Promise<{moved:number, created:string[], errors:string[]}>}
 */
export const sortTabs = async (api, compiledGroups, optOuts = {}) => {
  const result = { moved: 0, created: [], errors: [] };
  if (compiledGroups.length === 0) return result;
  const windows = await api.windows.getAll({ populate: true, windowTypes: ['normal'] });

  for (const win of windows) {
    if (win.incognito) continue;
    const plan = planWindow(win.tabs || [], compiledGroups, optOuts);
    if (plan.size === 0) continue;
    const existing = await api.tabGroups.query({ windowId: win.id });

    for (const { group, tabs } of plan.values()) {
      const tabIds = tabs.map((t) => t.id);
      try {
        const target = findGroup(existing, group.title);
        if (target) {
          await api.tabs.group({ groupId: target.id, tabIds });
        } else {
          const groupId = await api.tabs.group({ tabIds, createProperties: { windowId: win.id } });
          await api.tabGroups.update(groupId, { title: group.title, color: group.color });
          existing.push({ id: groupId, title: group.title });
          result.created.push(group.title);
        }
        result.moved += tabIds.length;
      } catch (error) {
        // A tab can close or a drag can be in progress between query and move;
        // the next run picks it up again.
        result.errors.push(`${group.title}: ${error?.message ?? error}`);
      }
    }
  }
  return result;
};
