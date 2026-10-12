'use strict';

// Upper limits for numbers a person (or a data file) can give. Without them a huge value makes an invalid date
// or a very slow calculation. The limits are far above anything a real plan needs.

module.exports = {
  MAX_DURATION_MINUTES: 7 * 24 * 60, // one task lasts at most 7 days
  MAX_OFFSET_MINUTES: 7 * 24 * 60, // reminders: up to 7 days before; "N minutes before a prayer or task": up to 7 days
  MAX_INTERVAL: 999, // "every N days / weeks / months / years"
  MAX_COUNT: 9999, // "ends after N occurrences"
  MAX_TASKS: 20000, // tasks in one data file
  MAX_IMPORT_BYTES: 20 * 1024 * 1024, // size of a backup file that is read
};
