'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createTask, setCompletion, computeStats, defaultCategories, addDaysToKey, mergeSettings, DEFAULT_SETTINGS, sanitizeSettings, STATS_CHART_IDS, normalizeData, emptyData } = require('../src/core');
const { PlannerService } = require('../src/main/service');
const { MemoryStore } = require('../src/main/store');
const { at, constantProvider } = require('./helpers');

const TODAY = '2026-10-10';
const NOW = at(TODAY, '20:00');
const categories = defaultCategories();
const fixed = (time) => ({ mode: 'fixed', time });
let counter = 0;
function task(extra) {
  counter += 1;
  return createTask({
    id: `L${counter}`, title: 'Task', start: fixed('12:00'), durationMinutes: 30, date: TODAY, recurrence: null,
    reminders: { enabled: false, offsets: [] }, priority: 'Medium', categoryId: null, notes: '', ...extra,
  });
}
// Ticked at the given time on the given day
const tick = (t, key, time) => setCompletion(t, key, true, at(key, time));
const stats = (tasks, query = { range: 'day' }, extra = {}) => computeStats({ provider: constantProvider, tasks, categories, options: {}, now: NOW, query, ...extra });

test('Lateness: on time within the limit, late beyond it, never negative', () => {
  const early = tick(task({ title: 'Early' }), TODAY, '11:30'); // ticked before the start
  const ok = tick(task({ title: 'Ok' }), TODAY, '12:50'); // 50 min after the start
  const late = tick(task({ title: 'Late' }), TODAY, '13:30'); // 90 min after the start
  const s = stats([early, ok, late], { range: 'day' }, { lateAfterMinutes: 60 });
  assert.equal(s.kpis.find((k) => k.id === 'ontime').value, '67', '2 of 3 on time');
  const names = s.lateness.items.map((i) => i.title);
  assert.deepEqual(names, ['Late'], 'only the late one is listed');
  assert.equal(s.lateness.items[0].avg, 90);
  assert.equal(s.lateness.lateCount, 1);
  assert.equal(s.lateness.measured, 3);
});

test('Lateness: the limit decides, and exactly the limit is still on time', () => {
  const t = tick(task({ title: 'Edge' }), TODAY, '13:00'); // exactly 60 min
  assert.equal(stats([t], {}, { lateAfterMinutes: 60 }).lateness.total, 0);
  assert.equal(stats([t], {}, { lateAfterMinutes: 59 }).lateness.total, 1);
  assert.equal(stats([t], {}, { lateAfterMinutes: 0 }).lateness.total, 1);
});

test('Lateness: a repeating task is averaged over its days, and the worst task is first', () => {
  const daily = (extra) => task({ recurrence: { startDate: '2026-10-08', frequency: 'daily', interval: 1 }, date: null, ...extra });
  let a = daily({ title: 'Report' });
  a = tick(a, '2026-10-08', '14:00'); // 120
  a = tick(a, '2026-10-09', '13:30'); // 90
  a = tick(a, TODAY, '12:10'); // 10
  const b = tick(task({ title: 'Call' }), TODAY, '15:00'); // 180 once
  const s = stats([a, b], { range: 'custom', fromKey: '2026-10-08', toKey: TODAY });
  assert.deepEqual(s.lateness.items.map((i) => i.title), ['Call', 'Report']);
  const report = s.lateness.items[1];
  assert.equal(report.avg, 73, '(120 + 90 + 10) / 3 rounded');
  assert.equal(report.late, 2);
  assert.equal(report.n, 3);
  assert.equal(report.maxLabel, '2h 0m');
});

test('Lateness: tasks never done are counted as missed, and done tasks without a time are left out', () => {
  const missed = task({ title: 'Missed', start: fixed('09:00') });
  const old = task({ title: 'Old tick', start: fixed('08:00') });
  old.completions[TODAY] = true; // done before the tick time was recorded
  const s = stats([missed, old], { range: 'day' });
  assert.equal(s.lateness.items[0].title, 'Missed');
  assert.equal(s.lateness.items[0].missed, 1);
  assert.equal(s.lateness.items[0].avg, null);
  assert.equal(s.lateness.unknown, 1);
  assert.equal(s.lateness.measured, 0);
  assert.equal(s.kpis.find((k) => k.id === 'ontime').value, '–');
});

