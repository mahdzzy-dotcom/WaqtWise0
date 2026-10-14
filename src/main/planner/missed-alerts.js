'use strict';

// Missed reminders (the bell) and the full-screen alert.
// These methods are added to PlannerService (see ../service.js); `this` is the service.

const { t } = require('../../core/i18n');
const core = require('../../core');

const {
  ALERT_PRESETS, localCategoryName, addDaysToKey, dateKey, formatTime12, formatDuration, formatKeyShort,
} = core;
const { copy } = require('./util');

class MissedAlertMethods {
  // ---- missed reminders (shown on the bell) ------------------------------------------------------------------
  // Reminders that came due while the computer was off or asleep. They stay on the bell until the person
  // opens the task, marks it done, or clears the list.

  missedList() {
    if (!Array.isArray(this.data.missedReminders)) this.data.missedReminders = [];
    return this.data.missedReminders;
  }

  // items: [{ taskId, dateKey, title, start, zoneName, alreadyStarted }] from the reminder engine.
  addMissed(items) {
    const list = this.missedList();
    for (const i of items) {
      if (list.some((m) => m.taskId === i.taskId && m.dateKey === i.dateKey)) continue;
      list.push({
        taskId: i.taskId,
        dateKey: i.dateKey,
        title: i.title,
        startMs: new Date(i.start).getTime(),
        zoneName: i.zoneName,
        alreadyStarted: Boolean(i.alreadyStarted),
      });
    }
    if (list.length > 50) list.splice(0, list.length - 50);
    this.changed();
  }

  // Entries whose task was deleted, or whose occurrence is already done or removed, quietly drop out.
  getMissed() {
    const list = this.missedList();
    const live = list.filter((m) => {
      const task = this.data.tasks.find((t) => t.id === m.taskId);
      return task && !task.completions[m.dateKey] && !(task.exceptions || []).includes(m.dateKey);
    });
    if (live.length !== list.length) {
      this.data.missedReminders = live;
      this.persist();
    }
    const todayKey = dateKey(this.now());
    const yesterdayKey = addDaysToKey(todayKey, -1);
    return live
      .slice()
      .sort((a, b) => b.startMs - a.startMs)
      .map((m) => {
        const k = dateKey(new Date(m.startMs));
        const day = k === todayKey ? t('Today') : k === yesterdayKey ? t('Yesterday') : formatKeyShort(k);
        return {
          taskId: m.taskId,
          dateKey: m.dateKey,
          title: m.title,
          whenLabel: `${day}${t(', ')}${formatTime12(new Date(m.startMs))}`,
          startLabel: formatTime12(new Date(m.startMs)),
          zoneName: t(m.zoneName),
          alreadyStarted: m.alreadyStarted,
        };
      });
  }

  dismissMissed({ taskId, dateKey: key }) {
    this.data.missedReminders = this.missedList().filter((m) => !(m.taskId === taskId && m.dateKey === key));
    this.changed();
    return { ok: true };
  }

  clearMissed() {
    this.data.missedReminders = [];
    this.changed();
    return { ok: true };
  }

  // ---- the full-screen alert ----------------------------------------------------------------------------------

  // One of a task's several notes (separated by ;), chosen at random without repeating until all were shown. A snoozed alert comes back with a different note.
  pickAlertNote(item) {
    const rotation = this.data.noteRotation || (this.data.noteRotation = {});
    const { note, record } = core.pickNote(item.notes, rotation[item.taskId], item.dateKey, this.random, Boolean(item.snoozed));
    const before = JSON.stringify(rotation[item.taskId] || null);
    if (record) rotation[item.taskId] = record;
    else delete rotation[item.taskId];
    if (JSON.stringify(record) !== before) {
      try {
        this.persist();
      } catch (error) {
        // not being able to remember the choice must never stop the alert from showing
      }
    }
    return note;
  }

  // What the alert window shows for each task starting now (plain text and numbers only).
  buildAlertItems(items) {
    return items.map((i) => {
      const category = this.categoryOf(i.categoryId);
      return {
        id: i.id,
        taskId: i.taskId,
        dateKey: i.dateKey,
        title: i.title,
        notes: i.randomNotes ? this.pickAlertNote(i) : i.notes || '',
        startMs: new Date(i.start).getTime(),
        startLabel: formatTime12(i.start),
        endLabel: formatTime12(i.end),
        durationLabel: formatDuration(i.durationMinutes),
        zoneName: t(i.zoneName),
        zoneIndex: i.zoneIndex,
        categoryName: category ? localCategoryName(category) : '',
        categoryColor: category ? category.color : '',
        priority: i.priority,
        snoozed: Boolean(i.snoozed),
      };
    });
  }

  // How the alert should look and behave right now.
  getAlertConfig() {
    const s = this.settings;
    return {
      appearance: copy(s.alertAppearance),
      screens: s.alertScreens,
      language: s.language,
      snoozeMinutes: s.snoozeMinutes,
      sound: { id: s.alertSound, volume: s.alertSoundVolume, repeat: s.alertSoundRepeat },
    };
  }

  // One of the ready-made looks.
  getAlertPreset(key) {
    const preset = ALERT_PRESETS[key];
    if (!preset) throw new Error(t('That look does not exist.'));
    return copy(preset.appearance);
  }

  // An example for the "Preview" button in Settings.
  getAlertSample() {
    const now = this.now();
    return {
      id: `sample-${now.getTime()}`,
      taskId: '__sample__',
      dateKey: dateKey(now),
      title: t('Study SQL: joins and subqueries'),
      notes: t('Open the exercises from yesterday.\nFinish chapter 4, then try the practice questions.'),
      startLabel: formatTime12(now),
      endLabel: formatTime12(new Date(now.getTime() + 45 * 60000)),
      durationLabel: '45m',
      zoneName: t('Dhuhr → Asr'),
      zoneIndex: 2,
      categoryName: t('Study'),
      categoryColor: '#8b5cf6',
      priority: 'High',
      snoozed: false,
    };
  }
}

module.exports = { MissedAlertMethods };
