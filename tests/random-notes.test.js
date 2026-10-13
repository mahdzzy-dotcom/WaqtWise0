'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { splitNotes, pickNote, normalizeNoteRotation, normalizeData, emptyData, buildExport } = require('../src/core');
const { PlannerService } = require('../src/main/service');
const { MemoryStore } = require('../src/main/store');
const { at, constantProvider } = require('./helpers');

test('Notes are split on ; and on the Arabic semicolon; blanks are dropped', () => {
  assert.deepEqual(splitNotes('one; two ;three'), ['one', 'two', 'three']);
  assert.deepEqual(splitNotes('أولى؛ ثانية'), ['أولى', 'ثانية']);
  assert.deepEqual(splitNotes(';; a ;;'), ['a']);
  assert.deepEqual(splitNotes(''), []);
  assert.deepEqual(splitNotes(null), []);
});

test('One message, or none: the notes are used as written and nothing is remembered', () => {
  assert.deepEqual(pickNote('just one', null, '2026-10-04'), { note: 'just one', record: null });
  assert.deepEqual(pickNote('a line; ', null, '2026-10-04'), { note: 'a line', record: null });
  assert.deepEqual(pickNote('', null, '2026-10-04'), { note: '', record: null });
});

test('Every message is shown once before any repeats, and never the same one twice in a row', () => {
  let record = null;
  const days = [];
  const random = () => 0; // always "the first candidate"
  for (let d = 1; d <= 9; d++) {
    const key = `2026-10-${String(d).padStart(2, '0')}`;
    const r = pickNote('a;b;c', record, key, random);
    record = r.record;
    days.push(r.note);
  }
  for (let i = 0; i < 9; i += 3) assert.deepEqual(days.slice(i, i + 3).slice().sort(), ['a', 'b', 'c'], `round ${i / 3 + 1} has all three`);
  for (let i = 1; i < days.length; i++) assert.notEqual(days[i], days[i - 1]);
});

test('Real randomness: many days, all messages used evenly, no immediate repeats', () => {
  let record = null;
  const counts = { a: 0, b: 0, c: 0, d: 0 };
  let previous = null;
  for (let d = 0; d < 400; d++) {
    const r = pickNote('a;b;c;d', record, `day${d}`, Math.random);
    record = r.record;
    counts[r.note] += 1;
    assert.notEqual(r.note, previous);
    previous = r.note;
  }
  for (const n of Object.values(counts)) assert.equal(n, 100);
});

test('The same day keeps the same message when shown again; a snooze picks a different one; changed notes start over', () => {
  const first = pickNote('a;b;c', null, '2026-10-04', () => 0.9);
  const again = pickNote('a;b;c', first.record, '2026-10-04', () => 0);
  assert.equal(again.note, first.note);
  const snoozed = pickNote('a;b;c', first.record, '2026-10-04', () => 0, true);
  assert.notEqual(snoozed.note, first.note);
  assert.equal(snoozed.record.used.length, 2, 'it counts in the round');
  const edited = pickNote('a;b;c;d', first.record, '2026-10-04', () => 0);
  assert.equal(edited.record.used.length, 1, 'a new rotation');
  assert.equal(edited.record.sig !== first.record.sig, true);
});

test('A damaged memory is ignored, never fatal', () => {
  const bad = { sig: 1, dateKey: '2026-10-03', index: 9, used: [0] };
  const r = pickNote('a;b', bad, '2026-10-04', () => 0);
  assert.ok(['a', 'b'].includes(r.note));
  assert.deepEqual(normalizeNoteRotation({ t1: { sig: 'x' }, t2: 5, gone: { sig: 1, dateKey: '2026-10-03', index: 0, used: [0] }, t3: { sig: 1, dateKey: '2026-10-03', index: 0, used: [0] } }, new Set(['t1', 't2', 't3'])), { t3: { sig: 1, dateKey: '2026-10-03', index: 0, used: [0] } });
  assert.deepEqual(normalizeData({ noteRotation: 7 }).data.noteRotation, {});
  assert.deepEqual(emptyData().noteRotation, {});
});

