'use strict';

// The free to-do list (tasks with no time yet) and the read-only task details.
// These methods are added to PlannerService (see ../service.js); `this` is the service.

const { t } = require('../../core/i18n');
const core = require('../../core');
const { copy } = require('./util');

const {
  normalizeFreeTask, MAX_FREE_TASKS, buildOccurrence, describeRule, normalizeRule, placementNote, reminderOffsets, formatTime12, formatDuration, dateKey, isValidKey, localCategoryName,
} = core;

class FreeTaskMethods {
  findFreeTask(id) {
    const item = (this.data.freeTasks || []).find((x) => x.id === id);
    if (!item) throw new Error(t('This task no longer exists.'));
    return item;
  }

  // The list as the window shows it (category names translated).
  getFreeTasks() {
    return (this.data.freeTasks || []).map((x) => {
      const category = this.categoryOf(x.categoryId);
      return {
        ...copy(x),
        categoryName: category ? localCategoryName(category) : '',
        categoryColor: category ? category.color : '',
        durationLabel: x.durationMinutes ? formatDuration(x.durationMinutes) : '',
      };
    });
  }

  getFreeTaskCount() {
    return (this.data.freeTasks || []).filter((x) => !x.done).length;
  }

  // form: { title, notes, priority, categoryId, durationMinutes }. With `id` it edits that task, otherwise it adds one.
  saveFreeTask({ id, form }) {
    const list = this.data.freeTasks || (this.data.freeTasks = []);
    const source = form && typeof form === 'object' ? form : {};
    if (id) {
      const old = this.findFreeTask(id);
      const { task, error } = normalizeFreeTask({ ...old, ...source, id: old.id, done: old.done, createdAt: old.createdAt }, this.now());
      if (error) throw new Error(error);
      if (task.categoryId !== null && !this.categoryOf(task.categoryId)) task.categoryId = null;
      this.data.freeTasks = list.map((x) => (x.id === id ? task : x));
      this.changed();
      return { ok: true, id };
    }
    if (list.length >= MAX_FREE_TASKS) throw new Error(t('The free list is full (at most {max} tasks)', { max: MAX_FREE_TASKS }));
    const { task, error } = normalizeFreeTask({ ...source, id: this.newId(), done: false }, this.now());
    if (error) throw new Error(error);
    if (task.categoryId !== null && !this.categoryOf(task.categoryId)) task.categoryId = null;
    list.push(task);
    this.changed();
    return { ok: true, id: task.id };
  }

  deleteFreeTask({ id }) {
    this.findFreeTask(id);
    this.data.freeTasks = this.data.freeTasks.filter((x) => x.id !== id);
    this.changed();
    return { ok: true };
  }

  setFreeDone({ id, done }) {
    const old = this.findFreeTask(id);
    this.data.freeTasks = this.data.freeTasks.map((x) => (x.id === id ? { ...old, done: Boolean(done) } : x));
    this.changed();
    return { ok: true };
  }

  clearFreeDone() {
    const before = (this.data.freeTasks || []).length;
    this.data.freeTasks = (this.data.freeTasks || []).filter((x) => !x.done);
    this.changed();
    return { ok: true, removed: before - this.data.freeTasks.length };
  }

  // direction: 'up' | 'down'
  moveFreeTask({ id, direction }) {
    const list = this.data.freeTasks || [];
    const i = list.findIndex((x) => x.id === id);
    if (i === -1) throw new Error(t('This task no longer exists.'));
    const j = direction === 'up' ? i - 1 : i + 1;
    if (j < 0 || j >= list.length) return { ok: true };
    const next = list.slice();
    [next[i], next[j]] = [next[j], next[i]];
    this.data.freeTasks = next;
    this.changed();
    return { ok: true };
  }

  // A new-task form filled in from a free task. Saving it with `fromFreeTaskId` moves it out of the free list.
  getFreeTaskForSchedule({ id, defaultKey }) {
    const item = this.findFreeTask(id);
    const form = this.newTaskDefaults(isValidKey(defaultKey) ? defaultKey : null);
    form.title = item.title;
    form.notes = item.notes;
    form.priority = item.priority;
    form.categoryId = item.categoryId && this.categoryOf(item.categoryId) ? item.categoryId : null;
    if (item.durationMinutes) form.durationMinutes = item.durationMinutes;
    return { fromFreeTaskId: id, form };
  }

  // Takes a one-time task off the schedule and puts it back in the free list (without its time).
  unscheduleTask({ taskId, dateKey: key }) {
    const task = this.findTask(taskId);
    if (task.recurrence) throw new Error(t('Only a task that does not repeat can go back to the free list.'));
    const list = this.data.freeTasks || (this.data.freeTasks = []);
    if (list.length >= MAX_FREE_TASKS) throw new Error(t('The free list is full (at most {max} tasks)', { max: MAX_FREE_TASKS }));
    const { task: item, error } = normalizeFreeTask({
      id: this.newId(),
      title: task.title,
      notes: task.notes,
      priority: task.priority,
      categoryId: task.categoryId,
      durationMinutes: task.durationMinutes,
      done: Boolean(task.completions && task.completions[task.date]),
    }, this.now());
    if (error) throw new Error(error);
    list.push(item);
    // The same removal as "Delete": tasks that followed it keep the times they have now.
    let result;
    try {
      result = this.deleteTask({ taskId, dateKey: key || task.date, scope: 'all' });
    } catch (error) {
      this.data.freeTasks = this.data.freeTasks.filter((x) => x.id !== item.id);
      throw error;
    }
    return { ok: true, id: item.id, frozen: result.frozen };
  }

  // Everything the details window shows for one occurrence of a task.
  getTaskDetails({ taskId, dateKey: key }) {
    const task = this.findTask(taskId);
    const o = buildOccurrence(this.provider(), task, key, false, this.recurrenceOptions());
    const category = this.categoryOf(o.categoryId);
    const zone = placementNote(this.provider(), o.start, key);
    return {
      taskId,
      dateKey: key,
      title: o.title,
      notes: o.notes,
      priority: o.priority,
      categoryName: category ? localCategoryName(category) : '',
      categoryColor: category ? category.color : '',
      startLabel: formatTime12(o.start),
      endLabel: formatTime12(o.end),
      endsNextDay: dateKey(o.end) !== dateKey(o.start),
      durationLabel: formatDuration(o.durationMinutes),
      zoneIndex: zone.zoneIndex,
      zoneName: t(zone.zoneName),
      isRecurring: Boolean(task.recurrence),
      repeatSummary: task.recurrence ? describeRule(normalizeRule(task.recurrence)) : '',
      done: o.done,
      remindersOn: Boolean(o.reminders && o.reminders.enabled),
      reminderOffsets: o.reminders && o.reminders.enabled ? reminderOffsets(o.reminders, this.settings) : [],
      fullScreen: Boolean(o.reminders && o.reminders.fullScreen),
      randomNotes: Boolean(o.reminders && o.reminders.fullScreen && o.reminders.randomNotes),
      followsTitle: this.followsTitle(o.startDefinition),
      canReturnToFree: !task.recurrence,
    };
  }
}

module.exports = { FreeTaskMethods };
