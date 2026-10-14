'use strict';

// Draws the full-screen reminder. Used by the real alert page and by the preview in Settings.

(function () {
  const WW = (window.WW = window.WW || {});
  const { h, clear, T, TP } = WW;

  function fontStack(name) {
    return `'${name}', 'Segoe UI', Tahoma, Arial, sans-serif`;
  }

  // Applies the user's choices to the stage element.
  function applyAppearance(stage, a) {
    const set = (name, value) => stage.style.setProperty(name, value);
    set('--a-bg', a.backgroundColor);
    set('--a-text', a.textColor);
    set('--a-accent', a.accentColor);
    set('--a-font', fontStack(a.fontFamily));
    set('--a-align', a.alignment);
    set('--a-items', a.alignment === 'left' ? 'flex-start' : 'center');
    set('--a-items-justify', a.alignment === 'left' ? 'flex-start' : 'center');
  }

  // state: { item, remaining, appearance, snoozeMinutes, guardActive }
  // handlers (optional): { dismiss, snooze, done, open } - called with no arguments
  function render(root, state, handlers) {
    const { item, appearance: a } = state;
    const frame = h('div', { class: 'alert-frame' });
    const stage = h('div', { class: 'alert-stage', role: 'alertdialog', 'aria-label': T('Reminder: {title}', { title: item.title }) });
    applyAppearance(stage, a);

    const name = h('h1', { class: 'alert-name', text: item.title });
    Object.assign(name.style, {
      fontSize: `${a.name.size}px`,
      color: a.name.color,
      fontWeight: a.name.bold ? '800' : '400',
      fontStyle: a.name.italic ? 'italic' : 'normal',
      textTransform: a.name.uppercase ? 'uppercase' : 'none',
    });

    const parts = [h('div', { class: 'alert-label', text: item.snoozed ? T('Snoozed reminder') : T('Starts now') }), name];

    if (a.notes.show && item.notes && item.notes.trim() !== '') {
      const notes = h('div', { class: 'alert-notes', text: item.notes });
      Object.assign(notes.style, {
        fontSize: `${a.notes.size}px`,
        color: a.notes.color,
        fontWeight: a.notes.bold ? '700' : '400',
        fontStyle: a.notes.italic ? 'italic' : 'normal',
      });
      parts.push(notes);
    }

    const chips = [];
    if (a.show.time) chips.push(h('span', { class: 'chip' }, h('b', { text: item.startLabel }), `– ${item.endLabel}`));
    if (a.show.duration) chips.push(h('span', { class: 'chip', text: item.durationLabel }));
    if (a.show.zone && item.zoneName) chips.push(h('span', { class: 'chip', text: T('Zone: {zone}', { zone: T(item.zoneName) }) }));
    if (a.show.category && item.categoryName) {
      chips.push(h('span', { class: 'chip' }, h('span', { class: 'dot', style: { background: item.categoryColor || a.textColor } }), item.categoryName));
    }
    if (a.show.priority) chips.push(h('span', { class: 'chip', text: T('{priority} priority', { priority: T(item.priority) }) }));
    if (chips.length) parts.push(h('div', { class: 'alert-info' }, chips));

    const act = (key) => () => { if (handlers && handlers[key] && !state.guardActive) handlers[key](); };
    const button = (label, key, primary) =>
      h('button', { type: 'button', class: primary ? 'primary' : '', text: label, disabled: state.guardActive, onclick: act(key), dataset: { action: key } });
    // "Got it" is always shown; the others follow the choice in Settings.
    const shown = a.buttons || { snooze: true, open: true, done: true };
    parts.push(h('div', { class: 'alert-actions' },
      button(T('Got it'), 'dismiss', true),
      shown.snooze ? button(TP(state.snoozeMinutes, 'Snooze {n} minute', 'Snooze {n} minutes'), 'snooze', false) : null,
      shown.open ? button(T('Open task'), 'open', false) : null,
      shown.done ? button(T('Mark as Done'), 'done', false) : null));

    if (state.remaining > 0) {
      parts.push(h('div', { class: 'alert-more', text: TP(state.remaining, '{n} more task starting now', '{n} more tasks starting now') }));
    }

    stage.append(...parts);
    frame.appendChild(stage);
    clear(root).appendChild(frame);
    return { stage, frame };
  }

  WW.AlertView = { render, applyAppearance };
})();
