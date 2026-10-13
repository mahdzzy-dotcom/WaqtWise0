'use strict';

// "One note at random": a task's notes can hold several messages separated by ; (or the Arabic ؛).
// The full-screen alert shows one of them. Every message is shown once before any is repeated, and the same
// message is kept while the alert is simply shown again on the same day; after a snooze a different one is chosen.
//
// The memory of that lives in data.noteRotation (not in the export file):
//   { [taskId]: { sig, dateKey, index, used: [index, ...] } }

const { isValidKey } = require('./time');

const SEPARATOR = /[;؛]/;
const MAX_PARTS = 1000;

function splitNotes(notes) {
  return String(notes === undefined || notes === null ? '' : notes).split(SEPARATOR).map((s) => s.trim()).filter((s) => s !== '').slice(0, MAX_PARTS);
}

// A small number that changes when the messages change (so a rotation of old messages is not reused).
function signature(parts) {
  let hash = 5381;
  const text = parts.join('\u0000');
  for (let i = 0; i < text.length; i++) hash = ((hash * 33) ^ text.charCodeAt(i)) >>> 0;
  return hash;
}

function validRecord(record, length) {
  return record && typeof record === 'object' && Number.isInteger(record.index) && record.index >= 0 && record.index < length
    && Array.isArray(record.used) && record.used.every((n) => Number.isInteger(n) && n >= 0 && n < length);
}

// Chooses the message for one occurrence. Returns { note, record } (record is null when there is nothing to remember).
// `fresh` forces a new choice even on the same day (the alert comes back after a snooze).
function pickNote(notes, record, dateKey, random = Math.random, fresh = false) {
  const parts = splitNotes(notes);
  if (parts.length < 2) return { note: parts.length === 1 ? parts[0] : String(notes || ''), record: null };
  const sig = signature(parts);
  const same = validRecord(record, parts.length) && record.sig === sig;
  if (same && !fresh && record.dateKey === dateKey) return { note: parts[record.index], record };
  const last = same ? record.index : -1;
  let used = same ? record.used.slice() : [];
  let candidates = parts.map((_, i) => i).filter((i) => !used.includes(i) && i !== last);
  if (candidates.length === 0) {
    used = [];
    candidates = parts.map((_, i) => i).filter((i) => i !== last);
  }
  const index = candidates[Math.min(candidates.length - 1, Math.floor(random() * candidates.length))];
  used.push(index);
  return { note: parts[index], record: { sig, dateKey, index, used } };
}

// Cleans the saved memory: only for tasks that still exist, only well-formed records.
function normalizeNoteRotation(raw, taskIds) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [taskId, record] of Object.entries(raw)) {
    if (!taskIds.has(taskId) || !record || typeof record !== 'object') continue;
    if (!Number.isInteger(record.sig) || !isValidKey(record.dateKey)) continue;
    if (!Number.isInteger(record.index) || record.index < 0 || record.index >= MAX_PARTS) continue;
    if (!Array.isArray(record.used) || record.used.length > MAX_PARTS || !record.used.every((n) => Number.isInteger(n) && n >= 0 && n < MAX_PARTS)) continue;
    out[taskId] = { sig: record.sig, dateKey: record.dateKey, index: record.index, used: record.used.slice() };
  }
  return out;
}

module.exports = { splitNotes, pickNote, normalizeNoteRotation };
