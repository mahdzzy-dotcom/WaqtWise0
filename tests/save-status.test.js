'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { PlannerService, PUBLIC_METHODS } = require('../src/main/service');
const { MemoryStore } = require('../src/main/store');
const { buildExport, parseImport, normalizeData } = require('../src/core');
const { at, constantProvider } = require('./helpers');

let now = at('2026-10-04', '10:00');
function make() {
  let n = 0;
  const store = new MemoryStore();
  const service = new PlannerService({ store, now: () => now, newId: () => `id${++n}`, providerFactory: () => constantProvider });
  return { service, store };
}
const form = (extra = {}) => ({
  title: 'A', start: { mode: 'fixed', time: '08:00' }, durationMinutes: 30, date: '2026-10-04', recurrence: null,
  reminders: { enabled: false, offsets: [] }, priority: 'Medium', categoryId: null, notes: '', ...extra,
});

test('A failed save is remembered with a clear reason, and cleared by the next good save', () => {
  now = at('2026-10-04', '10:00');
  const { service, store } = make();
  assert.deepEqual(service.getSaveStatus(), { ok: true });
  const good = store.save.bind(store);
  const fail = (code, message) => () => { const e = new Error(message); e.code = code; throw e; };

  store.save = fail('ENOSPC', 'no space left on device');
  assert.throws(() => service.saveTask({ mode: 'create', form: form() }), /no space/);
  let status = service.getSaveStatus();
  assert.equal(status.ok, false);
  assert.equal(status.message, 'The disk is full.');
  assert.ok(status.since);

  store.save = fail('EBUSY', 'resource busy');
  assert.match(service.retrySave().message, /locked or protected/);
  store.save = fail('EOTHER', 'something odd');
  assert.equal(service.retrySave().message, 'something odd');

  store.save = good;
  assert.deepEqual(service.retrySave(), { ok: true });
  assert.deepEqual(service.getSaveStatus(), { ok: true });
});

test('A background save that fails raises the same flag, and a normal change clears it', () => {
  now = at('2026-10-04', '10:00');
  const { service, store } = make();
  const good = store.save.bind(store);
  store.save = () => { throw new Error('locked'); };
  assert.throws(() => service.saveReminderState({ delivered: {}, lastTickAt: null, snoozed: [] }), /locked/);
  assert.equal(service.getSaveStatus().ok, false);
  store.save = good;
  service.saveTask({ mode: 'create', form: form() });
  assert.equal(service.getSaveStatus().ok, true);
});

test('The window may ask for the save status and retry', () => {
  for (const name of ['getSaveStatus', 'retrySave']) assert.ok(PUBLIC_METHODS.includes(name));
});

test('The export carries the saved statistics, and an import with them replaces the local ones', () => {
  now = at('2026-10-04', '10:00');
  const a = make().service;
  const { taskId } = a.saveTask({ mode: 'create', form: form() });
  a.setDone({ taskId, dateKey: '2026-10-04', done: true });
  now = at('2026-10-06', '10:00');
  a.freezePast();
  a.deleteTask({ taskId, dateKey: '2026-10-04', scope: 'all' }); // the task is gone, its past day stays in the saved statistics
  const exported = buildExport(a.data, new Date());
  assert.equal(exported.tasks.length, 0);
  assert.deepEqual(Object.keys(exported.statsHistory.days), ['2026-10-04']);

  const b = make().service;
  b.freezePast(); // this computer has its own (different) history
  b.data.statsHistory.days['2026-10-03'] = [['x', '2026-10-03', 'Old', null, 10, 1, 0, 1]];
  b.importData(JSON.parse(JSON.stringify(exported)));
  assert.deepEqual(Object.keys(b.data.statsHistory.days), ['2026-10-04'], 'the file\'s history replaced the local one');
  assert.equal(b.data.statsHistory.through, a.data.statsHistory.through);
});

test('An older export without statistics keeps the ones on this computer', () => {
  now = at('2026-10-06', '10:00');
  const b = make().service;
  b.freezePast();
  b.data.statsHistory.days['2026-10-03'] = [['x', '2026-10-03', 'Old', null, 10, 1, 0, 1]];
  const exported = buildExport(b.data, new Date());
  delete exported.statsHistory;
  assert.equal(parseImport(JSON.parse(JSON.stringify(exported))).hasHistory, false);
  b.importData(JSON.parse(JSON.stringify(exported)));
  assert.deepEqual(Object.keys(b.data.statsHistory.days), ['2026-10-03']);
});

test('Damaged statistics in a file are cleaned, not trusted', () => {
  const { data } = normalizeData({ statsHistory: { through: '2026-10-05', days: { '2026-10-04': [['bad']], nope: [] } } });
  assert.deepEqual(data.statsHistory, { through: '2026-10-05', days: {} });
});
