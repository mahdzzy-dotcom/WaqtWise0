'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { PlannerService } = require('../src/main/service');
const { FileStore, describeBackupName } = require('../src/main/store');
const { buildExport } = require('../src/core');
const { at, constantProvider } = require('./helpers');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ww-backups-'));
const form = (title, date = '2026-10-04') => ({
  title, start: { mode: 'fixed', time: '08:00' }, durationMinutes: 30, date, recurrence: null,
  reminders: { enabled: false, offsets: [] }, priority: 'Medium', categoryId: null, notes: '',
});

function make(dir, clock) {
  let n = 0;
  const store = new FileStore(path.join(dir, 'data.json'), { now: () => clock.now });
  const service = new PlannerService({ store, now: () => clock.now, newId: () => `id${++n}${Math.random().toString(36).slice(2, 6)}`, providerFactory: () => constantProvider });
  return { store, service };
}

const backupFiles = (dir) => (fs.existsSync(path.join(dir, 'backups')) ? fs.readdirSync(path.join(dir, 'backups')).sort() : []);

test('Backups: one copy per day, made at the first save of the day, and only the last 7 are kept', () => {
  const dir = tmp();
  const clock = { now: at('2026-10-01', '09:00') };
  const { service } = make(dir, clock);
  service.saveTask({ mode: 'create', form: form('A') });
  service.saveTask({ mode: 'create', form: form('B') });
  assert.deepEqual(backupFiles(dir), ['data-2026-10-01.json'], 'two saves on one day make one copy');

  for (let day = 2; day <= 10; day++) {
    clock.now = at(`2026-10-${String(day).padStart(2, '0')}`, '09:00');
    service.saveTask({ mode: 'create', form: form(`T${day}`) });
  }
  const files = backupFiles(dir);
  assert.equal(files.length, 7);
  assert.equal(files[0], 'data-2026-10-04.json');
  assert.equal(files.at(-1), 'data-2026-10-10.json');
});

test('Backups: importing makes a copy first, and Restore brings the old data back (and can be undone)', () => {
  const dir = tmp();
  const clock = { now: at('2026-10-04', '09:00') };
  const { service, store } = make(dir, clock);
  service.saveTask({ mode: 'create', form: form('Keep me') });

  const other = JSON.parse(JSON.stringify(buildExport(service.data, clock.now)));
  other.tasks = [];
  service.importData(JSON.stringify(other));
  assert.equal(service.getTasks().length, 0);

  const list = service.listBackups();
  const before = list.find((b) => b.kind === 'before-import');
  assert.ok(before, 'a copy was made before the import');
  assert.equal(before.tasks, 1);

  const restored = service.restoreBackup({ id: before.id });
  assert.equal(restored.tasks, 1);
  assert.equal(service.getTasks()[0].title, 'Keep me');
  assert.equal(new FileStore(path.join(dir, 'data.json')).load().tasks.length, 1, 'saved to disk');

  // The restore itself left a copy of the state it replaced (empty), so it can be undone
  const undo = service.listBackups().find((b) => b.kind === 'before-restore');
  assert.equal(undo.tasks, 0);
  service.restoreBackup({ id: undo.id });
  assert.equal(service.getTasks().length, 0);
  assert.ok(store.listBackups().length >= 3);
});

test('Backups: a failed import makes no copy; odd names and damaged copies are never used', () => {
  const dir = tmp();
  const clock = { now: at('2026-10-04', '09:00') };
  const { service } = make(dir, clock);
  service.saveTask({ mode: 'create', form: form('X') });
  assert.throws(() => service.importData('not json'));
  assert.equal(service.listBackups().filter((b) => b.kind !== 'daily').length, 0);

  for (const bad of ['../data.json', 'data.json', 'data-2026-10-04.json/../../x', '', null]) {
    assert.throws(() => service.restoreBackup({ id: bad }), /does not exist/);
  }
  fs.writeFileSync(path.join(dir, 'backups', 'data-2026-09-30.json'), '{broken', 'utf8');
  assert.ok(!service.listBackups().some((b) => b.date === '2026-09-30'), 'damaged copy is not offered');
  assert.throws(() => service.restoreBackup({ id: 'data-2026-09-30.json' }), /damaged/);
  assert.equal(service.getTasks().length, 1, 'nothing changed');
});

test('Backups: before-import / before-restore copies keep only the last 5 each', () => {
  const dir = tmp();
  const clock = { now: at('2026-10-04', '09:00') };
  const { service, store } = make(dir, clock);
  service.saveTask({ mode: 'create', form: form('X') });
  for (let i = 0; i < 8; i++) {
    clock.now = new Date(clock.now.getTime() + 1000);
    store.backupNow('before-import');
  }
  assert.equal(service.listBackups().filter((b) => b.kind === 'before-import').length, 5);
});

test('Backup names: only the names made by the app are understood', () => {
  assert.equal(describeBackupName('data-2026-10-04.json').kind, 'daily');
  assert.equal(describeBackupName('before-import-20261004-093000.json').time, '09:30');
  assert.equal(describeBackupName('before-restore-20261004-093000.json').kind, 'before-restore');
  assert.equal(describeBackupName('../x.json').kind, undefined);
});
