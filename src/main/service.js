'use strict';

// The planner "service": every action the screens can ask for, in plain Node code.
// It has no Electron in it, so it is tested directly and used by the screenshot tool.
// Everything it returns is plain data (text, numbers, lists) that can cross into the window.

const crypto = require('crypto');
const core = require('../core');
const { copy } = require('./planner/util');
const { formatTime12InZone } = require('../core/time');

const { CITIES, resolveCity, METHOD_KEYS, METHOD_LABELS, currentPlanningDayKey, createPrayerProvider } = core;

function defaultProviderFactory(settings) {
  const city = resolveCity(settings);
  return createPrayerProvider({
    latitude: city.latitude,
    longitude: city.longitude,
    method: settings.method,
    adjustments: settings.adjustments,
  });
}

class PlannerService {
  // deps: { store, now, newId, providerFactory, onDataChanged(), onSettingsChanged(settings) }
  constructor(deps) {
    this.store = deps.store;
    this.now = deps.now || (() => new Date());
    this.newId = deps.newId || (() => crypto.randomUUID());
    this.providerFactory = deps.providerFactory || defaultProviderFactory;
    this.onDataChanged = deps.onDataChanged || (() => {});
    this.onSettingsChanged = deps.onSettingsChanged || (() => {});
    this.data = this.store.load();
    this.providerCache = null;
  }

  // ---- basics -----------------------------------------------------------------------------------------

  get settings() {
    return this.data.settings;
  }

  provider() {
    const s = this.settings;
    const key = JSON.stringify([s.cityName, s.useCustomCity, s.customCity, s.method, s.adjustments]);
    if (!this.providerCache || this.providerCache.key !== key) {
      this.providerCache = { key, provider: this.providerFactory(s) };
    }
    return this.providerCache.provider;
  }

  // Options used whenever occurrences are worked out. `tasks` lets tasks that follow other tasks find them.
  recurrenceOptions() {
    return { workingDays: this.settings.workingDays, weekStartsOn: this.weekStart(), tasks: this.data.tasks };
  }

  // The city in use, and whether its time zone is different from this computer's.
  cityInfo() {
    const city = resolveCity(this.settings);
    const computer = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return { name: city.name, custom: city.custom, timeZone: city.timeZone, computerTimeZone: computer, differs: Boolean(city.timeZone) && city.timeZone !== computer };
  }

  getCityInfo() {
    return this.cityInfo();
  }

  // A prayer-time boundary written in the city's time zone (the computer's clock for the built-in cities).
  zoneTimeLabel(date) {
    const { timeZone } = resolveCity(this.settings);
    return timeZone ? formatTime12InZone(date, timeZone) : core.formatTime12(date);
  }

  weekStart() {
    return [6, 0, 1].includes(this.settings.weekStart) ? this.settings.weekStart : 0;
  }

  persist() {
    this.store.save(this.data);
  }

  changed() {
    this.persist();
    this.onDataChanged();
  }

  findTask(taskId) {
    const task = this.data.tasks.find((t) => t.id === taskId);
    if (!task) throw new Error('This task no longer exists.');
    return task;
  }

  categoryOf(categoryId) {
    return this.data.categories.find((c) => c.id === categoryId) || null;
  }

  // ---- start-up information ----------------------------------------------------------------------------

  bootstrap() {
    this.freezePast();
    return {
      settings: copy(this.settings),
      categories: copy(this.data.categories),
      cities: CITIES.map((c) => c.name),
      methods: METHOD_KEYS.map((key) => ({ key, label: METHOD_LABELS[key] })),
      currentPlanningDayKey: currentPlanningDayKey(this.provider(), this.now()),
      city: this.cityInfo(),
      loadNotes: copy(this.store.loadNotes || []),
    };
  }

  // ---- used by the background reminder engine (main process) ------------------------------------------------------------

  getTasks() {
    return this.data.tasks;
  }

  getReminderSettings() {
    return this.data.settings;
  }

  updateTaskFromEngine(task) {
    this.data.tasks = this.data.tasks.map((t) => (t.id === task.id ? task : t));
    this.changed();
  }

  getReminderState() {
    return this.data.reminderState;
  }

  saveReminderState(state) {
    this.data.reminderState = state;
    this.persist();
  }
}

// The service is built from several files, one per area; their methods are added here.
const MIXINS = [
  require('./planner/day-view').DayViewMethods,
  require('./planner/missed-alerts').MissedAlertMethods,
  require('./planner/task-form').TaskFormMethods,
  require('./planner/settings-categories').SettingsMethods,
  require('./planner/data-transfer').DataTransferMethods,
  require('./planner/history').HistoryMethods,
];
for (const mixin of MIXINS) {
  for (const name of Object.getOwnPropertyNames(mixin.prototype)) {
    if (name !== 'constructor') Object.defineProperty(PlannerService.prototype, name, Object.getOwnPropertyDescriptor(mixin.prototype, name));
  }
}

// The names the window is allowed to call.
const PUBLIC_METHODS = [
  'bootstrap', 'getDay', 'getStats', 'getUpcoming', 'getMissed', 'dismissMissed', 'clearMissed', 'newTaskDefaults', 'getTaskForEdit', 'previewForm', 'saveTask',
  'getReferenceChoices', 'getDeleteImpact', 'getAlertPreset', 'deleteTask', 'setDone', 'duplicateTask', 'getSettings', 'saveSettings', 'addCategory', 'updateCategory',
  'deleteCategory', 'listBackups', 'restoreBackup', 'getCityInfo',
];

module.exports = { PlannerService, PUBLIC_METHODS, defaultProviderFactory };
