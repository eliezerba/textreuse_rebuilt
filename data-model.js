window.TR = window.TR || {};

TR.DataModel = class DataModel {
  constructor({ label, records, books, targetBooks = [], datasets = [] }) {
    this.label = label;
    this.records = records;
    this.recordMap = new Map();
    this.candidateMap = new Map();
    const categorySet = new Set();
    let candidateCount = 0;
    let maxScore = 0;
    for (const record of records) {
      this.recordMap.set(record.id, record);
      for (const candidate of record.candidates || []) {
        this.candidateMap.set(candidate.id, candidate);
        candidateCount += 1;
        maxScore = Math.max(maxScore, Number(candidate.score || 0));
        for (const category of candidate.categories || []) categorySet.add(category);
      }
    }
    this.books = books;
    this.bookMap = new Map(books.map(book => [book.slug, book]));
    this.targetBooks = targetBooks;
    this.targetBook = targetBooks.length === 1 ? targetBooks[0] : null;
    this.sourceBookSlugs = new Set(targetBooks.map(book => book.slug));
    this.datasets = datasets;
    this.datasetMap = new Map(datasets.map(dataset => [dataset.id, dataset]));
    this.categories = [...categorySet].sort((a, b) => String(a).localeCompare(String(b), 'he'));
    this.candidateCount = candidateCount;
    this.nonSelfCandidateCount = candidateCount;
    this.maxScore = maxScore;
    this.structuralIssues = this.buildStructuralIssues();
  }

  static async fromRaw(raw, label = 'dataset', onProgress = () => {}, options = {}) {
    const { finite, normalizeText, locationParts, chapterKey } = TR.utils;
    const compactMode = Boolean(options.compact);
    const largeSourceId = String(options.largeSourceId || options.datasetId || '');
    const COMPACT_TEXT_PREVIEW = 420;
    const storedText = value => {
      const text = String(value || '');
      if (!compactMode || text.length <= COMPACT_TEXT_PREVIEW) return text;
      return `${text.slice(0, COMPACT_TEXT_PREVIEW)}…`;
    };
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new Error('מבנה הקובץ אינו אובייקט JSON של קטעים.');
    }

    const entries = Object.entries(raw);
    if (!entries.length) throw new Error('קובץ ה־JSON ריק.');

    const datasetId = String(options.datasetId || `dataset-${Math.random().toString(36).slice(2, 10)}`);
    const dataset = { id: datasetId, label, kind: 'textreuse' };
    const records = [];
    const targetBooks = new Map();
    const normalizeLocationIdentity = value => String(value || '')
      .normalize('NFKD')
      .toLowerCase()
      .replace(/[\s_.,:;\-–—/\\]+/g, '')
      .trim();
    const normalizeLoose = value => String(value || '').toLowerCase().replace(/[\s_\-]+/g, ' ').trim();
    const detectCandidateFamily = (sourceLocation, categories, sourceData = {}) => {
      const list = Array.isArray(categories) ? categories.map(item => String(item || '')) : [];
      const first = normalizeLoose(list[0]);
      const location = String(sourceLocation || '');
      const explicitFamily = normalizeLoose(sourceData.source_family || sourceData.sourceFamily || sourceData.provider || sourceData.source_type || sourceData.sourceType || sourceData.resolver || '');
      const explicitNonSefaria = sourceData.is_sefaria === false || sourceData.isSefaria === false;

      if (explicitFamily.includes('geniza') || first.includes('geniza') || /^geniza_/i.test(location)) {
        const manuscript = list[1] || (location.match(/(BIB_[^_]+)/i)?.[1] || 'GENIZA_MS');
        const fragment = list[2] || (location.match(/(IE\d+)/i)?.[1] || 'UNKNOWN_FRAGMENT');
        return {
          family: 'geniza',
          manuscript,
          fragment,
          bookSlug: manuscript,
          bookTitle: `Geniza · ${manuscript}`
        };
      }

      if (explicitFamily.includes('vrr') || first.includes('vrr milikowsky') || /^vrr_milikowsky_/i.test(location)) {
        const manuscript = list[1] || (location.match(/^VRR_Milikowsky_([^_]+)/i)?.[1] || 'UNKNOWN_MS');
        return {
          family: 'vrr',
          manuscript,
          fragment: '',
          bookSlug: `VRR_Milikowsky_${manuscript}`,
          bookTitle: `VRR Milikowsky · ${manuscript}`
        };
      }

      if (explicitFamily.includes('dts')) {
        return { family: 'dts', manuscript: '', fragment: '', bookSlug: '', bookTitle: '' };
      }
      if (explicitNonSefaria || ['local', 'custom', 'corpus', 'external', 'other'].some(value => explicitFamily.includes(value))) {
        return { family: 'local', manuscript: '', fragment: '', bookSlug: '', bookTitle: '' };
      }
      return {
        family: 'sefariaLike',
        manuscript: '',
        fragment: '',
        bookSlug: '',
        bookTitle: ''
      };
    };

    for (let recordIndex = 0; recordIndex < entries.length; recordIndex += 1) {
      const [rawRecordId, rawRecord] = entries[recordIndex];
      const recordId = `${datasetId}::${rawRecordId}`;
      const rawCandidates = Array.isArray(rawRecord?.candidates) ? rawRecord.candidates : [];
      const rawRecordIdentity = normalizeLocationIdentity(rawRecordId);

      // TEXTREUSE often returns the queried passage as a perfect candidate of
      // itself. We may use that row to recover the book-side categories, but it
      // is never exposed as a candidate and never enters any statistic or view.
      const selfRaw = rawCandidates.find(candidate => {
        const details = candidate?.alignment_details || {};
        const candidateLocation = details.location || candidate.location || '';
        return normalizeLocationIdentity(candidateLocation) === rawRecordIdentity;
      }) || null;
      const bookSeed = selfRaw || rawCandidates.find(candidate => candidate?.alignment_details?.passage_text) || rawCandidates[0] || null;
      const bookSeedDetails = bookSeed?.alignment_details || {};
      const bookCategories = selfRaw && Array.isArray(bookSeedDetails.source_categories)
        ? bookSeedDetails.source_categories
        : [];
      const originalParts = TR.refTemplates?.parseLocation(rawRecordId, bookCategories)
        || locationParts(rawRecordId, bookCategories);
      const originalText = String(
        bookSeedDetails.passage_text
        || rawCandidates.find(candidate => candidate?.alignment_details?.passage_text)?.alignment_details?.passage_text
        || ''
      );
      const storedOriginalText = storedText(originalText);
      const sourceBook = {
        slug: originalParts.bookSlug,
        title: originalParts.bookTitle,
        categories: bookCategories
      };
      targetBooks.set(sourceBook.slug, sourceBook);

      const mappedCandidates = rawCandidates.map((candidate, candidateIndex) => {
        const details = candidate?.alignment_details || {};
        const sourceLocation = details.location || candidate.location || '';
        const categories = Array.isArray(details.source_categories) ? details.source_categories : [];
        const parts = TR.refTemplates?.parseLocation(sourceLocation, categories) || locationParts(sourceLocation, categories);
        const familyInput = compactMode ? {
          source_family: details.source_family ?? candidate.source_family,
          sourceFamily: details.sourceFamily ?? candidate.sourceFamily,
          provider: details.provider ?? candidate.provider,
          source_type: details.source_type ?? candidate.source_type,
          sourceType: details.sourceType ?? candidate.sourceType,
          resolver: details.resolver ?? candidate.resolver,
          is_sefaria: details.is_sefaria ?? candidate.is_sefaria,
          isSefaria: details.isSefaria ?? candidate.isSefaria
        } : { ...candidate, ...details };
        const family = detectCandidateFamily(sourceLocation, categories, familyInput);
        const resolvedBookSlug = family.bookSlug || parts.bookSlug;
        const resolvedBookTitle = family.bookTitle || parts.bookTitle;
        const score = finite(details.score ?? candidate.score);
        const normScore = finite(details.norm_score ?? candidate.norm_score);
        const alignmentScore = finite(details.alignment_score ?? candidate.alignment_score);
        const fullAlignment = Boolean(finite(details.full_alignment_ind ?? candidate.full_alignment_ind));
        const passageText = String(details.passage_text || candidate.passage_text || originalText || '');
        const sourceText = String(details.source_text || candidate.source_text || '');
        const storedPassageText = storedText(passageText);
        const storedSourceText = storedText(sourceText);
        const rawCandidateId = String(candidate.elastic_id || candidateIndex);
        const id = `${datasetId}::${rawRecordId}::${rawCandidateId}`;
        const metadataInput = compactMode ? {
          location: sourceLocation,
          title: details.title ?? candidate.title,
          he_title: details.he_title ?? candidate.he_title,
          categories,
          source_categories: categories,
          versions: details.versions ?? candidate.versions,
          version: details.version ?? candidate.version,
          versionSource: details.versionSource ?? candidate.versionSource,
          version_source: details.version_source ?? candidate.version_source,
          segment: details.segment ?? candidate.segment,
          from_word: details.from_word ?? candidate.from_word,
          to_word: details.to_word ?? candidate.to_word,
          text_length: details.text_length ?? candidate.text_length,
          references: details.references ?? candidate.references,
          source_text: storedSourceText,
          passage_text: storedPassageText,
          dts_resource: details.dts_resource ?? candidate.dts_resource,
          dts_ref: details.dts_ref ?? candidate.dts_ref
        } : { ...candidate, ...details };
        let localMetadata = TR.knowledge?.extractPassageMetadata
          ? TR.knowledge.extractPassageMetadata(metadataInput, {
              location: sourceLocation, label, sourceId: datasetId, refTemplate: parts, fallbackText: storedSourceText
            })
          : null;
        if (compactMode && localMetadata) {
          localMetadata = {
            ...localMetadata,
            analysisText: storedText(localMetadata.analysisText || sourceText),
            originalText: storedText(localMetadata.originalText || sourceText),
            raw: { __largeStoreRef: largeSourceId ? `${largeSourceId}::${rawRecordId}` : '', candidateIndex }
          };
        }
        const resourceId = localMetadata?.resourceId || resolvedBookSlug;
        const passageId = localMetadata?.passageId || parts.address || parts.display || sourceLocation;
        const fullAlignmentModel = compactMode
          ? {
              origin: details.alignment_sequence ? 'alignment_sequence'
                : (details.suspect_matrix || details.source_matrix) ? 'matrix'
                  : (details.seq_source_html || details.seq_passage_html || details.passage_html || details.source_html) ? 'html-inferred' : 'none',
              direct: Boolean(details.alignment_sequence),
              pairs: [], sourceEvidence: [], candidateEvidence: [], synopsisTable: null
            }
          : (TR.utils.normalizedAlignment ? TR.utils.normalizedAlignment(details) : null);
        const alignment = fullAlignmentModel;
        // In large-file mode do not precompute token maps for every candidate.
        // HTML/matrix inference can be expensive (including LCS work) and made
        // streaming slower than ordinary loading. The active candidate is
        // rehydrated from the raw store and aligned lazily on demand.
        const storedDetails = compactMode ? {
          location: sourceLocation,
          source_categories: categories,
          passage_text: compactMode ? '' : passageText,
          source_text: compactMode ? '' : sourceText,
          score,
          norm_score: normScore,
          alignment_score: alignmentScore,
          full_alignment_ind: fullAlignment ? 1 : 0,
          __normalizedAlignment: alignment,
          __largeStoreRef: largeSourceId ? `${largeSourceId}::${rawRecordId}` : ''
        } : details;

        const sameLocation = normalizeLocationIdentity(sourceLocation) === rawRecordIdentity;
        const sameParsedRef = resolvedBookSlug === originalParts.bookSlug
          && normalizeText(parts.display) === normalizeText(originalParts.display);
        const normalizedCandidateText = normalizeText(sourceText);
        const sameText = Boolean(normalizedCandidateText)
          && normalizedCandidateText === normalizeText(passageText || originalText);
        const isSelf = sameLocation || (sameParsedRef && sameText);

        return {
          id,
          rawCandidateId,
          recordId,
          rawRecordId,
          datasetId,
          datasetLabel: label,
          index: candidateIndex,
          raw: compactMode ? { __largeStoreRef: largeSourceId ? `${largeSourceId}::${rawRecordId}` : '', candidateIndex, elastic_id: candidate.elastic_id ?? null } : candidate,
          details: storedDetails,
          sourceLocation,
          categories,
          topCategory: categories[0] || 'לא מזוהה',
          bookSlug: resolvedBookSlug,
          bookTitle: resolvedBookTitle,
          provisionalRef: parts.simpleRef,
          sefariaQuery: parts.searchQuery,
          displayRef: parts.display,
          refTemplate: parts,
          sourceFamily: family.family,
          sourceManuscript: family.manuscript,
          sourceFragment: family.fragment,
          isSefariaLike: family.family === 'sefariaLike',
          resourceId,
          passageId,
          localMetadata,
          provenance: localMetadata?.provenance || [{ sourceId: datasetId, label, kind: 'textreuse' }],
          alignment,
          score,
          normScore,
          alignmentScore,
          fullAlignment,
          isSelf,
          passageText: storedPassageText,
          bookText: storedPassageText,
          sourceText: storedSourceText,
          datasetText: storedSourceText,
          largeSourceId: compactMode ? largeSourceId : '',
          originalHtml: null,
          candidateHtml: null,
          hasDetailedAlignment: Boolean(details.alignment_sequence || details.suspect_matrix || details.source_matrix || details.seq_source_html || details.seq_passage_html || details.synopsis_table),
          searchBlob: normalizeText([
            label, sourceLocation, parts.display, categories.join(' '), storedSourceText, storedPassageText,
            score, normScore, alignmentScore
          ].join(' '))
        };
      });

      const removedSelfCount = mappedCandidates.filter(candidate => candidate.isSelf).length;
      const candidates = mappedCandidates.filter(candidate => !candidate.isSelf);
      candidates.sort((a, b) => b.normScore - a.normScore || b.score - a.score || b.alignmentScore - a.alignmentScore);

      // A book-side passage object is retained solely for metadata resolution.
      // It is deliberately kept outside record.candidates.
      const bookPassageDetails = compactMode ? {
        location: rawRecordId,
        source_categories: bookCategories,
        passage_text: storedOriginalText,
        source_text: storedOriginalText,
        __largeStoreRef: largeSourceId ? `${largeSourceId}::${rawRecordId}` : ''
      } : {
        ...bookSeedDetails,
        location: rawRecordId,
        source_categories: bookCategories,
        passage_text: originalText,
        source_text: originalText
      };
      let bookLocalMetadata = TR.knowledge?.extractPassageMetadata
        ? TR.knowledge.extractPassageMetadata(bookPassageDetails, {
            location: rawRecordId, label, sourceId: datasetId, refTemplate: originalParts, fallbackText: storedOriginalText
          })
        : null;
      if (compactMode && bookLocalMetadata) {
        bookLocalMetadata = {
          ...bookLocalMetadata,
          analysisText: storedText(bookLocalMetadata.analysisText || originalText),
          originalText: storedText(bookLocalMetadata.originalText || originalText),
          raw: { __largeStoreRef: largeSourceId ? `${largeSourceId}::${rawRecordId}` : '' }
        };
      }
      const bookPassage = {
        id: `${recordId}::book-passage`,
        recordId,
        rawRecordId,
        datasetId,
        datasetLabel: label,
        raw: compactMode ? { __largeStoreRef: largeSourceId ? `${largeSourceId}::${rawRecordId}` : '' } : bookSeed,
        details: bookPassageDetails,
        sourceLocation: rawRecordId,
        categories: bookCategories,
        topCategory: bookCategories[0] || 'לא מזוהה',
        bookSlug: originalParts.bookSlug,
        bookTitle: originalParts.bookTitle,
        provisionalRef: originalParts.simpleRef,
        sefariaQuery: originalParts.searchQuery,
        displayRef: originalParts.display,
        refTemplate: originalParts,
        resourceId: bookLocalMetadata?.resourceId || originalParts.bookSlug,
        passageId: bookLocalMetadata?.passageId || originalParts.address || originalParts.display || rawRecordId,
        localMetadata: bookLocalMetadata,
        provenance: bookLocalMetadata?.provenance || [{ sourceId: datasetId, label, kind: 'textreuse' }],
        passageText: storedOriginalText,
        sourceText: storedOriginalText,
        largeSourceId: compactMode ? largeSourceId : '',
        isBookPassage: true,
        isSelf: false
      };

      candidates.forEach(candidate => {
        candidate.relation = {
          type: 'text-reuse',
          source: { resourceId: bookPassage.resourceId, passageId: bookPassage.passageId, location: rawRecordId },
          target: { resourceId: candidate.resourceId, passageId: candidate.passageId, location: candidate.sourceLocation },
          scores: { score: candidate.score, normScore: candidate.normScore, alignmentScore: candidate.alignmentScore, fullAlignment: candidate.fullAlignment },
          alignment: candidate.alignment
        };
      });

      const best = candidates[0] || null;
      records.push({
        id: recordId,
        rawId: rawRecordId,
        index: recordIndex,
        datasetId,
        datasetLabel: label,
        jobId: rawRecord?.job_id ?? null,
        compactMode,
        largeSourceId: compactMode ? largeSourceId : '',
        largeStoreRef: compactMode && largeSourceId ? `${largeSourceId}::${rawRecordId}` : '',
        raw: compactMode ? { __largeStoreRef: largeSourceId ? `${largeSourceId}::${rawRecordId}` : '', job_id: rawRecord?.job_id ?? null } : rawRecord,
        location: rawRecord?.Location || rawRecordId,
        displayRef: originalParts.display,
        refTemplate: originalParts,
        chapter: chapterKey(rawRecordId),
        resourceId: bookPassage.resourceId,
        passageId: bookPassage.passageId,
        localMetadata: bookLocalMetadata,
        provenance: bookPassage.provenance,
        originalText: storedOriginalText,
        analysisText: bookLocalMetadata?.analysisText || storedOriginalText,
        originalSourceText: bookLocalMetadata?.originalText || storedOriginalText,
        bookText: storedOriginalText,
        sourceBook,
        bookPassage,
        candidates,
        removedSelfCount,
        bestCandidate: best,
        bestNormScore: best?.normScore || 0,
        bestScore: best?.score || 0,
        reuseBookCount: new Set(candidates.map(candidate => candidate.bookSlug)).size,
        exactCandidateCount: candidates.filter(candidate => candidate.fullAlignment).length,
        searchBlob: normalizeText([
          label, rawRecordId, originalParts.display, storedOriginalText,
          ...candidates.slice(0, 8).map(candidate => `${candidate.bookTitle} ${candidate.sourceText}`)
        ].join(' '))
      });

      if (recordIndex % 25 === 0 || recordIndex === entries.length - 1) {
        onProgress({ current: recordIndex + 1, total: entries.length });
        if (!compactMode) await TR.utils.nextFrame();
      }
    }

    const targetBookList = [...targetBooks.values()];
    records.sort(TR.DataModel.compareSourceRecords);
    const books = TR.DataModel.aggregateBooks(records);
    return new TR.DataModel({ label, records, books, targetBooks: targetBookList, datasets: [dataset] });
  }

  static fromBatchModels(models, label = 'large dataset', dataset = null) {
    const selected = (models || []).filter(Boolean);
    if (!selected.length) throw new Error('לא נוצרו רשומות מן הקובץ הגדול.');
    const records = [];
    const targetMap = new Map();
    const datasetMap = new Map();
    for (const model of selected) {
      for (const record of model.records || []) records.push(record);
      for (const book of model.targetBooks || []) targetMap.set(book.slug, book);
      for (const item of model.datasets || []) datasetMap.set(item.id, item);
    }
    records.sort(TR.DataModel.compareSourceRecords);
    return new TR.DataModel({
      label,
      records,
      books: TR.DataModel.aggregateBooks(records),
      targetBooks: [...targetMap.values()],
      datasets: dataset ? [dataset] : [...datasetMap.values()]
    });
  }

  static sourceIdentity(record) {
    // Normalize the raw JSON key so records from different datasets for the
    // same source passage always receive the same identity, regardless of how
    // bookCategories were inferred during parsing.
    const raw = String(record?.rawId || record?.location || '');
    return raw.normalize('NFKD').toLowerCase().replace(/[\s_.,:;\-\u2013\u2014/\\]+/g, '');
  }

  static compareSourceRecords(a, b) {
    const bookCompare = String(a?.sourceBook?.slug || '').localeCompare(String(b?.sourceBook?.slug || ''), 'en');
    if (bookCompare) return bookCompare;
    const leftNamed = Array.isArray(a?.refTemplate?.namedPathTitles) ? a.refTemplate.namedPathTitles.join('>') : String(a?.refTemplate?.namedTitle || '');
    const rightNamed = Array.isArray(b?.refTemplate?.namedPathTitles) ? b.refTemplate.namedPathTitles.join('>') : String(b?.refTemplate?.namedTitle || '');
    if (leftNamed !== rightNamed) return Number(a?.index || 0) - Number(b?.index || 0);
    const left = Array.isArray(a?.refTemplate?.addressTokens) ? a.refTemplate.addressTokens : [];
    const right = Array.isArray(b?.refTemplate?.addressTokens) ? b.refTemplate.addressTokens : [];
    const length = Math.max(left.length, right.length);
    const parse = value => {
      const match = String(value || '').match(/^(\d+)([ab])?$/i);
      if (!match) return { number: Number.POSITIVE_INFINITY, suffix: String(value || '') };
      return { number: Number(match[1]), suffix: (match[2] || '').toLowerCase() };
    };
    for (let index = 0; index < length; index += 1) {
      if (index >= left.length) return -1;
      if (index >= right.length) return 1;
      const l = parse(left[index]);
      const r = parse(right[index]);
      if (l.number !== r.number) return l.number - r.number;
      if (l.suffix !== r.suffix) return l.suffix.localeCompare(r.suffix, 'en');
    }
    return Number(a?.index || 0) - Number(b?.index || 0);
  }

  static combine(models, label = '') {
    const selected = (models || []).filter(Boolean);
    if (!selected.length) throw new Error('לא נבחרו מאגרי נתונים.');
    if (selected.length === 1) return selected[0];

    const sourceGroups = new Map();
    for (const model of selected) {
      for (const record of model.records) {
        const key = TR.DataModel.sourceIdentity(record);
        const group = sourceGroups.get(key) || [];
        group.push(record);
        sourceGroups.set(key, group);
      }
    }

    const records = [...sourceGroups.values()].map((group, groupIndex) => {
      const base = group[0];
      const datasetLabels = [...new Set(group.map(record => record.datasetLabel).filter(Boolean))];
      const mergedId = group.length === 1
        ? base.id
        : `source::${base.sourceBook.slug}::${groupIndex}`;
      const candidates = group.flatMap(record => record.candidates
        .filter(candidate => !candidate.isSelf)
        .map(candidate => ({ ...candidate, recordId: mergedId })));
      candidates.sort((a, b) => b.normScore - a.normScore || b.score - a.score || b.alignmentScore - a.alignmentScore);
      const best = candidates[0] || null;
      const bookPassage = base.bookPassage
        ? { ...base.bookPassage, id: `${mergedId}::book-passage`, recordId: mergedId }
        : null;
      const sourceRecordIds = [...new Set(group.map(record => record.id))];
      const mergedLocalMetadata = group.reduce((current, record) =>
        TR.knowledge?.mergePassageMetadata ? TR.knowledge.mergePassageMetadata(current, record.localMetadata) : (current || record.localMetadata), null);
      const provenance = group.flatMap(record => record.provenance || []);
      return {
        ...base,
        id: mergedId,
        index: Math.min(...group.map(record => Number(record.index || 0))),
        datasetId: group.length === 1 ? base.datasetId : 'combined',
        datasetLabel: datasetLabels.length === 1 ? datasetLabels[0] : `${datasetLabels.length} מאגרים`,
        datasetIds: [...new Set(group.map(record => record.datasetId))],
        datasetLabels,
        sourceRecordIds,
        sourceVariants: group.map(record => ({
          id: record.id, datasetId: record.datasetId, datasetLabel: record.datasetLabel, raw: record.raw, localMetadata: record.localMetadata
        })),
        rawRecords: group.map(record => record.raw),
        localMetadata: mergedLocalMetadata,
        provenance,
        analysisText: mergedLocalMetadata?.analysisText || base.analysisText || base.originalText,
        originalSourceText: mergedLocalMetadata?.originalText || base.originalSourceText || base.originalText,
        bookPassage: bookPassage ? {
          ...bookPassage,
          localMetadata: mergedLocalMetadata || bookPassage.localMetadata,
          provenance
        } : null,
        candidates,
        removedSelfCount: group.reduce((sum, record) => sum + Number(record.removedSelfCount || 0), 0),
        bestCandidate: best,
        bestNormScore: best?.normScore || 0,
        bestScore: best?.score || 0,
        reuseBookCount: new Set(candidates.map(candidate => candidate.bookSlug)).size,
        exactCandidateCount: candidates.filter(candidate => candidate.fullAlignment).length,
        searchBlob: TR.utils.normalizeText([
          base.sourceBook?.title, base.rawId, base.displayRef, base.originalText,
          ...datasetLabels,
          ...candidates.slice(0, 12).map(candidate => `${candidate.bookTitle} ${candidate.sourceText}`)
        ].join(' '))
      };
    }).sort(TR.DataModel.compareSourceRecords);
    const targetBookMap = new Map();
    const datasets = [];
    const metadataByBook = new Map();
    for (const model of selected) {
      model.targetBooks.forEach(book => targetBookMap.set(book.slug, book));
      model.datasets.forEach(dataset => {
        if (!datasets.some(item => item.id === dataset.id)) datasets.push(dataset);
      });
      model.books.forEach(book => {
        if (book.metadata || book.metadataStatus !== 'idle') metadataByBook.set(book.slug, book);
      });
    }
    const books = TR.DataModel.aggregateBooks(records, metadataByBook);
    const combinedLabel = label || `${selected.length} מאגרים`;
    return new TR.DataModel({
      label: combinedLabel,
      records,
      books,
      targetBooks: [...targetBookMap.values()],
      datasets
    });
  }

  attachRegistry(registry) {
    this.registry = registry || null;
    if (!registry) return this;
    const resourceByCandidateBook = new Map();
    const resourceBySourceBook = new Map();
    for (const record of this.records) {
      const recordEntry = registry.lookup(record) || registry.lookup(record.bookPassage);
      if (recordEntry) {
        record.localMetadata = TR.knowledge?.mergePassageMetadata
          ? TR.knowledge.mergePassageMetadata(recordEntry, record.localMetadata)
          : recordEntry;
        record.resourceId = record.localMetadata?.resourceId || record.resourceId;
        record.passageId = record.localMetadata?.passageId || record.passageId;
        record.analysisText = record.localMetadata?.analysisText || record.analysisText || record.originalText;
        record.originalSourceText = record.localMetadata?.originalText || record.originalSourceText || record.originalText;
        if (record.sourceBook) {
          record.sourceBook.resourceId = record.resourceId;
          record.sourceBook.localTitle = record.localMetadata?.heTitle || record.localMetadata?.title || '';
        }
        if (record.bookPassage) {
          record.bookPassage.localMetadata = record.localMetadata;
          record.bookPassage.resourceId = record.resourceId;
          record.bookPassage.passageId = record.passageId;
          record.bookPassage.provenance = record.localMetadata?.provenance || record.bookPassage.provenance;
        }
      }
      if (record.sourceBook?.slug && record.localMetadata?.resourceId && !resourceBySourceBook.has(record.sourceBook.slug)) {
        resourceBySourceBook.set(record.sourceBook.slug, record.localMetadata.resourceId);
      }
      for (const candidate of record.candidates) {
        const entry = registry.lookup(candidate);
        if (!entry) continue;
        candidate.localMetadata = TR.knowledge?.mergePassageMetadata
          ? TR.knowledge.mergePassageMetadata(entry, candidate.localMetadata)
          : entry;
        candidate.resourceId = candidate.localMetadata?.resourceId || candidate.resourceId;
        candidate.passageId = candidate.localMetadata?.passageId || candidate.passageId;
        candidate.provenance = candidate.localMetadata?.provenance || candidate.provenance;
        candidate.originalSourceText = candidate.localMetadata?.originalText || candidate.sourceText;
        candidate.analysisText = candidate.localMetadata?.analysisText || candidate.sourceText;
        candidate.localTitle = candidate.localMetadata?.heTitle || candidate.localMetadata?.title || '';
        candidate.localCategories = candidate.localMetadata?.categories || [];
        candidate.resolvedLocalRef = [candidate.localTitle || candidate.resourceId, candidate.passageId].filter(Boolean).join(' ');
        if (candidate.bookSlug && candidate.localMetadata?.resourceId && !resourceByCandidateBook.has(candidate.bookSlug)) {
          resourceByCandidateBook.set(candidate.bookSlug, candidate.localMetadata.resourceId);
        }
        if (candidate.relation) {
          candidate.relation.source = { resourceId: record.resourceId, passageId: record.passageId, location: record.rawId };
          candidate.relation.target = { resourceId: candidate.resourceId, passageId: candidate.passageId, location: candidate.sourceLocation };
        }
      }
    }
    for (const book of this.books) {
      let resource = registry.resources.get(book.slug);
      if (!resource) {
        const resourceId = resourceByCandidateBook.get(book.slug) || resourceBySourceBook.get(book.slug);
        if (resourceId) resource = registry.resources.get(resourceId);
      }
      if (resource) {
        book.localResource = resource;
        book.localTitle = resource.heTitle || resource.title || '';
        book.localCategories = resource.categories || [];
      }
    }
    this.records.sort((a, b) => {
      const aResource = a.localMetadata?.resourceId || a.resourceId || a.sourceBook?.slug || '';
      const bResource = b.localMetadata?.resourceId || b.resourceId || b.sourceBook?.slug || '';
      const resourceCompare = String(aResource).localeCompare(String(bResource), 'en');
      if (resourceCompare) return resourceCompare;
      const aSegment = Number(a.localMetadata?.segment);
      const bSegment = Number(b.localMetadata?.segment);
      if (Number.isFinite(aSegment) && Number.isFinite(bSegment) && aSegment !== bSegment) return aSegment - bSegment;
      return TR.DataModel.compareSourceRecords(a, b);
    });
    return this;
  }

  static aggregateBooks(records, metadataByBook = new Map()) {
    const accumulator = new Map();
    const ensureBook = (slug, title, categories = []) => {
      let book = accumulator.get(slug);
      if (!book) {
        const previous = metadataByBook.get(slug);
        book = {
          slug,
          title,
          categories,
          candidateCount: 0,
          nonSelfCandidateCount: 0,
          recordIds: new Set(),
          sourceRecordIds: new Set(),
          selfCount: 0,
          fullAlignmentCount: 0,
          detailedAlignmentCount: 0,
          scoreSum: 0,
          normSum: 0,
          alignmentSum: 0,
          maxScore: 0,
          maxNormScore: 0,
          maxAlignmentScore: 0,
          metadata: previous?.metadata || null,
          metadataStatus: previous?.metadataStatus || 'idle'
        };
        accumulator.set(slug, book);
      }
      return book;
    };

    for (const record of records) {
      const sourceBook = ensureBook(record.sourceBook.slug, record.sourceBook.title, record.sourceBook.categories);
      sourceBook.sourceRecordIds.add(record.id);
      for (const candidate of record.candidates) {
        const book = ensureBook(candidate.bookSlug, candidate.bookTitle, candidate.categories);
        book.candidateCount += 1;
        book.nonSelfCandidateCount += candidate.isSelf ? 0 : 1;
        book.recordIds.add(record.id);
        book.selfCount += candidate.isSelf ? 1 : 0;
        book.fullAlignmentCount += candidate.fullAlignment && !candidate.isSelf ? 1 : 0;
        book.detailedAlignmentCount += candidate.hasDetailedAlignment ? 1 : 0;
        book.scoreSum += candidate.score;
        book.normSum += candidate.normScore;
        book.alignmentSum += candidate.alignmentScore;
        book.maxScore = Math.max(book.maxScore, candidate.score);
        book.maxNormScore = Math.max(book.maxNormScore, candidate.normScore);
        book.maxAlignmentScore = Math.max(book.maxAlignmentScore, candidate.alignmentScore);
      }
    }

    return [...accumulator.values()].map(book => ({
      ...book,
      recordCount: book.recordIds.size,
      sourceRecordCount: book.sourceRecordIds.size,
      avgScore: book.candidateCount ? book.scoreSum / book.candidateCount : 0,
      avgNormScore: book.candidateCount ? book.normSum / book.candidateCount : 0,
      avgAlignmentScore: book.candidateCount ? book.alignmentSum / book.candidateCount : 0,
      recordIds: [...book.recordIds],
      sourceRecordIds: [...book.sourceRecordIds]
    })).sort((a, b) => b.nonSelfCandidateCount - a.nonSelfCandidateCount || b.recordCount - a.recordCount || b.maxNormScore - a.maxNormScore);
  }

  getRecord(recordId) {
    return this.recordMap.get(recordId) || this.records[0] || null;
  }

  getCandidate(candidateId) {
    return this.candidateMap.get(candidateId) || null;
  }

  getRecordForCandidate(candidateId) {
    const candidate = this.getCandidate(candidateId);
    return candidate ? this.recordMap.get(candidate.recordId) || null : null;
  }

  buildStructuralIssues() {
    const byDataset = new Map();
    const byCode = new Map();
    let total = 0;
    for (const record of this.records) {
      for (const candidate of record.candidates) {
        const issues = candidate.refTemplate?.issues || [];
        if (!issues.length) continue;
        total += issues.length;
        const dataset = byDataset.get(record.datasetId) || { datasetId: record.datasetId, label: record.datasetLabel, candidates: 0, issueCount: 0, codes: new Map() };
        dataset.candidates += 1;
        dataset.issueCount += issues.length;
        for (const issue of issues) {
          dataset.codes.set(issue.code, (dataset.codes.get(issue.code) || 0) + 1);
          byCode.set(issue.code, (byCode.get(issue.code) || 0) + 1);
        }
        byDataset.set(record.datasetId, dataset);
      }
    }
    return {
      total,
      byCode: [...byCode.entries()].map(([code, count]) => ({ code, count })),
      byDataset: [...byDataset.values()].map(item => ({ ...item, codes: [...item.codes.entries()].map(([code, count]) => ({ code, count })) }))
    };
  }

  getSourceRecords() {
    return [...this.records].sort(TR.DataModel.compareSourceRecords);
  }

  getVisibleRecords(filters = {}) {
    const query = TR.utils.normalizeText(filters.query || '');
    const selectedBooks = new Set(filters.bookSlugs || []);
    const selectedCategories = new Set(filters.categories || []);
    const hasCandidateFilters = selectedBooks.size || selectedCategories.size || TR.utils.finite(filters.minNorm) > 0 || TR.utils.finite(filters.minScore) > 0 || Boolean(filters.exactOnly);

    return this.records.filter(record => {
      const candidates = this.getCandidates(record.id, filters);
      if (query && !record.searchBlob.includes(query) && !candidates.length) return false;
      if (hasCandidateFilters && !candidates.length) return false;
      return true;
    });
  }

  getCandidates(recordId, filters = {}) {
    const record = this.getRecord(recordId);
    if (!record) return [];
    const query = TR.utils.normalizeText(filters.query || '');
    const minNorm = TR.utils.finite(filters.minNorm);
    const minScore = TR.utils.finite(filters.minScore);
    const selectedBooks = new Set(filters.bookSlugs || []);
    const selectedCategories = new Set(filters.categories || []);
    const exactOnly = Boolean(filters.exactOnly);
    const sortBy = filters.sortBy || 'normScore';

    const output = record.candidates.filter(candidate => {
      if (candidate.isSelf) return false;
      if (selectedBooks.size && !selectedBooks.has(candidate.bookSlug)) return false;
      if (selectedCategories.size && !candidate.categories.some(category => selectedCategories.has(category))) return false;
      if (minNorm && candidate.normScore < minNorm) return false;
      if (minScore && candidate.score < minScore) return false;
      if (exactOnly && !candidate.fullAlignment) return false;
      if (query && !candidate.searchBlob.includes(query) && !record.searchBlob.includes(query)) return false;
      return true;
    });

    const sorter = {
      normScore: (a, b) => b.normScore - a.normScore || b.score - a.score,
      score: (a, b) => b.score - a.score || b.normScore - a.normScore,
      alignmentScore: (a, b) => b.alignmentScore - a.alignmentScore || b.normScore - a.normScore,
      book: (a, b) => a.bookTitle.localeCompare(b.bookTitle, 'he') || b.normScore - a.normScore
    }[sortBy] || ((a, b) => b.normScore - a.normScore);

    return output.sort(sorter);
  }

  aggregateMatrix({ metric = 'maxNorm', maxBooks = 14, granularity = 'chapter', filters = {} } = {}) {
    const requestedBooks = new Set(filters.bookSlugs || []);
    const books = this.books
      .filter(book => book.nonSelfCandidateCount > 0)
      .filter(book => !requestedBooks.size || requestedBooks.has(book.slug))
      .slice(0, maxBooks)
      .map(book => ({ ...book, title: book.localTitle || book.title, resourceId: book.localResource?.id || book.slug }));
    const bookSet = new Set(books.map(book => book.slug));
    const groups = new Map();
    const multipleDatasets = this.datasets.length > 1;

    for (const record of this.records) {
      const key = granularity === 'segment' ? record.id : `${record.datasetId}::${record.chapter}`;
      const label = granularity === 'segment'
        ? `${multipleDatasets ? `${record.datasetLabel} · ` : ''}${record.displayRef}`
        : `${multipleDatasets ? `${record.datasetLabel} · ` : ''}פרק ${record.chapter}`;
      if (!groups.has(key)) groups.set(key, { key, label, recordIds: [], values: new Map() });
      const group = groups.get(key);
      group.recordIds.push(record.id);

      for (const candidate of this.getCandidates(record.id, filters)) {
        if (candidate.isSelf || !bookSet.has(candidate.bookSlug)) continue;
        const value = group.values.get(candidate.bookSlug) || { count: 0, sumNorm: 0, maxNorm: 0, sumScore: 0, maxScore: 0, exact: 0 };
        value.count += 1;
        value.sumNorm += candidate.normScore;
        value.maxNorm = Math.max(value.maxNorm, candidate.normScore);
        value.sumScore += candidate.score;
        value.maxScore = Math.max(value.maxScore, candidate.score);
        value.exact += candidate.fullAlignment ? 1 : 0;
        group.values.set(candidate.bookSlug, value);
      }
    }

    const rows = [...groups.values()].map(group => ({
      ...group,
      cells: books.map(book => {
        const stats = group.values.get(book.slug) || { count: 0, sumNorm: 0, maxNorm: 0, sumScore: 0, maxScore: 0, exact: 0 };
        let value = 0;
        if (metric === 'count') value = stats.count;
        else if (metric === 'avgNorm') value = stats.count ? stats.sumNorm / stats.count : 0;
        else if (metric === 'maxScore') value = stats.maxScore;
        else if (metric === 'exact') value = stats.exact;
        else value = stats.maxNorm;
        return { book, stats, value };
      })
    }));

    const maxValue = Math.max(0, ...rows.flatMap(row => row.cells.map(cell => cell.value)));
    return { books, rows, maxValue, metric, granularity };
  }

  buildCooccurrenceGraph({ minNorm = 0.2, maxNodes = TR.config.maxNetworkNodes, filters = {} } = {}) {
    const selectedBooks = new Set(filters.bookSlugs || []);
    const nodeBooks = this.books
      .filter(book => book.nonSelfCandidateCount > 0)
      .filter(book => !selectedBooks.size || selectedBooks.has(book.slug))
      .slice(0, maxNodes);
    const allowed = new Set(nodeBooks.map(book => book.slug));
    const edges = new Map();
    const nodeStrength = new Map(nodeBooks.map(book => [book.slug, 0]));

    for (const record of this.records) {
      const bestByBook = new Map();
      const candidates = this.getCandidates(record.id, { ...filters, minNorm: Math.max(minNorm, TR.utils.finite(filters.minNorm)) });
      for (const candidate of candidates) {
        if (candidate.isSelf || !allowed.has(candidate.bookSlug)) continue;
        const previous = bestByBook.get(candidate.bookSlug);
        if (!previous || candidate.normScore > previous.normScore) bestByBook.set(candidate.bookSlug, candidate);
      }
      const present = [...bestByBook.values()];
      for (const candidate of present) nodeStrength.set(candidate.bookSlug, (nodeStrength.get(candidate.bookSlug) || 0) + candidate.normScore);
      for (let i = 0; i < present.length; i += 1) {
        for (let j = i + 1; j < present.length; j += 1) {
          const a = present[i];
          const b = present[j];
          const pair = [a.bookSlug, b.bookSlug].sort();
          const key = pair.join('::');
          const edge = edges.get(key) || { source: pair[0], target: pair[1], count: 0, strength: 0, recordIds: [] };
          edge.count += 1;
          edge.strength += Math.min(a.normScore, b.normScore);
          edge.recordIds.push(record.id);
          edges.set(key, edge);
        }
      }
    }

    const nodes = nodeBooks.map(book => ({
      id: book.slug,
      resourceId: book.localResource?.id || book.slug,
      title: book.localTitle || book.title,
      count: book.recordCount,
      strength: nodeStrength.get(book.slug) || 0,
      color: TR.utils.hashColor(book.slug),
      book
    })).filter(node => node.strength > 0);
    const nodeIds = new Set(nodes.map(node => node.id));
    const edgeList = [...edges.values()]
      .filter(edge => edge.count >= 2 && nodeIds.has(edge.source) && nodeIds.has(edge.target))
      .sort((a, b) => b.count - a.count || b.strength - a.strength)
      .slice(0, 90);
    return { nodes, edges: edgeList };
  }

  buildSourceBookGraph({ minNorm = 0.1, maxNodes = TR.config.maxNetworkNodes, filters = {} } = {}) {
    const nodeMap = new Map();
    const edgeMap = new Map();
    const selectedBooks = new Set(filters.bookSlugs || []);

    const ensureNode = (book, isSource = false) => {
      if (!book || !book.slug) return null;
      let node = nodeMap.get(book.slug);
      if (!node) {
        node = {
          id: book.slug,
          resourceId: book.localResource?.id || book.resourceId || book.slug,
          title: book.localTitle || book.title,
          count: 0,
          strength: 0,
          color: isSource ? '#17212b' : TR.utils.hashColor(book.slug),
          isSource,
          book: this.bookMap.get(book.slug) || null
        };
        nodeMap.set(book.slug, node);
      }
      node.isSource = node.isSource || isSource;
      if (node.isSource) node.color = '#17212b';
      return node;
    };

    for (const record of this.records) {
      const sourceNode = ensureNode({ ...record.sourceBook, title: record.sourceBook.localTitle || record.sourceBook.title, resourceId: record.resourceId }, true);
      sourceNode.count += 1;
      sourceNode.strength += 1;
      const bestByBook = new Map();
      const candidates = this.getCandidates(record.id, { ...filters, minNorm: Math.max(minNorm, TR.utils.finite(filters.minNorm)) });
      for (const candidate of candidates) {
        if (candidate.isSelf) continue;
        if (selectedBooks.size && !selectedBooks.has(candidate.bookSlug)) continue;
        const previous = bestByBook.get(candidate.bookSlug);
        if (!previous || candidate.normScore > previous.normScore) bestByBook.set(candidate.bookSlug, candidate);
      }
      for (const candidate of bestByBook.values()) {
        if (candidate.bookSlug === record.sourceBook.slug) continue;
        const targetBookBase = this.bookMap.get(candidate.bookSlug) || { slug: candidate.bookSlug, title: candidate.bookTitle };
        const targetBook = { ...targetBookBase, title: targetBookBase.localTitle || candidate.localTitle || targetBookBase.title, resourceId: candidate.resourceId || targetBookBase.slug };
        const targetNode = ensureNode(targetBook, false);
        targetNode.count += 1;
        targetNode.strength += candidate.normScore;
        const key = `${record.sourceBook.slug}::${candidate.bookSlug}`;
        const edge = edgeMap.get(key) || { source: record.sourceBook.slug, target: candidate.bookSlug, count: 0, strength: 0, recordIds: [] };
        edge.count += 1;
        edge.strength += candidate.normScore;
        edge.recordIds.push(record.id);
        edgeMap.set(key, edge);
      }
    }

    const edges = [...edgeMap.values()].sort((a, b) => b.count - a.count || b.strength - a.strength);
    const allowedIds = new Set();
    edges.slice(0, Math.max(1, maxNodes * 3)).forEach(edge => { allowedIds.add(edge.source); allowedIds.add(edge.target); });
    this.targetBooks.forEach(book => allowedIds.add(book.slug));
    const nodes = [...nodeMap.values()]
      .filter(node => allowedIds.has(node.id))
      .sort((a, b) => Number(b.isSource) - Number(a.isSource) || b.count - a.count)
      .slice(0, maxNodes);
    const finalIds = new Set(nodes.map(node => node.id));
    return { nodes, edges: edges.filter(edge => finalIds.has(edge.source) && finalIds.has(edge.target)).slice(0, 90) };
  }

  buildSourceToGenizaGraph({ minNorm = 0.1, maxNodes = TR.config.maxNetworkNodes, filters = {} } = {}) {
    const nodeMap = new Map();
    const edgeMap = new Map();

    const ensureNode = (id, title, { isSource = false, book = null } = {}) => {
      if (!id) return null;
      let node = nodeMap.get(id);
      if (!node) {
        node = {
          id,
          title,
          count: 0,
          strength: 0,
          color: isSource ? '#17212b' : TR.utils.hashColor(id),
          isSource,
          book
        };
        nodeMap.set(id, node);
      }
      node.isSource = node.isSource || isSource;
      if (node.isSource) node.color = '#17212b';
      return node;
    };

    for (const record of this.records) {
      const sourceNode = ensureNode(record.sourceBook.slug, record.sourceBook.title, {
        isSource: true,
        book: this.bookMap.get(record.sourceBook.slug) || null
      });
      sourceNode.count += 1;
      sourceNode.strength += 1;

      const bestByManuscript = new Map();
      const candidates = this.getCandidates(record.id, { ...filters, minNorm: Math.max(minNorm, TR.utils.finite(filters.minNorm)) });
      for (const candidate of candidates) {
        if (candidate.isSelf || candidate.sourceFamily !== 'geniza') continue;
        const manuscript = candidate.sourceManuscript || candidate.bookSlug;
        if (!manuscript) continue;
        const previous = bestByManuscript.get(manuscript);
        if (!previous || candidate.normScore > previous.normScore) bestByManuscript.set(manuscript, candidate);
      }

      for (const [manuscript, candidate] of bestByManuscript.entries()) {
        const targetNode = ensureNode(manuscript, `Geniza NLI · ${manuscript}`, {
          isSource: false,
          book: this.bookMap.get(manuscript) || null
        });
        targetNode.count += 1;
        targetNode.strength += candidate.normScore;

        const key = `${record.sourceBook.slug}::${manuscript}`;
        const edge = edgeMap.get(key) || {
          source: record.sourceBook.slug,
          target: manuscript,
          count: 0,
          strength: 0,
          recordIds: []
        };
        edge.count += 1;
        edge.strength += candidate.normScore;
        edge.recordIds.push(record.id);
        edgeMap.set(key, edge);
      }
    }

    const edges = [...edgeMap.values()].sort((a, b) => b.count - a.count || b.strength - a.strength);
    const allowedIds = new Set();
    edges.slice(0, Math.max(1, maxNodes * 3)).forEach(edge => {
      allowedIds.add(edge.source);
      allowedIds.add(edge.target);
    });
    this.targetBooks.forEach(book => allowedIds.add(book.slug));

    const nodes = [...nodeMap.values()]
      .filter(node => allowedIds.has(node.id))
      .sort((a, b) => Number(b.isSource) - Number(a.isSource) || b.count - a.count)
      .slice(0, maxNodes);
    const finalIds = new Set(nodes.map(node => node.id));

    return {
      nodes,
      edges: edges.filter(edge => finalIds.has(edge.source) && finalIds.has(edge.target)).slice(0, 90)
    };
  }

  getScatterPoints({ filters = {}, maxPoints = TR.config.maxScatterPoints } = {}) {
    const points = [];
    let seen = 0;
    for (const record of this.records) {
      for (const candidate of this.getCandidates(record.id, filters)) {
        seen += 1;
        const point = {
          id: `${record.id}::${candidate.id}`,
          record,
          candidate,
          x: candidate.normScore,
          y: candidate.alignmentScore,
          size: Math.max(2, Math.sqrt(Math.max(1, candidate.score)) / 2.8),
          color: TR.utils.hashColor(candidate.bookSlug)
        };
        if (points.length < maxPoints) points.push(point);
        else {
          // Reservoir sampling avoids retaining every point before downsampling.
          const slot = Math.floor(Math.random() * seen);
          if (slot < maxPoints) points[slot] = point;
        }
      }
    }
    points.totalSeen = seen;
    return points;
  }

  getReverseGroups({ mode = 'book', filters = {} } = {}) {
    const groups = new Map();
    for (const record of this.records) {
      for (const candidate of this.getCandidates(record.id, filters)) {
        const descriptor = this.describeReverseGroup(candidate, mode);
        if (!descriptor) continue;
        const existing = groups.get(descriptor.key) || { key: descriptor.key, title: descriptor.title, count: 0, maxNorm: 0 };
        existing.count += 1;
        existing.maxNorm = Math.max(existing.maxNorm, candidate.normScore);
        groups.set(descriptor.key, existing);
      }
    }
    return [...groups.values()].sort((a, b) => b.count - a.count || b.maxNorm - a.maxNorm || a.title.localeCompare(b.title, 'en'));
  }

  describeReverseGroup(candidate, mode = 'book') {
    if (!candidate) return null;
    if (mode === 'genizaAll') {
      if (candidate.sourceFamily === 'geniza') return { key: 'geniza::all', title: 'Geniza (all manuscripts)' };
      return { key: candidate.bookSlug, title: candidate.localTitle || candidate.bookTitle, resourceId: candidate.resourceId || candidate.bookSlug };
    }
    if (mode === 'genizaFragment') {
      if (candidate.sourceFamily === 'geniza') {
        const fragment = candidate.sourceFragment || 'UNKNOWN_FRAGMENT';
        return { key: `geniza-fragment::${fragment}`, title: `Geniza · ${fragment}` };
      }
      return { key: candidate.bookSlug, title: candidate.localTitle || candidate.bookTitle, resourceId: candidate.resourceId || candidate.bookSlug };
    }
    if (mode === 'vrrManuscript') {
      if (candidate.sourceFamily === 'vrr') {
        const manuscript = candidate.sourceManuscript || 'UNKNOWN_MS';
        return { key: `vrr-ms::${manuscript}`, title: `VRR Milikowsky · ${manuscript}` };
      }
      return { key: candidate.bookSlug, title: candidate.localTitle || candidate.bookTitle, resourceId: candidate.resourceId || candidate.bookSlug };
    }
    return { key: candidate.bookSlug, title: candidate.localTitle || candidate.bookTitle, resourceId: candidate.resourceId || candidate.bookSlug };
  }

  getReverseMatches({ mode = 'book', groupKey = '', limit = 30, orderBy = 'source', filters = {} } = {}) {
    const maxRows = TR.utils.clamp(Number(limit) || 30, 3, 120);
    const byRecord = new Map();
    for (const record of this.records) {
      for (const candidate of this.getCandidates(record.id, filters)) {
        const descriptor = this.describeReverseGroup(candidate, mode);
        if (!descriptor || descriptor.key !== groupKey) continue;
        const current = byRecord.get(record.id) || {
          record,
          count: 0,
          bestNorm: 0,
          bestAlignment: 0,
          bestScore: 0
        };
        current.count += 1;
        current.bestNorm = Math.max(current.bestNorm, candidate.normScore);
        current.bestAlignment = Math.max(current.bestAlignment, candidate.alignmentScore);
        current.bestScore = Math.max(current.bestScore, candidate.score);
        byRecord.set(record.id, current);
      }
    }
    const rows = [...byRecord.values()]
      .sort((a, b) => {
        if (orderBy === 'score') {
          return b.bestNorm - a.bestNorm || b.bestAlignment - a.bestAlignment || b.bestScore - a.bestScore;
        }
        return TR.DataModel.compareSourceRecords(a.record, b.record);
      })
      .slice(0, maxRows);

    const chapterGroups = new Map();
    for (const row of rows) {
      const chapterKey = row.record.chapter || row.record.displayRef;
      const chapter = chapterGroups.get(chapterKey) || { key: chapterKey, label: `פרק ${chapterKey}`, recordIds: [], value: 0, count: 0 };
      chapter.recordIds.push(row.record.id);
      chapter.value = Math.max(chapter.value, row.bestNorm);
      chapter.count += row.count;
      chapterGroups.set(chapterKey, chapter);
    }

    const sourceOrder = new Map(this.records.map((record, index) => [record.id, index]));
    const heatRows = [...chapterGroups.values()].map(chapter => ({
      key: chapter.key,
      label: chapter.label,
      recordIds: chapter.recordIds,
      sortIndex: Math.min(...chapter.recordIds.map(recordId => sourceOrder.get(recordId) ?? Number.MAX_SAFE_INTEGER)),
      cells: [{
        book: { slug: groupKey, title: groupKey },
        value: chapter.value,
        stats: {
          count: chapter.count,
          maxNorm: chapter.value,
          exact: 0
        }
      }]
    })).sort((a, b) => {
      if (orderBy === 'score') {
        return b.cells[0].value - a.cells[0].value || b.cells[0].stats.count - a.cells[0].stats.count;
      }
      return a.sortIndex - b.sortIndex;
    })
      .map(({ sortIndex, ...row }) => row);

    return {
      rows,
      heatmap: {
        books: [{ slug: groupKey, title: groupKey }],
        rows: heatRows,
        maxValue: Math.max(0, ...heatRows.map(row => row.cells[0].value)),
        metric: 'maxNorm',
        granularity: 'chapter'
      }
    };
  }

  getCandidatePoolByDiagnosticsMode(mode = 'all') {
    const pool = [];
    for (const record of this.records) {
      for (const candidate of record.candidates) {
        if (mode === 'sefariaOnly' && !candidate.isSefariaLike) continue;
        if (mode === 'nonSefariaOnly' && candidate.isSefariaLike) continue;
        pool.push(candidate);
      }
    }
    return pool;
  }

  toCsv(filters = {}) {
    const rows = [[
      'dataset_file', 'source_resource_id', 'source_passage_id', 'book_location', 'book_ref', 'book_title', 'book_text', 'book_original_text',
      'dataset_resource_id', 'dataset_passage_id', 'dataset_location', 'dataset_book', 'dataset_categories', 'dataset_text', 'dataset_original_text',
      'version', 'version_source', 'from_word', 'to_word', 'alignment_origin', 'job_id', 'candidate_id',
      'score', 'norm_score', 'alignment_score', 'full_alignment'
    ]];
    for (const record of this.getVisibleRecords(filters)) {
      for (const candidate of this.getCandidates(record.id, filters)) {
        const local = candidate.localMetadata || {};
        const sourceLocal = record.localMetadata || {};
        rows.push([
          candidate.datasetLabel || record.datasetLabel,
          sourceLocal.resourceId || record.resourceId || record.sourceBook.slug,
          sourceLocal.passageId || record.passageId || record.rawId,
          record.rawId,
          record.displayRef,
          sourceLocal.heTitle || sourceLocal.title || record.sourceBook.title,
          sourceLocal.analysisText || record.analysisText || record.originalText,
          sourceLocal.originalText || record.originalSourceText || record.originalText,
          local.resourceId || candidate.resourceId || candidate.bookSlug,
          local.passageId || candidate.passageId || candidate.sourceLocation,
          candidate.sourceLocation,
          local.heTitle || local.title || candidate.bookTitle,
          (local.categories?.length ? local.categories : candidate.categories).join(' > '),
          local.analysisText || candidate.analysisText || candidate.sourceText,
          local.originalText || candidate.originalSourceText || candidate.sourceText,
          Array.isArray(local.versions) ? local.versions.join(' | ') : (local.versions || ''),
          local.versionSource || '',
          local.fromWord ?? '',
          local.toWord ?? '',
          candidate.alignment?.origin || '',
          record.jobId ?? '',
          candidate.rawCandidateId || '',
          candidate.score,
          candidate.normScore,
          candidate.alignmentScore,
          candidate.fullAlignment ? 1 : 0
        ]);
      }
    }
    return rows.map(row => row.map(TR.utils.csvEscape).join(',')).join('\r\n');
  }

};
