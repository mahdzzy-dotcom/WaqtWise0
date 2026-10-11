'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  PROTOCOL,
  escapeXml,
  buildActionUrl,
  parseActionUrl,
  findActionUrlInArgv,
  buildToastXml,
  createElectronNotifier,
} = require('../src/main/toast');
const { createTask, remindersInWindow, formatTaskNotification, formatZoneNotification, zoneStartEvents } = require('../src/core');
const { at, provider } = require('./helpers');

function samplePayload(extra = {}) {
  const task = createTask({
    id: 'task-1',
    title: 'Study & Review <SQL>',
    start: { mode: 'fixed', time: '09:00' },
    durationMinutes: 30,
    date: '2026-10-04',
    reminders: { enabled: true, offsets: [15] },
  });
  const [r] = remindersInWindow(provider, [task], at('2026-10-04', '00:00').getTime(), at('2026-10-04', '23:59').getTime(), {});
  return { ...formatTaskNotification(r, 15, { snoozeMinutes: 5 }), ...extra };
}

test('Links can only open the window', () => {
  assert.equal(buildActionUrl('open'), 'waqtwise://open');
  assert.deepEqual(parseActionUrl('waqtwise://open'), { type: 'open' });
  assert.deepEqual(parseActionUrl('waqtwise://missed'), { type: 'missed' });
  // anything after the name is ignored: a link can never carry a task or a date
  assert.deepEqual(parseActionUrl('waqtwise://open/?task=x&date=2026-10-04'), { type: 'open' });
});

test('Bad, foreign and old action links are rejected', () => {
  assert.equal(parseActionUrl('https://example.com'), null);
  assert.equal(parseActionUrl('waqtwise://format-disk'), null);
  assert.equal(parseActionUrl('waqtwise://snooze?task=x&date=2026-10-04'), null, 'no change can be made through a link');
  assert.equal(parseActionUrl('waqtwise://done?task=x&date=2026-10-04'), null, 'no change can be made through a link');
  assert.equal(parseActionUrl(null), null);
  assert.equal(parseActionUrl(42), null);
});

test('The link is found among command-line arguments', () => {
  const argv = ['C:\\Program Files\\WaqtWise\\WaqtWise.exe', '--flag', 'waqtwise://open'];
  assert.deepEqual(findActionUrlInArgv(argv), { type: 'open' });
  assert.equal(findActionUrlInArgv(['app.exe']), null);
  assert.equal(findActionUrlInArgv(['app.exe', 'waqtwise://done?task=t&date=2026-10-04']), null);
  assert.equal(findActionUrlInArgv(undefined), null);
});

test('Toast XML contains title, start time and zone, and no buttons', () => {
  const xml = buildToastXml(samplePayload());
  assert.ok(xml.startsWith('<toast '));
  assert.ok(xml.includes('Study &amp; Review &lt;SQL&gt;'), 'title is escaped');
  assert.ok(xml.includes('Starts in 15 min · 9:00 AM'));
  assert.ok(xml.includes('Zone: Fajr → Dhuhr'));
  assert.ok(!xml.includes('<actions>'), 'no buttons');
  assert.ok(!xml.includes('Snooze') && !xml.includes('Mark as Done'));
  assert.ok(xml.includes('launch="waqtwise://open"'), 'clicking the toast opens the app');
  assert.ok(!xml.includes('<audio'), 'sound is on by default');
  assert.equal((xml.match(/activationType="protocol"/g) || []).length, 1);
});

test('Silent toasts and Arabic text', () => {
  const xml = buildToastXml(samplePayload({ silent: true, title: 'مراجعة الدرس' }));
  assert.ok(xml.includes('<audio silent="true"/>'));
  assert.ok(xml.includes('<text>مراجعة الدرس</text>'));
});

test('Zone-start and missed toasts have no buttons', () => {
  const [event] = zoneStartEvents(provider, at('2026-10-04', '14:00').getTime(), at('2026-10-04', '16:00').getTime());
  const zoneXml = buildToastXml(formatZoneNotification(event, {}));
  assert.ok(zoneXml.includes('Asr → Maghrib has started'));
  assert.ok(!zoneXml.includes('<actions>'));
  assert.ok(zoneXml.includes('launch="waqtwise://open"'));

  const missedXml = buildToastXml({ kind: 'missed', title: 'You missed 2 reminders', lines: ['9:00 AM · A'], actions: [] });
  assert.ok(missedXml.includes('launch="waqtwise://missed"'));
});

test('escapeXml handles all special characters', () => {
  assert.equal(escapeXml(`<a href="x">Tom & 'Jerry'</a>`), '&lt;a href=&quot;x&quot;&gt;Tom &amp; &apos;Jerry&apos;&lt;/a&gt;');
});

test('The Electron notifier builds one toast per payload and shows it', () => {
  const created = [];
  class FakeNotification {
    constructor(options) {
      this.options = options;
      this.handlers = {};
      this.shown = false;
      created.push(this);
    }
    on(event, fn) {
      this.handlers[event] = fn;
    }
    show() {
      this.shown = true;
    }
  }
  FakeNotification.isSupported = () => true;

  const errors = [];
  const notify = createElectronNotifier({ Notification: FakeNotification, onError: (e) => errors.push(e) });
  const payload = samplePayload();
  const result = notify(payload);

  assert.equal(created.length, 1);
  assert.equal(result, created[0]);
  assert.equal(created[0].shown, true);
  assert.equal(created[0].options.toastXml, buildToastXml(payload));
  assert.equal(created[0].options.title, payload.title);
  assert.equal(created[0].options.silent, false);

  created[0].handlers.failed({}, new Error('boom'));
  assert.equal(errors.length, 1);
});

test('The Electron notifier does nothing when notifications are not supported', () => {
  class Unsupported {
    constructor() {
      throw new Error('should not be constructed');
    }
  }
  Unsupported.isSupported = () => false;
  assert.equal(createElectronNotifier({ Notification: Unsupported })(samplePayload()), null);
});

test('Protocol name is the one the installer must register', () => {
  assert.equal(PROTOCOL, 'waqtwise');
});
