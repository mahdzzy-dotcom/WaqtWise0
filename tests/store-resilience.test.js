'use strict';

// Windows can refuse to replace a file for a moment (an antivirus scan, the search indexer or a sync tool has it open).
// Saving must try again, and fall back to copying, instead of losing the change.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { FileStore } = require('../src/main/store');
const { emptyData, createTask } = require('../src/core');

function tmpStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ww-store-'));
  return { dir, store: new FileStore(path.join(dir, 'data.json'), { sleep: () => {} }) };
}
const withTask = (title) => ({ ...emptyData(), tasks: [createTask({ id: title, title, start: { mode: 'fixed', time: '09:00' }, durationMinutes: 30, date: '2026-10-04' })] });
const titles = (store) => store.load().tasks.map((t) => t.title);
const failing = (code) => Object.assign(new Error(`${code}: operation not permitted, rename`), { code });

test('a save is tried again when Windows says the file is busy for a moment', () => {
  const { dir, store } = tmpStore();
  store.save(withTask('first'));
  const real = fs.renameSync;
  let calls = 0;
  fs.renameSync = (...args) => { calls += 1; if (calls <= 3) throw failing('EPERM'); return real(...args); };
  try {
    store.save(withTask('second'));
  } finally {
    fs.renameSync = real;
  }
  assert.equal(calls, 4);
  assert.deepEqual(titles(store), ['second']);
  assert.equal(fs.existsSync(`${store.filePath}.tmp`), false, 'no temporary file is left');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('if replacing never works, the new data is copied over the file and nothing is lost', () => {
  const { dir, store } = tmpStore();
  store.save(withTask('first'));
  const real = fs.renameSync;
  fs.renameSync = (from, to) => { if (to === store.filePath) throw failing('EBUSY'); return real(from, to); };
  try {
    store.save(withTask('second'));
  } finally {
    fs.renameSync = real;
  }
  assert.deepEqual(titles(store), ['second']);
  assert.equal(fs.existsSync(`${store.filePath}.tmp`), false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('if saving is impossible the error is raised and the old data file stays whole', () => {
  const { dir, store } = tmpStore();
  store.save(withTask('first'));
  const realRename = fs.renameSync;
  const realCopy = fs.copyFileSync;
  fs.renameSync = (from, to) => { if (to === store.filePath) throw failing('EPERM'); return realRename(from, to); };
  fs.copyFileSync = (from, to) => { if (to === store.filePath) throw failing('EPERM'); return realCopy(from, to); };
  try {
    assert.throws(() => store.save(withTask('second')), /EPERM/);
  } finally {
    fs.renameSync = realRename;
    fs.copyFileSync = realCopy;
  }
  assert.deepEqual(titles(store), ['first']);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a different kind of error is not retried', () => {
  const { dir, store } = tmpStore();
  store.save(withTask('first'));
  const real = fs.renameSync;
  let calls = 0;
  fs.renameSync = () => { calls += 1; throw failing('ENOSPC'); };
  try {
    assert.throws(() => store.save(withTask('second')), /ENOSPC/);
  } finally {
    fs.renameSync = real;
  }
  assert.equal(calls, 1);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('saving many times in a row keeps working and always reads back what was saved', () => {
  const { dir, store } = tmpStore();
  for (let i = 0; i < 25; i++) {
    store.save(withTask(`save-${i}`));
    assert.deepEqual(titles(store), [`save-${i}`]);
  }
  fs.rmSync(dir, { recursive: true, force: true });
});
