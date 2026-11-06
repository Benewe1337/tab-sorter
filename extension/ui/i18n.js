// chrome.i18n helpers. Messages live in _locales/<lang>/messages.json.

/** @param {string} key @param {...(string|number)} subs */
export const t = (key, ...subs) => chrome.i18n.getMessage(key, subs.map(String)) || key;

/**
 * Fills static markup: data-i18n (text), data-i18n-placeholder,
 * data-i18n-aria (aria-label) and data-i18n-title.
 * @param {ParentNode} root
 */
export const applyI18n = (root = document) => {
  for (const el of root.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const el of root.querySelectorAll('[data-i18n-placeholder]')) el.placeholder = t(el.dataset.i18nPlaceholder);
  for (const el of root.querySelectorAll('[data-i18n-aria]')) el.setAttribute('aria-label', t(el.dataset.i18nAria));
  for (const el of root.querySelectorAll('[data-i18n-title]')) el.title = t(el.dataset.i18nTitle);
};

/** "vor 3 Min." / "3 min ago" via Intl, falls back to the plain time. */
export const relativeTime = (timestamp, now = Date.now()) => {
  const seconds = Math.round((timestamp - now) / 1000);
  const rtf = new Intl.RelativeTimeFormat(chrome.i18n.getUILanguage(), { numeric: 'auto', style: 'short' });
  if (Math.abs(seconds) < 60) return rtf.format(seconds, 'second');
  if (Math.abs(seconds) < 3600) return rtf.format(Math.round(seconds / 60), 'minute');
  if (Math.abs(seconds) < 86400) return rtf.format(Math.round(seconds / 3600), 'hour');
  return new Date(timestamp).toLocaleString(chrome.i18n.getUILanguage());
};
