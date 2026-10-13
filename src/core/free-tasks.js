'use strict';

// Free tasks: things to do that have no time yet. They live in their own list (data.freeTasks) and have no
// reminders, no zone and no statistics. When the person schedules one, it becomes a normal task and leaves the list.
//
//   { id, title, notes, priority: 'Low'|'Medium'|'High', categoryId|null, durationMinutes|null, done, createdAt }

const { t } = require('./i18n');
const { PRIORITIES, validateDuration } = require('./tasks');
const { MAX_FREE_TASKS, MAX_TITLE_LENGTH, MAX_NOTES_LENGTH } = require('./limits');

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function cleanCreatedAt(value) {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value)) && /^\d{4}-\d{2}-\d{2}T/.test(value) ? value : null;
}

// Builds a clean free task from a form or a file. Returns { task } or { error }.
function normalizeFreeTask(raw, now = new Date()) {
  if (!isPlainObject(raw)) return { error: 'not a task' };
  const title = typeof raw.title === 'string' ? raw.title.trim() : '';
  if (title === '') return { error: t('Please enter a title') };
  if (title.length > MAX_TITLE_LENGTH) return { error: t('The title is too long (at most {max} characters)', { max: MAX_TITLE_LENGTH }) };
  if (typeof raw.id !== 'string' || raw.id === '') return { error: 'missing id' };
  const notes = typeof raw.notes === 'string' ? raw.notes.slice(0, MAX_NOTES_LENGTH) : '';
  let durationMinutes = null;
  if (raw.durationMinutes !== null && raw.durationMinutes !== undefined) {
    const problems = validateDuration(raw.durationMinutes);
    if (problems.length) return { error: problems[0] };
    durationMinutes = raw.durationMinutes;
  }
  return {
    task: {
      id: raw.id,
      title,
      notes,
      priority: PRIORITIES.includes(raw.priority) ? raw.priority : 'Medium',
      categoryId: typeof raw.categoryId === 'string' && raw.categoryId !== '' ? raw.categoryId : null,
      durationMinutes,
      done: raw.done === true,
      createdAt: cleanCreatedAt(raw.createdAt) || now.toISOString(),
    },
  };
}

module.exports = { normalizeFreeTask, MAX_FREE_TASKS };
