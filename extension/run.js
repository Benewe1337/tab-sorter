// Opened by bin/sort-tabs: asks the service worker to sort, then closes itself.
const msg = (key, ...subs) => chrome.i18n.getMessage(key, subs.map(String)) || key;
const status = document.getElementById('status');
status.textContent = msg('runPageSorting');

const response = await chrome.runtime.sendMessage({ type: 'sort', reason: 'cli' });
status.textContent = response?.ok
  ? msg('sortedCount', response.result.moved)
  : msg('sortFailed', response?.error ?? '?');
document.title = status.textContent;

const self = await chrome.tabs.getCurrent();
setTimeout(() => chrome.tabs.remove(self.id), response?.ok ? 300 : 5000);
