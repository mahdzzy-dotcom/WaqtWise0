'use strict';

// Statistics: every number and chart on the Statistics screen, worked out from the tasks.
//
// What counts: a task occurrence is "counted" once it is done OR its end time has passed. A task that is
// still to come today is not counted, so "78% done" never includes things that were never due yet.
// Occurrences are filed under the Planning Day (and zone) that contains their START, like the Daily View.
// Days that are over are saved as snapshots (see snapshotDays), so editing or deleting a task later does not
// change them. Today and the days not yet snapshotted are worked out from the tasks as they are now.
//
// computeStats(...) returns plain data (text, numbers, lists) for the window to draw.

const {
  addDaysToKey, keyToDayNumber, weekdayOfKey, splitKey, makeKey, daysInMonth,
  formatKeyShort, formatDuration, formatTime12, isValidKey,
} = require('./time');
const { deriveZone, currentPlanningDayKey, ZONE_NAMES } = require('./zones');
const { getOccurrences } = require('./tasks');
const { t: tr, tp, weekdayShort, monthLong, monthShort } = require('./i18n');
const { localCategoryName } = require('./data');

const RANGES = ['day', 'week', 'month', 'year', 'custom'];
const STREAK_GOAL = 70; // a day counts for the streak when at least this much of it is done
const MAX_HISTORY_DAYS = 3 * 366;
const wd = (key) => weekdayShort(weekdayOfKey(key));
const monthName = (key) => monthLong(splitKey(key).m - 1);
const monthAbbr = (key) => monthShort(splitKey(key).m - 1);
const ZONE_SHORT = ['Fajr', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'];
const noCategory = () => ({ name: tr('No category'), color: '#8ca0b5' });
const noun = (range) => ({ day: tr('yesterday'), week: tr('last week'), month: tr('last month'), year: tr('last year'), custom: tr('the previous period') })[range];
const LATE_LIMIT = 200;

// ---- date helpers (calendar keys, no time zones involved) ---------------------------------------

const daysBetween = (a, b) => keyToDayNumber(b) - keyToDayNumber(a);
const monthStartKey = (key) => { const { y, m } = splitKey(key); return makeKey(y, m, 1); };
const monthEndKey = (key) => { const { y, m } = splitKey(key); return makeKey(y, m, daysInMonth(y, m)); };
function shiftMonth(key, n) {
  const { y, m } = splitKey(key);
  const index = y * 12 + (m - 1) + n;
  return makeKey(Math.floor(index / 12), (index % 12) + 1, 1);
}
function eachDay(from, to, fn) {
  for (let k = from; k <= to; k = addDaysToKey(k, 1)) fn(k);
}

// ---- the selected range -----------------------------------------------------------------------

// query: { range, anchorKey, fromKey, toKey }. Returns the dates of the range and of the one before it.
function resolveRange(query, todayKey, weekStart = 0) {
  const q = query || {};
  const range = RANGES.includes(q.range) ? q.range : 'week';
  let anchor = isValidKey(q.anchorKey) ? q.anchorKey : todayKey;
  if (anchor > todayKey) anchor = todayKey;
  let start;
  let end;
  let prevStart;
  let prevEnd;
  if (range === 'day') {
    start = anchor; end = anchor;
    prevStart = addDaysToKey(anchor, -1); prevEnd = prevStart;
  } else if (range === 'week') {
    start = addDaysToKey(anchor, -((weekdayOfKey(anchor) - weekStart + 7) % 7)); end = addDaysToKey(start, 6);
    prevStart = addDaysToKey(start, -7); prevEnd = addDaysToKey(start, -1);
  } else if (range === 'month') {
    start = monthStartKey(anchor); end = monthEndKey(anchor);
    prevStart = shiftMonth(start, -1); prevEnd = monthEndKey(prevStart);
  } else if (range === 'year') {
    const { y } = splitKey(anchor);
    start = makeKey(y, 1, 1); end = makeKey(y, 12, 31);
    prevStart = makeKey(y - 1, 1, 1); prevEnd = makeKey(y - 1, 12, 31);
  } else {
    let from = isValidKey(q.fromKey) ? q.fromKey : addDaysToKey(todayKey, -29);
    let to = isValidKey(q.toKey) ? q.toKey : todayKey;
    if (from > to) [from, to] = [to, from];
    to = to > todayKey ? todayKey : to;
    from = from > to ? to : from;
    start = from; end = to;
    const length = daysBetween(from, to) + 1;
    prevStart = addDaysToKey(from, -length); prevEnd = addDaysToKey(from, -1);
  }
  const dataEnd = end > todayKey ? todayKey : end; // days that have not come yet have no numbers
  const span = daysBetween(start, dataEnd) + 1;
  // The earlier period is cut to the same number of days (this week so far vs the first days of last week).
  let prevDataEnd = addDaysToKey(prevStart, span - 1);
  if (prevDataEnd > prevEnd) prevDataEnd = prevEnd;
  return { range, anchor: range === 'custom' ? dataEnd : anchor, start, end, dataEnd, span, prevStart, prevEnd, prevDataEnd };
}

function rangeLabel(r, todayKey) {
  const soFar = r.end > todayKey ? tr(' · so far') : '';
  if (r.range === 'day') return `${wd(r.start)}${tr(', ')}${formatKeyShort(r.start, true)}${r.start === todayKey ? tr(' · today') : ''}`;
  if (r.range === 'week') return `${wd(r.start)} ${formatKeyShort(r.start)} – ${wd(r.end)} ${formatKeyShort(r.end, true)}${soFar}`;
  if (r.range === 'month') return `${monthName(r.start)} ${splitKey(r.start).y}${soFar}`;
  if (r.range === 'year') return `${splitKey(r.start).y}${soFar}`;
  return `${formatKeyShort(r.start, true)} – ${formatKeyShort(r.end, true)}`;
}

// The queries behind the "previous" and "next" buttons (null when there is nothing to go to).
function neighbours(r, todayKey, earliestKey) {
  if (r.range === 'custom') {
    const length = daysBetween(r.start, r.end) + 1;
    const back = r.prevEnd >= earliestKey ? { range: 'custom', fromKey: r.prevStart, toKey: r.prevEnd } : null;
    const forwardFrom = addDaysToKey(r.start, length);
    const forward = forwardFrom <= todayKey
      ? { range: 'custom', fromKey: forwardFrom, toKey: addDaysToKey(forwardFrom, length - 1) > todayKey ? todayKey : addDaysToKey(forwardFrom, length - 1) }
      : null;
    return { prev: back, next: forward };
  }
  const nextAnchor = addDaysToKey(r.end, 1);
  return {
    prev: r.prevEnd >= earliestKey ? { range: r.range, anchorKey: r.prevEnd } : null,
    next: nextAnchor <= todayKey ? { range: r.range, anchorKey: nextAnchor } : null,
  };
}

// ---- gathering the counted occurrences ---------------------------------------------------------

// The first day anything is planned (never more than about 3 years back).
function earliestDay(tasks, todayKey) {
  let earliest = todayKey;
  for (const t of tasks) {
    const candidates = [];
    if (t.date) candidates.push(t.date);
    if (t.recurrence && t.recurrence.startDate) candidates.push(t.recurrence.startDate);
    if (t.additions && t.additions.length) candidates.push(t.additions[0]);
    for (const k of candidates) if (isValidKey(k) && k < earliest) earliest = k;
  }
  const limit = addDaysToKey(todayKey, -MAX_HISTORY_DAYS);
  return earliest < limit ? limit : earliest;
}

// When a done occurrence was ticked, in milliseconds. null when it is not known (done before the time was recorded).
function completedTime(task, dateKey) {
  const iso = task && task.completedAt && task.completedAt[dateKey];
  const ms = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(ms) ? ms : null;
}

// Map: Planning Day key -> counted occurrences. Done or past-due only.
function collectDays(provider, tasks, options, fromKey, toKey, nowMs) {
  const memo = new Map();
  const cached = (key) => {
    let value = memo.get(key);
    if (!value) { value = provider(key); memo.set(key, value); }
    return value;
  };
  const days = new Map();
  const lo = addDaysToKey(fromKey, -2);
  const hi = addDaysToKey(toKey, 2);
  const context = { ...options, tasks };
  for (const task of tasks) {
    for (const o of getOccurrences(cached, task, lo, hi, context)) {
      if (!o.done && o.end.getTime() > nowMs) continue;
      const placed = deriveZone(cached, o.start);
      const key = placed.planningDayKey;
      if (key < fromKey || key > toKey) continue;
      if (!days.has(key)) days.set(key, []);
      days.get(key).push({
        taskId: o.taskId, dateKey: o.dateKey, key, title: o.title, categoryId: o.categoryId, minutes: o.durationMinutes,
        done: o.done, startMs: o.start.getTime(), zone: placed.zoneIndex,
        completedMs: o.done ? completedTime(task, o.dateKey) : null,
      });
    }
  }
  return days;
}

// ---- daily snapshots --------------------------------------------------------------------------
// Once a Planning Day is over, its counted occurrences are saved ("frozen") so later edits or deletions of
// tasks do not rewrite history. An entry is stored as a short list to keep the data file small.

function packEntry(e) {
  return [e.taskId, e.dateKey, e.title, e.categoryId, e.minutes, e.done ? 1 : 0, e.startMs, e.zone, e.completedMs === undefined ? null : e.completedMs];
}

function unpackEntry(a, key) {
  return {
    taskId: a[0], dateKey: a[1], key, title: a[2], categoryId: a[3], minutes: a[4], done: a[5] === 1, startMs: a[6], zone: a[7],
    completedMs: Number.isFinite(a[8]) ? a[8] : null, // older snapshots do not have it
  };
}

// Work out the counted occurrences of every Planning Day from fromKey to toKey. Returns { key: [packed entries] }
// (days without counted occurrences are left out).
function snapshotDays(provider, tasks, options, fromKey, toKey, now) {
  const out = {};
  if (toKey < fromKey) return out;
  const days = collectDays(provider, tasks, options || {}, fromKey, toKey, now.getTime());
  for (const [key, list] of days) out[key] = list.map(packEntry);
  return out;
}

// ---- small calculations ---------------------------------------------------------------------

function totals(list) {
  let done = 0;
  let minutes = 0;
  for (const e of list) { if (e.done) done++; minutes += e.minutes; }
  return { total: list.length, done, minutes };
}

// ---- lateness ---------------------------------------------------------------------------------
// A done occurrence is late when it was ticked more than `thresholdMs` after its start time. Its delay is the time
// from the start to the tick (never negative). Occurrences without a recorded tick time are left out.
function delayStat(list, thresholdMs) {
  let n = 0;
  let late = 0;
  let sum = 0;
  let max = 0;
  for (const e of list) {
    if (!e.done || e.completedMs === null || e.completedMs === undefined) continue;
    const delay = Math.max(0, e.completedMs - e.startMs);
    n++;
    sum += delay;
    if (delay > max) max = delay;
    if (delay > thresholdMs) late++;
  }
  return { n, late, onTime: n - late, avg: n ? Math.round(sum / 60000 / n) : null, max: Math.round(max / 60000) };
}
const lateMinutes = (m) => (m === null ? '–' : m === 0 ? tr('On time') : formatDuration(m));
const percentOf = (t) => (t.total ? Math.round((t.done / t.total) * 100) : null);

// ---- the whole picture ------------------------------------------------------------------------

// args: { provider, tasks, categories, options, now, query }
function computeStats({ provider, tasks, categories, options, now, query, weekStart = 0, frozen = null, lateAfterMinutes = 60 }) {
  const nowMs = now.getTime();
  const thresholdMs = lateAfterMinutes * 60000;
  const taskById = new Map(tasks.map((t) => [t.id, t]));
  const todayKey = currentPlanningDayKey(provider, now);
  const earliestKey = earliestDay(tasks, todayKey);
  const r = resolveRange(query, todayKey, weekStart);
  const days = collectDays(provider, tasks, options || {}, earliestKey < r.prevStart ? earliestKey : r.prevStart, todayKey, nowMs);

  // Days that are over are read from their saved snapshot instead of being worked out again.
  if (frozen && frozen.days) {
    const through = frozen.through || '';
    for (const key of Object.keys(frozen.days)) {
      if (key > through || key >= todayKey) continue;
      days.set(key, frozen.days[key].map((a) => {
        const e = unpackEntry(a, key);
        // Snapshots saved before the tick time was kept: take it from the task if it still exists.
        if (e.done && e.completedMs === null) e.completedMs = completedTime(taskById.get(e.taskId), e.dateKey);
        return e;
      }));
    }
  }

  const listFor = (from, to) => {
    const out = [];
    if (to < from) return out;
    eachDay(from, to, (k) => { const l = days.get(k); if (l) out.push(...l); });
    return out;
  };
  const statOf = (key) => totals(days.get(key) || []);
  const pctAt = (key) => (key > todayKey ? null : percentOf(statOf(key)));
  const nearby = neighbours(r, todayKey, earliestKey);

  const inRange = listFor(r.start, r.dataEnd);
  const cur = totals(inRange);
  const before = totals(listFor(r.prevStart, r.prevDataEnd));
  const lastPeriod = noun(r.range);

  // ---- streak (always as of today) ----
  let current = 0;
  let best = 0;
  let run = 0;
  eachDay(earliestKey, todayKey, (k) => {
    const t = statOf(k);
    if (t.total === 0) return; // a day without counted tasks neither adds nor breaks
    if (percentOf(t) >= STREAK_GOAL) { run++; if (run > best) best = run; } else run = 0;
  });
  for (let k = todayKey; k >= earliestKey; k = addDaysToKey(k, -1)) {
    const t = statOf(k);
    if (t.total === 0) continue;
    if (percentOf(t) >= STREAK_GOAL) current++;
    else if (k !== todayKey) break; // today may still be in progress, so it never breaks the streak
  }

  // ---- key figures ----
  const pctNow = percentOf(cur);
  const pctBefore = percentOf(before);
  const dNow = delayStat(inRange, thresholdMs);
  const dBefore = delayStat(listFor(r.prevStart, r.prevDataEnd), thresholdMs);
  const onNow = dNow.n ? Math.round((dNow.onTime / dNow.n) * 100) : null;
  const onBefore = dBefore.n ? Math.round((dBefore.onTime / dBefore.n) * 100) : null;
  const onTimeKpi = {
    id: 'ontime', label: tr('Done on time'), value: onNow === null ? '–' : String(onNow), unit: '%',
    delta: onNow === null ? { text: tr('No timing data yet'), tone: 'none' }
      : onBefore === null ? { text: tp(dNow.n, 'Out of {n} timed task', 'Out of {n} timed tasks'), tone: 'none' }
        : onNow === onBefore ? { text: tr('Same as {period}', { period: lastPeriod }), tone: 'flat' }
          : { text: tr(onNow > onBefore ? '▲ {n} pts vs {period}' : '▼ {n} pts vs {period}', { n: Math.abs(onNow - onBefore), period: lastPeriod }), tone: onNow > onBefore ? 'up' : 'down' },
  };
  const kpis = [
    {
      id: 'rate', label: tr('Completion rate'), value: pctNow === null ? '–' : String(pctNow), unit: '%',
      delta: pctBefore === null || pctNow === null ? { text: tr('No earlier data'), tone: 'none' }
        : pctNow === pctBefore ? { text: tr('Same as {period}', { period: lastPeriod }), tone: 'flat' }
          : { text: tr(pctNow > pctBefore ? '▲ {n} pts vs {period}' : '▼ {n} pts vs {period}', { n: Math.abs(pctNow - pctBefore), period: lastPeriod }), tone: pctNow > pctBefore ? 'up' : 'down' },
    },
    {
      id: 'done', label: tr('Tasks done'), value: String(cur.done), unit: tr('of {n}', { n: cur.total }),
      delta: before.total === 0 ? { text: tr('No earlier data'), tone: 'none' }
        : cur.done === before.done ? { text: tr('Same as {period}', { period: lastPeriod }), tone: 'flat' }
          : {
            text: tr(cur.done > before.done ? '▲ {n} more than {period}' : '▼ {n} fewer than {period}', { n: Math.abs(cur.done - before.done), period: lastPeriod }),
            tone: cur.done > before.done ? 'up' : 'down',
          },
    },
    onTimeKpi,
    { id: 'streak', label: tr('Current streak · as of today'), value: String(current), unit: tp(current, 'day', 'days'), delta: { text: tp(best, 'Best: {n} day', 'Best: {n} days'), tone: 'none' } },
    {
      id: 'time', label: tr('Planned time'), value: formatDuration(cur.minutes), unit: '',
      delta: before.total === 0 ? { text: tr('No earlier data'), tone: 'none' }
        : cur.minutes === before.minutes ? { text: tr('Same as {period}', { period: lastPeriod }), tone: 'flat' }
          : { text: tr(cur.minutes > before.minutes ? '▲ {time} vs {period}' : '▼ {time} vs {period}', { time: formatDuration(Math.abs(cur.minutes - before.minutes)), period: lastPeriod }), tone: 'flat' },
    },
  ];

  // ---- done vs planned bars ----
  let unit;
  if (r.range === 'day') unit = 'zone';
  else if (r.range === 'week' || r.range === 'month') unit = 'day';
  else if (r.range === 'year') unit = 'month';
  else unit = r.span <= 14 ? 'day' : r.span <= 100 ? 'week' : 'month';
  const items = [];
  const bucket = (label, title, list, future) => {
    const t = totals(list);
    const d = delayStat(list, thresholdMs);
    items.push({ label, title, done: t.done, total: t.total, pct: percentOf(t), future: Boolean(future), delayAvg: d.avg, delayN: d.n });
  };
  if (unit === 'zone') {
    ZONE_SHORT.forEach((name, i) => bucket(tr(name), tr(ZONE_NAMES[i]), inRange.filter((e) => e.zone === i + 1)));
  } else if (unit === 'day') {
    const dayNumbers = r.range === 'month' || r.range === 'custom';
    eachDay(r.start, r.dataEnd, (k) => bucket(dayNumbers ? String(splitKey(k).d) : wd(k), `${wd(k)} ${formatKeyShort(k)}`, days.get(k) || []));
  } else if (unit === 'week') {
    for (let k = r.start; k <= r.dataEnd; k = addDaysToKey(k, 7)) {
      const to = addDaysToKey(k, 6) > r.dataEnd ? r.dataEnd : addDaysToKey(k, 6);
      bucket(formatKeyShort(k), tr('Week of {date}', { date: formatKeyShort(k) }), listFor(k, to));
    }
  } else {
    const lastMonth = r.range === 'year' ? r.end : r.dataEnd;
    for (let m = monthStartKey(r.start); m <= lastMonth; m = shiftMonth(m, 1)) {
      const to = monthEndKey(m) > r.dataEnd ? r.dataEnd : monthEndKey(m);
      bucket(monthAbbr(m), `${monthName(m)} ${splitKey(m).y}`, m > r.dataEnd ? [] : listFor(m, to), m > r.dataEnd);
    }
  }
  const bars = {
    title: tr('Done vs planned'),
    sub: unit === 'zone' ? tr('Each bar is one zone of the day') : tr({ day: 'Each bar is one day', week: 'Each bar is one week', month: 'Each bar is one month' }[unit]),
    unit, items, maxTotal: Math.max(1, ...items.map((i) => i.total)),
  };

  // ---- by zone, by category ----
  const zones = ZONE_NAMES.map((name, i) => {
    const t = totals(inRange.filter((e) => e.zone === i + 1));
    return { index: i + 1, name: tr(name), done: t.done, total: t.total, pct: t.total ? Math.round((t.done / t.total) * 100) : 0 };
  });
  const catById = new Map((categories || []).map((c) => [c.id, c]));
  const groups = new Map();
  for (const e of inRange) {
    const key = catById.has(e.categoryId) ? e.categoryId : '';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(e);
  }
  const categoryRows = Array.from(groups.entries()).map(([id, list]) => {
    const c = id ? catById.get(id) : noCategory();
    const t = totals(list);
    return { id, name: id ? localCategoryName(c) : c.name, color: c.color, done: t.done, total: t.total, pct: Math.round((t.done / t.total) * 100), minutes: t.minutes, timeLabel: formatDuration(t.minutes) };
  }).sort((a, b) => b.minutes - a.minutes);

  // ---- needs attention ----
  const lateAll = inRange.filter((e) => !e.done);
  lateAll.sort((a, b) => (r.range === 'year' || r.range === 'custom' ? a.startMs - b.startMs : b.startMs - a.startMs));
  const late = {
    total: lateAll.length,
    items: lateAll.slice(0, LATE_LIMIT).map((e) => {
      const ago = daysBetween(e.key, todayKey);
      const started = new Date(e.startMs);
      return {
        taskId: e.taskId, dateKey: e.dateKey, title: e.title, zoneName: tr(ZONE_NAMES[e.zone - 1]),
        whenLabel: `${wd(e.key)} ${formatKeyShort(e.key)} · ${formatTime12(started)}`,
        ageLabel: ago <= 0 ? tr('Today') : tp(ago, '1 day late', '{n} days late'),
      };
    }),
  };

  // ---- lateness: which tasks are done late, and by how much ----
  const perTask = new Map();
  for (const e of inRange) {
    if (!perTask.has(e.taskId)) perTask.set(e.taskId, { taskId: e.taskId, title: e.title, list: [], missed: 0, lastKey: e.dateKey, lastStart: e.startMs });
    const g = perTask.get(e.taskId);
    g.list.push(e);
    if (!e.done) g.missed++;
    if (e.startMs >= g.lastStart) { g.title = e.title; g.lastKey = e.dateKey; g.lastStart = e.startMs; }
  }
  const lateRows = [];
  for (const g of perTask.values()) {
    const d = delayStat(g.list, thresholdMs);
    if (d.late === 0 && g.missed === 0) continue;
    lateRows.push({
      taskId: g.taskId, dateKey: g.lastKey, title: g.title, avg: d.avg, n: d.n, late: d.late, missed: g.missed,
      avgLabel: lateMinutes(d.avg), maxLabel: d.n ? lateMinutes(d.max) : '–',
    });
  }
  lateRows.sort((a, b) => ((b.avg === null ? -1 : b.avg) - (a.avg === null ? -1 : a.avg)) || b.late - a.late || b.missed - a.missed || a.title.localeCompare(b.title));
  const lateness = {
    thresholdLabel: formatDuration(lateAfterMinutes),
    measured: dNow.n,
    unknown: inRange.filter((e) => e.done && e.completedMs === null).length,
    lateCount: dNow.late,
    avgLabel: lateMinutes(dNow.avg),
    total: lateRows.length,
    items: lateRows.slice(0, 8),
  };
  const delayRow = (name, color, list) => {
    const d = delayStat(list, thresholdMs);
    return { name, color, avg: d.avg, avgLabel: lateMinutes(d.avg), n: d.n, late: d.late };
  };
  const lateByZone = ZONE_NAMES.map((name, i) => ({ index: i + 1, ...delayRow(tr(name), null, inRange.filter((e) => e.zone === i + 1)) }));
  const lateByCategory = categoryRows.map((c) => ({ ...delayRow(c.name, c.color, groups.get(c.id)), id: c.id }));
  const lateBy = {
    zones: lateByZone,
    categories: lateByCategory,
    maxAvg: Math.max(1, ...lateByZone.map((z) => z.avg || 0), ...lateByCategory.map((c) => c.avg || 0)),
  };
  const lateTrend = {
    unit: bars.unit,
    items: items.map((i) => ({ label: i.label, title: i.title, avg: i.delayAvg, n: i.delayN, future: i.future })),
    maxAvg: Math.max(1, ...items.map((i) => i.delayAvg || 0)),
    known: items.filter((i) => i.delayN > 0).length,
  };

  // ---- heat map ----
  const heatYearMode = r.range === 'year' || (r.range === 'custom' && r.span > 62);
  const highlight = r.range !== 'month' && r.range !== 'year' && r.span < 28;
  const heatDay = (k) => {
    const t = statOf(k);
    return { key: k, day: splitKey(k).d, pct: k > todayKey ? null : percentOf(t), total: t.total, done: t.done, future: k > todayKey, inRange: highlight && k >= r.start && k <= r.dataEnd };
  };
  let heat;
  if (heatYearMode) {
    const year = splitKey(r.dataEnd).y;
    const first = makeKey(year, 1, 1);
    const list = [];
    eachDay(first, makeKey(year, 12, 31), (k) => list.push(heatDay(k)));
    heat = { mode: 'year', title: tr('{period} at a glance', { period: year }), firstWeekday: (weekdayOfKey(first) - weekStart + 7) % 7, weekStart, days: list };
  } else {
    const anchorMonth = r.range === 'custom' ? r.dataEnd : r.anchor;
    const first = monthStartKey(anchorMonth);
    const list = [];
    eachDay(first, monthEndKey(first), (k) => list.push(heatDay(k)));
    heat = { mode: 'month', title: tr('{period} at a glance', { period: `${monthName(first)} ${splitKey(first).y}` }), firstWeekday: (weekdayOfKey(first) - weekStart + 7) % 7, weekStart, days: list };
  }

  // ---- completion trend: what the line shows depends on the range ----
  const point = (label, title, value) => ({ label, title: value === null ? title : `${title}: ${value}%`, value });
  let points = [];
  let compare = null;
  let thin = null;
  let legend = [];
  let sub = '';
  const dayPoint = (k) => point(wd(k), formatKeyShort(k), pctAt(k));
  if (r.range === 'day') {
    for (let i = 6; i >= 0; i--) points.push(dayPoint(addDaysToKey(r.start, -i)));
    sub = tr('The 7 days ending {date}', { date: formatKeyShort(r.start) });
  } else if (r.range === 'week') {
    for (let i = 0; i < 7; i++) points.push(dayPoint(addDaysToKey(r.start, i)));
    compare = [];
    for (let i = 0; i < 7; i++) compare.push(pctAt(addDaysToKey(r.prevStart, i)));
    legend = [{ label: tr('This week'), style: 'solid' }, { label: tr('Last week'), style: 'dashed' }];
    sub = tr('Each day of this week, against the same days last week');
  } else if (r.range === 'month' || (r.range === 'custom' && r.span <= 31)) {
    const average = r.range === 'month';
    thin = [];
    eachDay(r.start, r.dataEnd, (k) => {
      const dayNumber = splitKey(k).d;
      const label = average ? (dayNumber % 5 === 0 || dayNumber === 1 ? String(dayNumber) : '') : (r.span <= 12 || dayNumber % 5 === 0 ? String(dayNumber) : '');
      if (average) {
        const t = totals(listFor(addDaysToKey(k, -6) < earliestKey ? earliestKey : addDaysToKey(k, -6), k));
        thin.push(pctAt(k));
        points.push(point(label, formatKeyShort(k), percentOf(t)));
      } else {
        points.push(point(label, formatKeyShort(k), pctAt(k)));
      }
    });
    if (average) {
      legend = [{ label: tr('Daily'), style: 'faint' }, { label: tr('7-day average'), style: 'solid' }];
      sub = tr('Every day this month, and a 7-day average that smooths the bumps');
    } else {
      thin = null;
      sub = tr('Day by day, {from} – {to}', { from: formatKeyShort(r.start), to: formatKeyShort(r.dataEnd) });
    }
  } else if (r.range === 'custom' && r.span <= 120) {
    for (let k = r.start; k <= r.dataEnd; k = addDaysToKey(k, 7)) {
      const to = addDaysToKey(k, 6) > r.dataEnd ? r.dataEnd : addDaysToKey(k, 6);
      points.push(point(formatKeyShort(k), tr('Week of {date}', { date: formatKeyShort(k) }), percentOf(totals(listFor(k, to)))));
    }
    sub = tr('Week by week, {from} – {to}', { from: formatKeyShort(r.start), to: formatKeyShort(r.dataEnd) });
  } else {
    for (let m = monthStartKey(r.start); m <= r.dataEnd; m = shiftMonth(m, 1)) {
      const to = monthEndKey(m) > r.dataEnd ? r.dataEnd : monthEndKey(m);
      const from = m < r.start ? r.start : m;
      points.push(point(monthAbbr(m), `${monthName(m)} ${splitKey(m).y}`, percentOf(totals(listFor(from, to)))));
    }
    sub = r.range === 'year' ? tr('Share of planned tasks done, month by month') : tr('Month by month, {from} – {to}', { from: formatKeyShort(r.start), to: formatKeyShort(r.dataEnd) });
  }
  const known = points.filter((p) => p.value !== null).length;
  const trend = { sub, points, compare, thin, legend, ok: known >= 3 };

  return {
    range: r.range,
    rangeLabel: rangeLabel(r, todayKey),
    rangeStartKey: r.start,
    rangeEndKey: r.dataEnd,
    anchorKey: r.anchor,
    todayKey,
    earliestKey,
    prevQuery: nearby.prev,
    nextQuery: nearby.next,
    kpis, bars, zones, categories: categoryRows, late, lateness, lateBy, lateTrend, heat, trend,
    empty: days.size === 0,
  };
}

module.exports = { RANGES, STREAK_GOAL, resolveRange, rangeLabel, neighbours, earliestDay, collectDays, computeStats, snapshotDays, packEntry, unpackEntry, MAX_HISTORY_DAYS };
