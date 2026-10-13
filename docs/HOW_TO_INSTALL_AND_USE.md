# WaqtWise - how to install and use

WaqtWise divides your day into 5 zones using the prayer times (Fajr to Dhuhr, Dhuhr to Asr,
Asr to Maghrib, Maghrib to Isha, Isha to Fajr). You add tasks, and each task lands in the right zone
by itself. It works without internet and keeps everything on your computer.

## 1. Install

1. Double-click **WaqtWise-Setup-...exe**.
2. Windows may show a blue screen saying **"Windows protected your PC"**. This is normal: the installer is
   not signed with a paid certificate. Click **More info**, then click **Run anyway**.
3. Click **Next**, choose where to install (the suggested place is fine), click **Install**, then **Finish**.
   You do not need administrator rights.
4. WaqtWise starts. A shortcut is on your Desktop and in the Start menu.

## 2. First start

- A welcome screen asks for your **city**. Choose it and click **Start planning**. (You can change it later in
  Settings.)
- Check the prayer times at the top of each zone against a timetable you trust. If one differs by a few
  minutes, Settings -> Prayer Times lets you add or subtract minutes for that prayer. You can also choose
  another calculation method.

## 3. Add your first task

1. Click **+ Task**.
2. Type a title, choose the time (there are three ways: **Fixed Time**, **Relative to Prayer** such as "10 minutes
   after Asr", or **Relative to Task** such as "15 minutes after the end of another task"), and the length.
3. The form shows which zone it falls in. Click **Save**.
4. To mark a task done, click the circle at the right of its row. Click a task to change it.

Tasks can repeat (every day, certain weekdays, every month on the 1st Friday, and many more). When you change
a repeating task, the app asks whether the change applies to this occurrence only, this and the following ones,
or all of them.

### Tasks with no time yet (Free To-Do list)

Open the menu and choose **Free To-Do list**. Type a task and press Enter (or use "Add with details"). When you decide the time, press **Schedule task**: the usual window opens with the title and notes filled in; choose the time and repeat, and Save. The task moves into the five zones. To put a one-time task back, click it in the Daily View and choose **Move to free list**.

Clicking a task (in the Daily View, the bell, the missed reminders or Statistics) shows its details. Use **Edit task** to change it.

## 4. Reminders

- New tasks have a reminder switched on. With no times added, it reminds you **10 minutes before** (change this
  in Settings). You can add several reminders to one task, for example 1 hour before and at the start.
- When it is time, Windows shows a notification (no buttons). Click the
  notification itself to open WaqtWise on the Daily View.
- Try it: Settings -> Reminders & Notifications -> **Send a test notification**.
- If you were away (computer off or asleep), the app tells you which reminders you missed.

### Choosing the buttons and details of the full-screen alert

Settings -> Full-screen reminder: **Details shown** chooses the time, duration, zone, category and priority lines, and **Show the notes** the notes. **Buttons shown** chooses whether Snooze, Open task and Mark as Done appear. "Got it" is always shown. The preview below updates at once.

### One note at random in the full-screen alert

In the task window, with **Full-screen alert** on, tick **Show one note at random** and write several notes separated by `;` (for example `Drink water; Stretch; Breathe`). Each time the alert appears it shows one of them; all of them are used before any repeats, and when you snooze, the alert comes back with a different one.

### Full-screen alerts (hard to miss)

For tasks you must not miss, switch on **Full-screen alert at the start time** in the task form. At exactly the start
time the whole screen shows the task name, notes and details until you click a button: **Got it**, **Snooze**,
**Open task** or **Mark as Done**. It covers every screen if you have more than one. For new tasks to have it
switched on automatically, turn on Settings -> Full-screen reminder -> "Switch the full-screen alert on for new tasks".

Settings -> **Full-screen reminder** lets you change the colors, the font, the size and style of the task name and
the notes, and what details are shown, with ready-made looks and a **Preview full screen** button. A few
presses right when it appears are ignored on purpose, so typing cannot close it by accident.

## 5. It keeps running in the background

- When you close or minimize the window, WaqtWise **keeps running** in the tray (the small icons near the
  clock; you may need to click the small arrow to see it). This is what lets reminders appear even when the
  window is closed. The first time, the app tells you this.
- Click the tray icon to open the window again. Right-click it for **Open / Show**, **Hide / Minimize** and
  **Exit**. Exit stops the app completely (reminders stop too).
- Settings -> Application -> **Start with Windows** makes it start by itself when you log in, quietly in the tray.

## 6. Your data and backups

- Everything is stored on this computer only.
- Settings -> Data -> **Export data** saves a backup file. **Import data** restores one (it replaces what is
  currently in the app). Make a backup before reinstalling Windows or moving to another computer.

## 7. Update

Run the newer installer. Your tasks and settings are kept.

## A city that is not in the list

Settings -> Prayer Times -> City -> **Custom city…**: type the name, latitude, longitude and time zone (for example
`Asia/Riyadh`; the button next to it fills in this computer's time zone), then **Save city**. Prayer times come from
the coordinates, and the start and end of each zone are shown in that city's time zone. Your tasks keep using this
computer's clock. Choosing a city from the list again keeps the custom one saved for later.

## Tasks that repeat every 2 or more weeks

Their weeks start on the **first day of the week** chosen in Settings. Changing that setting can move such tasks to
other weeks (tasks that repeat every week are not affected).

## Backups and statistics history

- WaqtWise keeps its own copies automatically in a `backups` folder next to your data: one per day (the last 7 days)
  and one just before every import or restore (the last 5 of each).
- To go back: Settings -> Data -> **Restore from backup…**, pick a copy and click **Restore**. The data you had
  just before is saved first, so a restore can be undone from the same list.
- Statistics of days that are over are saved, so editing or deleting a task later does not change the past.

## 8. Uninstall

Settings -> Apps -> WaqtWise -> Uninstall. The uninstaller asks whether to delete your data too: choose
**No** to keep it for a future reinstall.

## If something does not work

| Problem | What to try |
| --- | --- |
| No notifications appear | Click **Send a test notification** in Settings. If nothing shows: Windows Settings -> System -> Notifications, make sure notifications are on and "WaqtWise" is allowed; turn off Focus assist / Do not disturb. |
| Clicking a notification does not open WaqtWise | Tell the person who built the app; this needs a fix on our side. |
| The full-screen alert does not appear over a game or video | Programs running in exclusive full-screen can hide every other window. Try the program's windowed or borderless full-screen mode. |
| The window disappeared | It is in the tray. Click the tray icon. |
| Prayer times look wrong | Check the city and the calculation method in Settings, then add minutes of adjustment for the prayer that differs. |
| A task shows "Backup start time" | It starts relative to another task that is not on that day. Change the task it follows, or accept the backup time you chose. |

## Language

Settings -> **Language / اللغة**: English or العربية. The change is immediate and kept for next time. Your own text (task names, notes, category names you made) is never translated.
