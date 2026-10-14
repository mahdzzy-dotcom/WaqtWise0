'use strict';

// The saved data and the export/import file format.
//
// Saved data (data.json in the user's profile folder):
//   { version, settings, categories, tasks, freeTasks, noteRotation, reminderState, missedReminders }
// (noteRotation: which of a task's several notes was shown last; it is NOT part of the export file.)
// (missedReminders: reminders that came due while the computer was off or asleep and were not handled yet;
//  they are shown on the bell and are NOT part of the export file.)
//
// Export file (documented in docs/DATA_FORMAT.md):
//   { app: 'waqtwise', formatVersion: 1, exportedAt, settings, categories, tasks, freeTasks, statsHistory }
//
// Derived values (zones, end times, durations, occurrences, prayer times) are never saved.

const { t } = require('./i18n');
const { DEFAULT_SETTINGS, sanitizeSettings } = require('./settings');
const { validateTask, validateStart, validateDuration, validateReminders, PRIORITIES } = require('./tasks');
const { MAX_TASKS, MAX_FREE_TASKS } = require('./limits');
const { normalizeFreeTask } = require('./free-tasks');
const { normalizeNoteRotation } = require('./random-notes');
const { normalizeRule } = require('./recurrence');
const { emptyState, normalizeState } = require('./reminder-engine');
const { isValidKey } = require('./time');

const APP_NAME = 'waqtwise';
const FORMAT_VERSION = 1;
const DATA_VERSION = 1;

function defaultCategories() {
  return [
    { id: 'cat-work', name: 'Work', color: '#3b82f6' },
    { id: 'cat-study', name: 'Study', color: '#8b5cf6' },
    { id: 'cat-worship', name: 'Worship', color: '#10b981' },
    { id: 'cat-personal', name: 'Personal', color: '#f59e0b' },
    { id: 'cat-health', name: 'Health', color: '#ef4444' },
  ];
}

// The built-in categories are shown in the language of the app; a category the user renamed keeps their name.
const DEFAULT_CATEGORY_NAMES = { 'cat-work': 'Work', 'cat-study': 'Study', 'cat-worship': 'Worship', 'cat-personal': 'Personal', 'cat-health': 'Health' };
function localCategoryName(category) {
  return DEFAULT_CATEGORY_NAMES[category.id] === category.name ? t(category.name) : category.name;
}