test('Lateness: by zone, by category and over time', () => {
  const c = categories[0];
  const t = tick(task({ title: 'Cat', categoryId: c.id }), TODAY, '13:30');
  const s = stats([t], { range: 'day' });
  assert.equal(s.lateBy.zones.filter((z) => z.n > 0).length, 1);
  assert.equal(s.lateBy.categories.find((x) => x.id === c.id).avg, 90);
  assert.equal(s.lateTrend.known, 1);
  assert.equal(s.lateTrend.items.find((i) => i.n > 0).avg, 90);
});

test('Lateness: the setting is validated, kept, and the new charts are listed', () => {
  assert.equal(DEFAULT_SETTINGS.lateAfterMinutes, 60);
  assert.equal(mergeSettings(DEFAULT_SETTINGS, { lateAfterMinutes: 135 }).lateAfterMinutes, 135);
  assert.equal(mergeSettings(DEFAULT_SETTINGS, { lateAfterMinutes: 0 }).lateAfterMinutes, 0);
  for (const bad of [-1, 10081, 1.5, '60', null]) assert.throws(() => mergeSettings(DEFAULT_SETTINGS, { lateAfterMinutes: bad }), /counts as late/);
  assert.equal(sanitizeSettings({ lateAfterMinutes: 'x' }).lateAfterMinutes, 60);
  for (const id of ['kpi-ontime', 'lateness', 'lateby', 'latetrend']) assert.ok(STATS_CHART_IDS.includes(id), id);
});

test('Lateness: saved snapshots keep the tick time, old snapshots fall back to the task', () => {
  let n = 0;
  const clock = { now: at('2026-10-02', '09:00') };
  const store = new MemoryStore();
  const service = new PlannerService({ store, now: () => clock.now, newId: () => `s${++n}`, providerFactory: () => constantProvider });
  const { taskId } = service.saveTask({ mode: 'create', form: {
    title: 'Snap', start: fixed('08:00'), durationMinutes: 30, date: '2026-10-02', recurrence: null,
    reminders: { enabled: false, offsets: [] }, priority: 'Medium', categoryId: null, notes: '' } });
  clock.now = at('2026-10-02', '10:30');
  service.setDone({ taskId, dateKey: '2026-10-02', done: true });
  clock.now = at('2026-10-05', '09:00');
  const q = { range: 'custom', fromKey: '2026-10-01', toKey: '2026-10-04' };
  let s = service.getStats(q);
  assert.equal(s.lateness.items[0].avg, 150, 'ticked 2 h 30 m after the start');
  const row = store.data.statsHistory.days['2026-10-02'][0];
  assert.equal(row.length, 9);
  assert.equal(typeof row[8], 'number');
  // an older 8-item row, as saved by the previous version
  row.length = 8;
  s = service.getStats(q);
  assert.equal(s.lateness.items[0].avg, 150, 'found again from the task');
  const { data } = normalizeData(JSON.parse(JSON.stringify(store.data)));
  assert.equal(data.statsHistory.days['2026-10-02'][0].length, 8, 'an 8-item row is still accepted');
  const raw = emptyData();
  raw.statsHistory = { through: '2026-10-03', days: { '2026-10-02': [['a', 'k', 't', null, 30, 1, 5, 2, 'bad'], ['a', 'k', 't', null, 30, 1, 5, 2, 99]] } };
  assert.equal(normalizeData(raw).data.statsHistory.days['2026-10-02'].length, 1, 'a damaged 9th item is dropped');
});

test('Lateness: the service passes the saved limit to the statistics', () => {
  const clock = { now: at(TODAY, '14:00') };
  const store = new MemoryStore();
  const service = new PlannerService({ store, now: () => clock.now, newId: () => 'z1', providerFactory: () => constantProvider });
  const { taskId } = service.saveTask({ mode: 'create', form: {
    title: 'Limit', start: fixed('12:00'), durationMinutes: 30, date: TODAY, recurrence: null,
    reminders: { enabled: false, offsets: [] }, priority: 'Medium', categoryId: null, notes: '' } });
  service.setDone({ taskId, dateKey: TODAY, done: true }); // 2 h after the start
  assert.equal(service.getStats({ range: 'day' }).lateness.lateCount, 1);
  service.saveSettings({ lateAfterMinutes: 180 });
  assert.equal(service.getStats({ range: 'day' }).lateness.lateCount, 0);
  assert.equal(service.getStats({ range: 'day' }).lateness.thresholdLabel, '3h 0m');
});
