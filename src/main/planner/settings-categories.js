'use strict';

// Settings and categories.
// These methods are added to PlannerService (see ../service.js); `this` is the service.

const core = require('../../core');

const {
  mergeSettings,
} = core;
const { copy } = require('./util');

class SettingsMethods {
  // ---- settings and categories ---------------------------------------------------------------------------------

  getSettings() {
    return copy(this.settings);
  }

  saveSettings(patch) {
    this.freezePast();
    const previous = this.data.settings;
    const merged = mergeSettings(previous, patch);
    // Turning the "still running in the background" message back on shows it again at the next close.
    if (patch.showBackgroundMessage === true && !previous.showBackgroundMessage) merged.backgroundMessageShown = false;
    this.data.settings = merged;
    this.providerCache = null;
    this.persist();
    this.onSettingsChanged(copy(this.data.settings));
    this.onDataChanged();
    return copy(this.data.settings);
  }

  validateCategory({ name, color }, ignoreId) {
    const clean = String(name || '').trim();
    if (clean === '') throw new Error('Please enter a category name.');
    if (clean.length > 40) throw new Error('Category names can be up to 40 characters.');
    if (this.data.categories.some((c) => c.id !== ignoreId && c.name.toLowerCase() === clean.toLowerCase())) {
      throw new Error('There is already a category with that name.');
    }
    if (!/^#[0-9a-fA-F]{6}$/.test(color || '')) throw new Error('Please choose a color.');
    return { name: clean, color };
  }

  addCategory(input) {
    const clean = this.validateCategory(input);
    const category = { id: `cat-${this.newId()}`, ...clean };
    this.data.categories.push(category);
    this.changed();
    return copy(this.data.categories);
  }

  updateCategory({ id, name, color }) {
    const category = this.categoryOf(id);
    if (!category) throw new Error('That category no longer exists.');
    Object.assign(category, this.validateCategory({ name, color }, id));
    this.changed();
    return copy(this.data.categories);
  }

  // Deleting a category never deletes tasks: they simply become uncategorized.
  deleteCategory({ id }) {
    this.data.categories = this.data.categories.filter((c) => c.id !== id);
    for (const task of this.data.tasks) {
      if (task.categoryId === id) task.categoryId = null;
      for (const key of Object.keys(task.overrides)) {
        if (task.overrides[key].categoryId === id) task.overrides[key].categoryId = null;
      }
    }
    this.changed();
    return copy(this.data.categories);
  }
}

module.exports = { SettingsMethods };
