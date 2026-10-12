'use strict';

// The Add / Edit task form (spec 12.3).

(function () {
  const WW = (window.WW = window.WW || {});
  const { h, clear, T, TP } = WW;
  const i18n = window.WWI18n;

  const DAYS = () => [0, 1, 2, 3, 4, 5, 6].map((i) => i18n.weekdayShort(i));
  const DAYS_LONG = () => [0, 1, 2, 3, 4, 5, 6].map((i) => i18n.weekdayLong(i));
  const MONTHS = () => [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((m) => i18n.monthLong(m - 1));
  const PRAYERS = () => [['fajr', T('Fajr')], ['dhuhr', T('Dhuhr')], ['asr', T('Asr')], ['maghrib', T('Maghrib')], ['isha', T('Isha')]];
  const POSITIONS = () => [[1, T('1st')], [2, T('2nd')], [3, T('3rd')], [4, T('4th')], [-1, T('Last')]];

  function weekdayOf(key) {
    const [y, m, d] = key.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  }

  function toggleInList(list, value) {
    return list.includes(value) ? list.filter((v) => v !== value) : [...list, value].sort((a, b) => a - b);
  }

  // ---- 12-hour time picker: hour, minute, AM/PM ----------------------------------------------------------

  WW.timePicker = function timePicker(value24, onChange) {
    let [hh, mm] = value24.split(':').map(Number);
    const hourSel = h('select', { class: 'sel-auto', 'aria-label': T('Hour') });
    for (let i = 1; i <= 12; i++) hourSel.appendChild(h('option', { value: i, text: String(i) }));
    const minSel = h('select', { class: 'sel-auto', 'aria-label': T('Minute') });
    for (let i = 0; i < 60; i++) minSel.appendChild(h('option', { value: i, text: String(i).padStart(2, '0') }));
    const ampmSel = h('select', { class: 'sel-auto', 'aria-label': T('AM or PM') }, h('option', { value: 'AM', text: T('AM') }), h('option', { value: 'PM', text: T('PM') }));

    hourSel.value = String(hh % 12 === 0 ? 12 : hh % 12);
    minSel.value = String(mm);
    ampmSel.value = hh >= 12 ? 'PM' : 'AM';

    function emit() {
      let hour = Number(hourSel.value) % 12;
      if (ampmSel.value === 'PM') hour += 12;
      const text = `${String(hour).padStart(2, '0')}:${String(Number(minSel.value)).padStart(2, '0')}`;
      onChange(text);
    }
    [hourSel, minSel, ampmSel].forEach((s) => s.addEventListener('change', emit));
    return h('span', { class: 'row tight' }, hourSel, h('span', { text: ':' }), minSel, ampmSel);
  };

  function offsetLabel(n) {
    if (n === 0) return T('At start time');
    if (n % 1440 === 0) return TP(n / 1440, '{n} day before', '{n} days before');
    if (n < 60) return T('{n} min before', { n });
    if (n % 60 === 0) return TP(n / 60, '{n} hour before', '{n} hours before');
    return T('{h}h {m}m before', { h: Math.floor(n / 60), m: n % 60 });
  }

  function newRule(startDate) {
    return {
      startDate,
      frequency: 'weekly',
      interval: 1,
      weekdays: [weekdayOf(startDate)],
      end: { type: 'never' },
    };
  }

  // ---- The form ---------------------------------------------------------------------------------------------

  // options: { mode: 'create' | 'edit', taskId, dateKey, defaultKey }
  WW.openTaskForm = async function openTaskForm(options) {
    const isEdit = options.mode === 'edit';
    let info = null;
    let f;
    if (isEdit) {
      info = await WW.call('getTaskForEdit', { taskId: options.taskId, dateKey: options.dateKey });
      f = info.form;
    } else {
      f = await WW.call('newTaskDefaults', options.defaultKey);
    }
    const originalRule = f.recurrence ? JSON.stringify(f.recurrence) : null;
    const settings = WW.state.settings;
    // The other tasks this one could follow (for "Relative to Task").
    const choices = await WW.call('getReferenceChoices', { taskId: options.taskId || null });

    const dlg = WW.openDialog({ title: isEdit ? T('Edit task') : T('New task'), wide: true });
    const errorsBox = h('div', { class: 'errors', hidden: true });
    const startBox = h('div');
    const startReadout = h('div', { class: 'readout' });
    const startWarning = h('div', { class: 'note start-warning', hidden: true });
    const endReadout = h('div', { class: 'readout', 'aria-label': T('End time') });
    const zoneReadout = h('div', { class: 'readout zone-readout', 'aria-label': T('Zone') });
    const placementNote = h('div', { class: 'note placement', hidden: true });
    const dateBox = h('div');
    const recurrenceBox = h('div');
    const remindersBox = h('div');
    let previewSeq = 0;

    // ---- preview ----
    const refreshPreview = WW.debounce(async () => {
      const seq = ++previewSeq;
      let p;
      try {
        p = await WW.call('previewForm', f, { taskId: options.taskId || null });
      } catch (error) {
        return;
      }
      if (seq !== previewSeq) return;

      if (p.resolved && p.resolved.warning) {
        startWarning.hidden = false;
        startWarning.textContent = p.resolved.warning;
      } else {
        startWarning.hidden = true;
      }

      startReadout.textContent = p.resolved ? p.resolved.startLabel : '—';
      endReadout.textContent = p.resolved && p.resolved.endLabel ? p.resolved.endLabel + (p.resolved.endsNextDay ? ` (${T('next day')})` : '') : '—';
      zoneReadout.className = `readout zone-readout ${p.placement ? `z${p.placement.zoneIndex}` : ''}`;
      zoneReadout.textContent = p.placement ? p.placement.zoneName : '—';
      if (p.placement && p.placement.differsFromDate) {
        placementNote.hidden = false;
        placementNote.textContent = p.placement.text;
      } else {
        placementNote.hidden = true;
      }

      const messages = p.errors.slice();
      showErrors(messages);
      renderRuleSummary(p.rule);
    }, 120);

    function showErrors(messages) {
      clear(errorsBox);
      errorsBox.hidden = messages.length === 0;
      messages.forEach((m) => errorsBox.appendChild(h('div', { text: m })));
    }

    function changed() {
      refreshPreview();
    }

    // ---- title ----
    const titleInput = h('input', {
      type: 'text', id: 'f-title', value: f.title, maxlength: '200', placeholder: T('What do you want to do?'), autocomplete: 'off',
      oninput: (e) => { f.title = e.target.value; },
    });

    // ---- start time ----
    function renderStart() {
      clear(startBox);
      const mode = f.start.mode;
      const toggle = h(
        'div', { class: 'segmented', role: 'group', 'aria-label': T('Start time type') },
        h('button', {
          type: 'button', class: mode === 'fixed' ? 'on' : '', text: T('Fixed Time'),
          onclick: () => { f.start = { mode: 'fixed', time: '09:00' }; renderStart(); changed(); },
        }),
        h('button', {
          type: 'button', class: mode === 'prayer' ? 'on' : '', text: T('Relative to Prayer'),
          onclick: () => { f.start = { mode: 'prayer', prayer: 'asr', direction: 'after', minutes: 10 }; renderStart(); changed(); },
        }),
        h('button', {
          type: 'button', class: mode === 'task' ? 'on' : '', text: T('Relative to Task'),
          onclick: () => {
            f.start = { mode: 'task', taskId: choices.length ? choices[0].taskId : '', point: 'end', direction: 'after', minutes: 0, fallbackTime: '09:00' };
            renderStart(); changed();
          },
        })
      );
      startBox.appendChild(toggle);

      if (mode === 'fixed') {
        startBox.appendChild(h('div', { class: 'row', style: { marginTop: '10px' } }, WW.timePicker(f.start.time, (t) => { f.start.time = t; changed(); })));
      } else if (mode === 'prayer') {
        const prayerSel = h('select', { class: 'sel-auto', 'aria-label': T('Prayer'), onchange: (e) => { f.start.prayer = e.target.value; changed(); } },
          PRAYERS().map(([key, label]) => h('option', { value: key, text: label, selected: f.start.prayer === key })));
        const dirSel = h('select', { class: 'sel-auto', 'aria-label': T('Before or after'), onchange: (e) => { f.start.direction = e.target.value; changed(); } },
          h('option', { value: 'before', text: T('before'), selected: f.start.direction === 'before' }),
          h('option', { value: 'after', text: T('after'), selected: f.start.direction === 'after' }));
        const mins = h('input', {
          type: 'number', class: 'num', min: '0', max: '10080', value: String(f.start.minutes), 'aria-label': T('Minutes'),
          oninput: (e) => { f.start.minutes = e.target.value === '' ? NaN : Number(e.target.value); changed(); },
        });
        startBox.appendChild(h('div', { class: 'row', style: { marginTop: '10px' } }, mins, h('span', { text: T('minutes') }), dirSel, prayerSel));
      } else {
        // Relative to another task: "15 minutes after the end of <task>"
        const mins = h('input', {
          type: 'number', class: 'num', min: '0', max: '10080', value: String(f.start.minutes), 'aria-label': T('Minutes'),
          oninput: (e) => { f.start.minutes = e.target.value === '' ? NaN : Number(e.target.value); changed(); },
        });
        const dirSel = h('select', { class: 'sel-auto', 'aria-label': T('Before or after'), onchange: (e) => { f.start.direction = e.target.value; changed(); } },
          h('option', { value: 'before', text: T('before'), selected: f.start.direction === 'before' }),
          h('option', { value: 'after', text: T('after'), selected: f.start.direction === 'after' }));
        const pointSel = h('select', { class: 'sel-auto', 'aria-label': T('Start or end of that task'), onchange: (e) => { f.start.point = e.target.value; changed(); } },
          h('option', { value: 'start', text: T('start'), selected: f.start.point === 'start' }),
          h('option', { value: 'end', text: T('end'), selected: f.start.point === 'end' }));
        const taskSel = h('select', { 'aria-label': T('Task to follow'), onchange: (e) => { f.start.taskId = e.target.value; changed(); } },
          h('option', { value: '', text: choices.length ? T('Choose a task…') : T('There are no other tasks yet') }),
          choices.map((c) => h('option', { value: c.taskId, text: c.label, selected: f.start.taskId === c.taskId })));
        startBox.appendChild(h('div', { class: 'row', style: { marginTop: '10px' } },
          mins, h('span', { text: T('minutes') }), dirSel, WW.isRtl() ? null : h('span', { text: 'the' }), pointSel, WW.isRtl() ? null : h('span', { text: T('of') })));
        startBox.appendChild(h('div', { style: { marginTop: '8px' } }, taskSel));
        startBox.appendChild(h('div', { class: 'row', style: { marginTop: '10px' } },
          h('span', { class: 'hint', text: T('Backup start time, used on days when that task is not there:') }),
          WW.timePicker(f.start.fallbackTime, (t) => { f.start.fallbackTime = t; changed(); })));
      }
      renderDate();
    }

    // ---- duration ----
    const hoursInput = h('input', {
      type: 'number', class: 'num', min: '0', max: '168', value: String(Math.floor(f.durationMinutes / 60)), 'aria-label': T('Duration hours'),
      oninput: updateDuration,
    });
    const minutesInput = h('input', {
      type: 'number', class: 'num', min: '0', value: String(f.durationMinutes % 60), 'aria-label': T('Duration minutes'),
      oninput: updateDuration,
    });
    function updateDuration() {
      const hrs = hoursInput.value === '' ? 0 : Number(hoursInput.value);
      const mns = minutesInput.value === '' ? 0 : Number(minutesInput.value);
      f.durationMinutes = hrs * 60 + mns;
      changed();
    }

    // ---- date ----
    function renderDate() {
      clear(dateBox);
      if (f.recurrence) return; // repeating tasks use the rule's start date
      dateBox.appendChild(
        h('div', { class: 'field' },
          h('label', { for: 'f-date', text: T('Date') }),
          h('input', { type: 'date', id: 'f-date', value: f.date || '', oninput: (e) => { f.date = e.target.value; changed(); } }),
          h('p', {
            class: 'hint',
            text: f.start.mode === 'task'
              ? T('The date of the task it follows: that day\'s occurrence of the other task is used.')
              : T('The calendar date of the start time. A task after midnight but before Fajr still appears under the previous Planning Day.'),
          }))
      );
    }

    // ---- recurrence ----
    const ruleSummary = h('div', { class: 'summary' });
    const rulePreview = h('ul', { class: 'preview-list' });

    function renderRuleSummary(rule) {
      ruleSummary.textContent = rule ? rule.summary : '';
      clear(rulePreview);
      if (rule) {
        rulePreview.appendChild(h('li', { class: 'hint', text: T('Next occurrences:'), style: { listStyle: 'none', marginInlineStart: '-18px' } }));
        rule.preview.forEach((d) => rulePreview.appendChild(h('li', { text: d.label })));
      }
    }

    function positionBoxes(spec) {
      return h('span', { class: 'daytoggle' },
        POSITIONS().map(([value, label]) =>
          h('button', {
            type: 'button', class: spec.positions.includes(value) ? 'on' : '', text: label,
            onclick: () => { spec.positions = toggleInList(spec.positions, value); renderRecurrence(); changed(); },
          })));
    }

    function weekdayToggles(getList, setList) {
      return h('span', { class: 'daytoggle' },
        DAYS().map((label, i) =>
          h('button', {
            type: 'button', class: getList().includes(i) ? 'on' : '', text: label, 'aria-pressed': String(getList().includes(i)),
            onclick: () => { setList(toggleInList(getList(), i)); renderRecurrence(); changed(); },
          })));
    }

    function weekdaySelect(spec) {
      return h('select', { class: 'sel-auto', 'aria-label': T('Weekday'), onchange: (e) => { spec.weekday = Number(e.target.value); changed(); } },
        DAYS_LONG().map((label, i) => h('option', { value: i, text: label, selected: spec.weekday === i })));
    }

    function monthlyControls(r) {
      const m = r.monthly;
      const modes = [
        ['dayOfMonth', T('On day number(s)')],
        ['lastDay', T('On the last day of the month')],
        ['nthWeekday', T('On the …th weekday')],
        ['lastWorkingDay', T('On the last working day')],
        ['weekdaysInMonth', T('On every chosen weekday')],
      ];
      const defaults = {
        dayOfMonth: () => ({ type: 'dayOfMonth', days: [Number(r.startDate.slice(8, 10))] }),
        lastDay: () => ({ type: 'lastDay' }),
        nthWeekday: () => ({ type: 'nthWeekday', weekday: weekdayOf(r.startDate), positions: [1] }),
        lastWorkingDay: () => ({ type: 'lastWorkingDay' }),
        weekdaysInMonth: () => ({ type: 'weekdaysInMonth', weekdays: [weekdayOf(r.startDate)] }),
      };
      const wrap = h('div');
      for (const [type, label] of modes) {
        const active = m.type === type;
        let detail = null;
        if (active && type === 'dayOfMonth') {
          detail = h('input', {
            type: 'text', class: 'sel-auto', value: m.days.join(', '), placeholder: '1, 15', 'aria-label': T('Day numbers'), style: { width: '140px' },
            oninput: (e) => {
              m.days = e.target.value.split(/[ ,]+/).filter(Boolean).map(Number).filter((n) => Number.isInteger(n));
              changed();
            },
          });
        } else if (active && type === 'nthWeekday') {
          detail = h('span', { class: 'row tight' }, positionBoxes(m), weekdaySelect(m));
        } else if (active && type === 'weekdaysInMonth') {
          detail = weekdayToggles(() => m.weekdays, (list) => { m.weekdays = list; });
        }
        wrap.appendChild(
          h('div', { class: 'row', style: { marginBottom: '6px' } },
            h('label', { class: 'switch' },
              h('input', { type: 'radio', name: 'monthly-mode', checked: active, onchange: () => { r.monthly = defaults[type](); renderRecurrence(); changed(); } }),
              h('span', { text: label })),
            detail)
        );
      }
      return wrap;
    }

    function yearlyControls(r) {
      const y = r.yearly;
      const monthSel = h('select', { class: 'sel-auto', 'aria-label': T('Month'), onchange: (e) => { y.month = Number(e.target.value); changed(); } },
        MONTHS().map((label, i) => h('option', { value: i + 1, text: label, selected: y.month === i + 1 })));
      const isDay = y.type === 'dayOfMonth';
      return h('div', {},
        h('div', { class: 'row', style: { marginBottom: '6px' } },
          h('label', { class: 'switch' },
            h('input', { type: 'radio', name: 'yearly-mode', checked: isDay, onchange: () => { r.yearly = { month: y.month, type: 'dayOfMonth', day: Number(r.startDate.slice(8, 10)) }; renderRecurrence(); changed(); } }),
            h('span', { text: T('On day') })),
          isDay ? h('input', { type: 'number', class: 'num', min: '1', max: '31', value: String(y.day), 'aria-label': T('Day'), oninput: (e) => { y.day = Number(e.target.value); changed(); } }) : null,
          h('span', { text: T('of') }), monthSel),
        h('div', { class: 'row' },
          h('label', { class: 'switch' },
            h('input', { type: 'radio', name: 'yearly-mode', checked: !isDay, onchange: () => { r.yearly = { month: y.month, type: 'nthWeekday', weekday: weekdayOf(r.startDate), positions: [1] }; renderRecurrence(); changed(); } }),
            h('span', { text: T('On the …th weekday') })),
          !isDay ? h('span', { class: 'row tight' }, positionBoxes(y), weekdaySelect(y)) : null));
    }

    function endControls(r) {
      const type = r.end.type;
      const radio = (value, label, extra) =>
        h('div', { class: 'row', style: { marginBottom: '6px' } },
          h('label', { class: 'switch' },
            h('input', {
              type: 'radio', name: 'end-mode', checked: type === value,
              onchange: () => {
                r.end = value === 'never' ? { type: 'never' } : value === 'date' ? { type: 'date', date: r.startDate } : { type: 'count', count: 10 };
                renderRecurrence(); changed();
              },
            }),
            h('span', { text: label })),
          type === value ? extra : null);
      return h('div', {},
        radio('never', T('Never ends')),
        radio('date', T('Ends on'), h('input', { type: 'date', class: 'sel-auto', value: r.end.date || '', 'aria-label': T('End date'), oninput: (e) => { r.end.date = e.target.value; changed(); } })),
        radio('count', T('Ends after'), h('span', { class: 'row tight' },
          h('input', { type: 'number', class: 'num', min: '1', max: '9999', value: String(r.end.count), 'aria-label': T('Number of occurrences'), oninput: (e) => { r.end.count = Number(e.target.value); changed(); } }),
          h('span', { text: T('occurrences') }))));
    }

    function renderRecurrence() {
      clear(recurrenceBox);
      const repeats = Boolean(f.recurrence);
      recurrenceBox.appendChild(
        h('div', { class: 'field' },
          h('div', { class: 'label', text: T('Repeat') }),
          h('div', { class: 'segmented', role: 'group', 'aria-label': T('Repeat') },
            h('button', { type: 'button', class: repeats ? '' : 'on', text: T('Does not repeat'), onclick: () => { f.recurrence = null; renderDate(); renderRecurrence(); changed(); } }),
            h('button', { type: 'button', class: repeats ? 'on' : '', text: T('Repeats'), onclick: () => { if (!f.recurrence) f.recurrence = newRule(f.date); renderDate(); renderRecurrence(); changed(); } })))
      );
      if (!repeats) return;
      const r = f.recurrence;

      const unitSel = h('select', { class: 'sel-auto', 'aria-label': T('Repeat unit'),
        onchange: (e) => {
          const freq = e.target.value;
          r.frequency = freq;
          delete r.weekdays; delete r.monthly; delete r.yearly;
          if (freq === 'weekly') r.weekdays = [weekdayOf(r.startDate)];
          if (freq === 'monthly') r.monthly = { type: 'dayOfMonth', days: [Number(r.startDate.slice(8, 10))] };
          if (freq === 'yearly') r.yearly = { month: Number(r.startDate.slice(5, 7)), type: 'dayOfMonth', day: Number(r.startDate.slice(8, 10)) };
          renderRecurrence(); changed();
        } },
        [['daily', T('Days')], ['weekly', T('Weeks')], ['monthly', T('Months')], ['yearly', T('Years')]].map(([v, l]) => h('option', { value: v, text: l, selected: r.frequency === v })));

      const box = h('div', { class: 'box' },
        h('div', { class: 'row', style: { marginBottom: '10px' } },
          h('span', { text: T('Every') }),
          h('input', { type: 'number', class: 'num', min: '1', max: '999', value: String(r.interval), 'aria-label': T('Repeat every'), oninput: (e) => { r.interval = e.target.value === '' ? NaN : Number(e.target.value); changed(); } }),
          unitSel));

      if (r.frequency === 'weekly') {
        box.appendChild(h('div', { class: 'field' }, h('div', { class: 'label', text: window.WWI18n.getLanguage() === 'en' ? 'On' : T('On days') }), weekdayToggles(() => r.weekdays, (list) => { r.weekdays = list; })));
      }
      if (r.frequency === 'monthly') box.appendChild(h('div', { class: 'field' }, monthlyControls(r)));
      if (r.frequency === 'yearly') box.appendChild(h('div', { class: 'field' }, yearlyControls(r)));

      box.appendChild(h('div', { class: 'field' },
        h('label', { for: 'f-start-date', text: T('Starts on') }),
        h('input', { type: 'date', id: 'f-start-date', class: 'sel-auto', value: r.startDate, oninput: (e) => { r.startDate = e.target.value; f.date = e.target.value; changed(); } })));
      box.appendChild(h('div', { class: 'field' }, h('div', { class: 'label', text: T('Ends') }), endControls(r)));
      box.appendChild(ruleSummary);
      box.appendChild(rulePreview);
      recurrenceBox.appendChild(box);
    }

    // ---- reminders ----
    function renderReminders() {
      clear(remindersBox);
      const rem = f.reminders;
      // The full-screen alert is independent of the reminder On/Off switch below.
      remindersBox.appendChild(
        h('div', { class: 'field' },
          h('label', { class: 'switch' },
            h('input', {
              type: 'checkbox', id: 'f-fullscreen', checked: Boolean(rem.fullScreen),
              onchange: (e) => { rem.fullScreen = e.target.checked; },
            }),
            h('span', { text: T('Full-screen alert at the start time'), style: { fontWeight: '600' } })),
          h('p', {
            class: 'hint',
            text: settings.fullScreenAlerts
              ? T('At exactly the start time a full-screen reminder covers the screen until you click a button. Its look is set in Settings.')
              : T('Full-screen alerts are switched off in Settings, so this will not show until they are switched on there.'),
          }))
      );
      remindersBox.appendChild(
        h('div', { class: 'field' },
          h('div', { class: 'label', text: T('Reminder') }),
          h('div', { class: 'segmented', role: 'group', 'aria-label': T('Reminder on or off') },
            h('button', { type: 'button', class: rem.enabled ? '' : 'on', text: T('Off'), onclick: () => { rem.enabled = false; renderReminders(); } }),
            h('button', { type: 'button', class: rem.enabled ? 'on' : '', text: T('On'), onclick: () => { rem.enabled = true; renderReminders(); } })))
      );
      if (!rem.enabled) return;

      const chips = h('div', { class: 'chips' });
      rem.offsets.slice().sort((a, b) => b - a).forEach((n) =>
        chips.appendChild(h('span', { class: 'chip' }, h('span', { text: offsetLabel(n) }),
          h('button', { type: 'button', 'aria-label': T('Remove {what}', { what: offsetLabel(n) }), text: '✕', onclick: () => { rem.offsets = rem.offsets.filter((o) => o !== n); renderReminders(); } }))));
      remindersBox.appendChild(chips);
      if (rem.offsets.length === 0) {
        remindersBox.appendChild(h('p', { class: 'hint', text: T('No custom times: the default reminder ({what}) will be used.', { what: offsetLabel(settings.defaultReminderOffsetMinutes).toLowerCase() }) }));
      }

      const amount = h('input', { type: 'number', class: 'num', min: '0', max: '10080', value: '15', 'aria-label': T('Reminder amount') });
      const unit = h('select', { class: 'sel-auto', 'aria-label': T('Reminder unit') },
        h('option', { value: '1', text: T('minutes') }), h('option', { value: '60', text: T('Hours') }), h('option', { value: '1440', text: T('Days') }));
      remindersBox.appendChild(h('div', { class: 'row' },
        amount, unit, h('span', { text: T('before the start') }),
        h('button', {
          type: 'button', class: 'btn small', text: T('Add reminder'),
          onclick: () => {
            const minutes = Number(amount.value) * Number(unit.value);
            if (!Number.isInteger(minutes) || minutes < 0) { WW.toast(T('Please enter a whole number of 0 or more.'), 'error'); return; }
            if (!rem.offsets.includes(minutes)) rem.offsets.push(minutes);
            renderReminders();
          },
        }),
        h('button', { type: 'button', class: 'btn small', text: T('At start time'), onclick: () => { if (!rem.offsets.includes(0)) rem.offsets.push(0); renderReminders(); } })));
    }

    // ---- assemble ----
    renderStart(); renderDate(); renderRecurrence(); renderReminders();

    const prioritySel = h('select', { id: 'f-priority', onchange: (e) => { f.priority = e.target.value; } },
      ['Low', 'Medium', 'High'].map((p) => h('option', { value: p, text: T(p), selected: f.priority === p })));
    const categorySel = h('select', { id: 'f-category', onchange: (e) => { f.categoryId = e.target.value || null; } },
      h('option', { value: '', text: T('No category') }),
      WW.state.categories.map((c) => h('option', { value: c.id, text: c.name, selected: f.categoryId === c.id })));
    const notes = h('textarea', { id: 'f-notes', 'aria-label': T('Notes'), value: f.notes, oninput: (e) => { f.notes = e.target.value; } });

    dlg.body.append(
      errorsBox,
      h('div', { class: 'field' }, h('label', { for: 'f-title', text: T('Title') }), titleInput),
      h('div', { class: 'field' }, h('div', { class: 'label', text: T('Start Time') }), startBox,
        h('div', { class: 'row', style: { marginTop: '10px' } }, h('span', { class: 'hint', text: T('Starts at') }), startReadout),
        startWarning),
      h('div', { class: 'field' }, h('div', { class: 'label', text: T('Duration') }),
        h('div', { class: 'row' }, hoursInput, h('span', { text: T('h') }), minutesInput, h('span', { text: T('min') }),
          h('span', { class: 'hint', text: T('Ends at') }), endReadout)),
      h('div', { class: 'field' }, h('div', { class: 'label', text: T('Zone (set automatically)') }), zoneReadout, placementNote),
      dateBox,
      recurrenceBox,
      remindersBox,
      h('div', { class: 'row', style: { alignItems: 'flex-start' } },
        h('div', { class: 'field grow' }, h('label', { for: 'f-priority', text: T('Priority') }), prioritySel),
        h('div', { class: 'field grow' }, h('label', { for: 'f-category', text: T('Category') }), categorySel)),
      h('div', { class: 'field' }, h('label', { for: 'f-notes', text: T('Notes') }), notes)
    );

    // ---- buttons ----
    const saveBtn = h('button', { class: 'btn primary', text: T('Save') });
    if (isEdit) {
      dlg.footer.append(
        h('button', { class: 'btn danger', text: T('Delete'), onclick: onDelete }),
        h('button', { class: 'btn', text: T('Duplicate'), onclick: onDuplicate }),
        h('span', { class: 'spacer' })
      );
    }
    dlg.footer.append(h('button', { class: 'btn', text: T('Cancel'), onclick: () => dlg.close() }), saveBtn);

    async function onSave() {
      f.title = titleInput.value;
      const p = await WW.call('previewForm', f, { taskId: options.taskId || null });
      const problems = p.errors.slice();
      if (f.title.trim() === '') problems.unshift(T('Please enter a title'));
      if (problems.length) {
        showErrors(problems);
        dlg.body.scrollTop = 0;
        errorsBox.scrollIntoView({ block: 'nearest' });
        return;
      }
      let scope = 'all';
      if (isEdit && info.isRecurring && f.recurrence) {
        const ruleChanged = JSON.stringify(f.recurrence) !== originalRule;
        scope = await WW.askScope({ title: T('Save changes'), verb: T('Save'), allowThis: !ruleChanged });
        if (scope === null) return;
      }
      saveBtn.disabled = true;
      try {
        await WW.call('saveTask', { mode: options.mode, taskId: options.taskId, dateKey: options.dateKey, scope, form: f });
        dlg.close();
        WW.toast(isEdit ? T('Task saved') : T('Task added'));
        WW.afterChange();
      } catch (error) {
        showErrors([error.message]);
        saveBtn.disabled = false;
      }
    }
    saveBtn.addEventListener('click', onSave);

    async function onDelete() {
      let scope = 'all';
      if (info.isRecurring) {
        scope = await WW.askScope({ title: T('Delete task'), verb: T('Delete'), allowThis: true });
        if (scope === null) return;
      }
      try {
        const impact = await WW.call('getDeleteImpact', { taskId: options.taskId, dateKey: options.dateKey, scope });
        if (impact.wholeTask && impact.dependents.length > 0) {
          const names = impact.dependents.map((d) => `“${d.title}”`).join(T(', '));
          const go = await WW.ask({
            title: T('Other tasks follow this task'),
            message: T('These tasks start relative to “{title}”: {names}. If you delete it, they stay at the times they have now, as fixed times.', { title: f.title, names }),
            choices: [{ label: T('Cancel'), value: false }, { label: T('Delete anyway'), value: true, kind: 'danger' }],
          });
          if (!go) return;
        } else if (!info.isRecurring) {
          const answer = await WW.ask({
            title: T('Delete task'), message: T('Delete "{title}"?', { title: f.title }),
            choices: [{ label: T('Cancel'), value: false }, { label: T('Delete'), value: true, kind: 'danger' }],
          });
          if (!answer) return;
        }
        const result = await WW.call('deleteTask', { taskId: options.taskId, dateKey: options.dateKey, scope });
        dlg.close();
        const inexact = (result.frozen || []).filter((t) => !t.exact);
        WW.toast(inexact.length
          ? T('Task deleted. “{titles}” could not keep its exact time and uses its backup time.', { titles: inexact.map((t) => t.title).join('”, “') })
          : T('Task deleted'));
        WW.afterChange();
      } catch (error) {
        showErrors([error.message]);
      }
    }

    async function onDuplicate() {
      try {
        await WW.call('duplicateTask', { taskId: options.taskId });
        dlg.close();
        WW.toast(T('Task duplicated'));
        WW.afterChange();
      } catch (error) {
        showErrors([error.message]);
      }
    }

    titleInput.focus();
    refreshPreview();
  };
})();
