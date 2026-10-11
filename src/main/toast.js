'use strict';

// Windows notification ("toast") adapter for the Electron main process.
//
// It turns the plain notification payloads made by src/core/reminders.js into native Windows
// toasts. A toast has no buttons: clicking it opens the app.
//
// How a click reaches the app: a click on the toast opens the link  waqtwise://open .  Windows hands
// that link to the app (the installer registers the "waqtwise" protocol), the already-running copy
// receives it through Electron's single-instance "second-instance" event, and parseActionUrl()
// below turns it into an action. The links can only ever open the window; they cannot change any task.
//
// The Electron pieces are passed in (not imported), so this file can be tested without Electron.

const PROTOCOL = 'waqtwise';
const APP_ID = 'com.waqtwise.app'; // call app.setAppUserModelId(APP_ID) at startup
const ACTION_TYPES = ['open', 'missed']; // both only show the window

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function buildActionUrl(type) {
  return `${PROTOCOL}://${type}`;
}

// Returns { type } or null when the text is not one of our links. Anything after the name is ignored.
function parseActionUrl(text) {
  if (typeof text !== 'string' || !text.toLowerCase().startsWith(`${PROTOCOL}://`)) return null;
  let url;
  try {
    url = new URL(text);
  } catch (error) {
    return null;
  }
  const type = url.hostname.toLowerCase();
  if (!ACTION_TYPES.includes(type)) return null;

  return { type };
}

// When Windows opens the app with a link, it appears among the command-line arguments.
function findActionUrlInArgv(argv) {
  const link = (argv || []).find((arg) => typeof arg === 'string' && arg.toLowerCase().startsWith(`${PROTOCOL}://`));
  return link ? parseActionUrl(link) : null;
}

function buildToastXml(payload) {
  const lines = Array.isArray(payload.lines) ? payload.lines : [];
  const launch = payload.kind === 'missed' ? buildActionUrl('missed') : buildActionUrl('open');

  let xml = `<toast launch="${escapeXml(launch)}" activationType="protocol">`;
  xml += '<visual><binding template="ToastGeneric">';
  xml += `<text>${escapeXml(payload.title)}</text>`;
  for (const line of lines) xml += `<text>${escapeXml(line)}</text>`;
  xml += '</binding></visual>';
  if (payload.silent) xml += '<audio silent="true"/>';

  xml += '</toast>';
  return xml;
}

// electron: the object with Notification, e.g. require('electron').
// Returns notify(payload), which ReminderEngine uses as deps.notify.
function createElectronNotifier({ Notification, onError }) {
  const alive = new Set(); // keeps notifications from being cleaned up while on screen

  return function notify(payload) {
    if (typeof Notification.isSupported === 'function' && !Notification.isSupported()) return null;

    const notification = new Notification({
      title: payload.title,
      body: payload.body,
      silent: Boolean(payload.silent),
      toastXml: buildToastXml(payload),
    });

    alive.add(notification);
    const release = () => alive.delete(notification);
    notification.on('close', release);
    notification.on('click', release);
    notification.on('failed', (event, error) => {
      release();
      if (onError) onError(error || event);
    });
    notification.show();
    return notification;
  };
}

module.exports = {
  PROTOCOL,
  APP_ID,
  escapeXml,
  buildActionUrl,
  parseActionUrl,
  findActionUrlInArgv,
  buildToastXml,
  createElectronNotifier,
};
