'use strict';

// The Free To-Do list screen (tasks with no time yet) and the read-only task details window.

(function () {
  const WW = (window.WW = window.WW || {});
  const { h, clear, T, TP } = WW;

  // ---- Free To-Do list ------------------------------------------------------------------------------------

  async function call(name, payload) {
    try {
      return await WW.call(name, payload);
    } catch (error) {
      WW.toast(error.message, 'error');
      return null;
    }
  }

  async function refresh() {
    await WW.showFree();
    if (WW.refreshFreeCount) WW.refreshFreeCount();
  }

  // The window for adding or changing one free task. `item` is the existing task, or null for a new one.
  function openFreeForm(item) {
    const f = item
      ? { title: item.title, notes: item.notes, priority: item.priority, categoryId: item.categoryId, durationMinutes: item.durationMinutes }
      : { title: '', notes: '', priority: 'Medium', categoryId: null, durationMinutes: null };
    const dlg = WW.openDialog({ title: item ? T('Edit free task') : T('Add free task') });
    const errors = h('div', { class: 'errors', hidden: true });
    const title = h('input', { type: 'text', id: 'ff-title', value: f.title, maxlength: '200', placeholder: T('What do you want to do?'), autocomplete: 'off' });
    const priority = h('select', { id: 'ff-priority', onchange: (e) => { f.priority = e.target.value; } },
      ['Low', 'Medium', 'High'].map((p) => h('option', { value: p, text: T(p), selected: f.priority === p })));
    const category = h('select', { id: 'ff-category', onchange: (e) => { f.categoryId = e.target.value || null; } },
      h('option', { value: '', text: T('No category') }),
      WW.state.categories.map((c) => h('option', { value: c.id, text: c.name, selected: f.categoryId === c.id })));
    const duration = h('input', { type: 'number', class: 'num', id: 'ff-duration', min: '1', max: '10080', value: f.durationMinutes ? String(f.durationMinutes) : '', 'aria-label': T('Suggested duration (minutes)') });
    const notes = h('textarea', { id: 'ff-notes', value: f.notes, 'aria-label': T('Notes'), oninput: (e) => { f.notes = e.target.value; } });
    dlg.body.append(
      errors,
      h('div', { class: 'field' }, h('label', { for: 'ff-title', text: T('Title') }), title),
      h('div', { class: 'row', style: { alignItems: 'flex-start' } },
        h('div', { class: 'field grow' }, h('label', { for: 'ff-priority', text: T('Priority') }), priority),
        h('div', { class: 'field grow' }, h('label', { for: 'ff-category', text: T('Category') }), category)),
      h('div', { class: 'field' }, h('label', { for: 'ff-duration', text: T('Suggested duration (minutes)') }), duration,
        h('p', { class: 'hint', text: T('Optional. It is used when you schedule the task.') })),
      h('div', { class: 'field' }, h('label', { for: 'ff-notes', text: T('Notes') }), notes));
    const save = h('button', { class: 'btn primary', text: T('Save') });
    dlg.footer.append(h('button', { class: 'btn', text: T('Cancel'), onclick: () => dlg.close() }), save);
    save.addEventListener('click', async () => {
      f.title = title.value;
      f.durationMinutes = duration.value === '' ? null : Number(duration.value);
      if (f.title.trim() === '') { errors.hidden = false; errors.textContent = T('Please enter a title'); return; }
      save.disabled = true;
      try {
        await WW.call('saveFreeTask', { id: item ? item.id : null, form: f });
        dlg.close();
        WW.toast(item ? T('Task saved') : T('Task added'));
        refresh();
      } catch (error) {
        errors.hidden = false;
        errors.textContent = error.message;
        save.disabled = false;
      }
    });
    title.focus();
  }

  async function schedule(item) {
    const info = await call('getFreeTaskForSchedule', { id: item.id, defaultKey: WW.state.dayKey || WW.state.todayKey });
    if (info) WW.openTaskForm({ mode: 'create', defaultKey: WW.state.dayKey || WW.state.todayKey, prefill: info.form, fromFreeTaskId: item.id });
  }

  async function remove(item) {
    const go = await WW.ask({
      title: T('Delete task'), message: T('Delete "{title}"?', { title: item.title }),
      choices: [{ label: T('Cancel'), value: false }, { label: T('Delete'), value: true, kind: 'danger' }],
    });
    if (!go) return;
    if (await call('deleteFreeTask', { id: item.id })) { WW.toast(T('Task deleted')); refresh(); }
  }

  function freeRow(item, index, count) {
    const meta = [];
    if (item.categoryName) meta.push(h('span', { class: 'tag pill' }, h('span', { class: 'dot', style: { background: item.categoryColor } }), item.categoryName));
    meta.push(h('span', { class: 'tag', text: T('{priority} priority', { priority: T(item.priority) }) }));
    if (item.durationLabel) meta.push(h('span', { class: 'tag', text: item.durationLabel }));
    const check = h('button', {
      class: `check ${item.done ? 'on' : ''}`, type: 'button', 'aria-pressed': String(item.done),
      'aria-label': T(item.done ? 'Mark "{title}" as not done' : 'Mark "{title}" as done', { title: item.title }),
      onclick: async () => {
        if (await call('setFreeDone', { id: item.id, done: !item.done })) {
          if (!item.done && WW.state.settings) WW.sounds.play(WW.state.settings.doneSound, WW.state.settings.doneSoundVolume);
          refresh();
        }
      },
    }, WW.icon('check', 15, 3.4));
    const move = (direction) => async () => { if (await call('moveFreeTask', { id: item.id, direction })) refresh(); };
    return h('div', { class: `free-row ${item.done ? 'done' : ''}`, 'data-id': item.id },
      check,
      h('div', { class: 'task-main' },
        h('div', { class: 'task-title free-title', text: item.title }),
        h('div', { class: 'task-meta' }, meta),
        item.notes ? h('div', { class: 'free-notes', text: item.notes }) : null),
      h('span', { class: `prio ${item.priority}`, title: T('{priority} priority', { priority: T(item.priority) }) }),
      h('div', { class: 'free-actions' },
        item.done ? null : h('button', { class: 'btn small primary', type: 'button', text: T('Schedule task'), onclick: () => schedule(item) }),
        h('button', { class: 'btn small', type: 'button', text: T('Edit'), onclick: () => openFreeForm(item) }),
        h('button', { class: 'btn small', type: 'button', text: '↑', 'aria-label': T('Move up'), title: T('Move up'), disabled: index === 0, onclick: move('up') }),
        h('button', { class: 'btn small', type: 'button', text: '↓', 'aria-label': T('Move down'), title: T('Move down'), disabled: index === count - 1, onclick: move('down') }),
        h('button', { class: 'btn small danger', type: 'button', text: T('Delete'), onclick: () => remove(item) })));
  }

  function renderFree() {
    const items = WW.state.free;
    const open = items.filter((x) => !x.done).length;
    const doneCount = items.length - open;
    const root = clear(document.getElementById('view'));

    const quick = h('input', { type: 'text', id: 'free-quick', maxlength: '200', placeholder: T('Type a task and press Enter…'), 'aria-label': T('New free task'), autocomplete: 'off' });
    const quickAdd = async () => {
      const text = quick.value.trim();
      if (text === '') { openFreeForm(null); return; }
      if (await call('saveFreeTask', { id: null, form: { title: text } })) { quick.value = ''; await refresh(); const again = document.getElementById('free-quick'); if (again) again.focus(); }
    };
    quick.addEventListener('keydown', (e) => { if (e.key === 'Enter') quickAdd(); });

    root.append(
      h('div', { class: 'day-head' },
        h('div', { class: 'day-info' },
          h('h1', { class: 'day-title', text: T('Free To-Do list') }),
          h('div', { class: 'day-sub', text: T('Tasks with no time yet. Schedule one when you decide when to do it.') })),
        h('div', { class: 'day-actions' },
          h('span', { class: 'free-count', text: `${T('{n} open', { n: open })}${doneCount ? ` · ${T('{n} done', { n: doneCount })}` : ''}` }),
          doneCount ? h('button', { class: 'btn', type: 'button', id: 'free-clear', text: T('Clear done'), onclick: async () => { if (await call('clearFreeDone')) refresh(); } }) : null)),
      h('section', { class: 'zone free-card', 'aria-label': T('Free To-Do list') },
        h('div', { class: 'zone-body' },
          items.length ? items.map((item, i) => freeRow(item, i, items.length)) : h('div', { class: 'empty-zone', id: 'free-empty', text: T('No free tasks yet. Add one below.') }))),
      h('div', { class: 'free-add' }, quick,
        h('button', { class: 'btn', type: 'button', id: 'free-details', text: T('Add with details'), onclick: () => openFreeForm(null) }),
        h('button', { class: 'btn primary tall', type: 'button', id: 'free-add', text: T('Add free task'), onclick: quickAdd })));
  }

  WW.showFree = async function showFree() {
    try {
      const keepScroll = WW.state.view === 'free';
      const scrollY = window.scrollY;
      WW.state.view = 'free';
      WW.state.free = await WW.call('getFreeTasks');
      renderFree();
      if (keepScroll) window.scrollTo(0, scrollY);
    } catch (error) {
      WW.toast(error.message, 'error');
    }
  };

  // The number of open free tasks (shown in the side menu).
  WW.refreshFreeCount = async function refreshFreeCount() {
    try {
      WW.state.freeCount = await WW.call('getFreeTaskCount');
    } catch (error) {
      WW.state.freeCount = 0;
    }
  };

  // ---- Task details (read only) --------------------------------------------------------------------------

  WW.openTaskDetails = async function openTaskDetails({ taskId, dateKey }) {
    let d;
    try {
      d = await WW.call('getTaskDetails', { taskId, dateKey });
    } catch (error) {
      WW.toast(error.message, 'error');
      return;
    }
    const dlg = WW.openDialog({ title: d.title, wide: true });
    dlg.footer.classList.add('details-footer');
    dlg.box.classList.add('details-dialog');
    const row = (label, value) => (value ? [h('div', { class: 'details-label', text: label }), h('div', { class: 'details-value' }, value)] : []);
    // Each time is kept as one piece, so the range keeps its order when the screen reads right to left.
    const timeRange = h('span', {}, h('bdi', { dir: 'ltr', text: d.startLabel }), ' – ', h('bdi', { dir: 'ltr', text: d.endLabel }), d.endsNextDay ? ` (${T('next day')})` : '');
    const reminderText = d.remindersOn ? d.reminderOffsets.map((n) => WW.offsetLabel(n)).join(T(', ')) : T('Off');
    const reminders = `${reminderText}${d.fullScreen ? ` · ${T('Full-screen')}` : ''}${d.randomNotes ? ` · ${T('One note at random')}` : ''}`;
    // Element.append turns a null into the text "null", so empty parts are left out first.
    const put = (parent, ...nodes) => parent.append(...nodes.filter(Boolean));
    put(dlg.body,
      h('div', { class: 'details-head' },
        h('span', { class: `readout zone-readout z${d.zoneIndex}`, text: d.zoneName }),
        d.done ? h('span', { class: 'tag pill', text: T('Done') }) : null),
      // Where the task sits inside its zone.
      h('div', { class: `details-timeline z${d.zoneIndex}`, role: 'img', 'aria-label': `${d.zoneName}: ${d.zoneStartLabel} – ${d.zoneEndLabel}` },
        h('div', { class: 'details-bar' }, h('i', { class: 'details-fill', style: { insetInlineStart: `${d.leftPct}%`, width: `${Math.min(d.widthPct, 100 - d.leftPct)}%` } })),
        h('div', { class: 'details-bar-labels' },
          h('bdi', { dir: 'ltr', text: d.zoneStartLabel }),
          d.continuesPastZone ? h('span', { class: 'details-more', text: T('→ Continues into next zone') }) : null,
          h('bdi', { dir: 'ltr', text: d.zoneEndLabel }))),
      h('div', { class: 'details-grid' },
        row(T('Time'), timeRange),
        row(T('Duration'), d.durationLabel),
        row(T('Repeats'), d.repeatSummary),
        row(T('Starts after'), d.followsTitle),
        row(T('Category'), d.categoryName),
        row(T('Priority'), T(d.priority)),
        row(T('Reminders'), reminders)),
      d.notes ? h('div', { class: 'details-notes' }, h('div', { class: 'details-label', text: T('Notes') }), h('div', { class: 'details-notes-text', text: d.notes })) : null);

    const after = () => { dlg.close(); WW.afterChange(); };
    const guard = async (fn) => { try { await fn(); } catch (error) { WW.toast(error.message, 'error'); } };
    put(dlg.footer,
      h('button', { class: 'btn danger', type: 'button', id: 'details-delete', text: T('Delete'), onclick: () => guard(async () => {
        let scope = 'all';
        if (d.isRecurring) {
          dlg.box.hidden = true;
          scope = await WW.askScope({ title: T('Delete task'), verb: 'Delete', allowThis: true });
          dlg.box.hidden = false;
          if (scope === null) return;
        }
        const impact = await WW.call('getDeleteImpact', { taskId, dateKey, scope });
        let message = T('Delete "{title}"?', { title: d.title });
        if (impact.wholeTask && impact.dependents.length > 0) {
          const names = impact.dependents.map((x) => `“${x.title}”`).join(T(', '));
          message = T('These tasks start relative to “{title}”: {names}. If you delete it, they stay at the times they have now, as fixed times.', { title: d.title, names });
        }
        if (!d.isRecurring || (impact.wholeTask && impact.dependents.length > 0)) {
          const go = await WW.ask({ title: T('Delete task'), message, choices: [{ label: T('Cancel'), value: false }, { label: T('Delete'), value: true, kind: 'danger' }] });
          if (!go) return;
        }
        await WW.call('deleteTask', { taskId, dateKey, scope });
        WW.toast(T('Task deleted'));
        after();
      }) }),
      h('button', { class: 'btn', type: 'button', id: 'details-duplicate', text: T('Duplicate'), onclick: () => guard(async () => {
        await WW.call('duplicateTask', { taskId });
        WW.toast(T('Task duplicated'));
        after();
      }) }),
      h('button', { class: 'btn', type: 'button', id: 'details-done', text: d.done ? T('Mark as not done') : T('Mark as Done'), onclick: () => guard(async () => {
        await WW.call('setDone', { taskId, dateKey, done: !d.done });
        if (!d.done && WW.state.settings) WW.sounds.play(WW.state.settings.doneSound, WW.state.settings.doneSoundVolume);
        after();
      }) }),
      h('button', { class: 'btn primary', type: 'button', id: 'details-edit', text: T('Edit task'), onclick: () => { dlg.close(); WW.openTaskForm({ mode: 'edit', taskId, dateKey }); } }));
    const edit = dlg.footer.querySelector('#details-edit');
    if (edit) edit.focus();
  };
})();
