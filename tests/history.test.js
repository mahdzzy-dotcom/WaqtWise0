'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { PlannerService } = require('../src/main/service');
const { MemoryStore } = require('../src/main/store');
const { normalizeData, emptyData } = require('../src/core');
const { at, constantProvider } = require('./helpers');

const form = (title, date) => ({
  title, start: { mode: 'fixed', time: '08:00' }, durationMinutes: 60, date, recurrence: null,
  reminders: { enabled: false, offsets: [] }, priority: 'Medium', categoryId: null, notes: '',
});

function make(clock) {
  let n = 0;
  const store = new MemoryStore();
  const service = new PlannerService({ store, now: () => clock.now, newId: () => `h${++n}`, providerFactory: () => constantProvider });
  return { service, store };
}

const doneKpi = (stats) => stats.kpis.find((k) => k.id === 'done');
const dayStats = (service, key) => doneKpi(service.getStats({ range: 'day', anchorKey: key }));

test('Snapshots: a finished day keeps its numbers even if its task is deleted later', () => {
  const clock = { now: at('2026-10-02', '12:00') };
  const { service } = make(clock);
  const { taskId } = service.saveTask({ mode: 'create', form: form('Past task', '2026-10-02') });
  service.setDone({ taskId, dateKey: '2026-10-02', done: true });
  assert.equal(dayStats(service, '2026-10-02').value, '1');

  clock.now = at('2026-10-04', '10:00'); // two days later
  service.bootstrap(); // the day is over: it gets saved
  assert.ok(service.data.statsHistory.through >= '2026-10-03');
  service.deleteTask({ taskId, dateKey: '2026-10-02', scope: 'all' });

  const k = dayStats(service, '2026-10-02');
  assert.equal(k.value, '1', 'the finished day did not change');
  assert.equal(k.unit, 'of 1');
});

test('Snapshots: deleting a task before the app notices the new day still keeps the past (saved first)', () => {
  const clock = { now: at('2026-10-02', '12:00') };
  const { service } = make(clock);
  const { taskId } = service.saveTask({ mode: 'create', form: form('Old', '2026-10-02') });
  service.setDone({ taskId, dateKey: '2026-10-02', done: true });
  clock.now = at('2026-10-05', '10:00');
  service.deleteTask({ taskId, dateKey: '2026-10-02', scope: 'all' }); // nobody opened Statistics before
  assert.equal(dayStats(service, '2026-10-02').unit, 'of 1');
});

test('Snapshots: marking a finished day\'s task done afterwards is a real change and is kept', () => {
  const clock = { now: at('2026-10-02', '12:00') };
  const { service } = make(clock);
  const { taskId } = service.saveTask({ mode: 'create', form: form('Late', '2026-10-02') });
  clock.now = at('2026-10-04', '10:00');
  service.bootstrap();
  let k = dayStats(service, '2026-10-02');
  assert.equal(k.value, '0');
  assert.equal(k.unit, 'of 1');
  service.setDone({ taskId, dateKey: '2026-10-02', done: true });
  k = dayStats(service, '2026-10-02');
  assert.equal(k.value, '1');
  assert.equal(k.unit, 'of 1');
});

test('Snapshots: a task added for a day that is already over appears in that day', () => {
  const clock = { now: at('2026-10-04', '10:00') };
  const { service } = make(clock);
  service.bootstrap();
  service.saveTask({ mode: 'create', form: form('Back-dated', '2026-10-01') });
  assert.equal(dayStats(service, '2026-10-01').unit, 'of 1');
});

test('Snapshots: today is never frozen, and the data survives saving and loading', () => {
  const clock = { now: at('2026-10-02', '12:00') };
  const { service, store } = make(clock);
  service.saveTask({ mode: 'create', form: form('Today', '2026-10-02') });
  clock.now = at('2026-10-04', '10:00');
  service.bootstrap();
  const saved = store.data.statsHistory;
  assert.ok(!Object.keys(saved.days).some((key) => key >= '2026-10-04'));
  const { data } = normalizeData(JSON.parse(JSON.stringify(store.data)));
  assert.deepEqual(data.statsHistory, saved);
});

test('Snapshots: damaged saved statistics are cleaned, not trusted', () => {
  const raw = emptyData();
  raw.statsHistory = { through: '2026-10-03', days: { '2026-10-02': [['a', 'k', 't', null, 30, 1, 5, 2], ['bad'], 'x'], 'nope': [], '2026-10-09': [['a', 'k', 't', null, 30, 1, 5, 2]] } };
  const { data } = normalizeData(raw);
  assert.deepEqual(Object.keys(data.statsHistory.days), ['2026-10-02']);
  assert.equal(data.statsHistory.days['2026-10-02'].length, 1);
  assert.deepEqual(normalizeData({ statsHistory: 5 }).data.statsHistory, { through: null, days: {} });
});
