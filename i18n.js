window.TR = window.TR || {};

TR.i18n = (() => {
  'use strict';

  const STORAGE_KEY = 'textreuse_lang_v2';
  const state = { lang: 'he' };

  const MAP = [
    { selector: '.skip-link', he: 'דלג לתוכן', en: 'Skip to content' },
    { selector: '.brand-block .eyebrow', he: 'TEXTREUSE · סביבת מחקר', en: 'TEXTREUSE · Research Workspace' },
    { selector: '.brand-block h1', he: 'מפת שימוש חוזר בטקסט', en: 'Text Reuse Map' },
    { selector: '.brand-block > p:last-child', he: 'קריאה צמודה של קטעי המקור לצד מועמדי הקרבה, עם מטא־דאטה מספריא ומבט רוחב על יחסי הספרים.', en: 'Close reading of source passages next to candidate parallels, with Sefaria metadata and macro views of inter-book relationships.' },
    { selector: '#loadFileBtn', he: 'בחירת מאגרי JSON', en: 'Choose JSON Datasets' },
    { selector: '#exportCsvBtn', he: 'ייצוא CSV', en: 'Export CSV' },
    { selector: '#exportSynopsisCsvBtn', he: 'ייצוא CSV', en: 'Export CSV' },
    { selector: '[data-view="read"]', he: 'קריאה והשוואה', en: 'Read & Compare' },
    { selector: '[data-view="synopsis"]', he: 'סינופסיס', en: 'Synopsis' },
    { selector: '[data-view="reverse"]', he: 'קריאה הפוכה', en: 'Reverse Reading' },
    { selector: '[data-view="matrix"]', he: 'מפת חום', en: 'Heatmap' },
    { selector: '[data-view="network"]', he: 'רשת ספרים', en: 'Book Network' },
    { selector: '[data-view="scatter"]', he: 'פיזור ציונים', en: 'Score Scatter' },
    { selector: '[data-view="library"]', he: 'קטלוג ספרים', en: 'Book Catalog' },
    { selector: '[data-view="diagnostics"]', he: 'אבחון דאטה', en: 'Data Diagnostics' },
    { selector: '[data-view="reverse"] .visualization-header h2', he: 'מהדאטהסט אל ספר המקור', en: 'From Dataset Back to Source Book' },
    { selector: '#reverseRefreshBtn', he: 'עדכן', en: 'Refresh' },
    { selector: '[data-view="diagnostics"] .visualization-header h2', he: 'אבחון דאטה', en: 'Data Diagnostics' },
    { selector: '#runDiagnosticsBtn', he: 'בדוק דגימות', en: 'Run Diagnostics' }
  ];

  function getLang() {
    return state.lang;
  }

  function isHebrew() {
    return state.lang === 'he';
  }

  function t(he, en) {
    return isHebrew() ? he : en;
  }

  function setLang(lang) {
    state.lang = lang === 'en' ? 'en' : 'he';
    localStorage.setItem(STORAGE_KEY, state.lang);
    apply();
    document.dispatchEvent(new CustomEvent('tr-language-changed', { detail: { lang: state.lang } }));
  }

  function toggle() {
    setLang(isHebrew() ? 'en' : 'he');
  }

  function apply() {
    document.documentElement.lang = state.lang;
    document.documentElement.dir = isHebrew() ? 'rtl' : 'ltr';

    for (const entry of MAP) {
      const element = document.querySelector(entry.selector);
      if (!element) continue;
      if (entry.selector.includes('[data-view="synopsis"]')) {
        const count = element.querySelector('.tab-count');
        element.childNodes[0].nodeValue = `${t(entry.he, entry.en)} `;
        if (count) element.append(count);
      } else {
        element.textContent = t(entry.he, entry.en);
      }
    }

    const toggleButton = document.getElementById('langToggleBtn');
    if (toggleButton) toggleButton.textContent = isHebrew() ? 'EN' : 'עב';
  }

  function init() {
    const saved = localStorage.getItem(STORAGE_KEY);
    state.lang = saved === 'en' ? 'en' : 'he';
    apply();
  }

  return { init, apply, toggle, setLang, getLang, isHebrew, t };
})();