function emptyData() {
  return {
    version: DATA_VERSION,
    settings: JSON.parse(JSON.stringify(DEFAULT_SETTINGS)),
    categories: defaultCategories(),
    tasks: [],
    freeTasks: [],
    noteRotation: {},
    reminderState: emptyState(),
    missedReminders: [],
    statsHistory: { through: null, days: {} },
  };
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function normalizeCategories(raw, warnings) {
  if (!Array.isArray(raw)) return defaultCategories();
  const seen = new Set();
  const result = [];
  for (const c of raw) {
    const valid =
      isPlainObject(c) &&
      typeof c.id === 'string' && c.id !== '' &&
      typeof c.name === 'string' && c.name.trim() !== '' &&
      typeof c.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(c.color);
    if (!valid || seen.has(c.id)) {
      warnings.push(t('A category was skipped because it was not valid'));
      continue;
    }
    seen.add(c.id);
    result.push({ id: c.id, name: c.name.trim(), color: c.color });
  }
  return result;
}

const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/;

// Times when occurrences were ticked: keep only date key -> valid date text.
function cleanCompletedAt(raw) {
  const out = {};
  if (!isPlainObject(raw)) return out;
  for (const key of Object.keys(raw)) {
    if (!isValidKey(key) || typeof raw[key] !== 'string' || !ISO_TIME.test(raw[key])) continue;
    const time = Date.parse(raw[key]);
    const year = new Date(time).getUTCFullYear();
    if (Number.isNaN(time) || year < 2000 || year > 2200) continue;
    out[key] = new Date(time).toISOString(); // one canonical form
  }
  return out;
}

// Which occurrences are done: only real dates, only "true".
function cleanCompletions(raw) {
  const out = {};
  if (!isPlainObject(raw)) return out;
  for (const key of Object.keys(raw)) if (isValidKey(key) && raw[key] === true) out[key] = true;
  return out;
}

// Reminders of a task: "on" only when it says true; offsets without repeats, smallest first.
function cleanReminders(raw) {
  if (!isPlainObject(raw)) return { enabled: false, offsets: [] };
  const out = { enabled: raw.enabled === true, offsets: Array.isArray(raw.offsets) ? Array.from(new Set(raw.offsets)).sort((a, b) => a - b) : raw.offsets };
  if ('fullScreen' in raw) out.fullScreen = raw.fullScreen;
  if ('randomNotes' in raw) out.randomNotes = raw.randomNotes;
  return out;
}

// A single-occurrence edit is kept only for a real date, and only the fields that pass the same checks as a task.
function cleanOverrides(raw) {
  const out = {};
  if (!isPlainObject(raw)) return out;
  for (const key of Object.keys(raw)) {
    const value = raw[key];
    if (!isValidKey(key) || !isPlainObject(value)) continue;
    const kept = {};
    if (typeof value.title === 'string' && value.title.trim() !== '') kept.title = value.title.trim();
    if (typeof value.notes === 'string') kept.notes = value.notes;
    if (PRIORITIES.includes(value.priority)) kept.priority = value.priority;
    if (value.categoryId === null || typeof value.categoryId === 'string') kept.categoryId = value.categoryId;
    if ('start' in value && validateStart(value.start).length === 0) kept.start = value.start;
    if ('durationMinutes' in value && validateDuration(value.durationMinutes).length === 0) kept.durationMinutes = value.durationMinutes;
    if (isPlainObject(value.reminders) && validateReminders(value.reminders).length === 0) kept.reminders = cleanReminders(value.reminders);
    if (Object.keys(kept).length > 0) out[key] = kept;
  }
  return out;
}

// Make a task read from a file safe to use: fill missing fields, then validate it.
function normalizeTask(raw) {
  if (!isPlainObject(raw)) return { error: 'not a task' };
  const task = {
    id: raw.id,
    title: typeof raw.title === 'string' ? raw.title.trim() : raw.title,
    start: raw.start,
    durationMinutes: raw.durationMinutes,
    date: raw.recurrence ? null : raw.date,
    recurrence: isPlainObject(raw.recurrence) ? normalizeRule(raw.recurrence) : null,
    reminders: cleanReminders(raw.reminders),
    priority: raw.priority || 'Medium',
    categoryId: raw.categoryId === undefined ? null : raw.categoryId,
    notes: typeof raw.notes === 'string' ? raw.notes : '',
    exceptions: Array.isArray(raw.exceptions) ? raw.exceptions.filter(isValidKey) : [],
    additions: Array.isArray(raw.additions) ? raw.additions.filter(isValidKey) : [],
    overrides: cleanOverrides(raw.overrides),
    completions: cleanCompletions(raw.completions),
    completedAt: cleanCompletedAt(raw.completedAt),
  };
  if (typeof raw.continuedFrom === 'string' && raw.continuedFrom !== '') task.continuedFrom = raw.continuedFrom;
  const errors = validateTask(task);
  return errors.length ? { error: errors.join('; ') } : { task };
}

// Clean up a whole data object (from disk or an import file).
// Returns { data, warnings }. Never throws for individual bad items; they are skipped and reported.
// Saved statistics of finished days: { through: 'YYYY-MM-DD' | null, days: { key: [[taskId, dateKey, title, categoryId, minutes, done, startMs, zone], ...] } }
function normalizeStatsHistory(raw) {
  const empty = { through: null, days: {} };
  if (!isPlainObject(raw) || !isValidKey(raw.through) || !isPlainObject(raw.days)) return empty;
  const days = {};
  for (const [key, list] of Object.entries(raw.days)) {
    if (!isValidKey(key) || key > raw.through || !Array.isArray(list)) continue;
    const clean = list.filter((a) => Array.isArray(a) && a.length === 8
      && typeof a[0] === 'string' && typeof a[1] === 'string' && typeof a[2] === 'string'
      && (a[3] === null || typeof a[3] === 'string') && Number.isFinite(a[4]) && (a[5] === 0 || a[5] === 1)
      && Number.isFinite(a[6]) && Number.isInteger(a[7]));
    if (clean.length) days[key] = clean;
  }
  return { through: raw.through, days };
}

function normalizeData(raw) {
  const warnings = [];
  const source = isPlainObject(raw) ? raw : {};
  const settings = sanitizeSettings(source.settings);
  const categories = normalizeCategories(source.categories, warnings);

  const categoryIds = new Set(categories.map((c) => c.id));
  const tasks = [];
  const ids = new Set();
  let rawTasks = Array.isArray(source.tasks) ? source.tasks : [];
  if (rawTasks.length > MAX_TASKS) {
    warnings.push(t('Only the first {n} tasks were loaded', { n: MAX_TASKS }));
    rawTasks = rawTasks.slice(0, MAX_TASKS);
  }
  for (const rawTask of rawTasks) {
    const { task, error } = normalizeTask(rawTask);
    const label = isPlainObject(rawTask) && rawTask.title ? `"${rawTask.title}"` : t('A task');
    if (error) {
      warnings.push(t('{label} was skipped: {error}', { label, error }));
      continue;
    }
    if (ids.has(task.id)) {
      warnings.push(t('{label} was skipped because its id is used twice', { label }));
      continue;
    }
    ids.add(task.id);
    if (task.categoryId !== null && !categoryIds.has(task.categoryId)) task.categoryId = null;
    tasks.push(task);
  }

  const freeTasks = [];
  const freeIds = new Set();
  let rawFree = Array.isArray(source.freeTasks) ? source.freeTasks : [];
  if (rawFree.length > MAX_FREE_TASKS) {
    warnings.push(t('Only the first {n} free tasks were loaded', { n: MAX_FREE_TASKS }));
    rawFree = rawFree.slice(0, MAX_FREE_TASKS);
  }
  for (const rawItem of rawFree) {
    const { task, error } = normalizeFreeTask(rawItem);
    const label = isPlainObject(rawItem) && rawItem.title ? `"${rawItem.title}"` : t('A free task');
    if (error) {
      warnings.push(t('{label} was skipped: {error}', { label, error }));
      continue;
    }
    if (freeIds.has(task.id) || ids.has(task.id)) {
      warnings.push(t('{label} was skipped because its id is used twice', { label }));
      continue;
    }
    freeIds.add(task.id);
    if (task.categoryId !== null && !categoryIds.has(task.categoryId)) task.categoryId = null;
    freeTasks.push(task);
  }

  const restored = normalizeState(source.reminderState);
  const reminderState = restored.state;
  if (restored.dropped > 0) warnings.push(t('Some saved reminder information was damaged and was reset'));

  const missedReminders = (Array.isArray(source.missedReminders) ? source.missedReminders : [])
    .filter((m) => isPlainObject(m) && typeof m.taskId === 'string' && typeof m.dateKey === 'string' && Number.isFinite(m.startMs))
    .map((m) => ({
      taskId: m.taskId,
      dateKey: m.dateKey,
      title: String(m.title || ''),
      startMs: m.startMs,
      zoneName: String(m.zoneName || ''),
      alreadyStarted: Boolean(m.alreadyStarted),
    }))
    .slice(-50);

  return {
    data: { version: DATA_VERSION, settings, categories, tasks, freeTasks, noteRotation: normalizeNoteRotation(source.noteRotation, new Set(tasks.map((x) => x.id))), reminderState, missedReminders, statsHistory: normalizeStatsHistory(source.statsHistory) },
    warnings,
  };
}

function buildExport(data, now = new Date()) {
  return {
    app: APP_NAME,
    formatVersion: FORMAT_VERSION,
    exportedAt: now.toISOString(),
    settings: data.settings,
    categories: data.categories,
    tasks: data.tasks,
    freeTasks: data.freeTasks || [],
    statsHistory: data.statsHistory || { through: null, days: {} },
  };
}

// Reads text (or an already-parsed object) from an export file.
// Returns { data, warnings } or throws an Error with a friendly message.
function parseImport(input) {
  let parsed = input;
  if (typeof input === 'string') {
    try {
      parsed = JSON.parse(input);
    } catch (error) {
      throw new Error(t('This file is not a WaqtWise backup (it could not be read).'));
    }
  }
  if (!isPlainObject(parsed) || parsed.app !== APP_NAME) {
    throw new Error(t('This file is not a WaqtWise backup.'));
  }
  if (!Number.isInteger(parsed.formatVersion) || parsed.formatVersion < 1) {
    throw new Error(t('This backup file has no valid version number.'));
  }
  if (parsed.formatVersion > FORMAT_VERSION) {
    throw new Error(t('This backup was made by a newer version of WaqtWise. Please update the app first.'));
  }
  // Future versions: convert older formats here, one step at a time.
  const result = normalizeData(parsed);
  // Files made before the saved statistics were exported have no history: the caller keeps its own then.
  result.hasHistory = isPlainObject(parsed.statsHistory);
  return result;
}

module.exports = {
  APP_NAME,
  FORMAT_VERSION,
  DATA_VERSION,
  defaultCategories,
  localCategoryName,
  emptyData,
  normalizeData,
  buildExport,
  parseImport,
};
