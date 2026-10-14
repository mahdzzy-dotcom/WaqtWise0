'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { PlannerService, PUBLIC_METHODS } = require('../src/main/service');
const { MemoryStore } = require('../src/main/store');
const { emptyData, normalizeData, parseImport, buildExport } = require('../src/core');
const { at, constantProvider } = require('./helpers');

const DAY = '2026-10-04';

function make() {
  let n = 0;
  const service = new PlannerService({ store: new MemoryStore(), now: () => at(DAY, '10:00'), newId: () => `id${++n}`, providerFactory: () => constantProvider });
  return service;
}

const scheduleForm = (extra = {}) => ({
  title: 'X', start: { mode: 'fixed', time: '08:00' }, durationMinutes: 30, date: DAY, recurrence: null,
  reminders: { enabled: false, offsets: [], fullScreen: false }, priority: 'Medium', categoryId: null, notes: '', ...extra,
});

test('Free tasks: add, edit, done, move, delete, clear done', () => {
  const s = make();
  const a = s.saveFreeTask({ form: { title: '  Renew ID ', notes: 'photos', priority: 'High', durationMinutes: 45 } }).id;
  const b = s.saveFreeTask({ form: { title: 'Read' } }).id;
  assert.equal(s.getFreeTaskCount(), 2);
  let list = s.getFreeTasks();
  assert.deepEqual(list.map((x) => x.title), ['Renew ID', 'Read']);
  assert.equal(list[0].priority, 'High');
  assert.equal(list[0].durationLabel, '45m');
  assert.equal(list[1].priority, 'Medium');

  s.saveFreeTask({ id: a, form: { title: 'Renew residency' } });
  assert.equal(s.getFreeTasks()[0].title, 'Renew residency');
  assert.equal(s.getFreeTasks()[0].notes, 'photos', 'fields that were not sent stay');

  s.moveFreeTask({ id: a, direction: 'down' });
  assert.deepEqual(s.getFreeTasks().map((x) => x.id), [b, a]);
  s.moveFreeTask({ id: a, direction: 'down' }); // already last: nothing happens
  assert.deepEqual(s.getFreeTasks().map((x) => x.id), [b, a]);

  s.setFreeDone({ id: b, done: true });
  assert.equal(s.getFreeTaskCount(), 1);
  assert.equal(s.clearFreeDone().removed, 1);
  assert.deepEqual(s.getFreeTasks().map((x) => x.id), [a]);
  s.deleteFreeTask({ id: a });
  assert.equal(s.getFreeTasks().length, 0);
  assert.throws(() => s.deleteFreeTask({ id: a }));
});

test('Free tasks: bad input is refused', () => {
  const s = make();
  assert.throws(() => s.saveFreeTask({ form: { title: '   ' } }));
  assert.throws(() => s.saveFreeTask({ form: { title: 'x'.repeat(201) } }));
  assert.throws(() => s.saveFreeTask({ form: { title: 'x', durationMinutes: 0 } }));
  assert.throws(() => s.saveFreeTask({ form: { title: 'x', durationMinutes: 99999 } }));
  s.saveFreeTask({ form: { title: 'x', priority: 'Nope', categoryId: 'gone' } });
  const [only] = s.getFreeTasks();
  assert.equal(only.priority, 'Medium');
  assert.equal(only.categoryId, null);
});

test('Scheduling a free task moves it into the planner', () => {
  const s = make();
  const id = s.saveFreeTask({ form: { title: 'Call bank', notes: 'ask fees', priority: 'High', categoryId: 'cat-work', durationMinutes: 20 } }).id;
  const { form, fromFreeTaskId } = s.getFreeTaskForSchedule({ id, defaultKey: DAY });
  assert.equal(fromFreeTaskId, id);
  assert.equal(form.title, 'Call bank');
  assert.equal(form.durationMinutes, 20);
  assert.equal(form.date, DAY);
  const { taskId } = s.saveTask({ mode: 'create', form: { ...form, start: { mode: 'fixed', time: '11:00' } }, fromFreeTaskId: id });
  assert.equal(s.getFreeTasks().length, 0, 'it left the free list');
  assert.equal(s.getTasks().find((t) => t.id === taskId).notes, 'ask fees');
  assert.equal(s.getDay(DAY).taskCount, 1);
});

