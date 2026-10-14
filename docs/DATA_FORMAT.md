# WaqtWise backup file format

Export / Import (Settings -> Data) uses one JSON file. Version 1:

```json
{
  "app": "waqtwise",
  "formatVersion": 1,
  "exportedAt": "2026-10-04T10:00:00.000Z",
  "settings":   { ... },
  "categories": [ { "id": "cat-work", "name": "Work", "color": "#3b82f6" } ],
  "tasks":      [ { ... } ],
  "freeTasks":  [ { ... } ],  (optional; the free to-do list, see "Free task")
  "statsHistory": { ... }       (optional; the saved statistics of finished days, see below)
}
```

- `formatVersion` is checked on import. A file with a NEWER version than the app understands is refused with a
  friendly message; older versions will be converted step by step by future versions of the app.
- Importing replaces all tasks, categories and settings. Damaged tasks or categories in the file are skipped
  and reported; the rest is imported.
- Only what the user entered is stored. Zones, end times, durations, generated occurrences and prayer times
  are always recalculated and never saved.

## Task

```json
{
  "id": "uuid",
  "title": "Gym",
  "start": { "mode": "fixed", "time": "09:00" },
  "durationMinutes": 60,
  "date": null,
  "recurrence": {
    "startDate": "2026-10-02", "frequency": "weekly", "interval": 1, "weekdays": [5],
    "end": { "type": "never" }
  },
  "reminders": { "enabled": true, "offsets": [15, 0] },
  "priority": "Medium",
  "categoryId": "cat-health",
  "notes": "",
  "exceptions": ["2026-11-13"],
  "additions": ["2026-11-14"],
  "overrides": { "2026-10-09": { "start": { "mode": "fixed", "time": "08:00" } } },
  "completions": { "2026-10-02": true }
}
```

- `start`: `{ "mode": "fixed", "time": "HH:MM" }` (24-hour),
  `{ "mode": "prayer", "prayer": "fajr|dhuhr|asr|maghrib|isha", "direction": "before|after", "minutes": 10 }`, or
  `{ "mode": "task", "taskId": "...", "point": "start|end", "direction": "before|after", "minutes": 15, "fallbackTime": "HH:MM" }`
  (starts relative to another task's start or end on the same date; `fallbackTime` is used, with a warning,
  on days when that task has no occurrence).
- `continuedFrom` (optional): the id of the task this one was split from by a "This and following" edit.
  Tasks that follow the original keep following the later part through this link.
- `date`: the calendar date of the start time for one-off tasks; `null` for repeating tasks.
- `recurrence`: `null` for one-off tasks. `frequency` is `daily`, `weekly`, `monthly` or `yearly`; see
  `src/core/recurrence.js` for every field (weekday lists, monthly modes, yearly modes, end rules).
- `exceptions`, `additions`, `overrides` and `completions` are keyed by occurrence date (`YYYY-MM-DD`).

## Full-screen alert buttons

`settings.alertAppearance.buttons` = `{ snooze, open, done }` (true/false, all true by default) chooses which of the buttons **Snooze**, **Open task** and **Mark as Done** the full-screen alert shows. **Got it** has no switch and is always shown, so the alert can always be closed (Enter and Esc also close it). The choice is for every task. The "Details shown" choices (`show`: time, duration, zone, category, priority, and `notes.show`) work the same way. Older files without `buttons` get all three.

## One note at random

In the task form, with the full-screen alert on, **Show one note at random** is saved as `reminders.randomNotes` (true/false; it can differ per occurrence like the other reminder options). The notes are split on `;` or `؛`, blanks are dropped, and the full-screen alert shows one message. Every message is shown once before any is repeated (never the same one twice in a row), and the same message stays when the alert is only shown again on the same day; after **Snooze** the alert comes back with a different message. With only one message the notes are shown as written. Everywhere else (details, edit form) the notes are shown whole. What was shown last is kept in `data.json` as `noteRotation` (`{ taskId: { sig, dateKey, index, used } }`); it is not part of the export file, and it starts over when the notes are changed.

## Saved statistics (`statsHistory`)

`{ through: 'YYYY-MM-DD', days: { 'YYYY-MM-DD': [[taskId, dateKey, title, categoryId, minutes, done, startMs, zone], ...] } }` keeps the numbers of finished days, so the past stays fixed when tasks are edited or deleted. It is part of the export file. On import, a file that has it **replaces** the saved statistics on this computer (they belong to the imported tasks); an older file without it leaves them as they are. Damaged days are skipped.

## Free task

The Free To-Do list holds tasks that have no time yet. It has no reminders, no zone and no statistics. When a free task is scheduled it becomes a normal task and leaves the list; "Move to free list" does the reverse for a task that does not repeat. A file without `freeTasks` (made by an older version) loads with an empty list.

```json
{ "id": "…", "title": "Renew ID", "notes": "", "priority": "Low|Medium|High", "categoryId": null,
  "durationMinutes": null, "done": false, "createdAt": "2026-10-13T08:00:00.000Z" }
```

`durationMinutes` is optional (`null` or 1 to 10080); it is used when the task is scheduled. The order of the list is the order shown.

## Full-screen alert

- Each task's `reminders` object may contain `"fullScreen": true` (missing means off). Single-occurrence edits in
  `overrides` can carry their own `reminders`, so one day can differ.
- `settings` contains `fullScreenAlerts`, `fullScreenDefaultForNewTasks`, `alertScreens` (`"all"` or `"main"`) and
  `alertAppearance` (colors as `#rrggbb`, `fontFamily`, `alignment`, and the groups `name`, `notes` and `show`).
  Missing or invalid values are replaced by the defaults when a backup is imported.

## Settings added in this version

`settings.useCustomCity` (true/false) and `settings.customCity` (`null` or `{ "name", "latitude", "longitude", "timeZone" }`,
the time zone being an IANA name such as `Asia/Riyadh`). An invalid city is dropped when a backup is imported.
`settings.language` (`"en"` or `"ar"`) is the language of the app. Task titles, notes and category names you typed are never translated; the built-in category names, zone names and all other texts are translated when shown.

`settings.weekStart` (6, 0 or 1) is also used to count the weeks of tasks that repeat every 2 or more weeks.

## Saved data file (not the export file)

`data.json` also holds `statsHistory`: `{ "through": "YYYY-MM-DD", "days": { "<day>": [[taskId, dateKey, title, categoryId, minutes, done(0/1), startMs, zone], ...] } }`,
the saved statistics of finished days. It is not part of the export file. Automatic copies of `data.json` are kept
in the `backups` folder next to it (`data-YYYY-MM-DD.json`, `before-import-*.json`, `before-restore-*.json`).

## Limits

Numbers are checked when a task is saved and when a data file is loaded (a task or a part that fails is skipped with a message, never trusted): task duration 1 to 10080 minutes (7 days); "minutes before or after a prayer or task" and reminder times 0 to 10080; "every N" 1 to 999; "after N occurrences" 1 to 9999; at most 20000 tasks and 5000 free tasks per file; a title of at most 200 characters; a backup file larger than 20 MB is refused. The limits are in `src/core/limits.js`.

