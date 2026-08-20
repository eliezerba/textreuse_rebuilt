window.TR = window.TR || {};

TR.dataAdapters = (() => {
  'use strict';

  function stripBom(text) {
    return String(text || '').replace(/^\uFEFF/, '');
  }

  function looksLikeCandidateContainer(value) {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value) && Array.isArray(value.candidates));
  }

  function looksLikeTextReuseObject(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
    const values = Object.values(raw).slice(0, 25);
    return values.length > 0 && values.some(looksLikeCandidateContainer);
  }

  function unwrapTextReuse(raw) {
    if (looksLikeTextReuseObject(raw)) return raw;
    const wrappers = ['results', 'data', 'records', 'passages', 'textreuse', 'text_reuse'];
    for (const key of wrappers) {
      const value = raw?.[key];
      if (looksLikeTextReuseObject(value)) return value;
    }
    return null;
  }

  function looksLikePassage(item) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
    const hasLocator = item.location || item.Location || item.passage_id || item.passageId || item.segment || item.id;
    const hasText = item.sentence !== undefined || item.orig_sentence !== undefined || item.text !== undefined || item.source_text !== undefined || item.passage_text !== undefined;
    return Boolean(hasLocator && hasText);
  }

  function extractCorpusItems(raw) {
    if (Array.isArray(raw) && raw.some(looksLikePassage)) return raw.filter(looksLikePassage);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    for (const key of ['passages', 'items', 'segments', 'corpus', 'records']) {
      if (Array.isArray(raw[key]) && raw[key].some(looksLikePassage)) return raw[key].filter(looksLikePassage);
    }
    const values = Object.entries(raw).filter(([, value]) => looksLikePassage(value));
    if (values.length) return values.map(([key, value]) => ({ location: value.location || value.Location || key, ...value }));
    return null;
  }

  function parseNdjson(text) {
    const lines = stripBom(text).split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    if (lines.length < 2) return null;
    const items = [];
    for (let index = 0; index < lines.length; index += 1) {
      try {
        const parsed = JSON.parse(lines[index]);
        if (!looksLikePassage(parsed)) return null;
        items.push(parsed);
      } catch {
        return null;
      }
    }
    return items;
  }

  function parseSourceText(text, label = 'data') {
    const normalized = stripBom(text);
    let raw = null;
    let jsonError = null;
    try { raw = JSON.parse(normalized); }
    catch (error) { jsonError = error; }

    if (raw !== null) {
      const textReuse = unwrapTextReuse(raw);
      if (textReuse) return { kind: 'textreuse', raw: textReuse, wrapper: raw === textReuse ? null : raw };
      const corpusItems = extractCorpusItems(raw);
      if (corpusItems) return { kind: 'corpus', items: corpusItems, raw };
      throw new Error('מבנה JSON לא מזוהה: לא נמצאו רשומות TEXTREUSE עם candidates ולא רשומות קורפוס עם location וטקסט.');
    }

    const ndjsonItems = parseNdjson(normalized);
    if (ndjsonItems) return { kind: 'corpus', items: ndjsonItems, raw: null, format: 'ndjson' };
    throw new Error(`JSON/NDJSON לא תקין (${jsonError?.message || 'פורמט לא מזוהה'})`);
  }

  return { parseSourceText, looksLikeTextReuseObject, extractCorpusItems, parseNdjson };
})();
