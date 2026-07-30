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
      metadataCache: 'tr_genizah_metadata_cache_v2',
      imageCache: 'tr_genizah_image_cache_v3'
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

  extractFlFromCandidate(candidate) {
    const location = String(candidate?.sourceLocation || '');
    const fragment = String(candidate?.sourceFragment || '');
    const fromLocation = location.match(/FL(\d{4,})/i)?.[1];
    if (fromLocation) return `FL${fromLocation}`;
    const fromFragment = fragment.match(/FL(\d{4,})/i)?.[1];
    if (fromFragment) return `FL${fromFragment}`;
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

  extractCanvasFlId(canvas) {
    const canvasId = String(canvas?.['@id'] || canvas?.id || '');
    const match = canvasId.match(/(FL\d{4,})$/i) || canvasId.match(/(FL\d{4,})/i);
    return match ? match[1].toUpperCase() : '';
  }

  findBestCanvas(canvases, { ie, flId } = {}) {
    if (!Array.isArray(canvases) || !canvases.length) return null;
    const normalizedFl = String(flId || '').trim().toUpperCase();
    if (normalizedFl) {
      const exact = canvases.find(canvas => this.extractCanvasFlId(canvas) === normalizedFl);
      if (exact) return exact;
      const flDigits = normalizedFl.match(/FL(\d{4,})/)?.[1] || '';
      if (flDigits) {
        const byDigits = canvases.find(canvas => this.extractCanvasFlId(canvas).endsWith(flDigits));
        if (byDigits) return byDigits;
      }
    }
    return this.findClosestCanvas(canvases, ie) || canvases[0] || null;
  }

  imageUrlFromCanvas(canvas) {
    const annotation = canvas?.images?.[0] || canvas?.items?.[0];
    const resource = annotation?.resource || annotation?.body || annotation;
    const directId = String(resource?.['@id'] || resource?.id || '').trim();
    if (directId && /\.(jpe?g|png|webp)(\?|$)/i.test(directId)) return directId;

    const service = resource?.service;
    const serviceObject = Array.isArray(service) ? service[0] : service;
    const serviceId = String(serviceObject?.['@id'] || serviceObject?.id || '').trim();
    if (serviceId) {
      const base = serviceId.replace(/\/+$/, '');
      return `${base}/full/full/0/default.jpg`;
    }

    if (directId) {
      const base = directId.replace(/\/+$/, '');
      if (!/\.(jpe?g|png|webp)(\?|$)/i.test(base)) {
        return `${base}/full/full/0/default.jpg`;
      }
      return base;
    }

    return '';
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

    const flId = this.extractFlFromCandidate(candidate);
    const manifestData = await this.fetchManifestByAlma(alma);
    const manifest = manifestData?.manifest;
    const canvases = manifest?.sequences?.[0]?.canvases || [];
    const nearestCanvas = this.findBestCanvas(canvases, { ie, flId });
    const nearestCanvasId = String(nearestCanvas?.['@id'] || '');
    const nearestFlId = nearestCanvasId.split('/').filter(Boolean).pop() || '';
    const previewImageUrl = this.imageUrlFromCanvas(nearestCanvas) || (nearestFlId
      ? this.applyTemplate(this.templates.iiif_image_url_template, { FL_ID: nearestFlId })
      : '');
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
      flId,
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
      const canvas = this.findBestCanvas(canvases, { ie: metadata.ie, flId: metadata.flId || item.flId }) || canvases[0];
      const canvasId = canvas?.['@id'];
      if (!canvasId) throw new Error('No canvas id found in remote IIIF manifest.');
      const flId = String(canvasId).split('/').filter(Boolean).pop();
      if (!flId) throw new Error('Could not extract FL_ID from remote canvas id.');
      const imageUrl = this.imageUrlFromCanvas(canvas) || this.applyTemplate(this.templates.iiif_image_url_template, { FL_ID: flId });
      if (!imageUrl) throw new Error('Image URL template is missing.');
      this.imageUrlCache.set(cacheKey, imageUrl);
      this.persistCaches();
      return imageUrl;
    }

    const alma = String(item.alma || '').trim();
    const pageIndex = Math.max(0, (parseInt(item.page, 10) || 1) - 1);
    const manifestUrls = this.buildManifestUrlCandidates(alma, item);
    const manifestData = await this.fetchManifestWithFallback(manifestUrls);
    const manifest = manifestData.manifest;
    const canvases = manifest?.sequences?.[0]?.canvases || [];
    const canvas = canvases[pageIndex] || canvases[0];
    const canvasId = canvas?.['@id'];
    if (!canvasId) throw new Error('No canvas id found in IIIF manifest.');

    const flId = String(canvasId).split('/').filter(Boolean).pop();
    if (!flId) throw new Error('Could not extract FL_ID from canvas id.');

    const imageTemplates = this.buildImageTemplateCandidates(item);
    const imageUrl = this.applyTemplate(imageTemplates[0], { FL_ID: flId });
    if (!imageUrl) throw new Error('Image URL template is missing.');

    this.imageUrlCache.set(cacheKey, imageUrl);
    this.persistCaches();
    return imageUrl;
  }

  buildManifestUrlCandidates(alma, item) {
    const urls = [
      this.applyTemplate(this.templates.nli_manifest_proxy_url, { ALMA: alma }),
      item?.image_links?.nli_manifest_proxy_url || ''
    ];
    return Array.from(new Set(urls.map(url => String(url || '').trim()).filter(Boolean)));
  }

  async fetchManifestWithFallback(urls) {
    if (!Array.isArray(urls) || !urls.length) {
      throw new Error('Manifest URL template is missing.');
    }

    let lastError = null;
    for (const url of urls) {
      try {
        const response = await fetch(url, { cache: 'no-store' });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const manifest = await response.json();
        if (!manifest || typeof manifest !== 'object') {
          throw new Error('Invalid JSON payload');
        }
        return { manifest, manifestUrl: url };
      } catch (error) {
        lastError = error;
      }
    }

    const details = lastError?.message ? ` (${lastError.message})` : '';
    throw new Error(`Manifest request failed for all known URLs${details}.`);
  }

  buildImageTemplateCandidates(item) {
    const templates = [
      this.templates.iiif_image_url_template,
      item?.image_links?.iiif_image_url_template || ''
    ];
    return Array.from(new Set(templates.map(template => String(template || '').trim()).filter(Boolean)));
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
