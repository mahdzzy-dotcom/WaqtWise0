'use strict';

// Languages. The app is written in English; every sentence is also looked up here by its English text, so
// `t('Task added')` shows the Arabic when the language is Arabic and the English as written otherwise.
// Numbers are never translated: they are always written 0123456789.
//
// This file works both in Node (require) and in the window (a plain <script> that makes window.WWI18n).

(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.WWI18n = factory();
}(typeof window !== 'undefined' ? window : this, function () {
  const LANGUAGES = ['en', 'ar'];
  const RTL = ['ar'];
  const dictionaries = {};
  const missing = new Set(); // sentences asked for in a language that has no translation (used by tests)
  let current = 'en';

  const NAMES = {
    en: {
      monthLong: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
      monthShort: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
      weekdayLong: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
      weekdayShort: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
    },
    ar: {
      monthLong: ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'],
      monthShort: ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'],
      weekdayLong: ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'],
      weekdayShort: ['أحد', 'إثنين', 'ثلاثاء', 'أربعاء', 'خميس', 'جمعة', 'سبت'],
    },
  };

  function registerLanguage(code, dictionary) {
    dictionaries[code] = dictionary;
  }

  function setLanguage(code) {
    current = LANGUAGES.includes(code) ? code : 'en';
    return current;
  }

  const getLanguage = () => current;
  const isRtl = (code) => RTL.includes(code || current);

  function fill(text, params) {
    if (!params) return text;
    return text.replace(/\{(\w+)\}/g, (whole, name) => (name in params ? String(params[name]) : whole));
  }

  function lookup(key) {
    if (current === 'en') return key;
    const dictionary = dictionaries[current];
    const found = dictionary ? dictionary[key] : undefined;
    if (typeof found === 'string') return found;
    missing.add(key);
    return key;
  }

  // t('Hello {name}', { name: 'Sara' })
  function t(key, params) {
    return fill(lookup(key), params);
  }

  // Number-dependent sentences: tp(n, '{n} task', '{n} tasks'). Arabic has its own forms, written in the
  // dictionary under the plural key as a list: [one, two, 3-10, 11 or more (also 0)].
  function tp(n, one, other, params) {
    const all = { ...(params || {}), n };
    if (current === 'en') return fill(n === 1 ? one : other, all);
    const forms = dictionaries[current] ? dictionaries[current][other] : undefined;
    if (!Array.isArray(forms)) {
      missing.add(other);
      return fill(n === 1 ? one : other, all);
    }
    let index = 3;
    if (n === 1) index = 0;
    else if (n === 2) index = 1;
    else if (n >= 3 && n <= 10) index = 2;
    return fill(forms[index] || forms[forms.length - 1], all);
  }

  const names = (kind) => (NAMES[current] || NAMES.en)[kind];

  return {
    LANGUAGES,
    registerLanguage,
    setLanguage,
    getLanguage,
    isRtl,
    t,
    tp,
    monthLong: (i) => names('monthLong')[i],
    monthShort: (i) => names('monthShort')[i],
    weekdayLong: (i) => names('weekdayLong')[i],
    weekdayShort: (i) => names('weekdayShort')[i],
    takeMissing: () => { const list = Array.from(missing); missing.clear(); return list; },
    dictionary: (code) => dictionaries[code] || {},
  };
}));
