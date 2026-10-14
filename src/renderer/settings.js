'use strict';

// The Settings screen (spec 12.4). Every change is saved as soon as it is made.

(function () {
  const WW = (window.WW = window.WW || {});
  const { h, clear, T, TP } = WW;
  const i18n = window.WWI18n;

  const dayLabels = () => [0, 1, 2, 3, 4, 5, 6].map((i) => i18n.weekdayShort(i));
  const prayers = () => [['fajr', T('Fajr')], ['dhuhr', T('Dhuhr')], ['asr', T('Asr')], ['maghrib', T('Maghrib')], ['isha', T('Isha')]];

  async function save(patch) {
    try {
      WW.state.settings = await WW.call('saveSettings', patch);
      WW.applyTheme(WW.state.settings.theme);
    } catch (error) {
      WW.toast(error.message, 'error');
      WW.state.settings = await WW.call('getSettings');
      WW.renderSettings();
    }
  }

  function toggle(label, checked, onChange, hint) {
    return h('div', {},
      h('label', { class: 'switch' },
        h('input', { type: 'checkbox', checked, onchange: (e) => onChange(e.target.checked) }),
        h('span', { text: label })),
      hint ? h('p', { class: 'hint', text: hint }) : null);
  }

  // A real on/off switch (a sliding knob) with the word On or Off next to it.
  function onOffSwitch(label, checked, onChange, hint) {
    const state = h('span', { class: 'onoff-state', text: checked ? T('On') : T('Off') });
    const input = h('input', {
      type: 'checkbox', class: 'onoff', role: 'switch', 'aria-label': label, checked,
      onchange: (e) => { state.textContent = e.target.checked ? T('On') : T('Off'); onChange(e.target.checked); },
    });
    return h('div', {},
      h('label', { class: 'onoff-row' }, input, h('span', { class: 'onoff-label', text: label }), state),
      hint ? h('p', { class: 'hint', text: hint }) : null);
  }

  function numberField(value, min, max, suffix, onCommit, label) {
    return h('span', { class: 'row tight' },
      h('input', {
        type: 'number', class: 'num', min: String(min), max: String(max), value: String(value), 'aria-label': label,
        onchange: (e) => {
          const n = Number(e.target.value);
          onCommit(e.target.value === '' ? NaN : n);
        },
      }),
      suffix ? h('span', { text: suffix }) : null);
  }

  function section(title, ...children) {
    const body = h('div', { class: 'settings-section-body' }, ...children);
    const sectionBox = h('section', { class: 'settings-section' });
    const toggle = h('button', {
      type: 'button', class: 'settings-section-toggle', 'aria-expanded': 'true',
      onclick: () => {
        const collapsed = sectionBox.classList.toggle('collapsed');
        toggle.setAttribute('aria-expanded', String(!collapsed));
      },
    }, h('h2', { text: title }), h('span', { class: 'section-chevron', text: '⌄', 'aria-hidden': 'true' }));
    sectionBox.append(toggle, body);
    return sectionBox;
  }

  function row(label, control) {
    return [h('label', { text: label }), control];
  }

  // One sound choice: a list, a volume slider and a "Preview" button. Each change is saved at once.
  function soundPicker({ label, options, idKey, volumeKey, extra }) {
    const st = WW.state.settings;
    let id = st[idKey];
    let volume = st[volumeKey];
    const readout = h('span', { class: 'vol-readout', text: `${volume}%` });
    const select = h('select', {
      class: 'sel-auto', 'aria-label': T('{label} sound', { label }),
      onchange: (e) => { id = e.target.value; save({ [idKey]: id }); },
    }, options.map(([value, text]) => h('option', { value, text: T(text), selected: id === value })));
    const slider = h('input', {
      type: 'range', min: '0', max: '100', step: '5', value: String(volume), class: 'vol', 'aria-label': T('{label} volume', { label }),
      oninput: (e) => { volume = Number(e.target.value); readout.textContent = `${volume}%`; },
      onchange: (e) => { volume = Number(e.target.value); save({ [volumeKey]: volume }); },
    });
    const preview = h('button', {
      class: 'btn small', type: 'button', text: T('Preview'), 'aria-label': T('Preview the {label} sound', { label: label.toLowerCase() }),
      onclick: () => WW.sounds.play(id, volume),
    });
    return h('div', {}, h('div', { class: 'row' }, select, slider, readout, preview), extra || null);
  }

  function soundsSection() {
    const st = WW.state.settings;
    return section(T('Sounds'),
      h('p', { class: 'dialog-message', text: T('Sounds are made by WaqtWise itself and play only while it is running. They are separate from the Windows notification sound above.') }),
      h('div', { class: 'settings-grid' },
        row(T('Task done'), soundPicker({ label: T('Task done'), options: WW.sounds.DONE_OPTIONS, idKey: 'doneSound', volumeKey: 'doneSoundVolume',
          extra: h('p', { class: 'hint', text: T('Plays when you tick a task as done.') }) })),
        row(T('Full-screen alert'), soundPicker({ label: T('Full-screen alert'), options: WW.sounds.ALERT_OPTIONS, idKey: 'alertSound', volumeKey: 'alertSoundVolume',
          extra: h('div', {},
            toggle(T('Keep repeating until a button is pressed'), st.alertSoundRepeat, (v) => save({ alertSoundRepeat: v })),
            h('p', { class: 'hint', text: T('Plays when a full-screen alert appears (on one screen only, even if several are covered).') })) }))));
  }

  function categoriesSection() {
    const list = h('div');
    const draw = () => {
      clear(list);
      WW.state.categories.forEach((c) => {
        const name = h('input', { type: 'text', value: c.name, maxlength: '40', 'aria-label': T('Name of {name}', { name: c.name }) });
        const color = h('input', { type: 'color', value: c.color, 'aria-label': T('Color of {name}', { name: c.name }) });
        const commit = async () => {
          try {
            WW.state.categories = await WW.call('updateCategory', { id: c.id, name: name.value, color: color.value });
            WW.toast(T('Category saved'));
          } catch (error) {
            WW.toast(error.message, 'error');
            name.value = c.name;
          }
          draw();
        };
        name.addEventListener('change', commit);
        color.addEventListener('change', commit);
        list.appendChild(h('div', { class: 'cat-row' }, color, name,
          h('button', {
            class: 'btn small danger', text: T('Delete'),
            onclick: async () => {
              const ok = await WW.ask({
                title: T('Delete category'), message: T('Delete "{name}"? Tasks in this category are kept, but they become uncategorized.', { name: c.name }),
                choices: [{ label: T('Cancel'), value: false }, { label: T('Delete'), value: true, kind: 'danger' }],
              });
              if (!ok) return;
              WW.state.categories = await WW.call('deleteCategory', { id: c.id });
              draw();
            },
          })));
      });
      const newName = h('input', { type: 'text', placeholder: T('New category name'), maxlength: '40', 'aria-label': T('New category name') });
      const newColor = h('input', { type: 'color', value: '#3b82f6', 'aria-label': T('New category color') });
      list.appendChild(h('div', { class: 'cat-row' }, newColor, newName,
        h('button', {
          class: 'btn small primary', text: T('Add'),
          onclick: async () => {
            try {
              WW.state.categories = await WW.call('addCategory', { name: newName.value, color: newColor.value });
              draw();
            } catch (error) {
              WW.toast(error.message, 'error');
            }
          },
        })));
    };
    draw();
    return section(T('Categories'), list);
  }


  // ---- Full-screen reminder ------------------------------------------------------------------------------

  const FONTS = ['Segoe UI', 'Tahoma', 'Arial', 'Verdana', 'Georgia', 'Times New Roman'];
  const presetList = () => [
    ['dark', T('Dark')], ['light', T('Light')], ['highContrast', T('High contrast')], ['red', T('Red alert')], ['calm', T('Calm green')],
  ];
  const sampleItem = () => ({
    id: 'preview', taskId: '__sample__', dateKey: '2026-01-01', title: T('Study SQL: joins and subqueries'),
    notes: T('Open the exercises from yesterday.\nFinish chapter 4, then try the practice questions.'),
    startLabel: `12:00 ${T('PM')}`, endLabel: `12:45 ${T('PM')}`, durationLabel: T('{m}m', { m: 45 }), zoneName: 'Dhuhr → Asr', zoneIndex: 2,
    categoryName: T('Study'), categoryColor: '#8b5cf6', priority: 'High', snoozed: false,
  });

  // setIn(object, ['name', 'size'], 90) -> a copy with that value changed
  function setIn(object, keys, value) {
    const copy = JSON.parse(JSON.stringify(object));
    let node = copy;
    keys.slice(0, -1).forEach((k) => { node = node[k]; });
    node[keys[keys.length - 1]] = value;
    return copy;
  }
  function getIn(object, keys) {
    return keys.reduce((node, k) => node[k], object);
  }
  function nestedPatch(keys, value) {
    return keys.reduceRight((inner, key) => ({ [key]: inner }), value);
  }

  function alertSection() {
    const preview = h('div', { class: 'alert-preview', 'aria-label': T('Preview of the full-screen reminder') });

    function drawPreview() {
      const { frame } = WW.AlertView.render(preview, {
        item: sampleItem(), remaining: 0, appearance: WW.state.settings.alertAppearance,
        snoozeMinutes: WW.state.settings.snoozeMinutes, guardActive: false,
      }, null);
      const fit = () => { frame.style.transform = `scale(${preview.clientWidth / 1280})`; };
      fit();
      requestAnimationFrame(fit);
    }

    // Change one appearance value. `commit` false = only update the preview while a slider is being dragged.
    async function change(keys, value, commit = true) {
      WW.state.settings = { ...WW.state.settings, alertAppearance: setIn(WW.state.settings.alertAppearance, keys, value) };
      drawPreview();
      if (!commit) return;
      try {
        WW.state.settings = await WW.call('saveSettings', { alertAppearance: nestedPatch(keys, value) });
      } catch (error) {
        WW.toast(error.message, 'error');
        WW.state.settings = await WW.call('getSettings');
        WW.renderSettings();
      }
    }

    const value = (keys) => getIn(WW.state.settings.alertAppearance, keys);
    const color = (keys, label) => h('input', { type: 'color', value: value(keys), 'aria-label': label, onchange: (e) => change(keys, e.target.value) });
    const check = (keys, label) => h('label', { class: 'switch' },
      h('input', { type: 'checkbox', checked: value(keys), 'aria-label': label, onchange: (e) => change(keys, e.target.checked) }), h('span', { text: label }));
    const slider = (keys, min, max, label) => {
      const readout = h('span', { class: 'hint', text: T('{n} px', { n: value(keys) }) });
      return h('span', { class: 'row tight' },
        h('input', {
          type: 'range', min: String(min), max: String(max), value: String(value(keys)), 'aria-label': label, style: { width: '220px' },
          oninput: (e) => { readout.textContent = T('{n} px', { n: e.target.value }); change(keys, Number(e.target.value), false); },
          onchange: (e) => change(keys, Number(e.target.value)),
        }), readout);
    };
    const select = (keys, options, label) => h('select', { class: 'sel-auto', 'aria-label': label, onchange: (e) => change(keys, e.target.value) },
      options.map(([v, l]) => h('option', { value: v, text: l, selected: value(keys) === v })));

    const presets = h('div', { class: 'row' }, presetList().map(([key, label]) => h('button', {
      class: 'btn small', type: 'button', text: label,
      onclick: async () => {
        const preset = await WW.call('getAlertPreset', key);
        WW.state.settings = await WW.call('saveSettings', { alertAppearance: preset });
        const y = window.scrollY;
        WW.renderSettings();
        window.scrollTo(0, y);
      },
    })));

    const box = section(T('Full-screen reminder'),
      h('p', { class: 'dialog-message', text: T('At the exact start time of a task that has the full-screen alert switched on, a full-screen reminder covers the screen so it cannot be missed. It stays until you click a button.') }),
      h('div', { class: 'settings-grid' },
        row(T('Full-screen alerts'), onOffSwitch(T('Full-screen reminders'), WW.state.settings.fullScreenAlerts, (v) => save({ fullScreenAlerts: v }), T('Each task also has its own switch in the task form. With this off, no full-screen alert appears.'))),
        row(T('New tasks'), toggle(T('Switch the full-screen alert on for new tasks'), WW.state.settings.fullScreenDefaultForNewTasks, (v) => save({ fullScreenDefaultForNewTasks: v }))),
        row(T('Screens'), h('select', { class: 'sel-auto', 'aria-label': T('Screens'), onchange: (e) => save({ alertScreens: e.target.value }) },
          h('option', { value: 'all', text: T('All screens'), selected: WW.state.settings.alertScreens === 'all' }),
          h('option', { value: 'main', text: T('Main screen only'), selected: WW.state.settings.alertScreens === 'main' }))),
        row(T('Ready-made looks'), presets),
        row(T('Colors'), h('div', { class: 'row' },
          h('span', { text: T('Background') }), color(['backgroundColor'], T('Background color')),
          h('span', { text: T('Text') }), color(['textColor'], T('Text color')),
          h('span', { text: T('Accent') }), color(['accentColor'], T('Accent color')))),
        row(T('Font'), h('div', { class: 'row' },
          select(['fontFamily'], FONTS.map((f) => [f, f]), T('Font')),
          select(['alignment'], [['center', T('Centered')], ['left', T('Left aligned')]], T('Alignment')))),
        row(T('Task name'), h('div', {},
          slider(['name', 'size'], 24, 160, T('Task name size')),
          h('div', { class: 'row', style: { marginTop: '8px' } }, color(['name', 'color'], T('Task name color')),
            check(['name', 'bold'], T('Bold')), check(['name', 'italic'], T('Italic')), check(['name', 'uppercase'], T('CAPITALS'))))),
        row(T('Notes'), h('div', {},
          check(['notes', 'show'], T('Show the notes')),
          h('div', { style: { marginTop: '8px' } }, slider(['notes', 'size'], 14, 96, T('Notes size'))),
          h('div', { class: 'row', style: { marginTop: '8px' } }, color(['notes', 'color'], T('Notes color')),
            check(['notes', 'bold'], T('Bold')), check(['notes', 'italic'], T('Italic'))))),
        row(T('Details shown'), h('div', { class: 'row' },
          check(['show', 'time'], T('Time')), check(['show', 'duration'], T('Duration')), check(['show', 'zone'], T('Zone')),
          check(['show', 'category'], T('Category')), check(['show', 'priority'], T('Priority')))),
        row(T('Buttons shown'), h('div', {},
          h('div', { class: 'row' },
            check(['buttons', 'snooze'], T('Snooze')), check(['buttons', 'open'], T('Open task')), check(['buttons', 'done'], T('Mark as Done'))),
          h('p', { class: 'hint', text: T('"Got it" is always shown, so the reminder can always be closed.') })))),
      h('div', { style: { marginTop: '16px' } },
        preview,
        h('div', { class: 'row', style: { marginTop: '10px' } },
          h('button', {
            class: 'btn', text: T('Preview full screen'),
            onclick: async () => {
              try { await window.api.previewAlert(); } catch (error) { WW.toast(error.message, 'error'); }
            },
          }),
          h('span', { class: 'hint', text: T('Shows the real full-screen reminder with an example task. Click "Got it" to close it.') }))));
    requestAnimationFrame(drawPreview);
    drawPreview();
    return box;
  }

  const CUSTOM_VALUE = '__custom__';
  let customPending = false; // "Custom city…" chosen but not saved yet

  // Name, latitude, longitude and time zone of a city that is not in the list.
  function customCityPanel(s) {
    const c = s.customCity || {};
    const computerZone = (WW.state.city && WW.state.city.computerTimeZone) || '';
    const field = (label, value, type, extra = {}) => h('input', { type, value: value === undefined || value === null ? '' : String(value), 'aria-label': label, placeholder: label, ...extra });
    const name = field(T('City name'), c.name, 'text', { maxlength: '40' });
    const lat = field(T('Latitude'), c.latitude, 'text', { inputmode: 'decimal' });
    const lon = field(T('Longitude'), c.longitude, 'text', { inputmode: 'decimal' });
    const zones = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];
    const zone = field(T('Time zone'), c.timeZone || computerZone, 'text', { list: 'tz-list', spellcheck: 'false' });
    const note = h('p', { class: 'hint' });
    const num = (el) => (el.value.trim() === '' ? NaN : Number(el.value.trim().replace(',', '.')));
    const info = () => {
      const city = WW.state.city;
      note.textContent = city && city.custom && city.differs
        ? T("Prayer times (zone start and end) are shown in {zone} time. Your tasks keep using this computer's clock ({computer}).", { zone: city.timeZone, computer: city.computerTimeZone })
        : T('Prayer times are worked out from the latitude and longitude, and shown in the time zone you enter.');
    };
    info();
    return h('div', { class: 'custom-city' },
      h('div', { class: 'row' }, name),
      h('div', { class: 'row' }, lat, lon),
      h('div', { class: 'row' }, zone,
        h('button', { type: 'button', class: 'btn', text: T("This computer's time zone"), onclick: () => { zone.value = computerZone; } })),
      h('datalist', { id: 'tz-list' }, zones.map((z) => h('option', { value: z }))),
      h('div', { class: 'row' },
        h('button', {
          type: 'button', class: 'btn primary', text: T('Save city'),
          onclick: async () => {
            const latitude = num(lat);
            const longitude = num(lon);
            if (Number.isNaN(latitude) || Number.isNaN(longitude)) { WW.toast(T('Latitude and longitude must be numbers, like 24.7136 and 46.6753'), 'error'); return; }
            await save({ useCustomCity: true, customCity: { name: name.value, latitude, longitude, timeZone: zone.value } });
            if (WW.state.settings.useCustomCity) { customPending = false; await WW.refreshCity(); WW.toast(T('City saved')); WW.renderSettings(); }
          },
        })),
      note);
  }

  // The language switch. Its own labels are always shown in both languages, so it can be found from either one.
  function languageSection() {
    const current = WW.state.settings.language || 'en';
    const choose = async (code) => {
      if (code === current) return;
      try {
        await WW.call('saveSettings', { language: code });
        await WW.reloadEverything();
      } catch (error) {
        WW.toast(error.message, 'error');
      }
    };
    const button = (code, label) => h('button', {
      type: 'button', class: current === code ? 'on' : '', text: label, lang: code, 'aria-pressed': String(current === code),
      onclick: () => choose(code),
    });
    return h('section', { class: 'settings-section' },
      h('h2', { text: 'اللغة / Language' }),
      h('div', { class: 'settings-grid' },
        h('label', { text: T('App language') }),
        h('div', {},
          h('div', { class: 'segmented lang-switch', role: 'group', 'aria-label': 'اللغة / Language' }, button('en', 'English'), button('ar', 'العربية')),
          h('p', { class: 'hint', text: T('The whole app changes at once: texts and screen direction. Numbers stay 0123456789.') }))));
  }

  WW.renderSettings = function renderSettings() {
    const view = clear(document.getElementById('view'));
    const s = WW.state.settings;

    const customShown = s.useCustomCity || customPending;
    const city = h('select', {
      'aria-label': T('City'),
      onchange: async (e) => {
        if (e.target.value === CUSTOM_VALUE) {
          customPending = true;
          if (s.customCity) { await save({ useCustomCity: true }); await WW.refreshCity(); } // the one typed in before
          WW.renderSettings();
          return;
        }
        customPending = false;
        await save({ useCustomCity: false, cityName: e.target.value });
        await WW.refreshCity();
        WW.renderSettings();
      },
    },
    [...WW.state.cities.map((name) => h('option', { value: name, text: T(name), selected: !customShown && s.cityName === name })),
      h('option', { value: CUSTOM_VALUE, text: T('Custom city…'), selected: customShown })]);
    const customPanel = customShown ? customCityPanel(s) : null;
    const method = h('select', { 'aria-label': T('Calculation method'), onchange: (e) => save({ method: e.target.value }) },
      WW.state.methods.map((m) => h('option', { value: m.key, text: m.label, selected: s.method === m.key })));
    const adjustments = h('div', { class: 'adjustment-grid' },
      prayers().map(([key, label]) => h('span', { class: 'row tight' },
        h('span', { text: label }),
        numberField(s.adjustments[key], -120, 120, T('min'), (n) => save({ adjustments: { [key]: n } }), T('{label} adjustment in minutes', { label })))));
    const hijri = h('select', { 'aria-label': T('Hijri date adjustment'), class: 'sel-auto', onchange: (e) => save({ hijriAdjustment: Number(e.target.value) }) },
      [[-1, T('−1 day')], [0, T('No adjustment')], [1, T('+1 day')]].map(([v, l]) => h('option', { value: v, text: l, selected: s.hijriAdjustment === v })));

    const theme = h('select', { class: 'sel-auto', 'aria-label': T('Theme'), onchange: (e) => save({ theme: e.target.value }) },
      [['system', T('System (follow Windows)')], ['light', T('Light')], ['dark', T('Dark')]].map(([v, l]) => h('option', { value: v, text: l, selected: s.theme === v })));

    const weekStart = h('select', { class: 'sel-auto', 'aria-label': T('First day of the week'), onchange: (e) => save({ weekStart: Number(e.target.value) }) },
      [6, 0, 1].map((d) => [d, i18n.weekdayLong(d)]).map(([v, l]) => h('option', { value: v, text: l, selected: s.weekStart === v })));

    const lateHours = Math.floor(s.lateAfterMinutes / 60);
    const lateMins = s.lateAfterMinutes % 60;
    const commitLate = async (hours, minutes) => {
      await save({ lateAfterMinutes: hours * 60 + minutes });
      WW.renderSettings();
    };
    const lateAfter = h('span', { class: 'row' },
      numberField(lateHours, 0, 168, T('hours'), (n) => commitLate(n, lateMins), T('Late after, hours')),
      numberField(lateMins, 0, 59, T('minutes'), (n) => commitLate(lateHours, n), T('Late after, minutes')));

    const workingDays = h('span', { class: 'daytoggle' },
      dayLabels().map((label, i) => h('button', {
        type: 'button', class: s.workingDays.includes(i) ? 'on' : '', text: label, 'aria-pressed': String(s.workingDays.includes(i)),
        onclick: async () => {
          const next = s.workingDays.includes(i) ? s.workingDays.filter((d) => d !== i) : [...s.workingDays, i];
          await save({ workingDays: next });
          WW.renderSettings();
        },
      })));

    view.append(
      h('button', { class: 'back-link', text: WW.isRtl() ? `${T('Back to Daily View')} →` : `← ${T('Back to Daily View')}`, onclick: () => WW.showDaily() }),
      h('h1', { text: T('Settings'), style: { marginTop: '0' } }),

      languageSection(),

      section(T('Prayer Times'),
        h('div', { class: 'settings-grid' },
          row(T('City'), h('div', {}, city, customPanel)),
          row(T('Calculation method'), method),
          row(T('Manual adjustment'), h('div', {}, adjustments, h('p', { class: 'hint', text: T('Minutes added to the calculated time (negative = earlier).') }))),
          row(T('Hijri date'), hijri))),

      section(T('Reminders & Notifications'),
        h('div', { class: 'settings-grid' },
          row(T('Notifications'), onOffSwitch(T('Windows notifications'), s.notificationsEnabled, (v) => save({ notificationsEnabled: v }), T('Reminder pop-ups from Windows. With this off, no pop-up appears (full-screen reminders have their own switch).'))),
          row(T('Sound'), toggle(T('Play a sound'), s.soundEnabled, (v) => save({ soundEnabled: v }))),
          row(T('Default reminder'), h('div', {}, numberField(s.defaultReminderOffsetMinutes, 0, 10080, T('minutes before the start'), (n) => save({ defaultReminderOffsetMinutes: n }), T('Default reminder minutes')),
            h('p', { class: 'hint', text: T('Used when a task has reminders turned on but no times added.') }))),
          row(T('Snooze'), numberField(s.snoozeMinutes, 1, 1440, T('minutes'), (n) => save({ snoozeMinutes: n }), T('Snooze minutes'))),
          row(T('Zone start'), toggle(T('Notify when each Zone begins'), s.zoneStartNotifications, (v) => save({ zoneStartNotifications: v }), T('A notification at each prayer time.'))),
          row(T('Test'), h('div', {},
            h('button', {
              class: 'btn', text: T('Send a test notification'),
              onclick: async () => {
                try {
                  await window.api.testNotification();
                  WW.toast(T('Test notification sent. Look at the bottom-right corner of the screen.'));
                } catch (error) {
                  WW.toast(error.message, 'error');
                }
              },
            }),
            h('p', { class: 'hint', text: T('Checks that Windows shows notifications. Click the notification to open WaqtWise.') }))))),

      section(T('Application'),
        h('div', { class: 'settings-grid' },
          row(T('Start with Windows'), toggle(T('Start WaqtWise when Windows starts (in the tray)'), s.startWithWindows, (v) => save({ startWithWindows: v }))),
          row(T('Background message'), toggle(T('Show the "still running in the background" message'), s.showBackgroundMessage, (v) => save({ showBackgroundMessage: v }), T('Shown once, the next time the window is closed. Closing the window keeps WaqtWise running in the tray so reminders keep working.'))),
          row(T('Theme'), theme),
          row(T('First day of the week'), h('div', {}, weekStart, h('p', { class: 'hint', text: T('The day cards at the top of the Daily View and the weeks in Statistics start from this day.') }), h('p', { class: 'hint', text: T('Careful: tasks that repeat every 2 or more weeks also count their weeks from this day, so changing it can move them to other weeks.') }))),
          row(T('Late tasks'), h('div', {}, lateAfter, h('p', { class: 'hint', text: T('A task counts as late when you tick it as done more than this long after its start time. Used by the lateness charts in Statistics.') }))),
          row(T('Working days'), h('div', {}, workingDays, h('p', { class: 'hint', text: T('Used by "last working day" repeat rules.') }))))),

      alertSection(),

      soundsSection(),

      categoriesSection(),

      section(T('Data'),
        h('p', { class: 'dialog-message', text: T('Your data is stored only on this computer. Export a backup file to keep it safe or to move it to another computer.') }),
        h('div', { class: 'row' },
          h('button', { class: 'btn', text: T('Export data…'), onclick: () => WW.exportData() }),
          h('button', { class: 'btn', text: T('Import data…'), onclick: () => WW.importData() }),
          h('button', { class: 'btn', text: T('Restore from backup…'), onclick: () => WW.restoreBackup() })),
        h('p', { class: 'hint', text: T('WaqtWise also keeps its own copies automatically: one per day for the last 7 days, and one before every import.') }))
    );
  };
})();
