'use strict';

// Saves the app's data to one JSON file in the user's profile folder.
// Writes are crash-safe: the new data goes to a temporary file first, is flushed to disk, and only
// then replaces the real file. The previous version is kept as a ".bak" copy.
// Besides that, a "backups" folder next to the data file keeps one copy per day (the last 7 days), plus a copy
// made just before every import or restore (the last 5 of each), which the user can restore from Settings.

const fs = require('fs');
const path = require('path');
const { emptyData, normalizeData } = require('../core/data');

class FileStore {
  constructor(filePath, options) {
    this.filePath = filePath;
    this.backupPath = `${filePath}.bak`;
    this.tempPath = `${filePath}.tmp`;
    this.loadNotes = []; // things the app may want to tell the user after loading
    this.backupDir = path.join(path.dirname(filePath), 'backups');
    this.now = (options && options.now) || (() => new Date());
  }

  readJson(file) {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  }

  // Returns the saved data, or fresh default data on first run.
  // A damaged data file is set aside (not deleted) and the backup copy is used instead.
  load() {
    this.loadNotes = [];
    if (!fs.existsSync(this.filePath) && !fs.existsSync(this.backupPath)) return emptyData();

    for (const [file, label] of [[this.filePath, 'main'], [this.backupPath, 'backup']]) {
      if (!fs.existsSync(file)) continue;
      try {
        const { data, warnings } = normalizeData(this.readJson(file));
        this.loadNotes.push(...warnings);
        if (label === 'backup') this.loadNotes.push('Your data file was damaged, so the last backup copy was loaded.');
        return data;
      } catch (error) {
        if (label === 'main') this.setAsideDamagedFile();
      }
    }
    this.loadNotes.push('Your data file could not be read, so the app started empty.');
    return emptyData();
  }

  setAsideDamagedFile() {
    try {
      fs.renameSync(this.filePath, `${this.filePath}.damaged-${Date.now()}`);
    } catch (error) {
      // nothing more we can do
    }
  }

  save(data) {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const text = JSON.stringify(data, null, 2);

    const fd = fs.openSync(this.tempPath, 'w');
    try {
      fs.writeSync(fd, text);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }

    if (fs.existsSync(this.filePath)) {
      try {
        fs.copyFileSync(this.filePath, this.backupPath);
      } catch (error) {
        // a missing backup should never block saving
      }
    }
    fs.renameSync(this.tempPath, this.filePath);
    this.dailyBackup();
  }

  // ---- backups ------------------------------------------------------------------------------------

  // One copy per calendar day, made at the first save of that day; only the last 7 days are kept.
  dailyBackup() {
    try {
      const name = `data-${localDate(this.now())}.json`;
      if (fs.existsSync(path.join(this.backupDir, name))) return;
      fs.mkdirSync(this.backupDir, { recursive: true });
      fs.copyFileSync(this.filePath, path.join(this.backupDir, name));
      this.prune('daily', DAILY_KEEP);
    } catch (error) {
      // a failed backup must never stop saving
    }
  }

  // A copy of the data as it is now, made before something replaces it (kind: 'before-import' | 'before-restore').
  backupNow(kind) {
    try {
      if (!fs.existsSync(this.filePath)) return false;
      const stamp = localStamp(this.now());
      fs.mkdirSync(this.backupDir, { recursive: true });
      fs.copyFileSync(this.filePath, path.join(this.backupDir, `${kind}-${stamp}.json`));
      this.prune(kind, SAFETY_KEEP);
      return true;
    } catch (error) {
      return false;
    }
  }

  prune(kind, keep) {
    const same = this.listFiles().filter((b) => b.kind === kind); // newest first
    for (const old of same.slice(keep)) {
      try { fs.unlinkSync(path.join(this.backupDir, old.id)); } catch (error) { /* ignore */ }
    }
  }

  listFiles() {
    let names = [];
    try { names = fs.readdirSync(this.backupDir); } catch (error) { return []; }
    return names
      .map((id) => ({ id, ...describeBackupName(id) }))
      .filter((b) => b.kind)
      .sort((a, b) => (a.sortKey < b.sortKey ? 1 : a.sortKey > b.sortKey ? -1 : 0));
  }

  // [{ id, kind, label date, tasks }] newest first. Files that cannot be read are left out.
  listBackups() {
    const out = [];
    for (const b of this.listFiles()) {
      try {
        const { data } = normalizeData(this.readJson(path.join(this.backupDir, b.id)));
        out.push({ id: b.id, kind: b.kind, date: b.date, time: b.time, tasks: data.tasks.length });
      } catch (error) {
        // damaged copy: not offered
      }
    }
    return out;
  }

  // Returns { data, warnings } from a backup, or throws.
  readBackup(id) {
    if (!describeBackupName(id).kind) throw new Error('This backup does not exist.');
    const file = path.join(this.backupDir, id);
    if (!fs.existsSync(file)) throw new Error('This backup does not exist.');
    try {
      return normalizeData(this.readJson(file));
    } catch (error) {
      throw new Error('This backup file is damaged and cannot be restored.');
    }
  }
}

const DAILY_KEEP = 7;
const SAFETY_KEEP = 5;

const pad = (n) => String(n).padStart(2, '0');
const localDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const localStamp = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;

// Only names made by this app are accepted (this also stops any attempt to reach other files).
function describeBackupName(id) {
  let m = /^data-(\d{4}-\d{2}-\d{2})\.json$/.exec(String(id));
  if (m) return { kind: 'daily', date: m[1], time: '', sortKey: m[1] };
  m = /^(before-import|before-restore)-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})\.json$/.exec(String(id));
  if (m) return { kind: m[1], date: `${m[2]}-${m[3]}-${m[4]}`, time: `${m[5]}:${m[6]}`, sortKey: `${m[2]}-${m[3]}-${m[4]}T${m[5]}${m[6]}${m[7]}` };
  return {};
}

// A store that keeps everything in memory. Used by tests and the screenshot tool.
class MemoryStore {
  constructor(initial) {
    this.data = initial || emptyData();
    this.saveCount = 0;
    this.loadNotes = [];
    this.backups = []; // [{ id, kind, date, time, data }] newest first
  }

  backupNow(kind) {
    const when = new Date();
    this.backups.unshift({
      id: `${kind}-${this.backups.length}`, kind, date: localDate(when), time: `${pad(when.getHours())}:${pad(when.getMinutes())}`,
      data: JSON.parse(JSON.stringify(this.data)),
    });
    return true;
  }

  listBackups() {
    return this.backups.map((b) => ({ id: b.id, kind: b.kind, date: b.date, time: b.time, tasks: b.data.tasks.length }));
  }

  readBackup(id) {
    const found = this.backups.find((b) => b.id === id);
    if (!found) throw new Error('This backup does not exist.');
    return normalizeData(JSON.parse(JSON.stringify(found.data)));
  }

  load() {
    return JSON.parse(JSON.stringify(this.data));
  }

  save(data) {
    this.data = JSON.parse(JSON.stringify(data));
    this.saveCount += 1;
  }
}

module.exports = { FileStore, MemoryStore, describeBackupName };
