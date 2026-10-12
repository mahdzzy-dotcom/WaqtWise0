'use strict';

// Bad or extreme values in a data file or an import must never stop the app or produce invalid dates.

const test = require('node:test');
const assert = require('node:assert/strict');
const { createTask, normalizeData, ReminderEngine, validateTask, validateRule, normalizeRule, getOccurrences, emptyData } = require('../src/core');
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
