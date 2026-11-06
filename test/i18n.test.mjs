import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { COLORS } from '../extension/lib/config.js';
import { PRESETS } from '../extension/lib/presets.js';

const ext = join(dirname(fileURLToPath(import.meta.url)), '..', 'extension');
const locale = (lang) => JSON.parse(readFileSync(join(ext, '_locales', lang, 'messages.json'), 'utf8'));
const en = locale('en');
const de = locale('de');

const sources = [
  ...readdirSync(join(ext, 'ui')).map((f) => join(ext, 'ui', f)),
  join(ext, 'manifest.json'),
  join(ext, 'run.js'),
].filter((f) => /\.(html|js|json)$/.test(f));

const usedKeys = () => {
  const keys = new Set();
  for (const file of sources) {
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(/\bt\('([A-Za-z_]+)'/g)) keys.add(m[1]);
    for (const m of text.matchAll(/data-i18n(?:-[a-z]+)?="([A-Za-z_]+)"/g)) keys.add(m[1]);
    for (const m of text.matchAll(/__MSG_([A-Za-z_]+)__/g)) keys.add(m[1]);
    for (const m of text.matchAll(/getMessage\('([A-Za-z_]+)'/g)) keys.add(m[1]);
  }
  // keys built dynamically in code
  for (const kind of ['domain', 'path', 'title', 'regex', 'prefix', 'combo', 'invalid']) keys.add(`kind_${kind}`);
  for (const color of COLORS) keys.add(`color_${color}`);
  for (const preset of Object.values(PRESETS)) keys.add(preset.labelKey);
  return keys;
};

test('en and de have exactly the same keys', () => {
  assert.deepEqual(Object.keys(de).sort(), Object.keys(en).sort());
});

test('every key used in the UI exists', () => {
  const missing = [...usedKeys()].filter((key) => !(key in en));
  assert.deepEqual(missing, []);
});

test('placeholders match between languages', () => {
  for (const key of Object.keys(en)) {
    const count = (s) => (s.match(/\$\d/g) ?? []).sort().join();
    assert.equal(count(de[key].message), count(en[key].message), key);
  }
});
