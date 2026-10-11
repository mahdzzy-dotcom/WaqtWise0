'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { PlannerService } = require('../src/main/service');
const { MemoryStore } = require('../src/main/store');
const {
  validateCustomCity, resolveCity, mergeSettings, sanitizeSettings, DEFAULT_SETTINGS, previewDates, formatTime12InZone,
  formatZoneNotification,
} = require('../src/core');
const { at, constantProvider } = require('./helpers');

// The adhan library is not needed here: this stand-in moves the times by the city's longitude.
function longitudeProvider(settings) {
  const { longitude } = resolveCity(settings);
  const shift = Math.round(longitude * 4);
  return (key) => {
    const base = constantProvider(key);
    return Object.fromEntries(Object.entries(base).map(([name, date]) => [name, new Date(date.getTime() + shift * 60000)]));
  };
}

const RIYADH = { name: 'Riyadh', latitude: 24.7136, longitude: 46.6753, timeZone: 'Asia/Riyadh' };

// ---- every N weeks follows the first day of the week ----------------------------------------------

const RULE = { startDate: '2026-10-04', frequency: 'weekly', interval: 2, weekdays: [0, 1] }; // started on a Sunday

test('Every 2 weeks: the weeks are counted from the first day of the week', () => {
  const keys = (weekStartsOn) => previewDates(RULE, 5, { weekStartsOn }).map((d) => d.dateKey || d);
  assert.deepEqual(keys(0), ['2026-10-04', '2026-10-05', '2026-10-18', '2026-10-19', '2026-11-01']);
  assert.deepEqual(keys(1), ['2026-10-04', '2026-10-12', '2026-10-18', '2026-10-26', '2026-11-01']);
});

test('Every 2 weeks: the service uses the first-day-of-week setting, and changing it moves existing tasks', () => {
  let n = 0;
  const service = new PlannerService({
    store: new MemoryStore(), now: () => at('2026-10-04', '09:00'), newId: () => `w${++n}`, providerFactory: () => constantProvider,
  });
  service.saveTask({
    mode: 'create',
    form: {
      title: 'Biweekly', start: { mode: 'fixed', time: '08:00' }, durationMinutes: 30, date: '2026-10-04',
      recurrence: RULE, reminders: { enabled: false, offsets: [] }, priority: 'Medium', categoryId: null, notes: '',
    },
  });
  const titlesOn = (key) => service.getDay(key).zones.flatMap((z) => z.tasks.map((t) => t.title));
  assert.deepEqual(service.recurrenceOptions().weekStartsOn, 0);
  assert.deepEqual(titlesOn('2026-10-12'), [], 'Sunday start: not in this week');
  assert.equal(titlesOn('2026-10-05').length, 1);

  service.saveSettings({ weekStart: 1 });
  assert.equal(service.recurrenceOptions().weekStartsOn, 1);
  assert.equal(titlesOn('2026-10-12').length, 1, 'Monday start: the Monday of the next week counts');
  assert.deepEqual(titlesOn('2026-10-05'), []);
});

// ---- the custom city ----------------------------------------------------------------------------------------------

test('Custom city: what is accepted', () => {
  assert.deepEqual(validateCustomCity(RIYADH), []);
  const bad = (patch) => validateCustomCity({ ...RIYADH, ...patch }).length;
  assert.ok(bad({ name: '  ' }));
  assert.ok(bad({ name: 'x'.repeat(41) }));
  assert.ok(bad({ latitude: 91 }));
  assert.ok(bad({ longitude: -181 }));
  assert.ok(bad({ latitude: '24' }));
  assert.ok(bad({ latitude: NaN }));
  assert.ok(bad({ timeZone: 'Mars/Olympus' }));
  assert.ok(bad({ timeZone: '' }));
  assert.ok(validateCustomCity(null).length);
});

