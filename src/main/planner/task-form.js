'use strict';

// Creating, editing, deleting and completing tasks.
// These methods are added to PlannerService (see ../service.js); `this` is the service.

const { t, weekdayShort } = require('../../core/i18n');
const core = require('../../core');

const {
  createTask, validateStart, validateRule, normalizeRule, describeRule, previewDates, buildOccurrence, resolveStart, computeEnd, placementNote, setCompletion, editTask, deleteOccurrences, dependencyProblem, findDependents, followsTransitively, freezeDependents, dateKey, formatTime12, formatDuration, formatKeyShort, weekdayOfKey, isValidKey,
} = core;
const EDIT_FIELDS = ['title', 'start', 'durationMinutes', 'notes', 'priority', 'categoryId', 'reminders'];
const { copy, same } = require('./util');

class TaskFormMethods {
  // ---- the task form ---------------------------------------------------------------------------------------

  newTaskDefaults(forKey) {
    const key = isValidKey(forKey) ? forKey : dateKey(this.now());
    return {
      title: '',
      start: { mode: 'fixed', time: '09:00' },
      durationMinutes: 30,
      date: key,
      recurrence: null,
      // empty list = the default reminder time from Settings; the full-screen switch follows the Settings default
      reminders: { enabled: true, offsets: [], fullScreen: Boolean(this.settings.fullScreenDefaultForNewTasks), randomNotes: false },
      priority: 'Medium',
      categoryId: null,
      notes: '',
    };
  }

  getTaskForEdit({ taskId, dateKey: key }) {
    const task = this.findTask(taskId);
    const occurrence = buildOccurrence(this.provider(), task, key, false, this.recurrenceOptions());
    return {
      taskId,
      dateKey: key,
      isRecurring: Boolean(task.recurrence),
      done: occurrence.done,
      form: {
        title: occurrence.title,
        start: copy(occurrence.startDefinition),
        durationMinutes: occurrence.durationMinutes,
        date: task.recurrence ? key : task.date,
        recurrence: task.recurrence ? copy(task.recurrence) : null,
        reminders: copy(occurrence.reminders),
        priority: occurrence.priority,
        categoryId: occurrence.categoryId,
        notes: occurrence.notes,
      },
    };
  }

  // Live preview shown while the form is open: resolved start, end, zone, and the repeat summary.
  previewForm(form, context = {}) {
    const provider = this.provider();
    const errors = [];
    const out = { errors, resolved: null, placement: null, rule: null };

    errors.push(...validateStart(form.start));
    const durationOk = Number.isInteger(form.durationMinutes) && form.durationMinutes > 0;
    if (!durationOk) errors.push(t('Duration must be a whole number of minutes, more than 0'));

    let contextKey = form.recurrence ? form.recurrence.startDate : form.date;
    if (!isValidKey(contextKey)) {
      errors.push(form.recurrence ? t('Please choose a start date') : t('Please choose a date'));
      contextKey = null;
    }

    if (form.recurrence) {
      const ruleErrors = validateRule(form.recurrence);
      errors.push(...ruleErrors);
      if (ruleErrors.length === 0) {
        const rule = normalizeRule(form.recurrence);
        out.rule = {
          summary: describeRule(rule),
          preview: previewDates(rule, 5, this.recurrenceOptions()).map((k) => ({
            key: k,
            label: `${weekdayShort(weekdayOfKey(k))}${t(', ')}${formatKeyShort(k, true)}`,
          })),
        };
      }
    }

    if (form.start && form.start.mode === 'task' && validateStart(form.start).length === 0) {
      const problem = dependencyProblem(this.data.tasks, {
        id: context.taskId || '__new__',
        start: form.start,
        overrides: {},
      });
      if (problem) errors.push(problem);
    }

    if (contextKey && validateStart(form.start).length === 0) {
      const resolvedStart = resolveStart(provider, form.start, contextKey, this.recurrenceOptions(), context.taskId || '__new__');
      const start = resolvedStart.start;
      out.resolved = {
        startLabel: formatTime12(start),
        endLabel: null,
        endsNextDay: false,
        warning: resolvedStart.warning,
      };
      if (durationOk) {
        const end = computeEnd(start, form.durationMinutes);
        out.resolved.endLabel = formatTime12(end);
        out.resolved.endsNextDay = dateKey(end) !== dateKey(start);
      }
      const note = placementNote(provider, start, contextKey);
      out.placement = {
        text: note.text,
        zoneIndex: note.zoneIndex,
        zoneName: t(note.zoneName),
        differsFromDate: note.differsFromDate,
      };
    }
    return out;
  }

