'use strict';

// Saved statistics of finished days ("snapshots"), so the past stays fixed when tasks are edited or deleted.
// These methods are added to PlannerService (see ../service.js); `this` is the service.

const core = require('../../core');

const { currentPlanningDayKey, addDaysToKey, earliestDay, snapshotDays, MAX_HISTORY_DAYS } = core;

class HistoryMethods {
  history() {
    if (!this.data.statsHistory || typeof this.data.statsHistory !== 'object') this.data.statsHistory = { through: null, days: {} };
    return this.data.statsHistory;
  }

  // Saves every Planning Day that is over and not saved yet. Cheap when nothing is new, so it is called before
  // anything that could change the past (editing, deleting, settings, import) and whenever Statistics is opened.
  freezePast() {
    try {
      const now = this.now();
      const provider = this.provider();
      const today = currentPlanningDayKey(provider, now);
      const target = addDaysToKey(today, -1);
      const history = this.history();
      if (history.through && history.through >= target) return false;
      const from = history.through ? addDaysToKey(history.through, 1) : earliestDay(this.data.tasks, today);
      if (from <= target) {
        Object.assign(history.days, snapshotDays(provider, this.data.tasks, this.recurrenceOptions(), from, target, now));
      }
      history.through = target;
      const limit = addDaysToKey(today, -MAX_HISTORY_DAYS);
      for (const key of Object.keys(history.days)) if (key < limit) delete history.days[key];
      this.persist();
      return true;
    } catch (error) {
      return false; // statistics fall back to working the days out again
    }
  }

  // After one occurrence changes (marked done or not done, or added for a past date), update just that
  // occurrence in the saved days, leaving everything else in the past as it was.
  refreshFrozenOccurrence(taskId, dateKey) {
    try {
      const history = this.history();
      if (!history.through) return;
      const from = addDaysToKey(dateKey, -1);
      const to = addDaysToKey(dateKey, 1);
      if (from > history.through) return;
      const fresh = snapshotDays(this.provider(), this.data.tasks, this.recurrenceOptions(), from, to, this.now());
      for (const key of Object.keys(history.days)) {
        if (key < from || key > to) continue;
        history.days[key] = history.days[key].filter((a) => !(a[0] === taskId && a[1] === dateKey));
        if (!history.days[key].length) delete history.days[key];
      }
      for (const [key, list] of Object.entries(fresh)) {
        if (key > history.through) continue;
        const mine = list.filter((a) => a[0] === taskId && a[1] === dateKey);
        if (mine.length) history.days[key] = (history.days[key] || []).concat(mine);
      }
    } catch (error) {
      // leave the saved days as they are
    }
  }
}

module.exports = { HistoryMethods };