test('Custom city: settings need the city before it can be switched on, and bad saved values are dropped', () => {
  assert.throws(() => mergeSettings(DEFAULT_SETTINGS, { useCustomCity: true }), /Enter the city/);
  const merged = mergeSettings(DEFAULT_SETTINGS, { useCustomCity: true, customCity: { ...RIYADH, name: ' Riyadh ' } });
  assert.equal(merged.customCity.name, 'Riyadh');
  assert.equal(resolveCity(merged).custom, true);
  assert.equal(resolveCity(merged).timeZone, 'Asia/Riyadh');
  assert.equal(resolveCity(DEFAULT_SETTINGS).timeZone, null);
  assert.equal(resolveCity(DEFAULT_SETTINGS).name, 'Cairo');
  assert.throws(() => mergeSettings(DEFAULT_SETTINGS, { customCity: { ...RIYADH, latitude: 500 } }), /Latitude/);

  const loaded = sanitizeSettings({ useCustomCity: true, customCity: { ...RIYADH, timeZone: 'nope' } });
  assert.equal(loaded.useCustomCity, false);
  assert.equal(loaded.customCity, null);
  assert.equal(sanitizeSettings({ useCustomCity: true, customCity: RIYADH }).useCustomCity, true);
});

test('Custom city: prayer times come from its coordinates, and zone times are shown in its time zone', () => {
  const service = new PlannerService({ store: new MemoryStore(), now: () => at('2026-10-04', '09:00'), providerFactory: longitudeProvider });
  const cairoFajr = service.provider()('2026-10-04').fajr;
  const cairoDay = service.getDay('2026-10-04');
  const hh = (d) => `${d.getHours() % 12 || 12}:${String(d.getMinutes()).padStart(2, '0')} ${d.getHours() >= 12 ? 'PM' : 'AM'}`;
  assert.equal(cairoDay.zones[0].startLabel, hh(cairoFajr), 'built-in city: this computer\'s clock, as before');
  assert.equal(service.cityInfo().custom, false);

  service.saveSettings({ useCustomCity: true, customCity: RIYADH });
  const fajr = service.provider()('2026-10-04').fajr;
  assert.notEqual(fajr.getTime(), cairoFajr.getTime(), 'a different place gives different times');
  const day = service.getDay('2026-10-04');
  assert.equal(day.zones[0].startLabel, formatTime12InZone(fajr, 'Asia/Riyadh'));
  assert.equal(day.zones[4].endLabel, formatTime12InZone(service.provider()('2026-10-05').fajr, 'Asia/Riyadh'));
  const info = service.cityInfo();
  assert.equal(info.name, 'Riyadh');
  assert.equal(info.timeZone, 'Asia/Riyadh');
  assert.equal(service.bootstrap().city.name, 'Riyadh');

  // Going back to the list keeps the typed city for later
  service.saveSettings({ useCustomCity: false });
  assert.equal(service.getSettings().customCity.name, 'Riyadh');
  assert.equal(service.provider()('2026-10-04').fajr.getTime(), cairoFajr.getTime());
});

test('Time in another zone: formatted like the rest of the app, DST aware', () => {
  const instant = new Date(Date.UTC(2026, 6, 1, 0, 5)); // 00:05 UTC
  assert.equal(formatTime12InZone(instant, 'UTC'), '12:05 AM');
  assert.equal(formatTime12InZone(instant, 'Asia/Riyadh'), '3:05 AM');
  assert.equal(formatTime12InZone(instant, 'America/New_York'), '8:05 PM'); // summer time
  assert.equal(formatTime12InZone(new Date(Date.UTC(2026, 0, 1, 0, 5)), 'America/New_York'), '7:05 PM');
});

test('Zone-start notification: the end of the zone is shown in a custom city\'s time zone', () => {
  const event = { id: 'z', zoneName: 'Fajr', zoneEnd: new Date(Date.UTC(2026, 6, 1, 9, 30)) };
  const custom = formatZoneNotification(event, { ...DEFAULT_SETTINGS, useCustomCity: true, customCity: RIYADH });
  assert.equal(custom.body, 'Until 12:30 PM');
});
