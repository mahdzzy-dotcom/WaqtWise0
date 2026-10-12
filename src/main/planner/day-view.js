'use strict';

// The Daily View, the week strip, Statistics and the upcoming-reminders list.
// These methods are added to PlannerService (see ../service.js); `this` is the service.

const { t, tp, getLanguage, weekdayShort, weekdayLong, monthLong } = require('../../core/i18n');
const core = require('../../core');

const {
  localCategoryName, occurrencesForPlanningDay, computeDayLayout, currentPlanningDayKey, remindersInWindow, reminderOffsets, computeStats, addDaysToKey, dateKey, formatTime12, formatDuration, formatKeyShort, weekdayOfKey, parseDateKey, isValidKey,
} = core;

class DayViewMethods {
  // ---- the Daily View -----------------------------------------------------------------------------------

  hijriLabel(key) {
    try {
      const noon = parseDateKey(key);
      noon.setHours(12, 0, 0, 0);
      noon.setDate(noon.getDate() + this.settings.hijriAdjustment);
      return new Intl.DateTimeFormat(getLanguage() === 'ar' ? 'ar-u-ca-islamic-umalqura-nu-latn' : 'en-US-u-ca-islamic-umalqura-nu-latn', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      }).format(noon);
    } catch (error) {
      return '';
    }
  }

  viewOccurrence(o, planningKey, nowDate, conflictTitles) {
    const category = this.categoryOf(o.categoryId);
    return {
      id: o.id,
      taskId: o.taskId,
      dateKey: o.dateKey,
      title: o.title,
      notes: o.notes,
      priority: o.priority,
      categoryName: category ? localCategoryName(category) : '',
      categoryColor: category ? category.color : '',
      startLabel: formatTime12(o.start),
      endLabel: formatTime12(o.end),
      endsNextDay: dateKey(o.end) !== dateKey(o.start),
      afterMidnight: dateKey(o.start) !== planningKey,
      durationMinutes: o.durationMinutes,
      durationLabel: formatDuration(o.durationMinutes),
      isRecurring: o.isRecurring,
      hasReminders: reminderOffsets(o.reminders, this.settings).length > 0,
      hasFullScreen: Boolean(o.reminders && o.reminders.fullScreen),
      done: o.done,
      overlaps: Boolean(o.overlaps),
      conflictWith: conflictTitles || [],
      inProgress: !o.done && o.start.getTime() <= nowDate.getTime() && nowDate.getTime() < o.end.getTime(),
      extendsPastZoneEnd: Boolean(o.extendsPastZoneEnd),
      overdue: !o.done && o.end.getTime() <= nowDate.getTime(),
      followsTitle: this.followsTitle(o.startDefinition),
      startWarning: o.startWarning || null,
    };
  }

  // For a task that follows another task: the other task's title.
  followsTitle(startDefinition) {
    if (!startDefinition || startDefinition.mode !== 'task') return null;
    const other = this.data.tasks.find((t) => t.id === startDefinition.taskId);
    return other ? other.title : t('a deleted task');
  }

  getDay(planningKey) {
    if (!isValidKey(planningKey)) throw new Error(t('That date is not valid.'));
    const provider = this.provider();
    const nowDate = this.now();
    const nowMs = nowDate.getTime();
    const occurrences = occurrencesForPlanningDay(provider, this.data.tasks, planningKey, this.recurrenceOptions());
    const layout = computeDayLayout(provider, planningKey, occurrences);
    const currentKey = currentPlanningDayKey(provider, nowDate);
    const endKey = addDaysToKey(planningKey, 1);

    // Which tasks overlap which (titles for the "Conflict with ..." note) and the overlapping stretches.
    const conflictTitles = new Map();
    const conflictSpans = [];
    for (let i = 0; i < occurrences.length; i++) {
      for (let j = i + 1; j < occurrences.length; j++) {
        const a = occurrences[i];
        const b = occurrences[j];
        if (!(a.start < b.end && b.start < a.end)) continue;
        for (const [x, y] of [[a, b], [b, a]]) {
          if (!conflictTitles.has(x.id)) conflictTitles.set(x.id, []);
          if (!conflictTitles.get(x.id).includes(y.title)) conflictTitles.get(x.id).push(y.title);
        }
        conflictSpans.push({
          from: Math.max(a.start.getTime(), b.start.getTime()),
          to: Math.min(a.end.getTime(), b.end.getTime()),
          a: a.title,
          b: b.title,
        });
      }
    }

    const zones = layout.zones.map((z) => {
      const span = z.end.getTime() - z.start.getTime();
      const isCurrent = planningKey === currentKey && nowMs >= z.start.getTime() && nowMs < z.end.getTime();
      const segments = [...z.tasks, ...z.continued].map((o) => {
        const from = Math.max(o.start.getTime(), z.start.getTime());
        const to = Math.min(o.end.getTime(), z.end.getTime());
        const category = this.categoryOf(o.categoryId);
        return {
          leftPct: ((from - z.start.getTime()) / span) * 100,
          widthPct: Math.max(((to - from) / span) * 100, 0.8),
          color: category ? category.color : '',
          title: `${o.title} · ${formatTime12(o.start)} – ${formatTime12(o.end)}`,
          done: o.done,
        };
      });
      const zoneConflicts = conflictSpans
        .map((c) => ({ ...c, from: Math.max(c.from, z.start.getTime()), to: Math.min(c.to, z.end.getTime()) }))
        .filter((c) => c.to > c.from);
      const confSegs = zoneConflicts.map((c) => ({
        leftPct: ((c.from - z.start.getTime()) / span) * 100,
        widthPct: Math.max(((c.to - c.from) / span) * 100, 0.8),
        title: t('Conflict: “{a}” and “{b}” overlap', { a: c.a, b: c.b }),
      }));
      return {
        index: z.index,
        name: t(z.name),
        minutes: z.totalMinutes,
        freeMinutes: z.freeMinutes,
        minutesLeftLabel: isCurrent ? formatDuration(Math.max(0, Math.ceil((z.end.getTime() - nowMs) / 60000))) : '',
        taskCount: z.tasks.length,
        doneCount: z.tasks.filter((o) => o.done).length,
        confSegs,
        conflictCount: zoneConflicts.length,
        startLabel: this.zoneTimeLabel(z.start),
        endLabel: this.zoneTimeLabel(z.end),
        totalLabel: z.totalLabel,
        scheduledLabel: z.scheduledLabel,
        freeLabel: z.freeLabel,
        isCurrent,
        nowPct: isCurrent ? ((nowMs - z.start.getTime()) / span) * 100 : null,
        segments,
        tasks: z.tasks.map((o) => this.viewOccurrence(o, planningKey, nowDate, conflictTitles.get(o.id))),
        continued: z.continued.map((o) => ({
          taskId: o.taskId,
          dateKey: o.dateKey,
          title: o.title,
          endLabel: formatTime12(o.end),
          minutesLabel: formatDuration(o.minutesInZone),
        })),
      };
    });

    const listed = zones.reduce((n, z) => n + z.taskCount, 0);
    const listedDone = zones.reduce((n, z) => n + z.doneCount, 0);
    const currentZone = zones.find((z) => z.isCurrent) || null;
    const dayStart = layout.zones[0].start.getTime();
    const dayEnd = layout.zones[layout.zones.length - 1].end.getTime();
    const inProgress = zones.flatMap((z) => z.tasks.filter((t) => t.inProgress).map((t) => t.title));

    return {
      taskCount: listed,
      doneCount: listedDone,
      dayNowPct: planningKey === currentKey ? Math.min(100, Math.max(0, ((nowMs - dayStart) / (dayEnd - dayStart)) * 100)) : null,
      currentZone: currentZone
        ? { name: currentZone.name, timeLeftLabel: currentZone.minutesLeftLabel, freeLabel: currentZone.freeLabel, nextName: (zones[currentZone.index] || {}).name || '' }
        : null,
      inProgress,
      planningDayKey: planningKey,
      prevKey: addDaysToKey(planningKey, -1),
      nextKey: endKey,
      isCurrentDay: planningKey === currentKey,
      currentPlanningDayKey: currentKey,
      dateTitle: t('{weekday}, {month} {day}, {year}', {
        weekday: weekdayLong(weekdayOfKey(planningKey)), month: monthLong(Number(planningKey.slice(5, 7)) - 1), day: Number(planningKey.slice(8, 10)), year: planningKey.slice(0, 4),
      }),
      hijri: this.hijriLabel(planningKey),
      planningLine: t('Planning Day: {from} → {to}', { from: formatKeyShort(planningKey), to: formatKeyShort(endKey) }),
      week: this.weekStrip(planningKey, currentKey),
      zones,
    };
  }

  // The seven days of the week (from the first day chosen in Settings) around a planning day, for the strip at the top of the Daily View.
  weekStrip(planningKey, currentKey) {
    const provider = this.provider();
    const options = this.recurrenceOptions();
    const first = addDaysToKey(planningKey, -((weekdayOfKey(planningKey) - this.weekStart() + 7) % 7));
    const chipName = (wd) => (getLanguage() === 'en' ? weekdayShort(wd) : weekdayLong(wd));
    const days = [];
    for (let i = 0; i < 7; i++) {
      const key = addDaysToKey(first, i);
      const wd = weekdayOfKey(key);
      const list = occurrencesForPlanningDay(provider, this.data.tasks, key, options);
      const done = list.filter((o) => o.done).length;
      const pct = list.length ? Math.round((done / list.length) * 100) : 0;
      days.push({
        key,
        weekday: chipName(wd),
        day: parseDateKey(key).getDate(),
        total: list.length,
        done,
        pct,
        isToday: key === currentKey,
        isSelected: key === planningKey,
        label: `${key === currentKey ? t('Today, ') : ''}${weekdayLong(wd)} ${formatKeyShort(key)}${t(', ')}${list.length ? t('{done} of {total} done', { done, total: list.length }) : t('no tasks')}`,
      });
    }
    return { days, prevKey: addDaysToKey(planningKey, -7), nextKey: addDaysToKey(planningKey, 7) };
  }

  // The Statistics screen. query: { range: 'day'|'week'|'month'|'year'|'custom', anchorKey, fromKey, toKey }.
  getStats(query) {
    this.freezePast();
    return computeStats({
      frozen: this.history(),
      provider: this.provider(),
      tasks: this.data.tasks,
      categories: this.data.categories,
      options: this.recurrenceOptions(),
      now: this.now(),
      query: query || {},
      weekStart: this.weekStart(),
    });
  }

  // Next reminders, for the bell.
  getUpcoming() {
    const nowDate = this.now();
    const from = nowDate.getTime();
    const list = remindersInWindow(this.provider(), this.data.tasks, from, from + 7 * 86400000, this.settings).slice(0, 12);
    const todayKey = dateKey(nowDate);
    const tomorrowKey = addDaysToKey(todayKey, 1);
    return list.map((r) => {
      const k = dateKey(r.notifyAt);
      const day = k === todayKey ? t('Today') : k === tomorrowKey ? t('Tomorrow') : formatKeyShort(k);
      return {
        taskId: r.taskId,
        dateKey: r.dateKey,
        title: r.title,
        whenLabel: `${day}${t(', ')}${formatTime12(r.notifyAt)}`,
        startLabel: formatTime12(r.start),
        zoneName: t(r.zoneName),
      };
    });
  }
}

module.exports = { DayViewMethods };
