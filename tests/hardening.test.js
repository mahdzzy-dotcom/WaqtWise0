'use strict';

// Bad or extreme values in a data file or an import must never stop the app or produce invalid dates.

const test = require('node:test');
const assert = require('node:assert/strict');
const { createTask, normalizeData, ReminderEngine, validateTask, validateStart, validateRule, normalizeRule, getOccurrences, emptyData } = require('../src/core');
const { MAX_DURATION_MINUTES, MAX_OFFSET_MINUTES, MAX_INTERVAL, MAX_COUNT, MAX_TASKS } = require('../src/core/limits');
const { at, provider } = require('./helpers');

const base = (extra = {}) => ({
  id: 't1', title: 'Task', start: { mode: 'fixed', time: '09:00' }, durationMinutes: 30, date: '2026-10-04',
  reminders: { enabled: true, offsets: [10] }, ...extra,
});

function engineFor(initialState) {
  return new ReminderEngine({
    getTasks: () => [], getProvider: () => provider, getSettings: () => ({}), notify() {}, showAlert() {}, onMissed() {},
    updateTask() {}, initialState, saveState() {}, now: () => at('2026-10-04', '08:00'),
    setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
  });
}

test('a damaged reminder state in the data file is repaired and the reminder engine still starts', () => {
  const shapes = [
    { delivered: {}, lastTickAt: null, snoozed: {} },
    { delivered: [], lastTickAt: 'x', snoozed: 'abc' },
    { delivered: 5, lastTickAt: {}, snoozed: 7 },
    { delivered: { a: 'x', b: 12 }, lastTickAt: NaN, snoozed: [null, 3, { taskId: 1 }, { taskId: 't', dateKey: '2026-10-04', until: 5 }] },
    'text', 12, [],
  ];
  for (const shape of shapes) {
    const { data } = normalizeData({ ...emptyData(), reminderState: shape });
    assert.ok(Array.isArray(data.reminderState.snoozed), JSON.stringify(shape));
    assert.ok(data.reminderState.delivered && typeof data.reminderState.delivered === 'object' && !Array.isArray(data.reminderState.delivered));
    assert.ok(data.reminderState.lastTickAt === null || Number.isFinite(data.reminderState.lastTickAt));
    for (const s of data.reminderState.snoozed) {
      assert.equal(typeof s.taskId, 'string');
      assert.equal(typeof s.dateKey, 'string');
      assert.ok(Number.isFinite(s.until));
    }
    for (const v of Object.values(data.reminderState.delivered)) assert.ok(Number.isFinite(v));
    assert.doesNotThrow(() => engineFor(data.reminderState));
    // even a state that did not come through normalizeData must not stop the engine
    assert.doesNotThrow(() => engineFor(shape));
  }
});

test('a good reminder state is kept as it is, and a dropped part is reported', () => {
  const good = { delivered: { 'a@2026-10-04#10': 111 }, lastTickAt: 222, snoozed: [{ taskId: 't1', dateKey: '2026-10-04', until: 333, fullScreen: true }] };
  const kept = normalizeData({ ...emptyData(), reminderState: good });
  assert.deepEqual(kept.data.reminderState, good);
  assert.deepEqual(kept.warnings, []);
  const damaged = normalizeData({ ...emptyData(), reminderState: { delivered: {}, lastTickAt: null, snoozed: {} } });
  assert.equal(damaged.warnings.length, 1);
});

test('a task duration has an upper limit, and the end time is always a valid date', () => {
  for (const minutes of [Number.MAX_SAFE_INTEGER, 1e12, MAX_DURATION_MINUTES + 1, Infinity, NaN, 1.5, 0, -5]) {
    assert.throws(() => createTask(base({ durationMinutes: minutes })), undefined, String(minutes));
  }
  const ok = createTask(base({ durationMinutes: MAX_DURATION_MINUTES }));
  const [occurrence] = getOccurrences(provider, ok, '2026-10-04', '2026-10-04');
  assert.ok(Number.isFinite(occurrence.end.getTime()));
});

test('offsets, intervals and counts have upper limits', () => {
  const rel = (minutes) => ({ mode: 'prayer', prayer: 'fajr', direction: 'before', minutes });
  assert.deepEqual(validateTask(createTask(base())), []);
  assert.notDeepEqual(validateTask({ ...createTask(base()), start: rel(MAX_OFFSET_MINUTES + 1) }), []);
  assert.deepEqual(validateTask({ ...createTask(base()), start: rel(MAX_OFFSET_MINUTES) }), []);
  assert.notDeepEqual(validateTask({ ...createTask(base()), reminders: { enabled: true, offsets: [1e15] } }), []);
  const rule = (extra) => normalizeRule({ frequency: 'daily', interval: 1, startDate: '2026-10-04', end: { type: 'never' }, ...extra });
  assert.notDeepEqual(validateRule(rule({ interval: MAX_INTERVAL + 1 })), []);
  assert.deepEqual(validateRule(rule({ interval: MAX_INTERVAL })), []);
  assert.notDeepEqual(validateRule(rule({ end: { type: 'count', count: MAX_COUNT + 1 } })), []);
  assert.deepEqual(validateRule(rule({ end: { type: 'count', count: MAX_COUNT } })), []);
});

