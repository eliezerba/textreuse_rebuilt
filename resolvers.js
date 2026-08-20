window.TR = window.TR || {};

TR.LocalCorpusResolver = class LocalCorpusResolver {
  constructor(registry = null) { this.registry = registry; }
  setRegistry(registry) { this.registry = registry; }
  canResolve(entity) { return Boolean(this.registry?.lookup(entity)); }
  async resolve(entity) {
    const entry = this.registry?.lookup(entity);
    if (!entry) return null;
    return {
      provider: 'local',
      resolution: 'local-registry',
      canonicalRef: [entry.heTitle || entry.title || entry.resourceId, entry.passageId].filter(Boolean).join(' '),
      heRef: [entry.heTitle || entry.title || entry.resourceId, entry.passageId].filter(Boolean).join(' '),
      heIndexTitle: entry.heTitle || entry.title || '',
      indexTitle: entry.title || entry.resourceId || '',
      categories: entry.categories || [],
      versionTitle: Array.isArray(entry.versions) ? entry.versions.join(' · ') : (entry.versions || ''),
      versionSource: entry.versionSource || '',
      analysisText: entry.analysisText || '',
      originalText: entry.originalText || '',
      fromWord: entry.fromWord,
      toWord: entry.toWord,
      textLength: entry.textLength,
      segment: entry.segment,
      references: entry.references || [],
      provenance: entry.provenance || [],
      dts: entry.dts || null,
      localEntry: entry,
      url: entry.versionSource || null
    };
  }
};

TR.DTSResolver = class DTSResolver {
  constructor({ fetchImpl = null } = {}) { this.fetchImpl = fetchImpl || (typeof fetch !== 'undefined' ? fetch.bind(window) : null); }
  canResolve(entity) { return Boolean(entity?.localMetadata?.dts?.endpoint || entity?.dts?.endpoint); }

  async entrypoint(endpoint) {
    const base = String(endpoint || '').replace(/\/$/, '');
    try {
      const response = await this.fetchImpl(base, { cache: 'no-store' });
      if (!response.ok) return null;
      return await response.json();
    } catch {
      return null;
    }
  }

  absolute(base, link, fallbackPath) {
    const value = String(link || fallbackPath || '');
    try { return new URL(value, `${String(base).replace(/\/$/, '')}/`).toString(); }
    catch { return `${String(base).replace(/\/$/, '')}/${value.replace(/^\//, '')}`; }
  }

  async resolve(entity) {
    if (!this.fetchImpl) return null;
    const dts = entity?.localMetadata?.dts || entity?.dts;
    if (!dts?.endpoint || !dts.resource) return null;
    const endpoint = String(dts.endpoint).replace(/\/$/, '');
    const entrypoint = await this.entrypoint(endpoint);
    const collectionsBase = this.absolute(endpoint, entrypoint?.collections, 'collections');
    const collectionUrl = `${collectionsBase}${collectionsBase.includes('?') ? '&' : '?'}id=${encodeURIComponent(dts.resource)}`;
    const response = await this.fetchImpl(collectionUrl, { cache: 'no-store' });
    if (!response.ok) throw new Error(`DTS HTTP ${response.status}`);
    const collection = await response.json();
    return {
      provider: 'dts',
      resolution: 'dts',
      canonicalRef: [collection.title || dts.resource, dts.ref].filter(Boolean).join(' '),
      heRef: [collection.title || dts.resource, dts.ref].filter(Boolean).join(' '),
      heIndexTitle: collection.title || '',
      indexTitle: collection.title || dts.resource,
      categories: [],
      dts,
      dtsEntrypoint: entrypoint,
      dtsCollection: collection,
      url: collection['@id'] || collectionUrl
    };
  }

  async getText(entity) {
    if (!this.fetchImpl) return null;
    const dts = entity?.localMetadata?.dts || entity?.dts;
    if (!dts?.endpoint || !dts.resource) return null;
    const endpoint = String(dts.endpoint).replace(/\/$/, '');
    const entrypoint = await this.entrypoint(endpoint);
    const documentsBase = this.absolute(endpoint, entrypoint?.documents, 'documents');
    const params = new URLSearchParams({ id: dts.resource });
    if (dts.ref) params.set('ref', dts.ref);
    const response = await this.fetchImpl(`${documentsBase}${documentsBase.includes('?') ? '&' : '?'}${params}`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`DTS HTTP ${response.status}`);
    const xml = await response.text();
    let text = xml;
    if (typeof DOMParser !== 'undefined') {
      try { text = new DOMParser().parseFromString(xml, 'application/xml').documentElement?.textContent?.replace(/\s+/g, ' ').trim() || xml; } catch { /* keep XML */ }
    }
    return { provider: 'dts', text, xml, dts };
  }
};

TR.ResolverHub = class ResolverHub {
  constructor({ registry = null, sefaria = null } = {}) {
    this.local = new TR.LocalCorpusResolver(registry);
    this.dts = new TR.DTSResolver();
    this.sefaria = sefaria || null;
  }
  setRegistry(registry) { this.local.setRegistry(registry); }
  async getPassageMetadata(entity, { preferLocal = true } = {}) {
    const local = this.local.canResolve(entity) ? await this.local.resolve(entity) : null;
    if (preferLocal && local) {
      if (local.dts && this.dts.canResolve(entity)) {
        try {
          const external = await this.dts.resolve(entity);
          return { ...(external || {}), ...local, externalMetadata: external || null, provider: external ? 'local+dts' : 'local' };
        } catch { /* local metadata remains authoritative */ }
      }
      if (entity?.isSefariaLike === false) return local;
      try {
        const external = this.sefaria ? await this.sefaria.getPassageMetadata(entity) : null;
        return { ...(external || {}), ...local, externalMetadata: external || null, provider: external ? 'local+sefaria' : 'local' };
      } catch {
        return local;
      }
    }
    if (this.dts.canResolve(entity)) {
      try { return await this.dts.resolve(entity); } catch { /* optional resolver */ }
    }
    if (entity?.isBookPassage || entity?.isSefariaLike !== false) return this.sefaria ? this.sefaria.getPassageMetadata(entity) : local;
    return local;
  }
  async getText(entity, { original = false } = {}) {
    const localEntry = this.local.registry?.lookup(entity);
    if (localEntry) return { provider: 'local', text: original ? (localEntry.originalText || localEntry.analysisText) : (localEntry.analysisText || localEntry.originalText), entry: localEntry };
    if (this.dts.canResolve(entity)) return this.dts.getText(entity);
    return null;
  }
};