  cleanForm(form) {
    const fields = {
      title: String(form.title === undefined || form.title === null ? '' : form.title).trim(),
      start: form.start,
      durationMinutes: form.durationMinutes,
      notes: typeof form.notes === 'string' ? form.notes : '',
      priority: form.priority || 'Medium',
      categoryId: form.categoryId && this.categoryOf(form.categoryId) ? form.categoryId : null,
      reminders: {
        enabled: Boolean(form.reminders && form.reminders.enabled),
        offsets: form.reminders && Array.isArray(form.reminders.offsets) ? form.reminders.offsets : [],
        fullScreen: Boolean(form.reminders && form.reminders.fullScreen),
        randomNotes: Boolean(form.reminders && form.reminders.randomNotes),
      },
    };
    return { fields, recurrence: form.recurrence ? normalizeRule(form.recurrence) : null, date: form.date };
  }

  // payload: { mode: 'create' | 'edit', taskId, dateKey, scope: 'this'|'following'|'all', form }
  saveTask(payload) {
    this.freezePast();
    const { fields, recurrence, date } = this.cleanForm(payload.form);

    if (payload.mode === 'create') {
      const task = createTask({ id: this.newId(), ...fields, recurrence, date });
      this.checkDependencies(task);
      this.data.tasks.push(task);
      // Scheduling a free task moves it out of the free list.
      if (typeof payload.fromFreeTaskId === 'string') this.data.freeTasks = (this.data.freeTasks || []).filter((x) => x.id !== payload.fromFreeTaskId);
      if (date) this.refreshFrozenOccurrence(task.id, date); // a task added for a day that is already over
      this.changed();
      return { ok: true, taskId: task.id };
    }

    const old = this.findTask(payload.taskId);
    const key = payload.dateKey;
    const scope = payload.scope || 'all';
    const wasRecurring = Boolean(old.recurrence);
    const willRecur = Boolean(recurrence);

    let updated;
    let created = null;

    if (wasRecurring !== willRecur) {
      if (scope !== 'all') {
        throw new Error(t('To switch between repeating and not repeating, choose "All occurrences".'));
      }
      const replacement = createTask({ id: old.id, ...fields, recurrence, date });
      updated = { ...replacement, completions: copy(old.completions), completedAt: copy(old.completedAt || {}) };
    } else if (!wasRecurring) {
      ({ updated } = editTask(old, 'all', key, { ...fields, date }));
    } else {
      // Only the fields the user really changed are sent, so single-occurrence edits elsewhere survive.
      const current = buildOccurrence(this.provider(), old, key, false, this.recurrenceOptions());
      const currentValues = {
        title: current.title,
        start: current.startDefinition,
        durationMinutes: current.durationMinutes,
        notes: current.notes,
        priority: current.priority,
        categoryId: current.categoryId,
        reminders: current.reminders,
      };
      const patch = {};
      for (const name of EDIT_FIELDS) {
        if (!same(fields[name], currentValues[name])) patch[name] = fields[name];
      }
      const ruleChanged = !same(normalizeRule(old.recurrence), recurrence);
      if (ruleChanged) {
        if (scope === 'this') {
          throw new Error(t('The repeat pattern can only be changed for "This and following" or "All occurrences".'));
        }
        patch.recurrence = recurrence;
      }
      if (Object.keys(patch).length === 0) return { ok: true, taskId: old.id, unchanged: true };
      ({ updated, created } = editTask(old, scope, key, patch, { newId: this.newId(), ...this.recurrenceOptions() }));
    }

    this.checkDependencies(updated);
    this.data.tasks = this.data.tasks.map((t) => (t.id === updated.id ? updated : t));
    if (created) this.data.tasks.push(created);
    this.changed();
    return { ok: true, taskId: updated.id };
  }