test('a bad single-occurrence override in a file is cleaned, not trusted', () => {
  const raw = {
    ...createTask(base()),
    overrides: {
      '2026-10-04': { durationMinutes: Number.MAX_SAFE_INTEGER, title: 'Kept title', priority: 'Urgent', start: { mode: 'x' } },
      'not-a-date': { title: 'x' },
      '2026-10-05': 'text',
      '2026-10-06': { durationMinutes: 45 },
    },
  };
  const { data } = normalizeData({ ...emptyData(), tasks: [raw] });
  assert.equal(data.tasks.length, 1);
  const o = data.tasks[0].overrides;
  assert.deepEqual(Object.keys(o).sort(), ['2026-10-04', '2026-10-06']);
  assert.deepEqual(o['2026-10-04'], { title: 'Kept title' });
  assert.deepEqual(o['2026-10-06'], { durationMinutes: 45 });
  for (const occurrence of getOccurrences(provider, data.tasks[0], '2026-10-04', '2026-10-06')) assert.ok(Number.isFinite(occurrence.end.getTime()));
});

test('an enormous task list in a file is cut with a warning', () => {
  const tasks = [];
  for (let i = 0; i < MAX_TASKS + 3; i++) tasks.push({ ...createTask(base({ id: `t${i}` })) });
  const { data, warnings } = normalizeData({ ...emptyData(), tasks });
  assert.equal(data.tasks.length, MAX_TASKS);
  assert.equal(warnings.length, 1);
});

test('"start after another task" has the same upper limit on its minutes, in the logic and in files', () => {
  const rel = (minutes) => ({ mode: 'task', taskId: 'other', point: 'end', direction: 'after', minutes, fallbackTime: '09:00' });
  for (const minutes of [MAX_OFFSET_MINUTES + 1, Number.MAX_SAFE_INTEGER, 1e15, NaN, -1, 1.5]) {
    assert.notDeepEqual(validateStart(rel(minutes)), [], String(minutes));
    assert.throws(() => createTask(base({ start: rel(minutes) })), undefined, String(minutes));
  }
  assert.deepEqual(validateStart(rel(MAX_OFFSET_MINUTES)), []);
  // in a data file: the task is skipped with a warning, and a bad override value is dropped
  const other = createTask(base({ id: 'other' }));
  const bad = { ...createTask(base({ id: 'bad', start: rel(10) })), start: rel(Number.MAX_SAFE_INTEGER) };
  const withOverride = { ...createTask(base({ id: 'ov', start: rel(10) })), overrides: { '2026-10-04': { start: rel(Number.MAX_SAFE_INTEGER), title: 'ok' } } };
  const { data, warnings } = normalizeData({ ...emptyData(), tasks: [other, bad, withOverride] });
  assert.deepEqual(data.tasks.map((t) => t.id), ['other', 'ov']);
  assert.equal(warnings.length, 1);
  assert.deepEqual(data.tasks[1].overrides['2026-10-04'], { title: 'ok' });
});

test('reminders: "enabled" must be on or off (a text like "false" is not "on"), and the offsets are tidied', () => {
  assert.notDeepEqual(validateTask({ ...createTask(base()), reminders: { enabled: 'false', offsets: [10] } }), []);
  assert.notDeepEqual(validateTask({ ...createTask(base()), reminders: { enabled: 1, offsets: [10] } }), []);
  assert.throws(() => createTask(base({ reminders: { enabled: 'yes', offsets: [] } })));
  // in a data file: the text is read as "off", the offsets are sorted and made unique
  const raw = { ...createTask(base()), reminders: { enabled: 'false', offsets: [30, 10, 10, 60] } };
  const { data } = normalizeData({ ...emptyData(), tasks: [raw] });
  assert.deepEqual(data.tasks[0].reminders, { enabled: false, offsets: [10, 30, 60] });
  const on = { ...createTask(base()), reminders: { enabled: true, offsets: [60, 10, 60], fullScreen: true } };
  assert.deepEqual(normalizeData({ ...emptyData(), tasks: [on] }).data.tasks[0].reminders, { enabled: true, offsets: [10, 60], fullScreen: true });
  // a bad override value for reminders is dropped
  const ov = { ...createTask(base()), overrides: { '2026-10-04': { reminders: { enabled: 'x', offsets: [1] }, title: 'kept' } } };
  assert.deepEqual(normalizeData({ ...emptyData(), tasks: [ov] }).data.tasks[0].overrides['2026-10-04'], { title: 'kept' });
});

test('exceptions, additions, completions and completion times keep only real dates and valid values', () => {
  const raw = {
    ...createTask(base()),
    exceptions: ['2026-10-05', 'x', '2026-13-45', 7],
    additions: ['2026-10-06', '', null],
    completions: { '2026-10-04': true, 'nope': true, '2026-10-05': 'yes', '2026-10-06': false },
    completedAt: { '2026-10-04': '2026-10-04T08:41:00.000Z', '2026-10-05': 'Oct 5 2026', '2026-10-06': '+275760-09-13T00:00:00.000Z', bad: '2026-10-04T08:41:00.000Z' },
  };
  const { data } = normalizeData({ ...emptyData(), tasks: [raw] });
  const t = data.tasks[0];
  assert.deepEqual(t.exceptions, ['2026-10-05']);
  assert.deepEqual(t.additions, ['2026-10-06']);
  assert.deepEqual(t.completions, { '2026-10-04': true });
  assert.deepEqual(t.completedAt, { '2026-10-04': '2026-10-04T08:41:00.000Z' });
});
