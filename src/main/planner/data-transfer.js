'use strict';

// Export and import.
// These methods are added to PlannerService (see ../service.js); `this` is the service.

const core = require('../../core');

const {
  buildExport, parseImport,
} = core;
const { copy } = require('./util');

class DataTransferMethods {
  // ---- export / import --------------------------------------------------------------------------------------------

  exportData() {
    return buildExport(this.data, this.now());
  }

  // Replaces tasks, categories and settings with the contents of a backup.
  importData(input) {
    this.freezePast();
    const { data, warnings, hasHistory } = parseImport(input);
    if (this.store.backupNow) this.store.backupNow('before-import'); // so a wrong import can be undone
    // A file with saved statistics replaces the ones on this computer (they belong to the imported tasks); an older file keeps them.
    this.data = { ...data, reminderState: this.data.reminderState, statsHistory: hasHistory ? data.statsHistory : this.history() };
    this.providerCache = null;
    this.applyLanguage();
    this.persist();
    this.onSettingsChanged(copy(this.data.settings));
    this.onDataChanged();
    return { ok: true, tasks: data.tasks.length, categories: data.categories.length, warnings };
  }

  // ---- backup copies kept by the app ----------------------------------------------------------------------------------

  // The saved copies the user can go back to: [{ id, kind: 'daily'|'before-import'|'before-restore', date, time, tasks }].
  listBackups() {
    return this.store.listBackups ? this.store.listBackups() : [];
  }

  // Replaces tasks, categories and settings with a saved copy. The current data is saved first, so this can be undone too.
  restoreBackup({ id }) {
    this.freezePast();
    const { data, warnings } = this.store.readBackup(id);
    this.store.backupNow('before-restore');
    this.data = { ...data, reminderState: this.data.reminderState, statsHistory: this.history() };
    this.providerCache = null;
    this.applyLanguage();
    this.persist();
    this.onSettingsChanged(copy(this.data.settings));
    this.onDataChanged();
    return { ok: true, tasks: data.tasks.length, categories: data.categories.length, warnings };
  }
}

module.exports = { DataTransferMethods };
