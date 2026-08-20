window.TR = window.TR || {};

TR.knowledge = (() => {
  'use strict';

  const scalar = value => (value === undefined || value === null ? '' : String(value));
  const list = value => Array.isArray(value) ? value.filter(item => item !== undefined && item !== null).map(item => String(item)) : (value ? [String(value)] : []);
  const first = (...values) => values.find(value => value !== undefined && value !== null && String(value).trim() !== '');
  const normalizedKey = value => scalar(value).normalize('NFKD').toLowerCase().replace(/[\s_.,:;\-\u2013\u2014/\\]+/g, '');

  function suffixFromLocation(location) {
    const value = scalar(location);
    if (!value.includes('__')) return '';
    return value.split('__').slice(1).join('__');
  }

  function derivePassageId(location, item = {}, refTemplate = {}) {
    const explicit = first(item.passage_id, item.passageId, item.ref, item.reference, item.dts_ref, item.dtsRef);
    if (explicit) return scalar(explicit);
    const suffix = suffixFromLocation(location);
    if (suffix) return suffix;
    return scalar(refTemplate.address || refTemplate.display || location);
  }

  function deriveResourceId(location, item = {}, refTemplate = {}) {
    const explicit = first(item.resource_id, item.resourceId, item.work_id, item.workId, item.dts_resource, item.dtsResource);
    if (explicit) return scalar(explicit);
    if (refTemplate.bookSlug) return scalar(refTemplate.bookSlug);
    const prefix = scalar(location).split('__', 1)[0];
    return prefix || 'unknown-resource';
  }

  function deriveDts(item = {}) {
    const nested = item.dts && typeof item.dts === 'object' ? item.dts : {};
    const endpoint = first(item.dts_endpoint, item.dtsEndpoint, nested.endpoint, nested.baseUrl, nested.base_url);
    const resource = first(item.dts_resource, item.dtsResource, nested.resource, nested.id, nested.resourceId);
    const ref = first(item.dts_ref, item.dtsRef, nested.ref, nested.reference);
    if (!endpoint && !resource && !ref) return null;
    return {
      endpoint: endpoint ? scalar(endpoint) : '',
      resource: resource ? scalar(resource) : '',
      ref: ref ? scalar(ref) : ''
    };
  }

  function extractPassageMetadata(item = {}, { location = '', label = '', sourceId = '', refTemplate = {}, fallbackText = '' } = {}) {
    const categories = Array.isArray(item.categories)
      ? item.categories.map(String)
      : Array.isArray(item.source_categories)
        ? item.source_categories.map(String)
        : [];
    const versions = first(item.versions, item.version, item.versionTitle, item.version_title);
    const analysisText = scalar(first(item.sentence, item.analysis_text, item.analysisText, item.text, item.source_text, item.passage_text, fallbackText));
    const originalText = scalar(first(item.orig_sentence, item.original_text, item.originalText, item.original, analysisText));
    const fromWordRaw = first(item.from_word, item.fromWord, item.start_word, item.startWord);
    const toWordRaw = first(item.to_word, item.toWord, item.end_word, item.endWord);
    const lengthRaw = first(item.text_length, item.textLength, item.length);
    const toNumberOrNull = value => value === undefined || value === null || value === '' || !Number.isFinite(Number(value)) ? null : Number(value);
    const resourceId = deriveResourceId(location, item, refTemplate);
    const passageId = derivePassageId(location, item, refTemplate);
    const versionSource = scalar(first(item.versionSource, item.version_source, item.source_url, item.sourceUrl));
    const references = Array.isArray(item.references) ? item.references : [];
    return {
      location: scalar(location || item.location),
      resourceId,
      passageId,
      segment: first(item.segment, item.section, item.segment_id, item.segmentId) ?? null,
      analysisText,
      originalText,
      analysisTextKind: scalar(first(item.analysis_text_kind, item.analysisTextKind, 'normalized')),
      fromWord: toNumberOrNull(fromWordRaw),
      toWord: toNumberOrNull(toWordRaw),
      selector: (toNumberOrNull(fromWordRaw) != null || toNumberOrNull(toWordRaw) != null) ? {
        type: 'word-range',
        start: toNumberOrNull(fromWordRaw),
        end: toNumberOrNull(toWordRaw)
      } : null,
      textLength: toNumberOrNull(lengthRaw) ?? (analysisText ? analysisText.trim().split(/\s+/).filter(Boolean).length : null),
      title: scalar(first(item.title, item.work_title, item.workTitle, refTemplate.bookTitle)),
      heTitle: scalar(first(item.he_title, item.heTitle, item.hebrew_title, item.hebrewTitle)),
      categories,
      versions: versions == null ? '' : (Array.isArray(versions) ? versions.map(String) : scalar(versions)),
      versionSource,
      references,
      dts: deriveDts(item),
      provenance: [{ sourceId: scalar(sourceId), label: scalar(label), kind: 'file' }].filter(entry => entry.sourceId || entry.label),
      raw: item
    };
  }

  function uniqueArray(values) {
    const seen = new Set();
    return values.filter(value => {
      const key = typeof value === 'string' ? value : JSON.stringify(value);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function mergePassageMetadata(base, extra) {
    if (!base) return extra ? { ...extra, provenance: [...(extra.provenance || [])] } : null;
    if (!extra) return { ...base, provenance: [...(base.provenance || [])] };
    const scalarKeys = ['location', 'resourceId', 'passageId', 'segment', 'analysisText', 'originalText', 'analysisTextKind', 'fromWord', 'toWord', 'textLength', 'title', 'heTitle', 'versionSource'];
    const merged = { ...base };
    scalarKeys.forEach(key => {
      if ((merged[key] === '' || merged[key] === null || merged[key] === undefined) && extra[key] !== '' && extra[key] !== null && extra[key] !== undefined) merged[key] = extra[key];
    });
    merged.categories = uniqueArray([...(base.categories || []), ...(extra.categories || [])]);
    const versions = [base.versions, extra.versions].flatMap(value => Array.isArray(value) ? value : value ? [value] : []);
    merged.versions = uniqueArray(versions);
    if (merged.versions.length === 1) merged.versions = merged.versions[0];
    merged.references = uniqueArray([...(base.references || []), ...(extra.references || [])]);
    merged.selector = base.selector || extra.selector || ((merged.fromWord != null || merged.toWord != null) ? { type: 'word-range', start: merged.fromWord, end: merged.toWord } : null);
    merged.provenance = uniqueArray([...(base.provenance || []), ...(extra.provenance || [])]);
    merged.dts = base.dts || extra.dts || null;
    const conflicts = { ...(base.conflicts || {}) };
    scalarKeys.forEach(key => {
      const values = [base[key], extra[key]].filter(value => value !== '' && value !== null && value !== undefined);
      const unique = uniqueArray(values);
      if (unique.length > 1) conflicts[key] = unique;
    });
    if (Object.keys(conflicts).length) merged.conflicts = conflicts;
    return merged;
  }

  function passageLookupKeys(entity = {}) {
    const metadata = entity.localMetadata || entity.passageMetadata || {};
    const keys = [];
    const add = value => { if (value) keys.push(normalizedKey(value)); };
    add(entity.sourceLocation);
    add(entity.rawId);
    add(entity.location);
    add(metadata.location);
    if (metadata.resourceId && metadata.passageId) add(`${metadata.resourceId}::${metadata.passageId}`);
    if (entity.resourceId && entity.passageId) add(`${entity.resourceId}::${entity.passageId}`);
    return [...new Set(keys.filter(Boolean))];
  }

  return {
    normalizedKey,
    derivePassageId,
    deriveResourceId,
    deriveDts,
    extractPassageMetadata,
    mergePassageMetadata,
    uniqueArray,
    passageLookupKeys,
    suffixFromLocation
  };
})();

TR.CorpusRegistry = class CorpusRegistry {
  constructor({ label = 'corpus', sourceId = '', entries = [] } = {}) {
    this.label = label;
    this.sourceId = sourceId;
    this.entries = [];
    this.byKey = new Map();
    this.resources = new Map();
    entries.forEach(entry => this.add(entry));
  }

  static fromItems(items, label = 'corpus', sourceId = '') {
    const registry = new TR.CorpusRegistry({ label, sourceId });
    (items || []).forEach((item, index) => {
      if (!item || typeof item !== 'object') return;
      const location = String(item.location || item.Location || item.id || item.passage_id || item.passageId || `${label}:${index + 1}`);
      const categories = Array.isArray(item.categories) ? item.categories : (Array.isArray(item.source_categories) ? item.source_categories : []);
      const refTemplate = TR.refTemplates?.parseLocation(location, categories) || TR.utils?.locationParts?.(location, categories) || {};
      const metadata = TR.knowledge.extractPassageMetadata(item, { location, label, sourceId, refTemplate });
      registry.add(metadata);
    });
    return registry;
  }

  static combine(registries, label = 'combined corpus') {
    const result = new TR.CorpusRegistry({ label, sourceId: 'combined' });
    (registries || []).filter(Boolean).forEach(registry => registry.entries.forEach(entry => result.add(entry)));
    return result;
  }

  add(metadata) {
    if (!metadata) return;
    const keys = [];
    const addKey = value => { if (value) keys.push(TR.knowledge.normalizedKey(value)); };
    addKey(metadata.location);
    if (metadata.resourceId && metadata.passageId) addKey(`${metadata.resourceId}::${metadata.passageId}`);
    let existing = null;
    for (const key of keys) {
      if (this.byKey.has(key)) { existing = this.byKey.get(key); break; }
    }
    const merged = TR.knowledge.mergePassageMetadata(existing, metadata);
    if (!existing) this.entries.push(merged);
    else {
      const index = this.entries.indexOf(existing);
      if (index >= 0) this.entries[index] = merged;
    }
    keys.forEach(key => this.byKey.set(key, merged));
    if (merged.resourceId) {
      const resource = this.resources.get(merged.resourceId) || {
        id: merged.resourceId,
        title: merged.title || merged.resourceId,
        heTitle: merged.heTitle || '',
        categories: [],
        versions: [],
        versionSources: [],
        dts: null,
        passageCount: 0,
        provenance: []
      };
      resource.title = resource.title || merged.title || merged.resourceId;
      resource.heTitle = resource.heTitle || merged.heTitle || '';
      resource.categories = [...new Set([...resource.categories, ...(merged.categories || [])])];
      resource.versions = [...new Set([...resource.versions, ...([merged.versions].flat().filter(Boolean))])];
      resource.versionSources = [...new Set([...(resource.versionSources || []), merged.versionSource].filter(Boolean))];
      resource.provenance = TR.knowledge.uniqueArray([...(resource.provenance || []), ...(merged.provenance || [])]);
      resource.dts = resource.dts || merged.dts || null;
      resource.passageCount += existing ? 0 : 1;
      this.resources.set(merged.resourceId, resource);
    }
  }

  lookup(entityOrLocation, passageId = '') {
    if (!entityOrLocation) return null;
    if (typeof entityOrLocation === 'string') {
      const direct = this.byKey.get(TR.knowledge.normalizedKey(entityOrLocation));
      if (direct) return direct;
      if (passageId) return this.byKey.get(TR.knowledge.normalizedKey(`${entityOrLocation}::${passageId}`)) || null;
      return null;
    }
    for (const key of TR.knowledge.passageLookupKeys(entityOrLocation)) {
      const entry = this.byKey.get(key);
      if (entry) return entry;
    }
    return null;
  }
};