const DAY = '2026-10-04';
function make(random) {
  let n = 0;
  const store = new MemoryStore();
  const service = new PlannerService({ store, now: () => at(DAY, '10:00'), newId: () => `id${++n}`, providerFactory: () => constantProvider, random });
  return { service, store };
}
const item = (service, taskId, dateKey) => ({ ...service.getTasks().find((t) => t.id === taskId), taskId, dateKey, id: `${taskId}@${dateKey}`, notes: service.getTasks().find((t) => t.id === taskId).notes, randomNotes: true, start: at(dateKey, '08:00'), end: at(dateKey, '08:30'), durationMinutes: 30, zoneName: 'Fajr → Dhuhr', zoneIndex: 1 });

test('The alert shows one note; the choice is saved and stays for the day; export does not carry it', () => {
  const { service, store } = make(() => 0.99);
  const { taskId } = service.saveTask({ mode: 'create', form: {
    title: 'T', start: { mode: 'fixed', time: '08:00' }, durationMinutes: 30, date: DAY, recurrence: null,
    reminders: { enabled: true, offsets: [], fullScreen: true, randomNotes: true }, priority: 'Medium', categoryId: null, notes: 'one; two; three',
  } });
  assert.equal(service.getTasks()[0].reminders.randomNotes, true, 'the switch is saved with the task');
  const [a] = service.buildAlertItems([item(service, taskId, DAY)]);
  assert.ok(['one', 'two', 'three'].includes(a.notes));
  const [b] = service.buildAlertItems([item(service, taskId, DAY)]);
  assert.equal(b.notes, a.notes, 'shown again the same day: the same note');
  const [s] = service.buildAlertItems([{ ...item(service, taskId, DAY), snoozed: true }]);
  assert.notEqual(s.notes, a.notes, 'after a snooze: a different note');
  const [c] = service.buildAlertItems([item(service, taskId, '2026-10-05')]);
  assert.ok(['one', 'two', 'three'].includes(c.notes));
  assert.ok(service.data.noteRotation[taskId]);
  assert.equal('noteRotation' in buildExport(service.data, new Date()), false);
  const saved = store.load();
  assert.equal(saved.noteRotation[taskId].dateKey, '2026-10-05', 'it survives a restart');
});

test('With the switch off, the notes are shown whole', () => {
  const { service } = make();
  const { taskId } = service.saveTask({ mode: 'create', form: {
    title: 'T', start: { mode: 'fixed', time: '08:00' }, durationMinutes: 30, date: DAY, recurrence: null,
    reminders: { enabled: true, offsets: [], fullScreen: true }, priority: 'Medium', categoryId: null, notes: 'one; two',
  } });
  const i = { ...item(service, taskId, DAY), randomNotes: false };
  assert.equal(service.buildAlertItems([i])[0].notes, 'one; two');
  assert.deepEqual(service.data.noteRotation, {});
});

test('A bad switch value is refused by the same checks as the other reminder options', () => {
  const { validateReminders } = require('../src/core');
  assert.equal(validateReminders({ enabled: true, offsets: [], randomNotes: 'yes' }).length, 1);
  assert.equal(validateReminders({ enabled: true, offsets: [], randomNotes: true }).length, 0);
  const { service } = make();
  const { taskId } = service.saveTask({ mode: 'create', form: {
    title: 'x', start: { mode: 'fixed', time: '08:00' }, durationMinutes: 30, date: DAY, recurrence: null,
    reminders: { enabled: true, offsets: [], randomNotes: 'yes' }, priority: 'Medium', notes: '',
  } });
  assert.strictEqual(service.getTasks().find((t) => t.id === taskId).reminders.randomNotes, true, 'the form turns it into true or false');
  const loaded = normalizeData({ tasks: [{ ...service.getTasks()[0], reminders: { enabled: true, offsets: [], randomNotes: 'yes' } }] });
  assert.equal(loaded.data.tasks.length, 0, 'a file with a bad value skips that task');
});
