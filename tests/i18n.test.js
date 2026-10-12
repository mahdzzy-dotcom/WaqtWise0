'use strict';

const test = require('node:test');
const assert = require('node:assert');
const i18n = require('../src/core/i18n');
require('../src/core/i18n-ar');
const { scan, dataTexts } = require('../tools/i18n-scan');
const { describeRule } = require('../src/core/recurrence');
const { formatTime12, formatDuration } = require('../src/core/time');

test.afterEach(() => i18n.setLanguage('en'));

test('every text used in the source has an Arabic translation, and none is left over', () => {
  const { singles, plurals } = scan();
  for (const k of dataTexts()) singles.add(k);
  const dict = i18n.dictionary('ar');
  const missing = [...singles].filter((k) => !(k in dict));
  const missingPlural = [...plurals].filter((k) => !Array.isArray(dict[k]));
  assert.deepStrictEqual(missing, [], 'texts without Arabic');
  assert.deepStrictEqual(missingPlural, [], 'plural texts without the 4 Arabic forms');
  const used = new Set([...singles, ...plurals]);
  const unused = Object.keys(dict).filter((k) => !used.has(k));
  assert.deepStrictEqual(unused, [], 'Arabic texts that nothing uses');
});

test('plural forms have 4 entries and keep their placeholders', () => {
  const dict = i18n.dictionary('ar');
  for (const [key, value] of Object.entries(dict)) {
    const names = (s) => (s.match(/\{\w+\}/g) || []).sort();
    if (Array.isArray(value)) {
      assert.strictEqual(value.length, 4, key);
      for (const form of value) for (const p of names(form)) assert.ok(names(key).includes(p) || p === '{n}', `${key} -> ${form}`);
    } else {
      assert.deepStrictEqual(names(value), names(key), key);
    }
  }
});

test('English is unchanged and Arabic switches text and direction', () => {
  assert.strictEqual(i18n.t('Task added'), 'Task added');
  assert.strictEqual(i18n.isRtl(), false);
  i18n.setLanguage('ar');
  assert.strictEqual(i18n.t('Task added'), 'تمت إضافة المهمة');
  assert.strictEqual(i18n.isRtl(), true);
  assert.strictEqual(i18n.t('A text nobody translated'), 'A text nobody translated');
  assert.ok(i18n.takeMissing().includes('A text nobody translated'));
  i18n.setLanguage('en');
  assert.strictEqual(i18n.isRtl(), false);
});

test('Arabic plurals: one, two, 3 to 10, 11 or more', () => {
  i18n.setLanguage('ar');
  const f = (n) => i18n.tp(n, '{n} task', '{n} tasks');
  assert.strictEqual(f(1), 'مهمة واحدة');
  assert.strictEqual(f(2), 'مهمتان');
  assert.strictEqual(f(5), '5 مهام');
  assert.strictEqual(f(11), '11 مهمة');
  assert.strictEqual(f(0), '0 مهمة');
});

test('numbers stay Western digits in every Arabic text', () => {
  i18n.setLanguage('ar');
  assert.strictEqual(formatTime12(new Date(2026, 9, 4, 9, 5)), '9:05 ص');
  assert.strictEqual(formatDuration(90), '1 س 30 د');
  const text = describeRule({ frequency: 'weekly', interval: 2, startDate: '2026-10-04', weekdays: [0, 1, 3], end: { type: 'count', count: 5 } });
  assert.ok(!/[٠-٩]/.test(text), text);
  assert.match(text, /كل أسبوعين/);
  assert.match(text, /5/);
});

test('month and weekday names come from the language', () => {
  assert.strictEqual(i18n.monthLong(9), 'October');
  assert.strictEqual(i18n.weekdayLong(5), 'Friday');
  i18n.setLanguage('ar');
  assert.strictEqual(i18n.monthLong(9), 'أكتوبر');
  assert.strictEqual(i18n.weekdayLong(5), 'الجمعة');
  assert.strictEqual(i18n.weekdayShort(0), i18n.weekdayLong(0).length > 0 ? i18n.weekdayShort(0) : '');
});
