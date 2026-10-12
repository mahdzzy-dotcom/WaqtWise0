'use strict';

// Lists every translatable text in the source: node tools/i18n-scan.js [--json]
// Used by tests/i18n-coverage.test.js, so a missing Arabic text is caught before release.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'src');
const FILES = [];
(function walk(dir) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) walk(full);
    else if (name.endsWith('.js') && !/^i18n(-ar)?\.js$/.test(name)) FILES.push(full);
  }
})(ROOT);

const STR = String.raw`'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"`;
const unescape = (s) => s.replace(/\\u([0-9a-fA-F]{4})|\\(n|'|"|\\)/g, (m, hex, c) => (hex ? String.fromCharCode(parseInt(hex, 16)) : c === 'n' ? '\n' : c));
const pick = (m, i) => unescape(m[i] !== undefined ? m[i] : m[i + 1]);

// t('x') / T('x') / tr('x') / i18n.t('x')
const SINGLE = new RegExp(String.raw`(?<![\w.$])(?:t|T|tr|i18n\.t)\(\s*(?:${STR})`, 'g');
// tp(n, 'one', 'other') / TP(...)
const PLURAL = new RegExp(String.raw`(?<![\w.$])(?:tp|TP)\(\s*[^,]+?,\s*(?:${STR})\s*,\s*(?:${STR})`, 'g');
// T(flag ? 'a' : 'b')
const TERNARY = new RegExp(String.raw`(?<![\w.$])(?:t|T|tr)\(\s*[^'"()]+?\?\s*(?:${STR})\s*:\s*(?:${STR})`, 'g');

function scan() {
  const singles = new Set();
  const plurals = new Set();
  for (const file of FILES) {
    const text = fs.readFileSync(file, 'utf8').split('\n').filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line)).join('\n');
    for (const m of text.matchAll(SINGLE)) singles.add(pick(m, 1));
    for (const m of text.matchAll(TERNARY)) { singles.add(pick(m, 1)); singles.add(pick(m, 3)); }
    for (const m of text.matchAll(PLURAL)) { plurals.add(pick(m, 3)); singles.add(pick(m, 1)); singles.delete(pick(m, 1)); }
  }
  return { singles, plurals };
}

// Texts that are looked up from data (not written next to the t() call).
function dataTexts() {
  const out = new Set(['AM', 'PM', 'Low', 'Medium', 'High', 'Fajr', 'Dhuhr', 'Asr', 'Maghrib', 'Isha', 'Off',
    'last', '1st', '2nd', '3rd', '4th', 'last (f)', '1st (f)', '2nd (f)', '3rd (f)', '4th (f)',
    'Each bar is one day', 'Each bar is one week', 'Each bar is one month']);
  const { ZONE_NAMES } = require('../src/core/zones');
  const { CITIES } = require('../src/core/cities');
  const { METHOD_LABELS } = require('../src/core/settings');
  ZONE_NAMES.forEach((n) => out.add(n));
  CITIES.forEach((c) => out.add(c.name));
  Object.values(METHOD_LABELS).forEach((n) => out.add(n));
  ['Work', 'Study', 'Worship', 'Personal', 'Health'].forEach((n) => out.add(n));
  const sounds = fs.readFileSync(path.join(ROOT, 'renderer', 'sounds.js'), 'utf8');
  for (const m of sounds.matchAll(/\['\w]+', '([^']+)'\]/g)) out.add(m[1]);
  return out;
}

module.exports = { scan, dataTexts, FILES };

if (require.main === module) {
  const { singles, plurals } = scan();
  for (const k of dataTexts()) singles.add(k);
  if (process.argv.includes('--json')) console.log(JSON.stringify({ singles: [...singles].sort(), plurals: [...plurals].sort() }, null, 1));
  else console.log(`${singles.size} texts, ${plurals.size} plural texts`);
}
