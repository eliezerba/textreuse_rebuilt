window.TR = window.TR || {};

TR.GenizahService = class GenizahService {
  constructor(config = {}) {
    const defaultTemplates = {
      nli_viewer_url: 'https://www.nli.org.il/en/manuscripts/NNL_ALEPH{ALMA}/NLI',
      nli_manifest_proxy_url: 'https://nli-proxy.avichai-levy.workers.dev/IIIFv21/DOCID/PNX_MANUSCRIPTS{ALMA}-1/manifest',
      iiif_image_url_template: 'https://iiif.nli.org.il/IIIFv21/{FL_ID}/full/max/0/default.jpg'
    };
    this.config = {
      itemsPath: config.itemsPath || 'Genizah_Data/geniza_items_with_image_links.json',
      domainsPath: config.domainsPath || 'Genizah_Data/friedberg_domains.json',
      templatesPath: config.templatesPath || 'Genizah_Data/image_url_templates.json'
    };
    this.loaded = false;
    this.loadingPromise = null;
    this.items = [];
    this.itemsByIe = new Map();
    this.friedbergByAlma = {};
    this.templates = { ...defaultTemplates };
    this.defaultTemplates = defaultTemplates;
    this.imageUrlCache = new Map();
    this.manifestCache = new Map();
    this.metadataCache = new Map();
    this.localDataAvailable = false;
    this.storageKeys = {
      metadataCache: 'tr_genizah_metadata_cache_v1',
      imageCache: 'tr_genizah_image_cache_v1'
    };
    this.restorePersistentCaches();
  }

  restorePersistentCaches() {
    try {
      if (typeof localStorage === 'undefined') return;
      const rawMetadata = localStorage.getItem(this.storageKeys.metadataCache);
      const rawImage = localStorage.getItem(this.storageKeys.imageCache);
      if (rawMetadata) {
        const list = JSON.parse(rawMetadata);
        if (Array.isArray(list)) this.metadataCache = new Map(list);
      }
      if (rawImage) {
        const list = JSON.parse(rawImage);
        if (Array.isArray(list)) this.imageUrlCache = new Map(list);
      }
    } catch {
      // Ignore malformed cache payload.
    }
  }

  persistCaches() {
    try {
      if (typeof localStorage === 'undefined') return;
      const metadataList = Array.from(this.metadataCache.entries()).slice(-350);
      const imageList = Array.from(this.imageUrlCache.entries()).slice(-350);
      localStorage.setItem(this.storageKeys.metadataCache, JSON.stringify(metadataList));
      localStorage.setItem(this.storageKeys.imageCache, JSON.stringify(imageList));
    } catch {
      // Ignore quota/storage errors.
    }
  }

  candidateCacheKey(candidate) {
    const ie = this.extractIeFromCandidate(candidate);
    const alma = this.extractAlmaFromCandidate(candidate);
    const location = String(candidate?.sourceLocation || '');
    return `${alma}::${ie}::${location}`;
  }

  async ensureLoaded() {
    if (this.loaded) return;
    if (this.loadingPromise) return this.loadingPromise;
    this.loadingPromise = this.loadLocalData();
    await this.loadingPromise;
  }

  async loadLocalData() {
    const [itemsResult, domainsResult, templatesResult] = await Promise.allSettled([
      this.fetchJson(this.config.itemsPath),
      this.fetchJson(this.config.domainsPath),
      this.fetchJson(this.config.templatesPath)
    ]);

    const items = itemsResult.status === 'fulfilled' && Array.isArray(itemsResult.value)
      ? itemsResult.value
      : [];
    const domains = domainsResult.status === 'fulfilled' && domainsResult.value && typeof domainsResult.value === 'object'
      ? domainsResult.value
      : {};
    const templates = templatesResult.status === 'fulfilled' && templatesResult.value && typeof templatesResult.value === 'object'
      ? templatesResult.value
      : {};

    this.items = items;
    this.friedbergByAlma = domains;
    this.templates = { ...this.defaultTemplates, ...templates };
    this.itemsByIe = this.buildItemsByIe(this.items);
    this.localDataAvailable = Boolean(
      itemsResult.status === 'fulfilled'
      || domainsResult.status === 'fulfilled'
      || templatesResult.status === 'fulfilled'
    );
    this.loaded = true;
  }

  async fetchJson(url) {
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) throw new Error(`Unable to load ${url} (HTTP ${response.status})`);
    return response.json();
  }

  buildItemsByIe(items) {
    const map = new Map();
    for (const item of items) {
      const ie = this.normalizeIe(item?.geniza_ie);
      if (!ie) continue;
      const previous = map.get(ie);
      if (!previous) {
        map.set(ie, item);
        continue;
      }
      const previousCoverage = Number(previous.coverage || 0);
      const nextCoverage = Number(item.coverage || 0);
      if (nextCoverage > previousCoverage) map.set(ie, item);
    }
    return map;
  }

  normalizeIe(value) {
    if (value == null) return '';
    const text = String(value).trim();
    const match = text.match(/(\d{4,})/);
    return match ? match[1] : '';
  }

  extractIeFromCandidate(candidate) {
    const fromFragment = this.normalizeIe(candidate?.sourceFragment);
    if (fromFragment) return fromFragment;
    const fromLocation = this.normalizeIe(candidate?.sourceLocation);
    if (fromLocation) return fromLocation;
    return '';
  }

  extractAlmaFromCandidate(candidate) {
    const location = String(candidate?.sourceLocation || '');
    const byBIB = location.match(/BIB[_\s-]*(\d{12,22})/i)?.[1];
    if (byBIB) return byBIB;

    const byLongNumber = location.match(/(99\d{14,20})/i)?.[1];
    if (byLongNumber) return byLongNumber;

    return '';
  }

  async fetchManifestByAlma(alma) {
    const key = String(alma || '').trim();
    if (!key) return null;
    if (this.manifestCache.has(key)) return this.manifestCache.get(key);

    const manifestUrl = this.applyTemplate(this.templates.nli_manifest_proxy_url, { ALMA: key });
    if (!manifestUrl) return null;

    const response = await fetch(manifestUrl, { cache: 'no-store' });
    if (!response.ok) {
      throw new Error(`NLI manifest request failed (HTTP ${response.status}).`);
    }
    const manifest = await response.json();
    const data = { manifestUrl, manifest };
    this.manifestCache.set(key, data);
    return data;
  }

  findClosestCanvas(canvases, ie) {
    if (!Array.isArray(canvases) || !canvases.length) return null;
    const ieNum = Number(this.normalizeIe(ie));
    if (!Number.isFinite(ieNum)) return canvases[0] || null;

    let best = canvases[0] || null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const canvas of canvases) {
      const canvasId = String(canvas?.['@id'] || '');
      const fl = canvasId.match(/FL(\d{4,})/i)?.[1];
      const flNum = Number(fl);
      if (!Number.isFinite(flNum)) continue;
      const distance = Math.abs(flNum - ieNum);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = canvas;
      }
    }
    return best;
  }

  metadataValue(manifest, label) {
    const items = Array.isArray(manifest?.metadata) ? manifest.metadata : [];
    const found = items.find(item => String(item?.label || '').toLowerCase().includes(String(label).toLowerCase()));
    return found?.value || '';
  }

  async getMetadataForCandidate(candidate) {
    await this.ensureLoaded();
    const cacheKey = this.candidateCacheKey(candidate);
    if (this.metadataCache.has(cacheKey)) return this.metadataCache.get(cacheKey);

    const ie = this.extractIeFromCandidate(candidate);
    const almaFromCandidate = this.extractAlmaFromCandidate(candidate);
    if (!ie && !almaFromCandidate) {
      const result = {
        isGeniza: false,
        reason: 'Candidate does not include recognizable Genizah IE/BIB identifiers.'
      };
      this.metadataCache.set(cacheKey, result);
      this.persistCaches();
      return result;
    }

    const item = ie ? (this.itemsByIe.get(ie) || null) : null;
    if (item) {
      const alma = String(item.alma || almaFromCandidate || '').trim();
      const friedberg = alma ? (this.friedbergByAlma[alma] || null) : null;

      const result = {
        isGeniza: true,
        ie,
        lookupMode: 'local',
        item,
        friedberg,
        viewerUrl: this.applyTemplate(this.templates.nli_viewer_url, { ALMA: alma })
      };
      this.metadataCache.set(cacheKey, result);
      this.persistCaches();
      return result;
    }

    const alma = String(almaFromCandidate || '').trim();
    if (!alma) {
      const result = {
        isGeniza: true,
        ie,
        lookupMode: 'local-miss',
        reason: 'No local metadata found and no BIB/ALMA id was detected for remote lookup.'
      };
      this.metadataCache.set(cacheKey, result);
      this.persistCaches();
      return result;
    }

    const manifestData = await this.fetchManifestByAlma(alma);
    const manifest = manifestData?.manifest;
    const canvases = manifest?.sequences?.[0]?.canvases || [];
    const nearestCanvas = this.findClosestCanvas(canvases, ie);
    const nearestCanvasId = String(nearestCanvas?.['@id'] || '');
    const nearestFlId = nearestCanvasId.split('/').filter(Boolean).pop() || '';
    const imageTemplate = this.templates.iiif_image_url_template;
    const previewImageUrl = nearestFlId ? this.applyTemplate(imageTemplate, { FL_ID: nearestFlId }) : '';
    const friedberg = this.friedbergByAlma[alma] || null;

    const remoteItem = {
      geniza_ie: ie || '',
      alma,
      page: '',
      shelfmark: this.metadataValue(manifest, 'Shelfmark') || friedberg?.shelfmark || '',
      title: manifest?.label || friedberg?.h || friedberg?.d || 'קטע גניזה',
      library: this.metadataValue(manifest, 'Library') || manifest?.attribution?.[0] || '',
      city: this.metadataValue(manifest, 'City') || '',
      has_nli: Boolean(canvases.length),
      has_friedberg: Boolean(friedberg),
      coverage: null
    };

    const result = {
      isGeniza: true,
      ie,
      lookupMode: 'remote-manifest',
      localDataAvailable: this.localDataAvailable,
      item: remoteItem,
      friedberg,
      viewerUrl: this.applyTemplate(this.templates.nli_viewer_url, { ALMA: alma }),
      manifestUrl: manifestData?.manifestUrl || '',
      manifestCanvasCount: canvases.length,
      previewImageUrl
    };
    this.metadataCache.set(cacheKey, result);
    this.persistCaches();
    return result;
  }

  async resolveImageUrl(metadata) {
    if (!metadata?.item) {
      throw new Error('Missing Genizah metadata for image retrieval.');
    }
    await this.ensureLoaded();

    const item = metadata.item;
    const cacheKey = `${metadata.lookupMode || 'unknown'}:${item.geniza_ie || ''}:${item.alma || ''}:${item.page || ''}`;
    if (this.imageUrlCache.has(cacheKey)) return this.imageUrlCache.get(cacheKey);

    if (metadata.lookupMode === 'remote-manifest') {
      const alma = String(item.alma || '').trim();
      const manifestData = await this.fetchManifestByAlma(alma);
      const canvases = manifestData?.manifest?.sequences?.[0]?.canvases || [];
      const canvas = this.findClosestCanvas(canvases, metadata.ie) || canvases[0];
      const canvasId = canvas?.['@id'];
      if (!canvasId) throw new Error('No canvas id found in remote IIIF manifest.');
      const flId = String(canvasId).split('/').filter(Boolean).pop();
      if (!flId) throw new Error('Could not extract FL_ID from remote canvas id.');
      const imageUrl = this.applyTemplate(this.templates.iiif_image_url_template, { FL_ID: flId });
      if (!imageUrl) throw new Error('Image URL template is missing.');
      this.imageUrlCache.set(cacheKey, imageUrl);
      this.persistCaches();
      return imageUrl;
    }

    const alma = String(item.alma || '').trim();
    const pageIndex = Math.max(0, (parseInt(item.page, 10) || 1) - 1);
    const manifestUrl = item?.image_links?.nli_manifest_proxy_url
      || this.applyTemplate(this.templates.nli_manifest_proxy_url, { ALMA: alma });
    if (!manifestUrl) throw new Error('Manifest URL template is missing.');

    const response = await fetch(manifestUrl, { cache: 'no-store' });
    if (!response.ok) {
      throw new Error(`Manifest request failed (HTTP ${response.status}).`);
    }

    const manifest = await response.json();
    const canvases = manifest?.sequences?.[0]?.canvases || [];
    const canvas = canvases[pageIndex] || canvases[0];
    const canvasId = canvas?.['@id'];
    if (!canvasId) throw new Error('No canvas id found in IIIF manifest.');

    const flId = String(canvasId).split('/').filter(Boolean).pop();
    if (!flId) throw new Error('Could not extract FL_ID from canvas id.');

    const template = item?.image_links?.iiif_image_url_template || this.templates.iiif_image_url_template;
    const imageUrl = this.applyTemplate(template, { FL_ID: flId });
    if (!imageUrl) throw new Error('Image URL template is missing.');

    this.imageUrlCache.set(cacheKey, imageUrl);
    this.persistCaches();
    return imageUrl;
  }

  async warmupForCandidates(candidates, onProgress = () => {}) {
    await this.ensureLoaded();
    const unique = [];
    const seen = new Set();
    for (const candidate of (Array.isArray(candidates) ? candidates : [])) {
      if (!candidate || candidate.sourceFamily !== 'geniza') continue;
      const key = this.candidateCacheKey(candidate);
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(candidate);
    }

    const total = unique.length;
    let done = 0;
    if (!total) return { total: 0, done: 0, errors: 0 };

    const concurrency = Math.min(6, Math.max(2, Math.ceil(total / 40)));
    let cursor = 0;
    let errors = 0;

    const worker = async () => {
      while (cursor < total) {
        const index = cursor;
        cursor += 1;
        const candidate = unique[index];
        try {
          const metadata = await this.getMetadataForCandidate(candidate);
          if (metadata?.item?.has_nli) {
            await this.resolveImageUrl(metadata);
          }
        } catch {
          errors += 1;
        }
        done += 1;
        onProgress({ done, total, errors });
      }
    };

    await Promise.all(Array.from({ length: concurrency }, () => worker()));
    return { total, done, errors };
  }

  applyTemplate(template, values) {
    if (!template) return '';
    let result = String(template);
    for (const [key, value] of Object.entries(values || {})) {
      result = result.replaceAll(`{${key}}`, String(value || ''));
    }
    return result;
  }
};
