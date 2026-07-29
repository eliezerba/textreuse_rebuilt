window.TR = window.TR || {};

TR.SefariaService = class SefariaService {
  constructor() {
    this.base = TR.config.sefariaBase;
    this.cache = this.loadCache();
    this.inFlight = new Map();
  }

  loadCache() {
    try {
      const parsed = JSON.parse(localStorage.getItem(TR.config.storageKeys.sefariaCache) || '{}');
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }

  saveCache() {
    try {
      const entries = Object.entries(this.cache);
      if (entries.length > 500) {
        entries.sort((a, b) => (b[1]?.cachedAt || 0) - (a[1]?.cachedAt || 0));
        this.cache = Object.fromEntries(entries.slice(0, 500));
      }
      localStorage.setItem(TR.config.storageKeys.sefariaCache, JSON.stringify(this.cache));
    } catch {
      // The viewer remains usable without local storage.
    }
  }

  async cached(key, loader, maxAgeMs = 1000 * 60 * 60 * 24 * 30) {
    const existing = this.cache[key];
    if (existing && Date.now() - existing.cachedAt < maxAgeMs) return existing.value;
    if (this.inFlight.has(key)) return this.inFlight.get(key);
    const promise = Promise.resolve()
      .then(loader)
      .then(value => {
        this.cache[key] = { cachedAt: Date.now(), value };
        this.saveCache();
        return value;
      })
      .finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, promise);
    return promise;
  }

  async getNameCompletions(query, type = 'ref', limit = 20) {
    if (!query) return [];
    const key = `name:${type}:${limit}:${query}`;
    return this.cached(key, async () => {
      const data = await TR.utils.fetchJson(`${this.base}/api/name/${encodeURIComponent(query)}?type=${encodeURIComponent(type)}&limit=${limit}`);
      return Array.isArray(data?.completion_objects) ? data.completion_objects : [];
    });
  }

  async getRawIndex(title) {
    if (!title) throw new Error('חסר שם ספר לבדיקת הסכמה.');
    const key = `raw-index:${title}`;
    return this.cached(key, async () => {
      const data = await TR.utils.fetchJson(`${this.base}/api/v2/raw/index/${encodeURIComponent(title)}`);
      if (!data || data.error) throw new Error(data?.error || `הספר ${title} לא נמצא בספריא.`);
      return data;
    });
  }

  async resolveIndexProfile(book) {
    const title = book?.title || book?.bookTitle || '';
    const key = `index-profile:${title}`;
    return this.cached(key, async () => {
      const attempts = [];
      try {
        const raw = await this.getRawIndex(title);
        return { title: raw.title || title, raw, attempts: [{ value: title, result: 'ok', method: 'index-direct' }] };
      } catch (error) {
        attempts.push({ value: title, result: 'failed', method: 'index-direct', error: error.message });
      }

      const objects = await this.getNameCompletions(title, 'ref', 30).catch(() => []);
      const normalizedTitle = TR.refTemplates.normalize(title);
      const ranked = objects
        .filter(item => item.is_book || item.index || item.book)
        .map(item => {
          const canonical = item.index || item.book || item.ref || item.title;
          let score = TR.refTemplates.tokenSimilarity(canonical, title) * 70;
          if (TR.refTemplates.normalize(canonical) === normalizedTitle) score += 100;
          if (TR.refTemplates.transliterationKey(canonical) === TR.refTemplates.transliterationKey(title)) score += 45;
          if (item.is_book) score += 30;
          if (item.index) score += 10;
          return { item, canonical, score };
        })
        .sort((a, b) => b.score - a.score);

      for (const match of ranked.slice(0, 5)) {
        try {
          const raw = await this.getRawIndex(match.canonical);
          attempts.push({ value: match.canonical, result: 'ok', method: 'index-name' });
          return { title: raw.title || match.canonical, raw, attempts };
        } catch (error) {
          attempts.push({ value: match.canonical, result: 'failed', method: 'index-name', error: error.message });
        }
      }
      throw Object.assign(new Error(`לא נמצאה בספריא סכמת ספר עבור “${title}”.`), { attempts });
    });
  }

  async resolveHierarchy(parsed) {
    if (!parsed) return null;
    const categoryKey = (parsed.categoryPathRaw || []).join('>');
    const key = `hierarchy-v4:${categoryKey}:${parsed.prefix || ''}`;
    return this.cached(key, async () => {
      const candidates = TR.refTemplates.hierarchyCandidates(parsed);
      const attempts = [];
      let best = null;

      for (const candidate of candidates) {
        let profile = null;
        try {
          profile = await this.resolveIndexProfile({ title: candidate.proposedTitle });
        } catch (error) {
          attempts.push({
            method: 'hierarchy-index',
            value: candidate.proposedTitle,
            bookCategoryIndex: candidate.bookCategoryIndex,
            ok: false,
            reason: error.message
          });
          continue;
        }

        const canonicalTitle = profile.title || profile.raw?.title || candidate.proposedTitle;
        const applied = TR.refTemplates.applyHierarchy(parsed, {
          bookCategoryIndex: candidate.bookCategoryIndex,
          canonicalTitle,
          resolution: 'sefaria-hierarchy'
        });
        const rawCategories = profile.raw?.categories || [];
        const categoryScore = TR.refTemplates.categoryPathSimilarity(candidate.ancestors, rawCategories);
        const titleScore = TR.refTemplates.tokenSimilarity(candidate.proposedTitle, canonicalTitle);
        const transliterationBonus = TR.refTemplates.transliterationKey(candidate.proposedTitle)
          === TR.refTemplates.transliterationKey(canonicalTitle) ? 0.12 : 0;
        const schemaMatch = TR.refTemplates.matchSchemaRef(applied, profile.raw);
        const requiresNode = Boolean(applied.namedPathTitles?.length);
        const nodeScore = requiresNode ? Math.min(1, Math.max(0, schemaMatch?.score || 0)) : 1;
        const addressScore = applied.addressTokens?.length ? 1 : 0.45;
        let score = categoryScore * 0.5 + titleScore * 0.16 + nodeScore * 0.24 + addressScore * 0.05 + candidate.localScore * 0.05 + transliterationBonus;

        const normalizedExpected = (candidate.ancestors || []).map(TR.refTemplates.normalize);
        const normalizedActual = rawCategories.map(TR.refTemplates.normalize);
        const exactCategoryPath = normalizedExpected.length === normalizedActual.length
          && normalizedExpected.every((value, index) => value === normalizedActual[index]);
        if (exactCategoryPath) score += 0.2;
        if (requiresNode && !schemaMatch) score -= 0.28;

        const attempt = {
          method: 'hierarchy-index',
          value: candidate.proposedTitle,
          canonicalTitle,
          bookCategoryIndex: candidate.bookCategoryIndex,
          ancestors: candidate.ancestors,
          nodeTitles: applied.namedPathTitles,
          ok: true,
          score,
          categoryScore,
          nodeScore,
          schemaRef: schemaMatch?.ref || ''
        };
        attempts.push(attempt);
        if (!best || score > best.score) {
          best = { score, profile, parsed: applied, candidate, schemaMatch, attempt };
        }
      }

      if (!best || best.score < 0.34) {
        return {
          parsed,
          profile: null,
          score: best?.score || 0,
          confidence: best?.score || 0,
          resolution: 'local-path',
          attempts
        };
      }

      best.parsed.hierarchyConfidence = best.score;
      best.parsed.hierarchyAttempts = attempts;
      return {
        parsed: best.parsed,
        profile: best.profile,
        score: best.score,
        confidence: best.score,
        resolution: 'sefaria-hierarchy',
        schemaMatch: best.schemaMatch,
        attempts
      };
    }, 1000 * 60 * 60 * 24 * 30);
  }

  normalizeAuthors(authors) {
    if (!Array.isArray(authors)) return [];
    return authors.map(author => {
      if (typeof author === 'string') return { en: TR.refTemplates.humanize(author), he: '', slug: author };
      return { en: author?.en || author?.title || '', he: author?.he || author?.heTitle || '', slug: author?.slug || '' };
    }).filter(author => author.en || author.he);
  }

  async getBookMetadata(book) {
    const key = `book-v2:${book.title}`;
    return this.cached(key, async () => {
      const profile = await this.resolveIndexProfile(book);
      const raw = profile.raw || {};
      let legacy = {};
      try {
        legacy = await TR.utils.fetchJson(`${this.base}/api/index/${encodeURIComponent(profile.title)}`);
      } catch {
        legacy = {};
      }
      const authors = this.normalizeAuthors(legacy.authors?.length ? legacy.authors : raw.authors);
      const compDateString = legacy.compDateString?.he || legacy.compDateString?.en || raw.compDateString?.he || raw.compDateString?.en || raw.compDateString || '';
      const compPlace = legacy.compPlaceString?.he || legacy.compPlace || raw.compPlaceString?.he || raw.compPlace || '';
      return {
        title: profile.title,
        heTitle: legacy.heTitle || raw.heTitle || raw.schema?.heTitle || '',
        categories: raw.categories || legacy.categories || book.categories || [],
        heCategories: legacy.heCategories || [],
        authors,
        enShortDesc: legacy.enShortDesc || raw.enShortDesc || '',
        heShortDesc: legacy.heShortDesc || raw.heShortDesc || '',
        enDesc: legacy.enDesc || raw.enDesc || '',
        heDesc: legacy.heDesc || raw.heDesc || '',
        compDate: legacy.compDate || raw.compDate || [],
        compDateString,
        compPlace,
        pubDate: legacy.pubDate || raw.pubDate || [],
        pubDateString: legacy.pubDateString?.he || legacy.pubDateString?.en || raw.pubDateString || '',
        pubPlace: legacy.pubPlaceString?.he || legacy.pubPlace || raw.pubPlace || '',
        era: legacy.era || raw.era || '',
        titleVariants: legacy.titleVariants || [],
        heTitleVariants: legacy.heTitleVariants || [],
        schema: raw.schema || null,
        templateLeaves: TR.refTemplates.flattenSchema(raw),
        profileAttempts: profile.attempts,
        url: `${this.base}/${encodeURIComponent(profile.title).replaceAll('%20', '_')}`
      };
    });
  }

  async hydrateBooks(books, onProgress = () => {}) {
    const queue = [...books];
    let completed = 0;
    const total = queue.length;
    const workers = Array.from({ length: Math.min(TR.config.maxBookMetadataConcurrency, total || 1) }, async () => {
      while (queue.length) {
        const book = queue.shift();
        if (!book) break;
        book.metadataStatus = 'loading';
        try {
          book.metadata = await this.getBookMetadata(book);
          book.metadataStatus = 'ready';
          book.metadataError = '';
        } catch (error) {
          book.metadataStatus = 'error';
          book.metadataError = error.message;
        }
        completed += 1;
        onProgress({ completed, total, book });
      }
    });
    await Promise.all(workers);
  }

  async validateRef(tref) {
    if (!tref) return null;
    const key = `ref-v2:${tref}`;
    return this.cached(key, async () => {
      try {
        const data = await TR.utils.fetchJson(`${this.base}/api/ref/${encodeURIComponent(tref)}`);
        if (data?.is_ref === false || data?.error) return null;
        return data;
      } catch {
        return null;
      }
    });
  }

  scoreCompletion(object, candidate) {
    const normalize = TR.utils.normalizeText;
    let score = 0;
    const index = object.index || object.book || '';
    if (normalize(index) === normalize(candidate.bookTitle)) score += 100;
    if (object.is_segment) score += 25;
    if (object.ref) score += 10;
    const numbers = candidate.refTemplate?.addressTokens || (candidate.sourceLocation.match(/\d+[ab]?/gi) || []);
    const refNumbers = String(object.ref || object.title || '').match(/\d+[ab]?/gi) || [];
    const overlap = numbers.filter(number => refNumbers.includes(number)).length;
    score += overlap * 8;
    const suffixWords = TR.utils.normalizeText(candidate.refTemplate?.namedTitle || '').split(' ').filter(Boolean);
    const objectWords = new Set(normalize(`${object.title || ''} ${object.ref || ''}`).split(' '));
    score += suffixWords.filter(word => objectWords.has(word)).length;
    return score;
  }

  async resolveRef(candidate, { force = false } = {}) {
    const categoryKey = (candidate.categories || []).join('>');
    const cacheKey = `resolved-v5:${candidate.sourceLocation}:${categoryKey}`;
    const loader = async () => {
      const baseParsed = candidate.refTemplate || TR.refTemplates.parseLocation(candidate.sourceLocation, candidate.categories);
      const attempts = [];
      let hierarchy = null;
      try {
        hierarchy = await this.resolveHierarchy(baseParsed);
        for (const attempt of hierarchy?.attempts || []) attempts.push(attempt);
      } catch (error) {
        attempts.push({ method: 'hierarchy-index', value: baseParsed.bookTitle, ok: false, reason: error.message });
      }
      const parsed = hierarchy?.parsed || baseParsed;
      let profile = hierarchy?.profile || null;

      try {
        if (!profile) profile = await this.resolveIndexProfile({ title: parsed.bookTitle });
        const schemaMatch = TR.refTemplates.matchSchemaRef(parsed, profile.raw);
        if (schemaMatch?.ref) {
          const schemaCandidates = schemaMatch.refCandidates?.length
            ? schemaMatch.refCandidates
            : [{ ref: schemaMatch.ref, reason: 'schema-primary' }];
          for (const schemaCandidate of schemaCandidates) {
            const validated = await this.validateRef(schemaCandidate.ref);
            attempts.push({
              method: 'schema-template-v3',
              value: schemaCandidate.ref,
              ok: Boolean(validated),
              score: schemaMatch.score,
              addressResolution: schemaCandidate.reason || ''
            });
            if (validated) {
              const ref = validated.ref || schemaCandidate.ref;
              return {
                ref,
                url: validated.url ? `${this.base}/${validated.url.replace(/^\//, '')}` : this.makeReaderUrl(ref),
                refMeta: validated,
                resolution: 'schema-template',
                attempts,
                problem: null,
                schemaMatch: { ...schemaMatch, selectedRef: schemaCandidate.ref, addressResolution: schemaCandidate.reason || '' },
                parsed,
                hierarchy
              };
            }
          }
        } else {
          attempts.push({ method: 'schema-template-v3', value: parsed.namedTitle || parsed.bookTitle, ok: false, reason: 'node-not-matched' });
        }
      } catch (error) {
        attempts.push({ method: 'schema-template-v3', value: parsed.bookTitle, ok: false, reason: error.message });
      }

      for (const provisional of parsed.refCandidates || []) {
        const validated = await this.validateRef(provisional);
        attempts.push({ method: 'fixed-template-v3', value: provisional, ok: Boolean(validated) });
        if (validated) {
          const ref = validated.ref || provisional;
          return {
            ref,
            url: validated.url ? `${this.base}/${validated.url.replace(/^\//, '')}` : this.makeReaderUrl(ref),
            refMeta: validated,
            resolution: hierarchy?.resolution === 'sefaria-hierarchy' ? 'hierarchy-template' : 'fixed-template',
            attempts,
            problem: null,
            parsed,
            hierarchy
          };
        }
      }

      const query = parsed.searchQuery || candidate.sefariaQuery || candidate.displayRef;
      const completionCandidate = { ...candidate, bookTitle: parsed.bookTitle, refTemplate: parsed };
      const objects = await this.getNameCompletions(query, 'ref', 40).catch(() => []);
      const ranked = objects
        .filter(item => item.ref || item.url)
        .map(item => ({ item, score: this.scoreCompletion(item, completionCandidate) }))
        .sort((a, b) => b.score - a.score);
      for (const rankedItem of ranked.slice(0, 8)) {
        const best = rankedItem.item;
        const ref = best.ref || best.title;
        const refMeta = await this.validateRef(ref);
        attempts.push({ method: 'name-autocomplete', value: ref, ok: Boolean(refMeta), score: rankedItem.score });
        if (refMeta) {
          return {
            ref: refMeta.ref || ref,
            url: best.url ? `${this.base}/${String(best.url).replace(/^\//, '')}` : this.makeReaderUrl(ref),
            refMeta,
            resolution: 'name-autocomplete',
            attempts,
            problem: null,
            parsed,
            hierarchy
          };
        }
      }

      const problem = this.explainResolutionFailure(candidate, parsed, profile, attempts);
      return {
        ref: null,
        url: `${this.base}/search?q=${encodeURIComponent(query)}`,
        refMeta: null,
        resolution: 'unresolved',
        attempts,
        problem,
        parsed,
        hierarchy
      };
    };
    return force ? loader() : this.cached(cacheKey, loader, 1000 * 60 * 60 * 24 * 14);
  }

  explainResolutionFailure(candidate, parsed, profile, attempts) {
    if (!candidate.sourceLocation) return 'חסר location בקובץ ה־JSON.';
    if (!candidate.categories?.length) return 'חסרות source_categories; שם הספר הוסק מן המזהה ולא בהכרח תואם לשם הקנוני בספריא.';
    if (!profile) return `הרכיב “${parsed.bookTitle}” זוהה כחיבור מתוך הנתיב, אך לא נמצא עבורו Index תואם בספריא.`;
    if (parsed.namedTitle && attempts.some(attempt => String(attempt.method).startsWith('schema-template') && !attempt.ok)) {
      return `החיבור זוהה כ־“${parsed.bookTitle}”, אך הנתיב הפנימי “${parsed.namedPathTitles.join(' › ')}” לא הותאם לצומת בסכמת ספריא.`;
    }
    if (!parsed.addressTokens.length) return 'שם החיבור זוהה, אך לא נמצאה כתובת מספרית בנתיב או בסיומת המיקום.';
    return 'המערכת זיהתה את גבול החיבור בתוך ההיררכיה ויצרה תבניות קבועות, אך ספריא לא אישרה אף אחת מהן.';
  }

  makeReaderUrl(ref) {
    const path = String(ref || '').trim().replace(/,\s*/g, ',_').replace(/\s+/g, '_').replace(/:/g, '.');
    return `${this.base}/${encodeURI(path)}`;
  }

  async diagnoseCandidate(candidate) {
    const initialParsed = candidate.refTemplate || TR.refTemplates.parseLocation(candidate.sourceLocation, candidate.categories);
    try {
      const resolved = await this.resolveRef(candidate, { force: true });
      const parsed = resolved.parsed || initialParsed;
      return {
        ok: Boolean(resolved.ref),
        candidate,
        parsed,
        ref: resolved.ref,
        url: resolved.url,
        resolution: resolved.resolution,
        attempts: resolved.attempts || [],
        problem: resolved.problem || '',
        structuralIssues: parsed.issues || []
      };
    } catch (error) {
      return { ok: false, candidate, parsed: initialParsed, ref: null, url: null, resolution: 'network-error', attempts: [], problem: error.message, structuralIssues: initialParsed.issues || [] };
    }
  }

  async getPassageMetadata(candidate) {
    const cacheKey = `passage-v4:${candidate.sourceLocation}:${(candidate.categories || []).join('>')}`;
    return this.cached(cacheKey, async () => {
      const resolved = await this.resolveRef(candidate);
      let textData = null;
      if (resolved.ref) {
        try {
          textData = await TR.utils.fetchJson(`${this.base}/api/v3/texts/${encodeURIComponent(resolved.ref)}?version=source`);
        } catch {
          try {
            textData = await TR.utils.fetchJson(`${this.base}/api/texts/${encodeURIComponent(resolved.ref)}?context=0&commentary=0&stripItags=1`);
          } catch {
            textData = null;
          }
        }
      }

      const versions = Array.isArray(textData?.versions) ? textData.versions : [];
      const version = versions[0] || {};
      const refMeta = resolved.refMeta || {};
      return {
        canonicalRef: textData?.ref || resolved.ref || null,
        heRef: textData?.heRef || '',
        url: resolved.url,
        resolution: resolved.resolution,
        resolutionProblem: resolved.problem || '',
        resolutionAttempts: resolved.attempts || [],
        indexTitle: textData?.indexTitle || textData?.book || resolved.parsed?.bookTitle || candidate.bookTitle,
        heIndexTitle: textData?.heIndexTitle || textData?.heTitle || '',
        categories: textData?.categories || candidate.categories || [],
        sectionNames: textData?.sectionNames || refMeta.section_names || refMeta.sectionNames || [],
        heSectionNames: textData?.heSectionNames || refMeta.he_section_names || refMeta.heSectionNames || [],
        sections: textData?.sections || refMeta.sections || [],
        versionTitle: version.versionTitle || textData?.versionTitle || '',
        versionTitleInHebrew: version.versionTitleInHebrew || '',
        versionSource: version.versionSource || textData?.versionSource || '',
        license: version.license || '',
        language: version.actualLanguage || version.language || textData?.language || '',
        next: textData?.next || refMeta.navigation_refs?.next_segment_ref || '',
        prev: textData?.prev || refMeta.navigation_refs?.prev_segment_ref || ''
      };
    }, 1000 * 60 * 60 * 24 * 14);
  }
};