test('Scheduling that fails keeps the free task', () => {
  const s = make();
  const id = s.saveFreeTask({ form: { title: 'Keep me' } }).id;
  const { form } = s.getFreeTaskForSchedule({ id });
  assert.throws(() => s.saveTask({ mode: 'create', form: { ...form, start: { mode: 'fixed', time: 'bad' } }, fromFreeTaskId: id }));
  assert.equal(s.getFreeTasks().length, 1);
});

test('Task details: time, zone, repeat summary, reminders', () => {
  const s = make();
  const once = s.saveTask({ mode: 'create', form: scheduleForm({ title: 'Report', notes: 'a;b', priority: 'High', reminders: { enabled: true, offsets: [10], fullScreen: true } }) }).taskId;
  const d = s.getTaskDetails({ taskId: once, dateKey: DAY });
  assert.equal(d.title, 'Report');
  assert.equal(d.notes, 'a;b', 'the notes are shown exactly as written');
  assert.match(d.startLabel, /8:00/);
  assert.equal(d.isRecurring, false);
  assert.deepEqual(d.reminderOffsets, [10]);
  assert.equal(d.fullScreen, true);
  assert.ok(d.zoneName);
  assert.ok(d.zoneStartLabel && d.zoneEndLabel, 'the zone limits are given for the little timeline');
  assert.ok(d.leftPct >= 0 && d.leftPct < 100 && d.widthPct > 0 && d.leftPct + Math.min(d.widthPct, 100 - d.leftPct) <= 100.0001);
  assert.equal(typeof d.continuesPastZone, 'boolean');
  const rec = s.saveTask({ mode: 'create', form: scheduleForm({ date: null, recurrence: { startDate: DAY, frequency: 'daily', interval: 1, end: { type: 'never' } } }) }).taskId;
  const r = s.getTaskDetails({ taskId: rec, dateKey: DAY });
  assert.ok(r.repeatSummary.length > 0);
  assert.throws(() => s.getTaskDetails({ taskId: 'nope', dateKey: DAY }));
});

test('Free tasks travel with export, import and backups; damaged ones are skipped', () => {
  const s = make();
  s.saveFreeTask({ form: { title: 'One' } });
  const exported = buildExport(s.data, new Date());
  assert.equal(exported.freeTasks.length, 1);
  const { data } = parseImport(JSON.parse(JSON.stringify(exported)));
  assert.equal(data.freeTasks[0].title, 'One');

  const s2 = make();
  s2.importData(JSON.parse(JSON.stringify(exported)));
  assert.equal(s2.getFreeTasks().length, 1);

  const bad = JSON.parse(JSON.stringify(exported));
  bad.freeTasks.push({ id: 'z' }, 5, { ...bad.freeTasks[0] }, { id: 'q', title: 'ok', durationMinutes: -3 });
  const result = normalizeData(bad);
  assert.equal(result.data.freeTasks.length, 1);
  assert.equal(result.warnings.length, 4);

  assert.deepEqual(emptyData().freeTasks, []);
  assert.deepEqual(normalizeData({}).data.freeTasks, [], 'an old file without the list still loads');
});

test('The window may call the new methods', () => {
  for (const name of ['getFreeTasks', 'getFreeTaskCount', 'saveFreeTask', 'deleteFreeTask', 'setFreeDone', 'clearFreeDone', 'moveFreeTask', 'getFreeTaskForSchedule', 'getTaskDetails']) {
    assert.ok(PUBLIC_METHODS.includes(name), name);
    assert.equal(typeof PlannerService.prototype[name], 'function', name);
  }
});
