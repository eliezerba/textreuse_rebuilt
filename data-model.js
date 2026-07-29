window.TR = window.TR || {};

TR.DataModel = class DataModel {
  constructor({ label, records, books, targetBooks = [], datasets = [] }) {
    this.label = label;
    this.records = records;
    this.recordMap = new Map(records.map(record => [record.id, record]));
    this.candidateMap = new Map(records.flatMap(record => record.candidates.map(candidate => [candidate.id, candidate])));
    this.books = books;
    this.bookMap = new Map(books.map(book => [book.slug, book]));
    this.targetBooks = targetBooks;
    this.targetBook = targetBooks.length === 1 ? targetBooks[0] : null;
    this.sourceBookSlugs = new Set(targetBooks.map(book => book.slug));
    this.datasets = datasets;
    this.datasetMap = new Map(datasets.map(dataset => [dataset.id, dataset]));
    this.categories = [...new Set(
      records.flatMap(record => record.candidates)
.flatMap(candidate => candidate.categories || [])
    )].sort((a, b) => String(a).localeCompare(String(b), 'he'));
    this.candidateCount = records.reduce((sum, record) => sum + record.candidates.length, 0);
    this.nonSelfCandidateCount = this.candidateCount;
    this.maxScore = Math.max(0, ...records.flatMap(record => record.candidates.map(candidate => candidate.score)));
    this.structuralIssues = this.buildStructuralIssues();
  }

  static async fromRaw(raw, label = 'dataset', onProgress = () => {}, options = {}) {
    const { finite, normalizeText, locationParts, chapterKey } = TR.utils;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new Error('מבנה הקובץ אינו אובייקט JSON של קטעים.');
    }

    const entries = Object.entries(raw);
    if (!entries.length) throw new Error('קובץ ה־JSON ריק.');

    const datasetId = String(options.datasetId || `dataset-${Math.random().toString(36).slice(2, 10)}`);
    const dataset = { id: datasetId, label };
    const records = [];
    const targetBooks = new Map();
    const normalizeLocationIdentity = value => String(value || '')
      .normalize('NFKD')
      .toLowerCase()
      .replace(/[\s_.,:;\-–—/\\]+/g, '')
      .trim();
    const normalizeLoose = value => String(value || '').toLowerCase().replace(/[\s_\-]+/g, ' ').trim();
    const detectCandidateFamily = (sourceLocation, categories) => {
      const list = Array.isArray(categories) ? categories.map(item => String(item || '')) : [];
      const first = normalizeLoose(list[0]);
      const location = String(sourceLocation || '');

      if (first.includes('geniza') || /^geniza_/i.test(location)) {
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

      if (first.includes('vrr milikowsky') || /^vrr_milikowsky_/i.test(location)) {
        const manuscript = list[1] || (location.match(/^VRR_Milikowsky_([^_]+)/i)?.[1] || 'UNKNOWN_MS');
        return {
          family: 'vrr',
          manuscript,
          fragment: '',
          bookSlug: `VRR_Milikowsky_${manuscript}`,
          bookTitle: `VRR Milikowsky · ${manuscript}`
        };
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
        const family = detectCandidateFamily(sourceLocation, categories);
        const resolvedBookSlug = family.bookSlug || parts.bookSlug;
        const resolvedBookTitle = family.bookTitle || parts.bookTitle;
        const score = finite(details.score ?? candidate.score);
        const normScore = finite(details.norm_score ?? candidate.norm_score);
        const alignmentScore = finite(details.alignment_score ?? candidate.alignment_score);
        const fullAlignment = Boolean(finite(details.full_alignment_ind ?? candidate.full_alignment_ind));
        const passageText = String(details.passage_text || candidate.passage_text || originalText || '');
        const sourceText = String(details.source_text || candidate.source_text || '');
        const rawCandidateId = String(candidate.elastic_id || candidateIndex);
        const id = `${datasetId}::${rawRecordId}::${rawCandidateId}`;

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
          raw: candidate,
          details,
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
          score,
          normScore,
          alignmentScore,
          fullAlignment,
          isSelf,
          passageText,
          bookText: passageText,
          sourceText,
          datasetText: sourceText,
          originalHtml: null,
          candidateHtml: null,
          hasDetailedAlignment: Boolean(details.seq_source_html || details.seq_passage_html || details.synopsis_table),
          searchBlob: normalizeText([
            label, sourceLocation, parts.display, categories.join(' '), sourceText, passageText,
            score, normScore, alignmentScore
          ].join(' '))
        };
      });

      const removedSelfCount = mappedCandidates.filter(candidate => candidate.isSelf).length;
      const candidates = mappedCandidates.filter(candidate => !candidate.isSelf);
      candidates.sort((a, b) => b.normScore - a.normScore || b.score - a.score || b.alignmentScore - a.alignmentScore);

      // A book-side passage object is retained solely for metadata resolution.
      // It is deliberately kept outside record.candidates.
      const bookPassageDetails = {
        ...bookSeedDetails,
        location: rawRecordId,
        source_categories: bookCategories,
        passage_text: originalText,
        source_text: originalText
      };
      const bookPassage = {
        id: `${recordId}::book-passage`,
        recordId,
        rawRecordId,
        datasetId,
        datasetLabel: label,
        raw: bookSeed,
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
        passageText: originalText,
        sourceText: originalText,
        isBookPassage: true,
        isSelf: false
      };

      const best = candidates[0] || null;
      records.push({
        id: recordId,
        rawId: rawRecordId,
        index: recordIndex,
        datasetId,
        datasetLabel: label,
        jobId: rawRecord?.job_id ?? null,
        raw: rawRecord,
        location: rawRecord?.Location || rawRecordId,
        displayRef: originalParts.display,
        refTemplate: originalParts,
        chapter: chapterKey(rawRecordId),
        originalText,
        bookText: originalText,
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
          label, rawRecordId, originalParts.display, originalText,
          ...candidates.slice(0, 8).map(candidate => `${candidate.bookTitle} ${candidate.sourceText}`)
        ].join(' '))
      });

      if (recordIndex % 25 === 0 || recordIndex === entries.length - 1) {
        onProgress({ current: recordIndex + 1, total: entries.length });
        await TR.utils.nextFrame();
      }
    }

    const targetBookList = [...targetBooks.values()];
    records.sort(TR.DataModel.compareSourceRecords);
    const books = TR.DataModel.aggregateBooks(records);
    return new TR.DataModel({ label, records, books, targetBooks: targetBookList, datasets: [dataset] });
  }

  static sourceIdentity(record) {
    const slug = String(record?.sourceBook?.slug || 'Unknown');
    const template = record?.refTemplate || {};
    const named = Array.isArray(template.namedPathTitles)
      ? template.namedPathTitles.join('>')
      : String(template.namedTitle || '');
    const address = (template.addressTokens || []).join(':')
      || String(template.address || '')
      || String(record?.rawId || record?.location || '');
    return `${slug}::${named}::${address}`;
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
        : `source::${base.sourceBook.slug}::${base.refTemplate?.address || groupIndex}`;
      const candidates = group.flatMap(record => record.candidates
        .filter(candidate => !candidate.isSelf)
        .map(candidate => ({ ...candidate, recordId: mergedId })));
      candidates.sort((a, b) => b.normScore - a.normScore || b.score - a.score || b.alignmentScore - a.alignmentScore);
      const best = candidates[0] || null;
      const bookPassage = base.bookPassage
        ? { ...base.bookPassage, id: `${mergedId}::book-passage`, recordId: mergedId }
        : null;
      return {
        ...base,
        id: mergedId,
        index: Math.min(...group.map(record => Number(record.index || 0))),
        datasetId: group.length === 1 ? base.datasetId : 'combined',
        datasetLabel: datasetLabels.length === 1 ? datasetLabels[0] : `${datasetLabels.length} מאגרים`,
        datasetIds: [...new Set(group.map(record => record.datasetId))],
        datasetLabels,
        bookPassage,
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
      .slice(0, maxBooks);
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
      title: book.title,
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
          title: book.title,
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
      const sourceNode = ensureNode(record.sourceBook, true);
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
        const targetBook = this.bookMap.get(candidate.bookSlug) || { slug: candidate.bookSlug, title: candidate.bookTitle };
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

  getScatterPoints({ filters = {}, maxPoints = TR.config.maxScatterPoints } = {}) {
    const points = [];
    for (const record of this.records) {
      for (const candidate of this.getCandidates(record.id, filters)) {
        points.push({
          id: `${record.id}::${candidate.id}`,
          record,
          candidate,
          x: candidate.normScore,
          y: candidate.alignmentScore,
          size: Math.max(2, Math.sqrt(Math.max(1, candidate.score)) / 2.8),
          color: TR.utils.hashColor(candidate.bookSlug)
        });
      }
    }
    if (points.length <= maxPoints) return points;
    const stride = points.length / maxPoints;
    return Array.from({ length: maxPoints }, (_, index) => points[Math.floor(index * stride)]);
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
      return { key: candidate.bookSlug, title: candidate.bookTitle };
    }
    if (mode === 'genizaFragment') {
      if (candidate.sourceFamily === 'geniza') {
        const fragment = candidate.sourceFragment || 'UNKNOWN_FRAGMENT';
        return { key: `geniza-fragment::${fragment}`, title: `Geniza · ${fragment}` };
      }
      return { key: candidate.bookSlug, title: candidate.bookTitle };
    }
    if (mode === 'vrrManuscript') {
      if (candidate.sourceFamily === 'vrr') {
        const manuscript = candidate.sourceManuscript || 'UNKNOWN_MS';
        return { key: `vrr-ms::${manuscript}`, title: `VRR Milikowsky · ${manuscript}` };
      }
      return { key: candidate.bookSlug, title: candidate.bookTitle };
    }
    return { key: candidate.bookSlug, title: candidate.bookTitle };
  }

  getReverseMatches({ mode = 'book', groupKey = '', limit = 30, filters = {} } = {}) {
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
      .sort((a, b) => b.bestNorm - a.bestNorm || b.bestAlignment - a.bestAlignment || b.bestScore - a.bestScore)
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

    const heatRows = [...chapterGroups.values()].map(chapter => ({
      key: chapter.key,
      label: chapter.label,
      recordIds: chapter.recordIds,
      cells: [{
        book: { slug: groupKey, title: groupKey },
        value: chapter.value,
        stats: {
          count: chapter.count,
          maxNorm: chapter.value,
          exact: 0
        }
      }]
    }));

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
      'dataset_file', 'book_location', 'book_ref', 'book_title', 'book_text',
      'dataset_location', 'dataset_book', 'dataset_categories', 'dataset_text',
      'score', 'norm_score', 'alignment_score', 'full_alignment'
    ]];
    for (const record of this.getVisibleRecords(filters)) {
      for (const candidate of this.getCandidates(record.id, filters)) {
        rows.push([
          record.datasetLabel, record.rawId, record.displayRef, record.sourceBook.title, record.originalText,
          candidate.sourceLocation, candidate.bookTitle, candidate.categories.join(' > '), candidate.sourceText,
          candidate.score, candidate.normScore, candidate.alignmentScore,
          candidate.fullAlignment ? 1 : 0
        ]);
      }
    }
    return rows.map(row => row.map(TR.utils.csvEscape).join(',')).join('\r\n');
  }
};