  // Does this delete remove the whole task (so tasks that follow it lose it)?
  deletesWholeTask(task, scope, key) {
    if (!task.recurrence || scope === 'all') return true;
    return scope === 'following' && key <= normalizeRule(task.recurrence).startDate;
  }

  // Tasks that start relative to this one, and whether this delete removes it completely.
  getDeleteImpact({ taskId, dateKey: key, scope }) {
    const task = this.findTask(taskId);
    return {
      wholeTask: this.deletesWholeTask(task, scope || 'all', key),
      dependents: findDependents(this.data.tasks, taskId).map((t) => ({ taskId: t.id, title: t.title })),
    };
  }

  deleteTask({ taskId, dateKey: key, scope }) {
    this.freezePast();
    const task = this.findTask(taskId);
    const result = deleteOccurrences(task, scope || 'all', key, this.recurrenceOptions());
    let frozen = [];
    if (result === null) {
      // Tasks that followed it keep the times they have now.
      ({ tasks: this.data.tasks, frozen } = freezeDependents(this.provider(), this.data.tasks, taskId, key, this.recurrenceOptions()));
    } else {
      this.data.tasks = this.data.tasks.map((t) => (t.id === taskId ? result : t));
    }
    this.changed();
    return { ok: true, frozen };
  }

  checkDependencies(task) {
    const problem = dependencyProblem(this.data.tasks, task);
    if (problem) throw new Error(problem);
  }

  // The tasks a new or edited task can follow: everything except itself and the tasks that follow it.
  getReferenceChoices({ taskId }) {
    const describe = (def) => {
      if (def.mode === 'fixed') {
        const [h, m] = def.time.split(':').map(Number);
        return formatTime12(new Date(2000, 0, 1, h, m));
      }
      if (def.mode === 'prayer') {
        const name = t(def.prayer.charAt(0).toUpperCase() + def.prayer.slice(1));
        return t(def.direction === 'before' ? '{n} min before {prayer}' : '{n} min after {prayer}', { n: def.minutes, prayer: name });
      }
      return t('follows another task');
    };
    return this.data.tasks
      .filter((task) => task.id !== taskId && !(taskId && followsTransitively(this.data.tasks, task.id, taskId)))
      .sort((a, b) => a.title.localeCompare(b.title))
      .map((task) => ({
        taskId: task.id,
        title: task.title,
        label: `${task.title} (${describe(task.start)}${t(', ')}${formatDuration(task.durationMinutes)}${task.recurrence ? t(', repeats') : ''})`,
      }));
  }

  setDone({ taskId, dateKey: key, done }) {
    this.freezePast();
    const task = this.findTask(taskId);
    const updated = setCompletion(task, key, Boolean(done), this.now());
    this.data.tasks = this.data.tasks.map((t) => (t.id === taskId ? updated : t));
    this.refreshFrozenOccurrence(taskId, key);
    this.changed();
    return { ok: true };
  }

  duplicateTask({ taskId }) {
    const old = this.findTask(taskId);
    const task = createTask({
      id: this.newId(),
      title: t('{title} (copy)', { title: old.title }),
      start: copy(old.start),
      durationMinutes: old.durationMinutes,
      date: old.date,
      recurrence: old.recurrence ? copy(old.recurrence) : null,
      reminders: copy(old.reminders),
      priority: old.priority,
      categoryId: old.categoryId,
      notes: old.notes,
    });
    this.data.tasks.push(task);
    this.changed();
    return { ok: true, taskId: task.id };
  }
}

module.exports = { TaskFormMethods };
