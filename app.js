window.TR = window.TR || {};

TR.app = (() => {
  'use strict';

  const state = {
    sources: new Map(),
    activeSourceIds: new Set(),
    pickerSelection: new Set(),
    model: null,
    activeRecordId: null,
    activeCandidateId: null,
    activeView: 'read',
    filters: {
      query: '',
      minNorm: 0,
      minScore: 0,
      exactOnly: false,
      sortBy: 'normScore',
      bookSlugs: [],
      categories: []
    },
    matrix: { metric: 'maxNorm', granularity: 'chapter', books: 14 },
    network: { minNorm: 0.1, mode: 'cooccurrence', selected: null },
    passageMetadata: new Map(),
    metadataRequestId: 0,
    metadataRunId: 0,
    genizahRequestId: 0,
    activeGenizahMetadata: null,
    visibleRecords: [],
    loading: false,
    loadingFallbackTimer: null,
    sourceCounter: 0,
    synopsis: {
      candidatesByRecord: new Map(),
      topCount: 3,
      syncScroll: true,
      columnWidth: 380,
      metadataRunId: 0,
      mode: 'single',
      strategy: 'recommended',
      autoApply: true,
      continuousCount: 8
    },
    diagnostics: {
      running: false,
      results: [],
      samplePerBook: 1,
      mode: 'all'
    },
    reverse: {
      mode: 'book',
      groupKey: '',
      topCount: 30,
      orderBy: 'source',
      sequenceRecordIds: [],
      sequenceIndex: -1,
      sequenceLocked: false
    },
    genizahWarmup: {
      signature: '',
      running: false
    }
  };

  const els = {};
  const sefaria = new TR.SefariaService();
  const genizah = new TR.GenizahService(TR.config.genizah || {});
  const t = (he, en) => (TR.i18n?.t ? TR.i18n.t(he, en) : he);

  function init() {
    if (TR.i18n?.init) TR.i18n.init();
    cacheElements();
    bindEvents();
    restorePreferences();
    syncControlsFromState();
    setView('read');
    discoverAndStart();
  }

  function cacheElements() {
    const ids = [
      'fileInput', 'loadFileBtn', 'datasetName', 'datasetStatus', 'metadataStatus',
      'recordCount', 'candidateCount', 'bookCount', 'emptyState', 'workspace',
      'loadingOverlay', 'loadingTitle', 'loadingProgress', 'loadingDetail', 'searchInput',
      'minNormInput', 'minNormValue', 'minScoreInput', 'minScoreValue', 'exactOnlyInput',
      'sortSelect', 'resetFiltersBtn', 'exportCsvBtn',
      'datasetMultiSelect', 'datasetMultiSummary', 'datasetMultiOptions',
      'bookMultiSelect', 'bookMultiSummary', 'bookMultiOptions',
      'categoryMultiSelect', 'categoryMultiSummary', 'categoryMultiOptions',
      'sourceList', 'sourceListCount', 'sourceRailTitle', 'sourceRailSubtitle', 'sourceTitle', 'sourceRef', 'sourceText', 'candidateTitle',
      'candidateRef', 'candidateText', 'scoreRaw', 'scoreNorm', 'scoreAlignment', 'scoreFull',
      'candidateList', 'candidateListCount', 'prevRecordBtn', 'nextRecordBtn', 'prevCandidateBtn',
      'nextCandidateBtn', 'originalMetadata', 'candidateMetadata', 'alignmentNote', 'matrixMetricSelect',
      'matrixGranularitySelect', 'matrixBooksInput', 'matrixBooksValue', 'heatmapContainer',
      'networkThresholdInput', 'networkThresholdValue', 'networkModeSelect', 'networkSvg', 'networkInspector',
      'scatterSvg', 'scatterCount', 'libraryTableBody', 'bookInspector', 'toast', 'retryMetadataBtn',
      'activeFilterSummary', 'loadingDismissBtn', 'sourceDialog', 'sourcePickerList', 'sourcePickerNote',
      'refreshSourcesBtn', 'selectAllSourcesBtn', 'clearSourceSelectionBtn', 'addLocalFilesBtn',
      'applySourceSelectionBtn', 'closeSourceDialogBtn',
      'genizahImageDialog', 'genizahImageTitle', 'genizahImageStatus', 'genizahImage', 'openGenizahImageExternalLink', 'closeGenizahImageDialogBtn',
      'addActiveCandidateBtn', 'openSynopsisBtn', 'synopsisQuickCount', 'selectedCandidateCount',
      'selectTopCandidatesBtn', 'clearSelectedCandidatesBtn',
      'synopsisTabCount', 'syncSynopsisScrollInput',
      'synopsisColumnWidthInput', 'exportSynopsisBtn', 'synopsisBuilderTitle', 'synopsisSelectionCount',
      'synopsisTopCountInput', 'selectSynopsisTopBtn', 'selectSynopsisVisibleBtn', 'clearSynopsisBtn',
      'synopsisPicker', 'synopsisStageTitle', 'synopsisStageNote', 'synopsisMetadataProgress', 'synopsisGrid',
      'synopsisPrevRecordBtn', 'synopsisNextRecordBtn', 'synopsisRecordSelect', 'synopsisRecordPosition',
      'synopsisStrategySelect', 'applySynopsisStrategyBtn', 'synopsisAutoApplyInput',
      'continuousCountControl', 'continuousPassageCountInput', 'refreshContinuousBtn', 'continuousSynopsis',
      'diagnosticSampleInput', 'runDiagnosticsBtn', 'diagnosticSummary', 'diagnosticTableBody'
      , 'langToggleBtn', 'reverseDatasetModeSelect', 'reverseBookSelect', 'reverseOrderSelect', 'reverseTopInput',
      'reverseRefreshBtn', 'reverseSummary', 'reverseTableBody', 'reverseHeatmapContainer', 'reverseHeatTitle',
      'reverseSequenceInfo', 'reverseOpenSequenceBtn', 'reversePrevSequenceBtn', 'reverseNextSequenceBtn', 'reverseToggleSequenceLockBtn',
      'diagnosticModeSelect', 'scatterInspector'
    ];
    ids.forEach(id => { els[id] = document.getElementById(id); });
    els.tabs = TR.utils.$$('.view-tab');
    els.views = TR.utils.$$('.view-panel');
    els.synopsisModeButtons = TR.utils.$$('[data-synopsis-mode]');
    els.synopsisView = document.querySelector('.synopsis-view');
  }

  function bindEvents() {
    els.langToggleBtn.addEventListener('click', () => {
      if (TR.i18n?.toggle) TR.i18n.toggle();
    });
    document.addEventListener('tr-language-changed', () => {
      renderAll();
    });

    els.loadFileBtn.addEventListener('click', openSourceDialog);
    els.emptyState.addEventListener('click', event => {
      if (event.target.closest('[data-open-sources]')) openSourceDialog();
      if (event.target.closest('[data-open-file]')) els.fileInput.click();
    });
    els.fileInput.addEventListener('change', handleFileSelection);
    els.addLocalFilesBtn.addEventListener('click', () => els.fileInput.click());
    els.refreshSourcesBtn.addEventListener('click', async () => {
      await discoverServerSources();
      renderSourcePicker();
    });
    els.selectAllSourcesBtn.addEventListener('click', () => {
      state.pickerSelection = new Set(state.sources.keys());
      renderSourcePicker();
    });
    els.clearSourceSelectionBtn.addEventListener('click', () => {
      state.pickerSelection.clear();
      renderSourcePicker();
    });
    els.applySourceSelectionBtn.addEventListener('click', () => loadSelectedSources([...state.pickerSelection]));
    els.sourcePickerList.addEventListener('change', event => {
      const checkbox = event.target.closest('input[data-source-id]');
      if (!checkbox) return;
      checkbox.checked ? state.pickerSelection.add(checkbox.dataset.sourceId) : state.pickerSelection.delete(checkbox.dataset.sourceId);
      updatePickerNote();
    });

    els.loadingDismissBtn.addEventListener('click', forceOpenWorkspace);
    window.addEventListener('error', handleStartupError);
    window.addEventListener('unhandledrejection', handleStartupError);

    const debouncedSearch = TR.utils.debounce(() => {
      state.filters.query = els.searchInput.value;
      updateAfterFilters();
    }, 180);
    els.searchInput.addEventListener('input', debouncedSearch);

    els.minNormInput.addEventListener('input', () => {
      state.filters.minNorm = Number(els.minNormInput.value);
      els.minNormValue.textContent = TR.utils.percent(state.filters.minNorm, 0);
      updateAfterFilters();
    });
    els.minScoreInput.addEventListener('input', () => {
      state.filters.minScore = Number(els.minScoreInput.value);
      els.minScoreValue.textContent = TR.utils.compactNumber(state.filters.minScore, 0);
      updateAfterFilters();
    });
    els.exactOnlyInput.addEventListener('change', () => {
      state.filters.exactOnly = els.exactOnlyInput.checked;
      updateAfterFilters();
    });
    els.sortSelect.addEventListener('change', () => {
      state.filters.sortBy = els.sortSelect.value;
      updateAfterFilters(false);
    });

    els.datasetMultiOptions.addEventListener('change', handleDatasetMultiChange);
    els.datasetMultiOptions.addEventListener('click', handleMultiAction);
    els.bookMultiOptions.addEventListener('change', handleBookMultiChange);
    els.bookMultiOptions.addEventListener('click', handleMultiAction);
    els.categoryMultiOptions.addEventListener('change', handleCategoryMultiChange);
    els.categoryMultiOptions.addEventListener('click', handleMultiAction);

    els.resetFiltersBtn.addEventListener('click', resetFilters);
    els.exportCsvBtn.addEventListener('click', exportCsv);
    els.retryMetadataBtn.addEventListener('click', hydrateBookMetadata);
    els.candidateMetadata.addEventListener('click', event => {
      if (event.target.closest('[data-open-genizah-image]')) openGenizahImageDialog();
    });
    if (els.genizahImageDialog) {
      els.genizahImageDialog.addEventListener('close', () => {
        els.genizahImage.removeAttribute('src');
        els.genizahImage.hidden = true;
        els.openGenizahImageExternalLink.hidden = true;
        els.genizahImageStatus.textContent = 'טוען תמונה…';
      });
    }

    els.prevRecordBtn.addEventListener('click', () => stepRecord(-1));
    els.nextRecordBtn.addEventListener('click', () => stepRecord(1));
    els.prevCandidateBtn.addEventListener('click', () => stepCandidate(-1));
    els.nextCandidateBtn.addEventListener('click', () => stepCandidate(1));
    els.addActiveCandidateBtn.addEventListener('click', toggleActiveCandidateInSynopsis);
    els.openSynopsisBtn.addEventListener('click', openCurrentSynopsis);
    els.selectTopCandidatesBtn.addEventListener('click', () => selectTopSynopsisCandidates(state.synopsis.topCount));
    els.clearSelectedCandidatesBtn.addEventListener('click', clearCurrentCandidateSynopsis);
    els.syncSynopsisScrollInput.addEventListener('change', () => { state.synopsis.syncScroll = els.syncSynopsisScrollInput.checked; savePreferences(); });
    els.synopsisColumnWidthInput.addEventListener('input', () => { state.synopsis.columnWidth = Number(els.synopsisColumnWidthInput.value); renderSynopsis(); savePreferences(); });
    els.synopsisTopCountInput.addEventListener('change', () => {
      state.synopsis.topCount = TR.utils.clamp(Number(els.synopsisTopCountInput.value) || 3, 1, 12);
      els.synopsisTopCountInput.value = state.synopsis.topCount;
      if (state.synopsis.autoApply && state.synopsis.strategy !== 'manual') applySynopsisStrategyToCurrent(false);
      renderSynopsis();
      savePreferences();
    });
    els.synopsisPrevRecordBtn.addEventListener('click', () => navigateSynopsisRecord(-1));
    els.synopsisNextRecordBtn.addEventListener('click', () => navigateSynopsisRecord(1));
    els.synopsisRecordSelect.addEventListener('change', () => selectSynopsisRecord(els.synopsisRecordSelect.value));
    els.synopsisStrategySelect.addEventListener('change', () => {
      state.synopsis.strategy = els.synopsisStrategySelect.value;
      if (state.synopsis.autoApply && state.synopsis.strategy !== 'manual') applySynopsisStrategyToCurrent(false);
      renderSynopsis();
      savePreferences();
    });
    els.applySynopsisStrategyBtn.addEventListener('click', () => applySynopsisStrategyToCurrent(true));
    els.synopsisAutoApplyInput.addEventListener('change', () => { state.synopsis.autoApply = els.synopsisAutoApplyInput.checked; savePreferences(); });
    els.continuousPassageCountInput.addEventListener('change', () => {
      state.synopsis.continuousCount = TR.utils.clamp(Number(els.continuousPassageCountInput.value) || 8, 2, 30);
      els.continuousPassageCountInput.value = state.synopsis.continuousCount;
      renderSynopsis();
      savePreferences();
    });
    els.refreshContinuousBtn.addEventListener('click', renderContinuousSynopsis);
    els.synopsisModeButtons.forEach(button => button.addEventListener('click', () => setSynopsisMode(button.dataset.synopsisMode)));
    els.selectSynopsisTopBtn.addEventListener('click', () => applySynopsisStrategyToCurrent(true));
    els.selectSynopsisVisibleBtn.addEventListener('click', selectSynopsisVisible);
    els.clearSynopsisBtn.addEventListener('click', clearSynopsisSelection);
    els.exportSynopsisBtn.addEventListener('click', exportSynopsisHtml);
    els.synopsisPicker.addEventListener('change', handleSynopsisPickerChange);
    els.synopsisGrid.addEventListener('click', handleSynopsisGridClick);
    els.continuousSynopsis.addEventListener('click', handleContinuousSynopsisClick);
    els.runDiagnosticsBtn.addEventListener('click', runDiagnostics);
    els.diagnosticSampleInput.addEventListener('change', () => { state.diagnostics.samplePerBook = TR.utils.clamp(Number(els.diagnosticSampleInput.value) || 1, 1, 5); els.diagnosticSampleInput.value = state.diagnostics.samplePerBook; });
    els.diagnosticModeSelect.addEventListener('change', () => {
      state.diagnostics.mode = els.diagnosticModeSelect.value;
      renderDiagnostics();
      savePreferences();
    });

    els.reverseDatasetModeSelect.addEventListener('change', () => {
      state.reverse.mode = els.reverseDatasetModeSelect.value;
      refreshReverseOptions(true);
      savePreferences();
    });
    els.reverseBookSelect.addEventListener('change', () => {
      state.reverse.groupKey = els.reverseBookSelect.value;
      renderReverse();
      savePreferences();
    });
    els.reverseOrderSelect.addEventListener('change', () => {
      state.reverse.orderBy = els.reverseOrderSelect.value;
      renderReverse();
      savePreferences();
    });
    els.reverseTopInput.addEventListener('change', () => {
      state.reverse.topCount = TR.utils.clamp(Number(els.reverseTopInput.value) || 30, 3, 120);
      els.reverseTopInput.value = String(state.reverse.topCount);
      renderReverse();
      savePreferences();
    });
    els.reverseRefreshBtn.addEventListener('click', () => renderReverse());
    els.reverseOpenSequenceBtn.addEventListener('click', () => openReverseSequenceAt(0));
    els.reversePrevSequenceBtn.addEventListener('click', () => openReverseSequenceAt(state.reverse.sequenceIndex - 1));
    els.reverseNextSequenceBtn.addEventListener('click', () => openReverseSequenceAt(state.reverse.sequenceIndex + 1));
    els.reverseToggleSequenceLockBtn.addEventListener('click', () => {
      state.reverse.sequenceLocked = !state.reverse.sequenceLocked;
      renderReverseSequenceBar();
      savePreferences();
      showToast(state.reverse.sequenceLocked ? 'נעילת רצף הופעלה.' : 'נעילת רצף בוטלה.', 'info');
    });

    els.tabs.forEach(tab => tab.addEventListener('click', () => setView(tab.dataset.view)));

    els.matrixMetricSelect.addEventListener('change', () => {
      state.matrix.metric = els.matrixMetricSelect.value;
      renderMatrix();
    });
    els.matrixGranularitySelect.addEventListener('change', () => {
      state.matrix.granularity = els.matrixGranularitySelect.value;
      renderMatrix();
    });
    els.matrixBooksInput.addEventListener('input', () => {
      state.matrix.books = Number(els.matrixBooksInput.value);
      els.matrixBooksValue.textContent = state.matrix.books;
      renderMatrix();
    });
    els.networkModeSelect.addEventListener('change', () => {
      state.network.mode = els.networkModeSelect.value;
      state.network.selected = null;
      renderNetwork();
    });
    els.networkThresholdInput.addEventListener('input', () => {
      state.network.minNorm = Number(els.networkThresholdInput.value);
      els.networkThresholdValue.textContent = TR.utils.percent(state.network.minNorm, 0);
      renderNetwork();
    });

    window.addEventListener('keydown', handleKeyboard);
    window.addEventListener('resize', TR.utils.debounce(() => {
      if (state.activeView === 'network') renderNetwork();
    }, 200));
    document.addEventListener('click', event => {
      document.querySelectorAll('details.multi-select[open]').forEach(details => {
        if (!details.contains(event.target)) details.removeAttribute('open');
      });
    });
  }

  async function discoverAndStart() {
    setLoading(true, 'מאתר קובצי JSON', 'סורק את תיקיית המערכת…', 8);
    const [serverResult, remoteResult] = await Promise.allSettled([
      discoverServerSources(),
      discoverRemoteSources()
    ]);
    const serverSources = serverResult.status === 'fulfilled' ? serverResult.value : [];
    const remoteSources = remoteResult.status === 'fulfilled' ? remoteResult.value : [];
    const allSources = [...serverSources, ...remoteSources];

    setLoading(false);
    if (allSources.length === 1) {
      state.pickerSelection = new Set([allSources[0].id]);
      await loadSelectedSources([allSources[0].id]);
    } else if (allSources.length > 1) {
      state.pickerSelection = new Set(state.activeSourceIds);
      renderSourcePicker();
      showEmptyState(`נמצאו ${allSources.length} קובצי JSON. בחר קובץ אחד או כמה לטעינה.`);
      openDialogSafely(els.sourceDialog);
    } else {
      try {
        await attemptLegacyDefault();
      } catch {
        showEmptyState('לא נמצאו קובצי JSON באופן אוטומטי. אפשר לבחור כמה קבצים מהמחשב.');
      }
    }
  }

  async function discoverServerSources() {
    const response = await fetch('/api/json-files', { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    const sources = Array.isArray(payload.files) ? payload.files : [];
    for (const item of sources) {
      const id = `server:${item.name}`;
      const existing = state.sources.get(id);
      state.sources.set(id, {
        ...existing,
        id,
        label: item.name,
        origin: 'server',
        url: item.url,
        size: Number(item.size || 0),
        modified: item.modified || null,
        model: existing?.model || null,
        error: null
      });
    }
    return sources.map(item => state.sources.get(`server:${item.name}`));
  }

  async function discoverRemoteSources() {
    const remoteCfg = TR.config.remoteSources || {};
    const endpoint = String(remoteCfg.endpoint || '').trim();
    if (!endpoint) return [];

    const listAction = remoteCfg.listAction || 'list';
    const originLabel = remoteCfg.label || 'Google Drive';
    const listUrl = appendQueryParam(endpoint, 'action', listAction);
    const response = await fetch(listUrl, { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const payload = await response.json();
    const files = Array.isArray(payload.files) ? payload.files : [];
    const mapped = [];
    for (const item of files) {
      const fileId = String(item.id || '').trim();
      const fileName = String(item.name || item.label || '').trim();
      if (!fileId || !fileName) continue;
      const fallbackUrl = appendQueryParam(appendQueryParam(endpoint, 'action', remoteCfg.fileAction || 'file'), 'id', fileId);
      const sourceUrl = String(item.url || item.downloadUrl || fallbackUrl);
      const id = `remote:${fileId}`;
      const existing = state.sources.get(id);
      state.sources.set(id, {
        ...existing,
        id,
        label: fileName,
        origin: 'remote',
        originLabel,
        url: sourceUrl,
        size: Number(item.size || 0),
        modified: item.modified || item.modifiedTime || null,
        model: existing?.model || null,
        error: null
      });
      mapped.push(state.sources.get(id));
    }
    return mapped;
  }

  function appendQueryParam(url, key, value) {
    const separator = url.includes('?') ? '&' : '?';
    return `${url}${separator}${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
  }

  async function attemptLegacyDefault() {
    try {
      const response = await fetch(TR.config.defaultJson, { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const id = `server:${TR.config.defaultJson}`;
      state.sources.set(id, { id, label: TR.config.defaultJson, origin: 'server', url: TR.config.defaultJson, size: 0, model: null, error: null });
      await loadSelectedSources([id]);
    } catch {
      throw new Error('Legacy default JSON not found');
    }
  }

  async function openSourceDialog() {
    await Promise.allSettled([discoverServerSources(), discoverRemoteSources()]);
    state.pickerSelection = new Set(state.activeSourceIds.size ? state.activeSourceIds : []);
    renderSourcePicker();
    openDialogSafely(els.sourceDialog);
  }

  function openDialogSafely(dialogEl) {
    if (!dialogEl) return;
    if (typeof dialogEl.showModal === 'function') {
      if (!dialogEl.open) dialogEl.showModal();
    } else {
      dialogEl.setAttribute('open', '');
    }
  }

  function closeSourceDialog() {
    if (typeof els.sourceDialog.close === 'function' && els.sourceDialog.open) els.sourceDialog.close();
    else els.sourceDialog.removeAttribute('open');
  }

  function renderSourcePicker() {
    const sources = [...state.sources.values()].sort((a, b) => a.label.localeCompare(b.label, 'he'));
    if (!sources.length) {
      els.sourcePickerList.innerHTML = '<div class="empty-list">לא נמצאו קובצי JSON בתיקייה. אפשר להוסיף כמה קבצים מהמחשב.</div>';
      updatePickerNote();
      return;
    }
    els.sourcePickerList.innerHTML = sources.map(source => `
      <label class="source-picker-item ${source.error ? 'has-error' : ''}">
        <input type="checkbox" data-source-id="${TR.utils.escapeHtml(source.id)}" ${state.pickerSelection.has(source.id) ? 'checked' : ''}>
        <span class="source-picker-main">
          <b>${TR.utils.escapeHtml(source.label)}</b>
          <small>${sourceOriginLabel(source)}${source.size ? ` · ${formatBytes(source.size)}` : ''}</small>
          ${source.error ? `<em>${TR.utils.escapeHtml(source.error)}</em>` : ''}
        </span>
        <span class="source-state ${source.model ? 'is-loaded' : ''}">${source.model ? 'נטען' : 'ממתין'}</span>
      </label>`).join('');
    updatePickerNote();
  }

  function sourceOriginLabel(source) {
    if (source.origin === 'server') return 'בתיקיית המערכת';
    if (source.origin === 'remote') return source.originLabel || 'מקור מרוחק';
    return 'קובץ מהמחשב';
  }

  function updatePickerNote() {
    const count = state.pickerSelection.size;
    els.sourcePickerNote.textContent = count ? `נבחרו ${count} קבצים. הם יוצגו יחד ויישארו זמינים לבחירה מרובה בתוך המערכת.` : 'עדיין לא נבחר קובץ.';
    els.applySourceSelectionBtn.disabled = count === 0;
    els.applySourceSelectionBtn.textContent = count > 1 ? `טען ${count} מאגרים יחד` : 'טען את המאגר';
  }

  async function handleFileSelection(event) {
    const files = [...(event.target.files || [])];
    if (!files.length) return;
    const newIds = [];
    for (const file of files) {
      const id = `local:${file.name}:${file.size}:${file.lastModified}:${++state.sourceCounter}`;
      state.sources.set(id, { id, label: file.name, origin: 'local', file, size: file.size, modified: file.lastModified, model: null, error: null });
      newIds.push(id);
    }
    event.target.value = '';
    state.pickerSelection = new Set([...state.activeSourceIds, ...newIds]);
    renderSourcePicker();
    await loadSelectedSources([...state.pickerSelection]);
  }

  async function loadSelectedSources(ids) {
    const requested = ids.map(id => state.sources.get(id)).filter(Boolean);
    if (!requested.length) {
      showToast('יש לבחור לפחות קובץ JSON אחד.', 'error');
      return;
    }

    const successful = [];
    const errors = [];
    setLoading(true, 'טוען מאגרי נתונים', `0 מתוך ${requested.length}`, 5);
    for (let index = 0; index < requested.length; index += 1) {
      const source = requested[index];
      try {
        if (!source.model) await loadSourceModel(source, index, requested.length);
        source.error = null;
        successful.push(source);
      } catch (error) {
        source.error = error.message;
        errors.push(`${source.label}: ${error.message}`);
      }
    }

    if (!successful.length) {
      setLoading(false);
      renderSourcePicker();
      showToast(`לא ניתן היה לטעון את הקבצים: ${errors.join(' | ')}`, 'error');
      return;
    }

    state.activeSourceIds = new Set(successful.map(source => source.id));
    rebuildCombinedModel();
    closeSourceDialog();
    setLoading(true, 'מציג את המערכת', 'הנתונים מוכנים', 97);
    showWorkspace();
    setLoading(false);
    await new Promise(resolve => setTimeout(resolve, 0));
    renderAll();
    if (errors.length) showToast(`חלק מהקבצים לא נטענו: ${errors.join(' | ')}`, 'error');
    else showToast(successful.length > 1 ? `${successful.length} מאגרים נטענו יחד.` : `${successful[0].label} נטען.`, 'success');

    if (new URLSearchParams(window.location.search).get('metadata') === '0') {
      els.metadataStatus.textContent = 'מטא־דאטה מושבת בבדיקה';
    } else {
      setTimeout(() => hydrateBookMetadata(), 350);
    }
  }

  async function loadSourceModel(source, fileIndex, totalFiles) {
    const fileBase = (fileIndex / totalFiles) * 88;
    const fileShare = 88 / totalFiles;
    setLoading(true, 'קורא קובץ JSON', `${source.label} · ${fileIndex + 1} מתוך ${totalFiles}`, 6 + fileBase);
    const text = source.origin === 'local'
      ? await source.file.text()
      : await fetchSourceText(source.url);
    await TR.utils.nextFrame();
    let raw;
    try { raw = JSON.parse(text); }
    catch (error) { throw new Error(`JSON לא תקין (${error.message})`); }
    source.model = await TR.DataModel.fromRaw(raw, source.label, progress => {
      const ratio = progress.total ? progress.current / progress.total : 0;
      setLoading(true, 'בונה מודל נתונים', `${source.label}: ${progress.current} מתוך ${progress.total} קטעים`, 6 + fileBase + ratio * fileShare);
    }, { datasetId: source.id });
  }

  async function fetchSourceText(url) {
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.text();
  }

  function rebuildCombinedModel() {
    const models = [...state.activeSourceIds].map(id => state.sources.get(id)?.model).filter(Boolean);
    const labels = [...state.activeSourceIds].map(id => state.sources.get(id)?.label).filter(Boolean);
    state.model = TR.DataModel.combine(models, labels.length === 1 ? labels[0] : `${labels.length} מאגרים`);
    state.activeRecordId = state.model.records[0]?.id || null;
    state.activeCandidateId = null;
    state.passageMetadata.clear();
    state.network.selected = null;
    state.reverse.sequenceRecordIds = [];
    state.reverse.sequenceIndex = -1;
    state.reverse.sequenceLocked = false;
    cleanupSynopsisSelections();
    state.diagnostics.results = [];
    state.activeView = 'read';
    configureDatasetControls();
    refreshReverseOptions(true);
    syncControlsFromState();
    setView('read');
    scheduleGenizahWarmup();
  }

  function scheduleGenizahWarmup() {
    if (!state.model) return;
    const signature = [...state.activeSourceIds].sort().join('|');
    if (!signature || state.genizahWarmup.running || state.genizahWarmup.signature === signature) return;
    state.genizahWarmup.running = true;
    state.genizahWarmup.signature = signature;

    const candidates = state.model.records.flatMap(record => record.candidates).filter(candidate => candidate.sourceFamily === 'geniza');
    const uniqueCount = new Set(candidates.map(candidate => candidate.sourceLocation)).size;
    if (!uniqueCount) {
      state.genizahWarmup.running = false;
      return;
    }

    showToast(`מכין cache גניזה ברקע (${uniqueCount} הפניות)…`, 'info');
    setTimeout(async () => {
      try {
        const result = await genizah.warmupForCandidates(candidates);
        showToast(`cache גניזה מוכן: ${result.done}/${result.total}${result.errors ? ` · שגיאות: ${result.errors}` : ''}`, result.errors ? 'info' : 'success');
      } catch (error) {
        showToast(`warmup גניזה נכשל: ${error.message}`, 'error');
      } finally {
        state.genizahWarmup.running = false;
      }
    }, 80);
  }

  function configureDatasetControls() {
    const model = state.model;
    if (!model) return;
    const activeLabels = [...state.activeSourceIds].map(id => state.sources.get(id)?.label).filter(Boolean);
    els.datasetName.textContent = activeLabels.length === 1 ? activeLabels[0] : `${activeLabels.length} מאגרים`;
    els.datasetName.title = activeLabels.join('\n');
    els.datasetStatus.textContent = activeLabels.length > 1 ? 'תצוגה משולבת' : 'הדאטה נטען';
    els.recordCount.textContent = TR.utils.compactNumber(model.records.length, 0);
    els.candidateCount.textContent = TR.utils.compactNumber(model.candidateCount, 0);
    els.bookCount.textContent = TR.utils.compactNumber(model.books.filter(book => book.nonSelfCandidateCount > 0).length, 0);
    els.minScoreInput.max = String(Math.max(100, Math.ceil(model.maxScore)));
    els.minScoreInput.value = String(Math.min(state.filters.minScore, model.maxScore));
    state.filters.minScore = Number(els.minScoreInput.value);

    const validBooks = new Set(model.books.filter(book => book.nonSelfCandidateCount > 0).map(book => book.slug));
    state.filters.bookSlugs = state.filters.bookSlugs.filter(slug => validBooks.has(slug));
    const validCategories = new Set(model.categories);
    state.filters.categories = state.filters.categories.filter(category => validCategories.has(category));
    renderDatasetMultiOptions();
    renderBookMultiOptions();
    renderCategoryMultiOptions();
    refreshReverseOptions(false);
  }

  function refreshReverseOptions(resetSelection = false) {
    if (!state.model) return;
    const groups = state.model.getReverseGroups({ mode: state.reverse.mode, filters: state.filters });
    if (resetSelection || !groups.some(group => group.key === state.reverse.groupKey)) {
      state.reverse.groupKey = groups[0]?.key || '';
    }
    els.reverseBookSelect.innerHTML = groups.length
      ? groups.map(group => `<option value="${TR.utils.escapeHtml(group.key)}" ${group.key === state.reverse.groupKey ? 'selected' : ''}>${TR.utils.escapeHtml(group.title)} (${group.count})</option>`).join('')
      : `<option value="">${TR.utils.escapeHtml(t('אין נתונים זמינים', 'No data available'))}</option>`;
  }

  function renderDatasetMultiOptions() {
    const loaded = [...state.sources.values()].filter(source => source.model).sort((a, b) => a.label.localeCompare(b.label, 'he'));
    els.datasetMultiOptions.innerHTML = multiMenuHtml(
      loaded.map(source => ({ value: source.id, label: source.label, note: `${source.model.records.length} קטעים` })),
      state.activeSourceIds,
      'dataset'
    );
    updateDatasetSummary();
  }

  function renderBookMultiOptions() {
    if (!state.model) return;
    const books = state.model.books.filter(book => book.nonSelfCandidateCount > 0);
    els.bookMultiOptions.innerHTML = multiMenuHtml(
      books.map(book => ({ value: book.slug, label: book.title, note: `${book.recordCount} קטעים` })),
      new Set(state.filters.bookSlugs),
      'book'
    );
    updateBookSummary();
  }

  function renderCategoryMultiOptions() {
    if (!state.model) return;
    els.categoryMultiOptions.innerHTML = multiMenuHtml(
      state.model.categories.map(category => ({ value: category, label: category })),
      new Set(state.filters.categories),
      'category'
    );
    updateCategorySummary();
  }

  function multiMenuHtml(items, selected, kind) {
    if (!items.length) return '<div class="empty-list compact-empty">אין אפשרויות</div>';
    return `
      <div class="multi-select-actions">
        <button type="button" data-multi-action="all" data-multi-kind="${kind}">בחר הכול</button>
        <button type="button" data-multi-action="clear" data-multi-kind="${kind}">נקה</button>
      </div>
      <div class="multi-select-options">
        ${items.map(item => `
          <label>
            <input type="checkbox" data-multi-kind="${kind}" value="${TR.utils.escapeHtml(item.value)}" ${selected.has(item.value) ? 'checked' : ''}>
            <span>${TR.utils.escapeHtml(item.label)}${item.note ? `<small>${TR.utils.escapeHtml(item.note)}</small>` : ''}</span>
          </label>`).join('')}
      </div>`;
  }

  function handleMultiAction(event) {
    const button = event.target.closest('[data-multi-action]');
    if (!button) return;
    event.preventDefault();
    const kind = button.dataset.multiKind;
    const selectAll = button.dataset.multiAction === 'all';
    const container = kind === 'dataset' ? els.datasetMultiOptions : kind === 'book' ? els.bookMultiOptions : els.categoryMultiOptions;
    TR.utils.$$('input[type="checkbox"]', container).forEach(input => { input.checked = selectAll; });
    if (kind === 'dataset') applyDatasetChecks();
    if (kind === 'book') applyBookChecks();
    if (kind === 'category') applyCategoryChecks();
  }

  function handleDatasetMultiChange(event) {
    if (event.target.matches('input[data-multi-kind="dataset"]')) applyDatasetChecks();
  }

  function handleBookMultiChange(event) {
    if (event.target.matches('input[data-multi-kind="book"]')) applyBookChecks();
  }

  function handleCategoryMultiChange(event) {
    if (event.target.matches('input[data-multi-kind="category"]')) applyCategoryChecks();
  }

  function applyDatasetChecks() {
    const selected = checkedValues(els.datasetMultiOptions, 'dataset');
    if (!selected.length) {
      showToast('לפחות מאגר אחד חייב להישאר פעיל.', 'error');
      renderDatasetMultiOptions();
      return;
    }
    state.activeSourceIds = new Set(selected);
    rebuildCombinedModel();
    showWorkspace();
    renderAll();
    setTimeout(() => hydrateBookMetadata(), 200);
  }

  function applyBookChecks() {
    state.filters.bookSlugs = checkedValues(els.bookMultiOptions, 'book');
    updateBookSummary();
    updateAfterFilters();
  }

  function applyCategoryChecks() {
    state.filters.categories = checkedValues(els.categoryMultiOptions, 'category');
    updateCategorySummary();
    updateAfterFilters();
  }

  function checkedValues(container, kind) {
    return TR.utils.$$(`input[data-multi-kind="${kind}"]:checked`, container).map(input => input.value);
  }

  function updateDatasetSummary() {
    const labels = [...state.activeSourceIds].map(id => state.sources.get(id)?.label).filter(Boolean);
    els.datasetMultiSummary.textContent = summarizeSelection(labels, 'כל המאגרים שנטענו');
    els.datasetMultiSummary.title = labels.join('\n');
  }

  function updateBookSummary() {
    const labels = state.filters.bookSlugs.map(slug => state.model?.bookMap.get(slug)?.title || slug);
    els.bookMultiSummary.textContent = summarizeSelection(labels, 'כל הספרים');
    els.bookMultiSummary.title = labels.join('\n');
  }

  function updateCategorySummary() {
    els.categoryMultiSummary.textContent = summarizeSelection(state.filters.categories, 'כל הקטגוריות');
    els.categoryMultiSummary.title = state.filters.categories.join('\n');
  }

  function summarizeSelection(labels, emptyLabel) {
    if (!labels.length) return emptyLabel;
    if (labels.length === 1) return labels[0];
    return `${labels.length} נבחרו`;
  }

  function chooseDefaultCandidate(record) {
    if (!record) return null;
    const visible = state.model?.getCandidates(record.id, state.filters) || [];
    return visible[0] || record.candidates.find(candidate => !candidate.isSelf) || record.candidates[0] || null;
  }

  function renderAll() {
    if (!state.model) return;
    renderStatus();
    refreshReverseOptions(false);
    ensureActiveSelections();
    renderSourceList();
    renderComparison();
    renderCandidateList();
    if (state.activeView === 'library') renderLibrary();
    renderSynopsisIndicators();
    renderActiveVisualization();
    savePreferences();
  }

  function renderStatus() {
    const model = state.model;
    state.visibleRecords = model.getSourceRecords();
    const visibleCandidates = state.visibleRecords.reduce((sum, record) => sum + model.getCandidates(record.id, state.filters).length, 0);
    els.sourceListCount.textContent = `${state.visibleRecords.length} קטעים`;
    els.candidateListCount.textContent = `${model.getCandidates(state.activeRecordId, state.filters).length} קטעים`;
    const activeParts = [];
    if (state.filters.bookSlugs.length) activeParts.push(`${state.filters.bookSlugs.length} ספרים`);
    if (state.filters.categories.length) activeParts.push(`${state.filters.categories.length} קטגוריות`);
    if (state.filters.minNorm > 0) activeParts.push(`ציון מנורמל ≥ ${TR.utils.percent(state.filters.minNorm, 0)}`);
    if (state.filters.minScore > 0) activeParts.push(`score ≥ ${TR.utils.compactNumber(state.filters.minScore, 0)}`);
    if (state.filters.exactOnly) activeParts.push('התאמות מלאות');
    if (state.filters.query) activeParts.push(`חיפוש: “${state.filters.query}”`);
    const datasetText = model.datasets.length > 1 ? `${model.datasets.length} מאגרים · ` : '';
    els.activeFilterSummary.textContent = activeParts.length
      ? `${datasetText}${visibleCandidates} קטעי דאטהסט · ${activeParts.join(' · ')}`
      : `${datasetText}${visibleCandidates} קטעי דאטהסט להשוואה`;
  }

  function sourceBookMetadata(record) {
    return state.model?.bookMap.get(record?.sourceBook?.slug)?.metadata || null;
  }

  function sourceBookTitle(record) {
    const metadata = sourceBookMetadata(record);
    return record?.resolvedSourceTitle
      || metadata?.heTitle
      || metadata?.title
      || record?.sourceBook?.title
      || 'ספר המקור';
  }

  function sourceAddress(record) {
    const template = record?.refTemplate || {};
    const named = Array.isArray(template.namedPathTitles) && template.namedPathTitles.length
      ? template.namedPathTitles.join(', ')
      : String(template.namedTitle || '').trim();
    const address = String(template.address || '').trim();
    return [named, address].filter(Boolean).join(' ');
  }

  function sourceRailItemRef(record) {
    const section = sourceAddress(record);
    if (section) return section;
    return record?.resolvedSourceRef || record?.displayRef || record?.rawId || '';
  }

  function sourceCanonicalRef(record) {
    if (!record) return '';
    if (record.resolvedSourceRef) return record.resolvedSourceRef;
    const title = sourceBookTitle(record);
    const address = sourceAddress(record);
    return address ? `${title} ${address}` : title;
  }

  function renderSourceRailHeader() {
    const record = activeRecord() || state.visibleRecords[0] || state.model?.records[0];
    const title = sourceBookTitle(record);
    els.sourceRailTitle.textContent = title;
    const sourceBookCount = new Set(state.visibleRecords.map(item => item.sourceBook?.slug).filter(Boolean)).size;
    els.sourceRailSubtitle.textContent = sourceBookCount > 1
      ? `קטעי ${sourceBookCount} ספרי מקור, מקובצים לפי ספר ובסדר המקור`
      : 'קטעי ספר המקור לפי סדרם בספר';
  }

  function renderSourceList() {
    renderSourceRailHeader();
    const fragment = document.createDocumentFragment();
    if (!state.visibleRecords.length) fragment.append(emptyMessage('לא נמצאו קטעים בספר המקור.'));
    let previousBook = null;
    for (const record of state.visibleRecords) {
      const currentBook = record.sourceBook?.slug || '';
      if (state.model.targetBooks.length > 1 && currentBook !== previousBook) {
        const group = document.createElement('div');
        group.className = 'source-book-group-title';
        group.textContent = sourceBookTitle(record);
        fragment.append(group);
        previousBook = currentBook;
      }
      const row = document.createElement('div');
      row.className = `source-item-row ${record.id === state.activeRecordId ? 'is-active' : ''}`;

      const button = document.createElement('button');
      button.type = 'button';
      button.className = `source-item source-book-item ${record.id === state.activeRecordId ? 'is-active' : ''}`;
      button.dataset.recordId = record.id;
      button.innerHTML = `
        <span class="source-item-top">
          <span class="source-item-ref">${TR.utils.escapeHtml(sourceRailItemRef(record))}</span>
        </span>
        <span class="source-item-text">${TR.utils.escapeHtml(excerpt(record.originalText, 170))}</span>`;
      button.addEventListener('click', () => selectRecord(record.id));
      row.append(button);
      fragment.append(row);
    }
    els.sourceList.replaceChildren(fragment);
    requestAnimationFrame(() => els.sourceList.querySelector('.source-item.is-active')?.scrollIntoView({ block: 'nearest' }));
  }

  function ensureActiveSelections() {
    const model = state.model;
    if (!state.visibleRecords.some(record => record.id === state.activeRecordId)) {
      state.activeRecordId = state.visibleRecords[0]?.id || model.records[0]?.id || null;
    }
    const candidates = model.getCandidates(state.activeRecordId, state.filters);
    if (!candidates.some(candidate => candidate.id === state.activeCandidateId)) {
      state.activeCandidateId = candidates[0]?.id || chooseDefaultCandidate(model.getRecord(state.activeRecordId))?.id || null;
    }
  }

  function activeRecord() {
    return state.model?.getRecord(state.activeRecordId) || null;
  }

  function activeCandidate() {
    const record = activeRecord();
    return record?.candidates.find(candidate => candidate.id === state.activeCandidateId) || null;
  }

  function renderComparison() {
    const record = activeRecord();
    const candidate = activeCandidate();
    if (!record) return;

    els.sourceTitle.textContent = sourceBookTitle(record);
    els.sourceRef.textContent = sourceCanonicalRef(record);
    const alignmentColor = candidate ? TR.utils.hashColor(candidate.bookSlug) : '#2f6b50';
    els.sourceText.innerHTML = candidate
      ? TR.utils.alignedTextHtml(candidate.details, 'original', { color: alignmentColor })
      : TR.utils.escapeHtml(record.originalText);

    if (!candidate) {
      els.candidateTitle.textContent = 'לא נבחר קטע מן הדאטהסט';
      els.candidateRef.textContent = '';
      els.candidateText.innerHTML = '<p class="empty-inline">אין קטע מן הדאטהסט המתאים למסננים הנוכחיים.</p>';
      setMetricCards(null);
      els.originalMetadata.innerHTML = metadataPlaceholder('מטא־דאטה של קטע הספר');
      els.candidateMetadata.innerHTML = metadataPlaceholder('מטא־דאטה של הקטע מן הדאטהסט');
      renderGenizahMetadata(null, null);
      els.alignmentNote.textContent = 'שנה את המסננים כדי להציג השוואה.';
      els.addActiveCandidateBtn.disabled = true;
      renderSynopsisIndicators();
      return;
    }

    els.candidateTitle.textContent = candidate.bookTitle;
    els.candidateRef.textContent = candidate.displayRef;
    els.candidateText.innerHTML = TR.utils.alignedTextHtml(candidate.details, 'candidate', { color: alignmentColor });
    setMetricCards(candidate);
    els.alignmentNote.textContent = candidate.hasDetailedAlignment
      ? 'אותו צבע מוצג בשני הטקסטים לפי רצף היישור המפורט שסיפקה מערכת TEXTREUSE.'
      : 'סימוני ה־HTML של TEXTREUSE הועברו גם לטקסט המקור באמצעות יישור המילים, כדי להציג צבע מקביל בשני הצדדים.';
    renderMetadataLoading(candidate);
    loadSelectedMetadata(record, candidate);
    els.addActiveCandidateBtn.disabled = false;
    renderSynopsisIndicators();
  }

  function setMetricCards(candidate) {
    els.scoreRaw.textContent = candidate ? TR.utils.compactNumber(candidate.score, 1) : '—';
    els.scoreNorm.textContent = candidate ? TR.utils.percent(candidate.normScore, 1) : '—';
    els.scoreAlignment.textContent = candidate ? TR.utils.percent(candidate.alignmentScore, 1) : '—';
    els.scoreFull.textContent = candidate ? (candidate.fullAlignment ? 'כן' : 'לא') : '—';
    els.scoreFull.dataset.positive = candidate?.fullAlignment ? 'true' : 'false';
  }

  function renderCandidateList() {
    const record = activeRecord();
    const candidates = record ? state.model.getCandidates(record.id, state.filters) : [];
    const selected = selectedCandidatesForRecord(record?.id);
    els.candidateListCount.textContent = `${candidates.length} קטעים`;
    const fragment = document.createDocumentFragment();
    if (!candidates.length) fragment.append(emptyMessage('אין קטעים מן הדאטהסט המתאימים למסננים.'));

    candidates.forEach((candidate, index) => {
      const row = document.createElement('div');
      row.className = `candidate-item-row ${candidate.id === state.activeCandidateId ? 'is-active' : ''}`;

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'synopsis-select-check candidate-synopsis-check';
      checkbox.checked = selected.has(candidate.id);
      checkbox.title = 'הוסף את הקטע מן הדאטהסט לסינופסיס';
      checkbox.setAttribute('aria-label', `הוסף קטע מן הדאטהסט לסינופסיס: ${candidate.bookTitle}, ${candidate.displayRef}`);
      checkbox.addEventListener('change', () => toggleCandidateSynopsis(record.id, candidate.id, checkbox.checked));

      const button = document.createElement('button');
      button.type = 'button';
      button.className = `candidate-item ${candidate.id === state.activeCandidateId ? 'is-active' : ''}`;
      button.dataset.candidateId = candidate.id;
      button.style.setProperty('--book-color', TR.utils.hashColor(candidate.bookSlug));
      button.innerHTML = `
        <span class="candidate-rank">${index + 1}</span>
        <span class="candidate-main">
          <span class="candidate-book">${TR.utils.escapeHtml(candidate.bookTitle)}</span>
          <span class="candidate-ref">${TR.utils.escapeHtml(candidate.displayRef)}</span>
          <span class="candidate-excerpt">${TR.utils.escapeHtml(excerpt(candidate.datasetText || candidate.sourceText, 105))}</span>
        </span>
        <span class="candidate-metrics">
          <b>${TR.utils.percent(candidate.normScore, 0)}</b>
          <small>${TR.utils.compactNumber(candidate.score, 0)}</small>
        </span>`;
      button.addEventListener('click', () => selectCandidate(candidate.id));
      row.append(button);
      fragment.append(row);
    });
    els.candidateList.replaceChildren(fragment);
    requestAnimationFrame(() => els.candidateList.querySelector('.candidate-item.is-active')?.scrollIntoView({ block: 'nearest' }));
    renderSynopsisIndicators();
  }

  async function loadSelectedMetadata(record, candidate) {
    const requestId = ++state.metadataRequestId;
    const genizahRequestId = ++state.genizahRequestId;
    renderGenizahMetadataLoading(candidate);
    const originalPromise = record.bookPassage ? getCandidateMetadata(record.bookPassage) : Promise.resolve(null);
    const candidatePromise = getCandidateMetadata(candidate);
    const [original, source] = await Promise.allSettled([originalPromise, candidatePromise]);
    if (requestId !== state.metadataRequestId) return;
    renderMetadataCard(els.originalMetadata, {
      heading: 'קטע הספר',
      fallbackRef: record.displayRef,
      book: state.model.bookMap.get(record.sourceBook?.slug),
      passage: original.status === 'fulfilled' ? original.value : null,
      error: original.status === 'rejected' ? original.reason?.message : null
    });
    renderMetadataCard(els.candidateMetadata, {
      heading: 'קטע מן הדאטהסט',
      fallbackRef: candidate.displayRef,
      book: state.model.bookMap.get(candidate.bookSlug),
      passage: source.status === 'fulfilled' ? source.value : null,
      candidate,
      error: source.status === 'rejected' ? source.reason?.message : null
    });

    // Once Sefaria has resolved the hierarchy, promote the canonical work/ref
    // to the comparison header as well. This keeps all views synchronized with
    // the metadata card instead of leaving the locally inferred label visible.
    if (original.status === 'fulfilled' && original.value) {
      const originalPassage = original.value;
      record.resolvedSourceTitle = originalPassage.heIndexTitle
        || originalPassage.indexTitle
        || sourceBookTitle(record);
      record.resolvedSourceRef = originalPassage.heRef || originalPassage.canonicalRef || sourceCanonicalRef(record);
      els.sourceTitle.textContent = record.resolvedSourceTitle;
      els.sourceRef.textContent = record.resolvedSourceRef;
      renderSourceList();
    }

    if (source.status === 'fulfilled' && source.value) {
      const candidatePassage = source.value;
      els.candidateTitle.textContent = candidatePassage.heIndexTitle
        || candidatePassage.indexTitle
        || candidate.bookTitle;
      els.candidateRef.textContent = candidatePassage.heRef
        || candidatePassage.canonicalRef
        || candidate.displayRef;
    }

    await loadGenizahMetadata(candidate, genizahRequestId);
  }

  async function loadGenizahMetadata(candidate, requestId) {
    if (!candidate || candidate.sourceFamily !== 'geniza') {
      if (requestId === state.genizahRequestId) renderGenizahMetadata(null, candidate);
      return;
    }

    try {
      const metadata = await genizah.getMetadataForCandidate(candidate);
      if (requestId !== state.genizahRequestId) return;
      renderGenizahMetadata(metadata, candidate);
    } catch (error) {
      if (requestId !== state.genizahRequestId) return;
      renderGenizahMetadata({ isGeniza: true, reason: error.message }, candidate);
    }
  }

  async function getCandidateMetadata(candidate) {
    if (!candidate?.isBookPassage && candidate?.isSefariaLike === false) return null;
    const key = `${candidate.bookSlug}::${candidate.sourceLocation}`;
    if (state.passageMetadata.has(key)) return state.passageMetadata.get(key);
    const metadata = await sefaria.getPassageMetadata(candidate);
    state.passageMetadata.set(key, metadata);
    return metadata;
  }

  function renderMetadataLoading(candidate) {
    els.originalMetadata.innerHTML = metadataPlaceholder('מאתר את קטע הספר בספריא…', true);
    if (candidate?.isSefariaLike === false) {
      els.candidateMetadata.innerHTML = metadataPlaceholder('לקטע זה אין מקור בספריא. נטען מטה-דאטה מקומי…', true);
      return;
    }
    els.candidateMetadata.innerHTML = metadataPlaceholder('מאתר את הקטע מן הדאטהסט בספריא…', true);
  }

  function renderGenizahMetadataLoading(candidate) {
    if (!candidate || candidate.sourceFamily !== 'geniza') {
      renderGenizahMetadata(null, candidate);
      return;
    }
    setGenizahDropdownHtml(`
      <details class="genizah-dropdown" open>
        <summary>מטה-דאטה מורחב של גניזה (מתחת ל-MD מתוך JSON)</summary>
        <div class="genizah-dropdown-body">${metadataPlaceholder('טוען מטה-דאטה מקומי של Genizah…', true)}</div>
      </details>
    `);
    state.activeGenizahMetadata = null;
  }

  function renderGenizahMetadata(metadata, candidate) {
    if (!candidate || candidate.sourceFamily !== 'geniza') {
      setGenizahDropdownHtml('');
      state.activeGenizahMetadata = null;
      return;
    }

    if (!metadata?.item) {
      const reason = metadata?.reason || 'לא נמצא מטה-דאטה מקומי עבור קטע גניזה זה.';
      setGenizahDropdownHtml(`
        <details class="genizah-dropdown" open>
          <summary>מטה-דאטה מורחב של גניזה (מתחת ל-MD מתוך JSON)</summary>
          <div class="genizah-dropdown-body"><p class="metadata-warning">${TR.utils.escapeHtml(reason)}</p></div>
        </details>
      `);
      state.activeGenizahMetadata = null;
      return;
    }

    state.activeGenizahMetadata = metadata;
    const rows = [
      ['Lookup Mode', metadata.lookupMode || 'local'],
      ['Geniza IE', metadata.ie || '—'],
      ['ALMA', metadata.item.alma || '—'],
      ['Page', metadata.item.page || '—'],
      ['Shelfmark', metadata.item.shelfmark || '—'],
      ['Title', metadata.item.title || '—'],
      ['Library', metadata.item.library || '—'],
      ['City', metadata.item.city || '—'],
      ['Coverage', metadata.item.coverage ?? '—'],
      ['Has NLI', String(Boolean(metadata.item.has_nli))],
      ['Has Friedberg', String(Boolean(metadata.item.has_friedberg))]
    ];

    if (metadata.manifestCanvasCount != null) {
      rows.push(['Manifest Canvases', String(metadata.manifestCanvasCount)]);
    }

    if (metadata.friedberg) {
      rows.push(
        ['Friedberg Domain', metadata.friedberg.d || '—'],
        ['Friedberg Hebrew', metadata.friedberg.h || '—'],
        ['Friedberg Library', metadata.friedberg.lib_name || metadata.friedberg.lib || '—'],
        ['Friedberg Shelfmark', metadata.friedberg.shelfmark || '—'],
        ['Friedberg Hierarchy', Array.isArray(metadata.friedberg.hier) ? metadata.friedberg.hier.join(' > ') : '—']
      );
    }

    const localDetails = rows.map(([label, value]) => `
      <div>
        <dt>${TR.utils.escapeHtml(label)}</dt>
        <dd>${TR.utils.escapeHtml(String(value ?? '—'))}</dd>
      </div>
    `).join('');

    const imageAction = metadata.item.has_nli
      ? '<button type="button" class="secondary-button" data-open-genizah-image>הצג תמונה בתוך המערכת</button>'
      : '<span class="metadata-warning">אין תמונת NLI זמינה לפריט זה.</span>';

    setGenizahDropdownHtml(`
      <details class="genizah-dropdown" open>
        <summary>מטה-דאטה מורחב של גניזה (מתחת ל-MD מתוך JSON)</summary>
        <div class="genizah-dropdown-body">
          <dl class="metadata-list genizah-local-list">${localDetails}</dl>
          <div class="genizah-actions-row">
            ${imageAction}
            ${metadata.viewerUrl ? `<a class="text-button" href="${TR.utils.escapeHtml(metadata.viewerUrl)}" target="_blank" rel="noopener">צפייה בפריט ב-NLI ↗</a>` : ''}
            ${metadata.manifestUrl ? `<a class="text-button" href="${TR.utils.escapeHtml(metadata.manifestUrl)}" target="_blank" rel="noopener">Manifest IIIF ↗</a>` : ''}
          </div>
          ${metadata.lookupMode === 'remote-manifest' ? '<p class="metadata-warning">הרשומה לא נמצאה בקובץ המקומי, ולכן ה-MD והתמונה נטענים ישירות מהספריה הלאומית לפי BIB/ALMA. בחירת התמונה נעשית מה-canvas הקרוב ביותר ל-IE.</p>' : ''}
        </div>
      </details>
    `);
  }

  function setGenizahDropdownHtml(html) {
    els.candidateMetadata.querySelector('.genizah-dropdown')?.remove();
    if (!html) return;
    els.candidateMetadata.insertAdjacentHTML('beforeend', html);
  }

  async function openGenizahImageDialog() {
    const metadata = state.activeGenizahMetadata;
    if (!metadata?.item) {
      showToast('אין מטה-דאטה זמין לקטע גניזה זה.', 'error');
      return;
    }

    const title = `${metadata.item.shelfmark || metadata.item.title || 'Genizah'} · IE ${metadata.ie || ''}`.trim();
    els.genizahImageTitle.textContent = title;
    els.genizahImageStatus.textContent = 'מאתר תמונה דרך manifest מרוחק…';
    els.genizahImage.hidden = true;
    els.openGenizahImageExternalLink.hidden = true;
    openDialogSafely(els.genizahImageDialog);

    try {
      const imageUrl = await genizah.resolveImageUrl(metadata);
      if (!els.genizahImageDialog.open) return;
      await new Promise((resolve, reject) => {
        const onLoad = () => {
          cleanup();
          resolve();
        };
        const onError = () => {
          cleanup();
          reject(new Error('קובץ התמונה לא נטען משרת IIIF.'));
        };
        const cleanup = () => {
          els.genizahImage.removeEventListener('load', onLoad);
          els.genizahImage.removeEventListener('error', onError);
        };
        els.genizahImage.addEventListener('load', onLoad, { once: true });
        els.genizahImage.addEventListener('error', onError, { once: true });
        els.genizahImage.src = imageUrl;
      });
      if (!els.genizahImageDialog.open) return;
      els.genizahImage.hidden = false;
      els.openGenizahImageExternalLink.href = imageUrl;
      els.openGenizahImageExternalLink.hidden = false;
      els.genizahImageStatus.textContent = 'התמונה נטענה בהצלחה.';
    } catch (error) {
      if (!els.genizahImageDialog.open) return;
      els.genizahImage.hidden = true;
      els.openGenizahImageExternalLink.hidden = true;
      els.genizahImageStatus.textContent = `לא ניתן לטעון תמונה: ${error.message}`;
    }
  }

  function renderMetadataCard(container, { heading, fallbackRef, book, passage, candidate, error }) {
    const metadata = book?.metadata || {};
    const authors = (metadata.authors || []).map(author => author.he || author.en).filter(Boolean).join(', ');
    const canonicalRef = passage?.heRef || passage?.canonicalRef || fallbackRef;
    const categories = passage?.categories?.length ? passage.categories : (metadata.categories || book?.categories || []);
    const version = passage?.versionTitleInHebrew || passage?.versionTitle || '';
    const date = metadata.compDateString || formatDateRange(metadata.compDate);
    const description = metadata.heShortDesc || metadata.enShortDesc || '';
    const link = passage?.url || metadata.url || null;
    const resolutionLabel = passage?.resolution ? diagnosticMethodLabel(passage.resolution) : '';
    const noSefariaSource = Boolean(candidate && candidate.isSefariaLike === false);

    container.innerHTML = `
      <div class="metadata-heading-row">
        <h4>${TR.utils.escapeHtml(heading)}</h4>
        ${link ? `<a href="${TR.utils.escapeHtml(link)}" target="_blank" rel="noopener">פתיחה בספריא ↗</a>` : ''}
      </div>
      <dl class="metadata-list">
        <div><dt>מראה מקום</dt><dd>${TR.utils.escapeHtml(canonicalRef)}</dd></div>
        <div><dt>חיבור</dt><dd>${TR.utils.escapeHtml(metadata.heTitle || metadata.title || book?.title || '')}</dd></div>
        ${authors ? `<div><dt>מחבר</dt><dd>${TR.utils.escapeHtml(authors)}</dd></div>` : ''}
        ${date ? `<div><dt>זמן חיבור</dt><dd>${TR.utils.escapeHtml(date)}</dd></div>` : ''}
        ${metadata.compPlace ? `<div><dt>מקום חיבור</dt><dd>${TR.utils.escapeHtml(metadata.compPlace)}</dd></div>` : ''}
        ${categories.length ? `<div><dt>קטגוריות</dt><dd>${TR.utils.escapeHtml(categories.join(' › '))}</dd></div>` : ''}
        ${version ? `<div><dt>מהדורה דיגיטלית</dt><dd>${TR.utils.escapeHtml(version)}</dd></div>` : ''}
        ${passage?.license ? `<div><dt>רישיון</dt><dd>${TR.utils.escapeHtml(passage.license)}</dd></div>` : ''}
        ${resolutionLabel ? `<div><dt>פתרון ההפניה</dt><dd>${TR.utils.escapeHtml(resolutionLabel)}</dd></div>` : ''}
      </dl>
      ${description ? `<p class="metadata-description">${TR.utils.escapeHtml(description)}</p>` : ''}
        ${noSefariaSource ? '<p class="metadata-warning">לקטע זה אין מקור בספריא (זהו קטע גניזה/VRR), ולכן מוצג רק מטה-דאטה מקומי של הדאטהסט.</p>' : ''}
      ${passage?.resolutionProblem ? `<p class="metadata-warning">${TR.utils.escapeHtml(passage.resolutionProblem)}</p>` : ''}
      ${error ? '<p class="metadata-warning">ספריא לא החזירה מטא־דאטה לקטע זה. הנתונים המקומיים עדיין מוצגים במלואם.</p>' : ''}`;
  }

  function metadataPlaceholder(text, loading = false) {
    return `<div class="metadata-placeholder ${loading ? 'is-loading' : ''}">${TR.utils.escapeHtml(text)}</div>`;
  }

  async function hydrateBookMetadata() {
    if (!state.model) return;
    const runId = ++state.metadataRunId;
    const model = state.model;
    const books = model.books;
    els.retryMetadataBtn.hidden = true;
    els.metadataStatus.textContent = `מטא־דאטה מספריא: 0/${books.length}`;
    let errors = 0;
    await sefaria.hydrateBooks(books, ({ completed, total, book }) => {
      if (runId !== state.metadataRunId || model !== state.model) return;
      if (book.metadataStatus === 'error') errors += 1;
      els.metadataStatus.textContent = `מטא־דאטה מספריא: ${completed}/${total}`;
      if (model.sourceBookSlugs.has(book.slug)) {
        renderSourceList();
        renderComparison();
      }
      if (state.activeView === 'library') renderLibrary();
    });
    if (runId !== state.metadataRunId || model !== state.model) return;
    els.metadataStatus.textContent = errors ? `מטא־דאטה חלקי: ${books.length - errors}/${books.length}` : `מטא־דאטה מספריא: ${books.length}/${books.length}`;
    els.retryMetadataBtn.hidden = errors === 0;
    renderSourceList();
    renderComparison();
    if (state.activeView === 'library') renderLibrary();
  }

  function renderMatrix() {
    if (!state.model || state.activeView !== 'matrix') return;
    const matrix = state.model.aggregateMatrix({
      metric: state.matrix.metric,
      maxBooks: state.matrix.books,
      granularity: state.matrix.granularity,
      filters: state.filters
    });
    TR.visualizations.renderHeatmap(els.heatmapContainer, matrix, {
      onCellClick: ({ row, book, cell }) => {
        if (book) {
          state.filters.bookSlugs = [book.slug];
          renderBookMultiOptions();
        }
        if (row?.recordIds?.length) {
          const recordId = row.recordIds.find(id => {
            if (!book) return true;
            return state.model.getCandidates(id, { ...state.filters, bookSlugs: [book.slug] }).length > 0;
          }) || row.recordIds[0];
          selectRecord(recordId, false);
        }
        if (cell?.stats?.count || row) {
          setView('read');
          updateAfterFilters(false);
        }
      }
    });
  }

  function renderNetwork() {
    if (!state.model || state.activeView !== 'network') return;
    const options = { minNorm: state.network.minNorm, filters: state.filters };
    const graph = state.network.mode === 'source'
      ? state.model.buildSourceBookGraph(options)
      : state.network.mode === 'sourceGeniza'
        ? state.model.buildSourceToGenizaGraph(options)
        : state.model.buildCooccurrenceGraph(options);
    TR.visualizations.renderNetwork(els.networkSvg, graph, {
      onNodeClick: node => {
        state.network.selected = { type: 'node', node };
        renderNetworkInspector();
      },
      onEdgeClick: edge => {
        state.network.selected = { type: 'edge', edge, graph };
        renderNetworkInspector();
      }
    });
    renderNetworkInspector();
  }

  function renderNetworkInspector() {
    const selected = state.network.selected;
    if (!selected) {
      const modeText = state.network.mode === 'source'
        ? 'כל ספר מקור מחובר לספרים שהוצעו כמועמדים לקטעיו. כאשר נטענו כמה מאגרים, כל ספרי המקור מוצגים יחד.'
        : state.network.mode === 'sourceGeniza'
          ? 'כל ספר מקור מחובר לכתבי־יד גניזה (NLI) שהופיעו כמועמדים לקטעיו. מצב זה זמין כאפשרות כאשר הדאטה כולל גניזה.'
          : 'כל צומת הוא ספר. קו מחבר שני ספרים כאשר שניהם הופיעו כמועמדים לאותם קטעי מקור. עובי הקו מייצג את מספר הקטעים המשותפים.';
      els.networkInspector.innerHTML = `
        <h3>כיצד לקרוא את הרשת</h3>
        <p>${modeText}</p>
        <p>לחיצה על ספר או על קו תציג את הקטעים הרלוונטיים.</p>`;
      return;
    }
    if (selected.type === 'node') {
      const { node } = selected;
      const book = state.model.bookMap.get(node.id);
      els.networkInspector.innerHTML = `
        <h3>${TR.utils.escapeHtml(node.title)}</h3>
        <p>${book ? `הספר מופיע ב־<b>${book.recordCount}</b> קטעי מקור, ובסך הכול ב־<b>${book.nonSelfCandidateCount}</b> מועמדים שאינם התאמות עצמיות.` : 'זהו ספר מקור בתצוגה המשולבת.'}</p>
        ${book?.nonSelfCandidateCount ? `<button type="button" class="primary-button" data-filter-book="${TR.utils.escapeHtml(node.id)}">הוסף את הספר למסנן</button>` : ''}`;
      els.networkInspector.querySelector('[data-filter-book]')?.addEventListener('click', () => {
        addBookFilter(node.id);
        setView('read');
      });
      return;
    }
    const { edge, graph } = selected;
    const source = graph.nodes.find(node => node.id === edge.source);
    const target = graph.nodes.find(node => node.id === edge.target);
    const records = edge.recordIds.slice(0, 12).map(id => state.model.getRecord(id)).filter(Boolean);
    els.networkInspector.innerHTML = `
      <h3>${TR.utils.escapeHtml(source?.title || edge.source)} ↔ ${TR.utils.escapeHtml(target?.title || edge.target)}</h3>
      <p>הקשר מופיע ב־<b>${edge.count}</b> קטעי מקור.</p>
      <div class="inspector-actions"><button type="button" class="primary-button" data-edge-synopsis>בנה סינופסיס לקטע מן הקשר</button></div>
      <div class="inspector-records">
        ${records.map(record => `<button type="button" data-record="${TR.utils.escapeHtml(record.id)}">${TR.utils.escapeHtml(record.datasetLabel)} · ${TR.utils.escapeHtml(record.displayRef)}</button>`).join('')}
      </div>`;
    els.networkInspector.querySelector('[data-edge-synopsis]')?.addEventListener('click', () => {
      const record = edge.recordIds.map(id => state.model.getRecord(id)).find(Boolean);
      if (!record) return;
      selectRecord(record.id, false);
      const edgeBooks = new Set([edge.source, edge.target]);
      const matches = record.candidates.filter(candidate => !candidate.isSelf && edgeBooks.has(candidate.bookSlug)).slice(0, 20);
      const fallback = state.model.getCandidates(record.id, state.filters).slice(0, 5);
      state.synopsis.candidatesByRecord.set(record.id, new Set((matches.length ? matches : fallback).map(candidate => candidate.id)));
      setView('synopsis');
      renderAll();
    });
    TR.utils.$$('[data-record]', els.networkInspector).forEach(button => button.addEventListener('click', () => {
      selectRecord(button.dataset.record, false);
      setView('read');
      renderAll();
    }));
  }

  function renderReverse() {
    if (!state.model || state.activeView !== 'reverse') return;
    refreshReverseOptions(false);
    if (!state.reverse.groupKey) {
      els.reverseSummary.textContent = t('אין בחירה זמינה לתצוגה הפוכה.', 'No available selection for reverse view.');
      els.reverseTableBody.innerHTML = `<tr><td colspan="6" class="empty-table">${TR.utils.escapeHtml(t('אין נתונים להצגה.', 'No data to display.'))}</td></tr>`;
      els.reverseHeatmapContainer.replaceChildren();
      state.reverse.sequenceRecordIds = [];
      state.reverse.sequenceIndex = -1;
      renderReverseSequenceBar();
      return;
    }

    const reverseData = state.model.getReverseMatches({
      mode: state.reverse.mode,
      groupKey: state.reverse.groupKey,
      limit: state.reverse.topCount,
      orderBy: state.reverse.orderBy,
      filters: state.filters
    });

    const selectedLabel = els.reverseBookSelect.selectedOptions[0]?.textContent || state.reverse.groupKey;
    const sequenceIds = reverseData.rows.map(item => item.record.id);
    state.reverse.sequenceRecordIds = sequenceIds;
    const activeIndex = sequenceIds.indexOf(state.activeRecordId);
    state.reverse.sequenceIndex = activeIndex >= 0 ? activeIndex : (sequenceIds.length ? 0 : -1);
    els.reverseSummary.textContent = t(
      `מציג ${reverseData.rows.length} קטעי מקור הקרובים ביותר ל: ${selectedLabel}`,
      `Showing ${reverseData.rows.length} source passages that are closest to: ${selectedLabel}`
    );
    renderReverseSequenceBar();
    els.reverseHeatTitle.textContent = t('התפלגות לאורך ספר המקור', 'Distribution across source book');

    els.reverseTableBody.innerHTML = reverseData.rows.length
      ? reverseData.rows.map(item => `
        <tr>
          <td><b>${TR.utils.escapeHtml(sourceCanonicalRef(item.record))}</b></td>
          <td>${TR.utils.percent(item.bestNorm, 1)}</td>
          <td>${TR.utils.percent(item.bestAlignment, 1)}</td>
          <td>${TR.utils.compactNumber(item.bestScore, 0)}</td>
          <td>${item.count}</td>
          <td><button type="button" class="text-button" data-reverse-open-record="${TR.utils.escapeHtml(item.record.id)}">${TR.utils.escapeHtml(t('פתח השוואה', 'Open comparison'))}</button></td>
        </tr>
      `).join('')
      : `<tr><td colspan="6" class="empty-table">${TR.utils.escapeHtml(t('לא נמצאו התאמות לבחירה זו במסננים הנוכחיים.', 'No matches found for this selection under current filters.'))}</td></tr>`;

    TR.utils.$$('[data-reverse-open-record]', els.reverseTableBody).forEach(button => {
      button.addEventListener('click', () => {
        const recordId = button.dataset.reverseOpenRecord;
        const index = state.reverse.sequenceRecordIds.indexOf(recordId);
        openReverseSequenceAt(index >= 0 ? index : 0);
      });
    });

    const heatmapBookTitle = selectedLabel.replace(/\s*\(.+\)\s*$/, '') || state.reverse.groupKey;
    const heatmap = {
      ...reverseData.heatmap,
      books: [{ slug: state.reverse.groupKey, title: heatmapBookTitle }]
    };
    TR.visualizations.renderHeatmap(els.reverseHeatmapContainer, heatmap, {
      onCellClick: ({ row }) => {
        if (!row?.recordIds?.length) return;
        const recordId = row.recordIds[0];
        const index = state.reverse.sequenceRecordIds.indexOf(recordId);
        openReverseSequenceAt(index >= 0 ? index : 0);
      }
    });
  }

  function renderReverseSequenceBar() {
    const total = state.reverse.sequenceRecordIds.length;
    els.reverseToggleSequenceLockBtn.textContent = state.reverse.sequenceLocked
      ? t('נעילה: פעיל', 'Lock: On')
      : t('נעילה: כבוי', 'Lock: Off');
    if (!total) {
      els.reverseSequenceInfo.textContent = t('אין רצף זמין לבחירה הנוכחית.', 'No sequence for current selection.');
      els.reverseOpenSequenceBtn.disabled = true;
      els.reversePrevSequenceBtn.disabled = true;
      els.reverseNextSequenceBtn.disabled = true;
      els.reverseToggleSequenceLockBtn.disabled = true;
      return;
    }

    const index = state.reverse.sequenceIndex >= 0 ? state.reverse.sequenceIndex : 0;
    const hasMultiple = total > 1;
    els.reverseSequenceInfo.textContent = hasMultiple
      ? t(`הפריט מופיע ${total} פעמים בחיבור · מופע ${index + 1} מתוך ${total}`, `Item appears ${total} times · occurrence ${index + 1} of ${total}`)
      : t('נמצא מופע אחד בלבד לבחירה זו.', 'Only one occurrence for this selection.');
    els.reverseOpenSequenceBtn.disabled = false;
    els.reversePrevSequenceBtn.disabled = !hasMultiple;
    els.reverseNextSequenceBtn.disabled = !hasMultiple;
    els.reverseToggleSequenceLockBtn.disabled = false;
  }

  function openReverseSequenceAt(index) {
    const ids = state.reverse.sequenceRecordIds;
    if (!ids.length) {
      showToast('אין רצף זמין לבחירה הנוכחית.', 'info');
      return;
    }
    const safeIndex = ((index % ids.length) + ids.length) % ids.length;
    const recordId = ids[safeIndex];
    const record = state.model?.getRecord(recordId);
    if (!record) return;

    state.reverse.sequenceIndex = safeIndex;
    state.activeRecordId = recordId;
    state.activeCandidateId = pickBestReverseCandidate(record)?.id || chooseDefaultCandidate(record)?.id || null;
    setView('read');
    renderAll();
  }

  function pickBestReverseCandidate(record) {
    if (!state.model || !record) return null;
    const filtered = state.model.getCandidates(record.id, state.filters).filter(candidate => {
      const descriptor = state.model.describeReverseGroup(candidate, state.reverse.mode);
      return descriptor && descriptor.key === state.reverse.groupKey;
    });
    filtered.sort((a, b) => b.normScore - a.normScore || b.alignmentScore - a.alignmentScore || b.score - a.score);
    return filtered[0] || null;
  }

  function renderScatter() {
    if (!state.model || state.activeView !== 'scatter') return;
    const points = state.model.getScatterPoints({ filters: state.filters });
    els.scatterCount.textContent = t(`${points.length} נקודות מוצגות`, `${points.length} points shown`);
    if (points.length) {
      const avgX = points.reduce((sum, point) => sum + point.x, 0) / points.length;
      const avgY = points.reduce((sum, point) => sum + point.y, 0) / points.length;
      const highBoth = points.filter(point => point.x >= 0.6 && point.y >= 0.6).length;
      els.scatterInspector.innerHTML = `
        <h3>${TR.utils.escapeHtml(t('איך לקרוא את הגרף', 'How to read this chart'))}</h3>
        <p>${TR.utils.escapeHtml(t(
          'ימין־למעלה = התאמות חזקות ואמינות יותר. שמאל־למטה = מועמדים חלשים יחסית. זהו כלי אבחון איכות ולא רשימת תוצאות מדורגת.',
          'Upper-right means stronger and more reliable matches. Lower-left means weaker candidates. This chart is a quality-diagnostic view, not a ranked results list.'
        ))}</p>
        <p>${TR.utils.escapeHtml(t(
          `ממוצע הדאטה כעת: ציון מנורמל ${TR.utils.percent(avgX, 1)}, ציון יישור ${TR.utils.percent(avgY, 1)}. מספר נקודות באזור חזק (≥60% בשני הצירים): ${highBoth}.`,
          `Current dataset averages: normalized ${TR.utils.percent(avgX, 1)}, alignment ${TR.utils.percent(avgY, 1)}. Points in strong zone (>=60% on both axes): ${highBoth}.`
        ))}</p>`;
    } else {
      els.scatterInspector.innerHTML = `<p>${TR.utils.escapeHtml(t('אין נקודות להצגה במסננים הנוכחיים.', 'No points available with current filters.'))}</p>`;
    }
    TR.visualizations.renderScatter(els.scatterSvg, points, {
      onPointClick: point => {
        state.activeRecordId = point.record.id;
        state.activeCandidateId = point.candidate.id;
        setView('read');
        renderAll();
      }
    });
  }

  function renderLibrary() {
    if (!state.model) return;
    const selectedBooks = new Set(state.filters.bookSlugs);
    const books = state.model.books.filter(book => book.nonSelfCandidateCount > 0);
    els.libraryTableBody.innerHTML = books.map(book => {
      const metadata = book.metadata || {};
      const author = (metadata.authors || []).map(item => item.he || item.en).filter(Boolean).join(', ');
      return `
        <tr data-book="${TR.utils.escapeHtml(book.slug)}">
          <td>
            <input class="library-book-check" type="checkbox" data-library-book="${TR.utils.escapeHtml(book.slug)}" ${selectedBooks.has(book.slug) ? 'checked' : ''} aria-label="הוספה למסנן">
            <span class="book-dot" style="--book-color:${TR.utils.hashColor(book.slug)}"></span>
            <b>${TR.utils.escapeHtml(metadata.heTitle || book.title)}</b><small>${TR.utils.escapeHtml(metadata.heTitle ? book.title : '')}</small>
          </td>
          <td>${book.recordCount}</td>
          <td>${book.nonSelfCandidateCount}</td>
          <td>${TR.utils.percent(book.maxNormScore, 0)}</td>
          <td>${book.fullAlignmentCount}</td>
          <td>${TR.utils.escapeHtml(author || '—')}</td>
          <td><span class="metadata-state state-${book.metadataStatus}">${metadataStateLabel(book.metadataStatus)}</span></td>
        </tr>`;
    }).join('');
    TR.utils.$$('tr[data-book]', els.libraryTableBody).forEach(row => row.addEventListener('click', event => {
      if (event.target.closest('[data-library-book]')) return;
      showBookInspector(row.dataset.book);
    }));
    TR.utils.$$('[data-library-book]', els.libraryTableBody).forEach(input => input.addEventListener('change', () => {
      const set = new Set(state.filters.bookSlugs);
      input.checked ? set.add(input.dataset.libraryBook) : set.delete(input.dataset.libraryBook);
      state.filters.bookSlugs = [...set];
      renderBookMultiOptions();
      updateAfterFilters();
    }));
    const inspectedBook = els.bookInspector.dataset.book;
    if (inspectedBook && state.model.bookMap.has(inspectedBook)) showBookInspector(inspectedBook);
    else if (books[0]) showBookInspector(books[0].slug);
  }

  function showBookInspector(bookSlug) {
    const book = state.model.bookMap.get(bookSlug);
    if (!book) return;
    els.bookInspector.dataset.book = bookSlug;
    const metadata = book.metadata || {};
    const authors = (metadata.authors || []).map(author => author.he || author.en).filter(Boolean).join(', ');
    const description = metadata.heDesc || metadata.heShortDesc || metadata.enDesc || metadata.enShortDesc || '';
    const selected = state.filters.bookSlugs.includes(bookSlug);
    els.bookInspector.innerHTML = `
      <div class="book-inspector-head">
        <span class="book-large-dot" style="--book-color:${TR.utils.hashColor(book.slug)}"></span>
        <div><h3>${TR.utils.escapeHtml(metadata.heTitle || book.title)}</h3><p>${TR.utils.escapeHtml(metadata.heTitle ? book.title : '')}</p></div>
      </div>
      <dl class="metadata-list">
        ${authors ? `<div><dt>מחבר</dt><dd>${TR.utils.escapeHtml(authors)}</dd></div>` : ''}
        ${metadata.compDateString ? `<div><dt>זמן חיבור</dt><dd>${TR.utils.escapeHtml(metadata.compDateString)}</dd></div>` : ''}
        ${metadata.compPlace ? `<div><dt>מקום חיבור</dt><dd>${TR.utils.escapeHtml(metadata.compPlace)}</dd></div>` : ''}
        <div><dt>קטעי מקור קשורים</dt><dd>${book.recordCount}</dd></div>
        <div><dt>מועמדים</dt><dd>${book.nonSelfCandidateCount}</dd></div>
        <div><dt>ציון מנורמל מרבי</dt><dd>${TR.utils.percent(book.maxNormScore, 1)}</dd></div>
        <div><dt>התאמות מלאות</dt><dd>${book.fullAlignmentCount}</dd></div>
      </dl>
      ${description ? `<p class="book-description">${TR.utils.escapeHtml(description)}</p>` : '<p class="metadata-warning">המטא־דאטה המורחב עדיין לא זמין.</p>'}
      <div class="inspector-actions">
        <button type="button" class="primary-button" data-toggle-book>${selected ? 'הסר מהמסנן' : 'הוסף למסנן המרובה'}</button>
        <button type="button" class="secondary-button" data-book-synopsis>הוסף קטעים מן הספר בדאטהסט לסינופסיס</button>
        ${metadata.url ? `<a class="secondary-button" href="${TR.utils.escapeHtml(metadata.url)}" target="_blank" rel="noopener">פתיחה בספריא ↗</a>` : ''}
      </div>`;
    els.bookInspector.querySelector('[data-book-synopsis]')?.addEventListener('click', () => {
      const record = activeRecord();
      if (!record) return;
      const matches = record.candidates.filter(candidate => !candidate.isSelf && candidate.bookSlug === bookSlug).slice(0, 20);
      if (!matches.length) {
        showToast('לספר זה אין קטעי דאטהסט עבור קטע הספר הנוכחי.', 'error');
        return;
      }
      const selectedSet = ensureCandidateSelectionSet(record.id);
      matches.forEach(candidate => selectedSet.add(candidate.id));
      setView('synopsis');
    });
    els.bookInspector.querySelector('[data-toggle-book]')?.addEventListener('click', () => {
      const set = new Set(state.filters.bookSlugs);
      selected ? set.delete(bookSlug) : set.add(bookSlug);
      state.filters.bookSlugs = [...set];
      renderBookMultiOptions();
      updateAfterFilters();
      showBookInspector(bookSlug);
    });
  }

  function addBookFilter(bookSlug) {
    const set = new Set(state.filters.bookSlugs);
    set.add(bookSlug);
    state.filters.bookSlugs = [...set];
    renderBookMultiOptions();
    updateAfterFilters();
  }


  function selectedCandidatesForRecord(recordId) {
    return state.synopsis.candidatesByRecord.get(recordId) || new Set();
  }

  function ensureCandidateSelectionSet(recordId) {
    let selected = state.synopsis.candidatesByRecord.get(recordId);
    if (!selected) {
      selected = new Set();
      state.synopsis.candidatesByRecord.set(recordId, selected);
    }
    return selected;
  }

  function toggleCandidateSynopsis(recordId, candidateId, checked) {
    if (!recordId || !candidateId) return;
    const record = state.model?.recordMap.get(recordId);
    const candidate = record?.candidates.find(item => item.id === candidateId);
    if (!candidate || candidate.isSelf) return;
    const selected = ensureCandidateSelectionSet(recordId);
    checked ? selected.add(candidateId) : selected.delete(candidateId);
    if (!selected.size) state.synopsis.candidatesByRecord.delete(recordId);
    renderSynopsisIndicators();
    renderCandidateList();
    if (state.activeView === 'synopsis') renderSynopsis();
  }

  function cleanupSynopsisSelections() {
    if (!state.model) return;
    const cleaned = new Map();
    for (const [recordId, candidateIds] of state.synopsis.candidatesByRecord.entries()) {
      const record = state.model.recordMap.get(recordId);
      if (!record) continue;
      const validCandidates = new Set(record.candidates.filter(candidate => !candidate.isSelf).map(candidate => candidate.id));
      const values = new Set([...candidateIds].filter(id => validCandidates.has(id)));
      if (values.size) cleaned.set(recordId, values);
    }
    state.synopsis.candidatesByRecord = cleaned;
  }

  function totalSynopsisSelectionCount() {
    const record = activeRecord();
    return selectedCandidatesForRecord(record?.id).size;
  }

  function renderSynopsisIndicators() {
    if (!state.model) return;
    const record = activeRecord();
    const currentSet = selectedCandidatesForRecord(record?.id);
    const active = activeCandidate();
    els.selectedCandidateCount.textContent = String(currentSet.size);
    els.synopsisQuickCount.textContent = currentSet.size
      ? `${currentSet.size} קטעים מן הדאטהסט נבחרו`
      : 'לא נבחרו קטעים מן הדאטהסט';
    els.addActiveCandidateBtn.textContent = active && currentSet.has(active.id)
      ? 'הסר מועמד מן הסינופסיס'
      : 'הוסף מועמד לסינופסיס';
    els.synopsisTabCount.textContent = String(totalSynopsisSelectionCount());
    els.synopsisTabCount.hidden = totalSynopsisSelectionCount() === 0;
  }

  function toggleActiveCandidateInSynopsis() {
    const record = activeRecord();
    const candidate = activeCandidate();
    if (!record || !candidate) return;
    const selected = selectedCandidatesForRecord(record.id);
    toggleCandidateSynopsis(record.id, candidate.id, !selected.has(candidate.id));
  }

  function openCurrentSynopsis() {
    const record = activeRecord();
    const candidate = activeCandidate();
    if (!record) return;
    if (!selectedCandidatesForRecord(record.id).size) {
      if (state.synopsis.strategy !== 'manual') applySynopsisStrategy(record, false);
      else if (candidate) ensureCandidateSelectionSet(record.id).add(candidate.id);
    }
    state.synopsis.mode = 'single';
    setView('synopsis');
  }

  function clearCurrentCandidateSynopsis() {
    const record = activeRecord();
    if (!record) return;
    state.synopsis.candidatesByRecord.delete(record.id);
    renderAll();
  }

  function selectTopSynopsisCandidates(count = 5) {
    const record = activeRecord();
    if (!record) return;
    const candidates = state.model.getCandidates(record.id, state.filters).slice(0, TR.utils.clamp(Number(count) || 5, 1, 20));
    state.synopsis.candidatesByRecord.set(record.id, new Set(candidates.map(candidate => candidate.id)));
    renderAll();
  }

  function selectSynopsisTop(count) {
    selectTopSynopsisCandidates(count);
  }

  function selectSynopsisVisible() {
    const limit = 20;
    const record = activeRecord();
    if (!record) return;
    const candidates = state.model.getCandidates(record.id, state.filters);
    state.synopsis.candidatesByRecord.set(record.id, new Set(candidates.slice(0, limit).map(candidate => candidate.id)));
    if (candidates.length > limit) showToast(`נבחרו ${limit} קטעי הדאטהסט הראשונים כדי לשמור על תצוגה קריאה.`, 'info');
    renderAll();
  }

  function clearSynopsisSelection() {
    const record = activeRecord();
    if (record) state.synopsis.candidatesByRecord.delete(record.id);
    renderAll();
  }

  function handleSynopsisPickerChange(event) {
    const input = event.target.closest('input[data-synopsis-kind="candidate"]');
    if (!input) return;
    toggleCandidateSynopsis(input.dataset.recordId, input.value, input.checked);
  }

  function synopsisCandidateScore(candidate, record) {
    const candidates = record?.candidates || [];
    const maxRaw = Math.max(...candidates.map(item => Number(item.score || 0)), 1);
    const rawPart = Math.min(1, Math.max(0, Number(candidate.score || 0) / maxRaw));
    return (Number(candidate.normScore || 0) * 0.58)
      + (Number(candidate.alignmentScore || 0) * 0.27)
      + (rawPart * 0.15)
      + (candidate.fullAlignment ? 0.04 : 0);
  }

  function smartCandidatesForRecord(record, strategy = state.synopsis.strategy, count = state.synopsis.topCount) {
    if (!record) return [];
    const limit = TR.utils.clamp(Number(count) || 3, 1, 12);
    const visible = state.model.getCandidates(record.id, state.filters).filter(candidate => !candidate.isSelf);
    if (!visible.length) return [];
    const ranked = [...visible].sort((a, b) => synopsisCandidateScore(b, record) - synopsisCandidateScore(a, record)
      || b.normScore - a.normScore || b.alignmentScore - a.alignmentScore || b.score - a.score);

    if (strategy === 'manual') {
      const selected = selectedCandidatesForRecord(record.id);
      return ranked.filter(candidate => selected.has(candidate.id)).slice(0, limit);
    }
    if (strategy === 'strongest') return ranked.slice(0, limit);
    if (strategy === 'fullAlignment') {
      return [...ranked.filter(candidate => candidate.fullAlignment), ...ranked.filter(candidate => !candidate.fullAlignment)].slice(0, limit);
    }
    if (strategy === 'onePerBook') return uniqueFirst(ranked, candidate => candidate.bookSlug, limit);
    if (strategy === 'onePerDataset') return uniqueFirst(ranked, candidate => candidate.datasetId, limit);

    // Recommended: preserve strong matches, but avoid filling every column with
    // nearly identical results from the same book or the same imported dataset.
    const selected = [];
    const remaining = [...ranked];
    while (remaining.length && selected.length < limit) {
      let bestIndex = 0;
      let bestUtility = Number.NEGATIVE_INFINITY;
      remaining.forEach((candidate, index) => {
        const sameBook = selected.filter(item => item.bookSlug === candidate.bookSlug).length;
        const sameDataset = selected.filter(item => item.datasetId === candidate.datasetId).length;
        const utility = synopsisCandidateScore(candidate, record) - (sameBook * 0.18) - (sameDataset * 0.05);
        if (utility > bestUtility) {
          bestUtility = utility;
          bestIndex = index;
        }
      });
      selected.push(remaining.splice(bestIndex, 1)[0]);
    }
    return selected;
  }

  function uniqueFirst(candidates, keyFn, limit) {
    const chosen = [];
    const used = new Set();
    for (const candidate of candidates) {
      const key = keyFn(candidate) || candidate.id;
      if (used.has(key)) continue;
      chosen.push(candidate);
      used.add(key);
      if (chosen.length >= limit) return chosen;
    }
    for (const candidate of candidates) {
      if (chosen.some(item => item.id === candidate.id)) continue;
      chosen.push(candidate);
      if (chosen.length >= limit) break;
    }
    return chosen;
  }

  function applySynopsisStrategy(record, render = true) {
    if (!record || state.synopsis.strategy === 'manual') {
      if (render) renderSynopsis();
      return [];
    }
    const chosen = smartCandidatesForRecord(record, state.synopsis.strategy, state.synopsis.topCount);
    if (chosen.length) state.synopsis.candidatesByRecord.set(record.id, new Set(chosen.map(candidate => candidate.id)));
    else state.synopsis.candidatesByRecord.delete(record.id);
    if (render) {
      renderSynopsis();
      renderCandidateList();
      renderSynopsisIndicators();
    }
    return chosen;
  }

  function applySynopsisStrategyToCurrent(showMessage = false) {
    const record = activeRecord();
    const chosen = applySynopsisStrategy(record, false);
    renderSynopsis();
    renderCandidateList();
    renderSynopsisIndicators();
    if (showMessage) {
      const label = synopsisStrategyLabel(state.synopsis.strategy);
      showToast(chosen.length ? `נבחרו ${chosen.length} מועמדים לפי “${label}”.` : 'לא נמצאו מועמדים מתאימים.', chosen.length ? 'success' : 'info');
    }
  }

  function synopsisStrategyLabel(strategy) {
    return ({
      recommended: 'חוזק וגיוון',
      strongest: 'החזקים ביותר',
      onePerBook: 'מועמד מוביל מכל ספר',
      onePerDataset: 'מועמד מוביל מכל דאטהסט',
      fullAlignment: 'יישור מלא תחילה',
      manual: 'בחירה ידנית'
    })[strategy] || strategy;
  }

  function setSynopsisMode(mode) {
    state.synopsis.mode = mode === 'continuous' ? 'continuous' : 'single';
    renderSynopsis();
    savePreferences();
  }

  function selectSynopsisRecord(recordId) {
    const record = state.model?.getRecord(recordId);
    if (!record) return;
    selectRecord(record.id, false);
    if (state.synopsis.autoApply && state.synopsis.strategy !== 'manual') applySynopsisStrategy(record, false);
    renderAll();
  }

  function navigateSynopsisRecord(direction) {
    if (!state.visibleRecords.length) return;
    const index = Math.max(0, state.visibleRecords.findIndex(record => record.id === state.activeRecordId));
    const nextIndex = TR.utils.clamp(index + direction, 0, state.visibleRecords.length - 1);
    if (nextIndex === index) return;
    selectSynopsisRecord(state.visibleRecords[nextIndex].id);
  }

  function renderSynopsisRecordNavigation() {
    const options = state.visibleRecords.map((record, index) => {
      const selected = record.id === state.activeRecordId ? ' selected' : '';
      return `<option value="${TR.utils.escapeHtml(record.id)}"${selected}>${index + 1}. ${TR.utils.escapeHtml(sourceCanonicalRef(record))}</option>`;
    }).join('');
    els.synopsisRecordSelect.innerHTML = options;
    const index = state.visibleRecords.findIndex(record => record.id === state.activeRecordId);
    els.synopsisRecordPosition.textContent = index >= 0 ? `${index + 1} מתוך ${state.visibleRecords.length}` : '—';
    els.synopsisPrevRecordBtn.disabled = index <= 0;
    els.synopsisNextRecordBtn.disabled = index < 0 || index >= state.visibleRecords.length - 1;
  }

  function continuousRecordsFromCurrent() {
    if (!state.visibleRecords.length) return [];
    const start = Math.max(0, state.visibleRecords.findIndex(record => record.id === state.activeRecordId));
    return state.visibleRecords.slice(start, start + state.synopsis.continuousCount);
  }

  function renderContinuousSynopsis() {
    if (!state.model || state.synopsis.mode !== 'continuous') return;
    const records = continuousRecordsFromCurrent();
    if (!records.length) {
      els.continuousSynopsis.innerHTML = '<div class="continuous-empty">אין קטעי מקור להצגה ברצף.</div>';
      return;
    }
    const strategy = state.synopsis.strategy === 'manual' ? 'recommended' : state.synopsis.strategy;
    const rows = records.map((record, rowIndex) => {
      let candidates = state.synopsis.strategy === 'manual'
        ? smartCandidatesForRecord(record, 'manual', state.synopsis.topCount)
        : smartCandidatesForRecord(record, strategy, state.synopsis.topCount);
      if (!candidates.length && state.synopsis.strategy === 'manual') candidates = smartCandidatesForRecord(record, 'recommended', state.synopsis.topCount);
      const sourceHtml = buildUnionSourceHtml(record, candidates);
      const candidateColumns = candidates.map(candidate => continuousColumnHtml(record, candidate)).join('');
      return `<article class="continuous-passage ${record.id === state.activeRecordId ? 'is-active' : ''}" data-continuous-record="${TR.utils.escapeHtml(record.id)}">
        <header class="continuous-passage-head">
          <div><h3>${TR.utils.escapeHtml(sourceCanonicalRef(record))}</h3><p>קטע ${state.visibleRecords.indexOf(record) + 1} מתוך ${state.visibleRecords.length} · ${candidates.length} מועמדים · ${TR.utils.escapeHtml(synopsisStrategyLabel(strategy))}</p></div>
          <div class="continuous-passage-actions">
            <button type="button" class="text-button" data-use-continuous-record="${TR.utils.escapeHtml(record.id)}">פתח כסינופסיס יחיד</button>
            <button type="button" class="text-button" data-open-continuous-record="${TR.utils.escapeHtml(record.id)}">פתח בקריאה</button>
          </div>
        </header>
        <div class="continuous-columns" data-continuous-row="${rowIndex}" style="--continuous-column-width:${Math.max(300, Math.min(460, state.synopsis.columnWidth))}px">
          <article class="continuous-column continuous-source-column">
            <header class="continuous-column-head"><span>ספר המקור</span><h4>${TR.utils.escapeHtml(sourceBookTitle(record))}</h4><p>${TR.utils.escapeHtml(sourceCanonicalRef(record))}</p></header>
            <div class="continuous-column-text">${sourceHtml}</div>
            <footer class="continuous-column-foot">מול ${candidates.length} מועמדים שנבחרו עבור קטע זה</footer>
          </article>
          ${candidateColumns || '<article class="continuous-column"><header class="continuous-column-head"><span>הדאטהסט</span><h4>אין מועמדים</h4></header><div class="continuous-column-text"><p class="empty-inline">אין מועמדים המתאימים למסננים.</p></div><footer class="continuous-column-foot"></footer></article>'}
        </div>
      </article>`;
    }).join('');
    const lastRecord = records[records.length - 1];
    const lastIndex = state.visibleRecords.indexOf(lastRecord);
    const more = lastIndex < state.visibleRecords.length - 1
      ? `<div class="continuous-load-more"><button type="button" class="secondary-button" data-continuous-next="${TR.utils.escapeHtml(state.visibleRecords[lastIndex + 1].id)}">המשך לקטעים הבאים</button></div>`
      : '';
    els.continuousSynopsis.innerHTML = rows + more;
    wireContinuousSynopsisScroll();
    els.synopsisStageTitle.textContent = `קריאה רציפה · ${records.length} קטעי מקור`;
    els.synopsisStageNote.textContent = `כל שורה מציגה קטע מספר המקור מול ${state.synopsis.topCount} מועמדים לכל היותר; הספרים יכולים להשתנות מקטע לקטע.`;
    els.synopsisMetadataProgress.textContent = '';
  }

  function continuousColumnHtml(record, candidate) {
    const color = TR.utils.hashColor(candidate.bookSlug);
    return `<article class="continuous-column continuous-candidate-column" style="--column-color:${color}">
      <header class="continuous-column-head"><span>מועמד מן הדאטהסט</span><h4>${TR.utils.escapeHtml(candidate.bookTitle)}</h4><p>${TR.utils.escapeHtml(candidate.displayRef)}</p></header>
      <div class="continuous-column-text">${TR.utils.alignedTextHtml(candidate.details, 'candidate', { color })}</div>
      <footer class="continuous-column-foot">${TR.utils.percent(candidate.normScore, 1)} · יישור ${TR.utils.percent(candidate.alignmentScore, 1)} · score ${TR.utils.compactNumber(candidate.score, 0)}</footer>
    </article>`;
  }

  function wireContinuousSynopsisScroll() {
    TR.utils.$$('[data-continuous-row]', els.continuousSynopsis).forEach(row => {
      const scrollers = TR.utils.$$('.continuous-column-text', row);
      let syncing = false;
      scrollers.forEach(scroller => scroller.addEventListener('scroll', () => {
        if (!state.synopsis.syncScroll || syncing) return;
        const max = scroller.scrollHeight - scroller.clientHeight;
        const ratio = max > 0 ? scroller.scrollTop / max : 0;
        syncing = true;
        scrollers.forEach(other => {
          if (other === scroller) return;
          const otherMax = other.scrollHeight - other.clientHeight;
          other.scrollTop = ratio * Math.max(0, otherMax);
        });
        requestAnimationFrame(() => { syncing = false; });
      }));
    });
  }

  function handleContinuousSynopsisClick(event) {
    const next = event.target.closest('[data-continuous-next]');
    if (next) {
      selectSynopsisRecord(next.dataset.continuousNext);
      return;
    }
    const single = event.target.closest('[data-use-continuous-record]');
    if (single) {
      const record = state.model?.getRecord(single.dataset.useContinuousRecord);
      if (!record) return;
      selectRecord(record.id, false);
      if (state.synopsis.strategy !== 'manual') applySynopsisStrategy(record, false);
      state.synopsis.mode = 'single';
      renderAll();
      return;
    }
    const reading = event.target.closest('[data-open-continuous-record]');
    if (reading) {
      selectRecord(reading.dataset.openContinuousRecord, false);
      setView('read');
      renderAll();
    }
  }

  function renderSynopsis() {
    if (!state.model) return;
    cleanupSynopsisSelections();
    els.syncSynopsisScrollInput.checked = state.synopsis.syncScroll;
    els.synopsisColumnWidthInput.value = String(state.synopsis.columnWidth);
    els.synopsisTopCountInput.value = String(state.synopsis.topCount);
    els.synopsisStrategySelect.value = state.synopsis.strategy;
    els.synopsisAutoApplyInput.checked = state.synopsis.autoApply;
    els.continuousPassageCountInput.value = String(state.synopsis.continuousCount);
    els.synopsisGrid.style.setProperty('--synopsis-column-width', `${state.synopsis.columnWidth}px`);
    els.synopsisView.dataset.synopsisMode = state.synopsis.mode;
    els.synopsisModeButtons.forEach(button => button.classList.toggle('is-active', button.dataset.synopsisMode === state.synopsis.mode));
    TR.utils.$$('.continuous-only').forEach(element => { element.hidden = state.synopsis.mode !== 'continuous'; });
    els.synopsisGrid.hidden = state.synopsis.mode !== 'single';
    els.continuousSynopsis.hidden = state.synopsis.mode !== 'continuous';
    renderSynopsisRecordNavigation();
    if (state.synopsis.mode === 'continuous') {
      renderContinuousSynopsis();
    } else {
      renderSynopsisPicker();
      renderCandidateSynopsisStage();
    }
    renderSynopsisIndicators();
  }

  function renderSynopsisPicker() {
    const fragment = document.createDocumentFragment();
    const record = activeRecord();
    els.synopsisBuilderTitle.textContent = record ? `מועמדי הדאטהסט מול ${sourceCanonicalRef(record)}` : 'מועמדי הדאטהסט לבחירה';
    const candidates = record ? state.model.getCandidates(record.id, state.filters) : [];
    const selected = selectedCandidatesForRecord(record?.id);
    els.synopsisSelectionCount.textContent = `${selected.size} נבחרו`;
    if (!candidates.length) fragment.append(emptyMessage('אין קטעים מן הדאטהסט המתאימים למסננים.'));
    candidates.forEach((candidate, index) => {
      const label = document.createElement('label');
      label.className = 'synopsis-picker-item';
      label.style.setProperty('--candidate-color', TR.utils.hashColor(candidate.bookSlug));
      label.innerHTML = `
        <input type="checkbox" data-synopsis-kind="candidate" data-record-id="${TR.utils.escapeHtml(record.id)}" value="${TR.utils.escapeHtml(candidate.id)}" ${selected.has(candidate.id) ? 'checked' : ''}>
        <span><b>${index + 1}. ${TR.utils.escapeHtml(candidate.bookTitle)}</b><small>${TR.utils.escapeHtml(candidate.displayRef)} · ${TR.utils.percent(candidate.normScore, 0)} · score ${TR.utils.compactNumber(candidate.score, 0)}</small><em>${TR.utils.escapeHtml(excerpt(candidate.datasetText || candidate.sourceText, 90))}</em></span>`;
      fragment.append(label);
    });
    els.synopsisPicker.replaceChildren(fragment);
  }

  function renderCandidateSynopsisStage() {
    const record = activeRecord();
    if (!record) {
      renderSynopsisEmpty('לא נבחר קטע מקור.');
      return;
    }
    const selectedIds = selectedCandidatesForRecord(record.id);
    const visibleOrder = state.model.getCandidates(record.id, state.filters);
    const visibleIds = new Set(visibleOrder.map(candidate => candidate.id));
    const order = [
      ...visibleOrder.filter(candidate => selectedIds.has(candidate.id)),
      ...record.candidates.filter(candidate => selectedIds.has(candidate.id) && !visibleIds.has(candidate.id))
    ];
    els.synopsisStageTitle.textContent = `${sourceCanonicalRef(record)} · מול ${order.length} מועמדים מן הדאטהסט`;
    els.synopsisStageNote.textContent = 'מימין מופיע קטע אחד מספר המקור. כל טור שמשמאלו הוא מועמד שנבחר עבור אותו קטע מתוך הדאטהסט בלבד.';
    if (!order.length) {
      renderSynopsisEmpty('בחר מועמד אחד או יותר מתוך הדאטהסט עבור קטע המקור הנוכחי. קטע המקור יישאר קבוע מימין.');
      return;
    }

    const sourceColumn = synopsisColumnHtml({
      kind: 'source',
      title: sourceBookTitle(record),
      ref: sourceCanonicalRef(record),
      textHtml: buildUnionSourceHtml(record, order),
      meta: `${order.length} קטעים מן הדאטהסט נבחרו`,
      recordId: record.id
    });
    const candidateColumns = order.map(candidate => {
      const color = TR.utils.hashColor(candidate.bookSlug);
      return synopsisColumnHtml({
        kind: 'candidate',
        title: candidate.bookTitle,
        ref: candidate.displayRef,
        textHtml: TR.utils.alignedTextHtml(candidate.details, 'candidate', { color }),
        meta: `ציון ${TR.utils.percent(candidate.normScore, 1)} · יישור ${TR.utils.percent(candidate.alignmentScore, 1)} · score ${TR.utils.compactNumber(candidate.score, 0)}`,
        candidateId: candidate.id,
        recordId: record.id,
        color
      });
    }).join('');
    els.synopsisGrid.innerHTML = sourceColumn + candidateColumns;
    wireSynopsisScroll();
    hydrateSynopsisMetadata([
      { key: `source:${record.id}`, candidate: record.bookPassage, element: findSynopsisMetadataElement(`source:${record.id}`) },
      ...order.map(candidate => ({ key: `candidate:${candidate.id}`, candidate, element: findSynopsisMetadataElement(`candidate:${candidate.id}`) }))
    ]);
  }

  function renderSynopsisEmpty(message) {
    els.synopsisGrid.innerHTML = `<div class="synopsis-empty"><span>≡</span><h3>הסינופסיס עדיין ריק</h3><p>${TR.utils.escapeHtml(message)}</p></div>`;
    els.synopsisMetadataProgress.textContent = '';
  }

  function synopsisColumnHtml({ kind, title, ref, textHtml, meta, candidateId = '', recordId = '', color = '#315a70' }) {
    const key = kind === 'candidate' ? `candidate:${candidateId}` : `source:${recordId}`;
    const removable = kind === 'candidate';
    return `
      <article class="synopsis-column synopsis-${kind}-column" style="--column-color:${color}" data-candidate-id="${TR.utils.escapeHtml(candidateId)}" data-record-id="${TR.utils.escapeHtml(recordId)}">
        <header class="synopsis-column-head">
          <span class="synopsis-column-kind">${kind === 'source' ? 'ספר המקור · הקטע שמולו משווים' : 'מועמד נבחר מתוך הדאטהסט'}</span>
          <h3>${TR.utils.escapeHtml(title)}</h3>
          <p>${TR.utils.escapeHtml(ref)}</p>
          <small>${TR.utils.escapeHtml(meta)}</small>
          <div class="synopsis-column-actions">
            ${kind === 'candidate' ? `<button type="button" class="text-button" data-open-candidate="${TR.utils.escapeHtml(candidateId)}" data-record-id="${TR.utils.escapeHtml(recordId)}">פתח בקריאה</button>` : ''}
            ${removable ? `<button type="button" class="text-button danger-text" data-remove-candidate="${TR.utils.escapeHtml(candidateId)}" data-record-id="${TR.utils.escapeHtml(recordId)}">הסר</button>` : ''}
          </div>
        </header>
        <div class="synopsis-text-scroll"><div class="synopsis-text aligned-text">${textHtml}</div></div>
        <footer class="synopsis-column-metadata" data-synopsis-meta="${TR.utils.escapeHtml(key)}"><span class="mini-spinner"></span> מאתר מראה מקום בספריא…</footer>
      </article>`;
  }

  function hexToRgba(hex, alpha) {
    const value = String(hex || '').replace('#', '');
    const expanded = value.length === 3 ? value.split('').map(char => char + char).join('') : value;
    const numeric = Number.parseInt(expanded, 16);
    if (!Number.isFinite(numeric)) return `rgba(47,107,80,${alpha})`;
    return `rgba(${(numeric >> 16) & 255},${(numeric >> 8) & 255},${numeric & 255},${alpha})`;
  }

  function buildUnionSourceHtml(record, candidates) {
    const tokens = String(record.originalText || '').trim().split(/\s+/).filter(Boolean);
    if (!tokens.length) return '';
    const matchesByToken = Array.from({ length: tokens.length }, () => new Map());
    candidates.forEach(candidate => {
      const color = TR.utils.hashColor(candidate.bookSlug);
      const matches = TR.utils.alignmentIndexMap(candidate.details, 'original');
      for (const [index, match] of matches.entries()) {
        if (index < 0 || index >= tokens.length) continue;
        const existing = matchesByToken[index].get(color) || { count: 0, strength: 0, labels: new Set() };
        existing.count += 1;
        existing.strength = Math.max(existing.strength, match.strength || 1);
        existing.labels.add(candidate.bookTitle);
        matchesByToken[index].set(color, existing);
      }
    });

    return tokens.map((token, index) => {
      const entries = [...matchesByToken[index].entries()];
      if (!entries.length) return `<span class="synopsis-token alignment-plain-token">${TR.utils.escapeHtml(token)}</span>`;
      const labels = [...new Set(entries.flatMap(([, entry]) => [...entry.labels]))];
      if (entries.length === 1) {
        const [color, entry] = entries[0];
        const opacity = `${Math.round((0.16 + entry.strength * 0.22) * 100)}%`;
        return `<span class="synopsis-token union-match" style="--match-color:${color};--match-opacity:${opacity}" title="מיושר אל ${TR.utils.escapeHtml(labels.join(', '))}">${TR.utils.escapeHtml(token)}</span>`;
      }
      const stops = [];
      entries.forEach(([color], position) => {
        const start = (position / entries.length) * 100;
        const finish = ((position + 1) / entries.length) * 100;
        const rgba = hexToRgba(color, 0.32);
        stops.push(`${rgba} ${start.toFixed(1)}%`, `${rgba} ${finish.toFixed(1)}%`);
      });
      return `<span class="synopsis-token union-match multi-match" style="background:linear-gradient(90deg,${stops.join(',')})" title="מיושר אל ${TR.utils.escapeHtml(labels.join(', '))}">${TR.utils.escapeHtml(token)}</span>`;
    }).join(' ');
  }

  function wireSynopsisScroll() {
    const scrollers = TR.utils.$$('.synopsis-text-scroll', els.synopsisGrid);
    let syncing = false;
    scrollers.forEach(scroller => scroller.addEventListener('scroll', () => {
      if (!state.synopsis.syncScroll || syncing) return;
      const max = scroller.scrollHeight - scroller.clientHeight;
      const ratio = max > 0 ? scroller.scrollTop / max : 0;
      syncing = true;
      scrollers.forEach(other => {
        if (other === scroller) return;
        const otherMax = other.scrollHeight - other.clientHeight;
        other.scrollTop = ratio * Math.max(0, otherMax);
      });
      requestAnimationFrame(() => { syncing = false; });
    }));
  }

  function findSynopsisMetadataElement(key) {
    return TR.utils.$$('[data-synopsis-meta]', els.synopsisGrid).find(element => element.dataset.synopsisMeta === key) || null;
  }

  async function hydrateSynopsisMetadata(items) {
    const available = items.filter(item => item.candidate && item.element);
    const runId = ++state.synopsis.metadataRunId;
    if (!available.length) {
      els.synopsisMetadataProgress.textContent = '';
      return;
    }
    let complete = 0;
    els.synopsisMetadataProgress.textContent = `מטא־דאטה 0/${available.length}`;
    const queue = [...available];
    const workers = Array.from({ length: Math.min(4, queue.length) }, async () => {
      while (queue.length) {
        const item = queue.shift();
        if (!item) break;
        try {
          const metadata = await getCandidateMetadata(item.candidate);
          if (runId !== state.synopsis.metadataRunId) return;
          item.element.innerHTML = synopsisMetadataHtml(metadata, item.candidate);
        } catch (error) {
          if (runId !== state.synopsis.metadataRunId) return;
          item.element.innerHTML = `<span class="metadata-warning">${TR.utils.escapeHtml(error.message)}</span>`;
        }
        complete += 1;
        if (runId === state.synopsis.metadataRunId) els.synopsisMetadataProgress.textContent = `מטא־דאטה ${complete}/${available.length}`;
      }
    });
    await Promise.all(workers);
  }

  function synopsisMetadataHtml(metadata, candidate) {
    const ref = metadata?.heRef || metadata?.canonicalRef || candidate.displayRef;
    const method = diagnosticMethodLabel(metadata?.resolution);
    const warning = metadata?.resolutionProblem ? `<span class="synopsis-meta-warning">${TR.utils.escapeHtml(metadata.resolutionProblem)}</span>` : '';
    return `<span><b>${TR.utils.escapeHtml(ref)}</b><small>${TR.utils.escapeHtml(method)}</small>${warning}</span>${metadata?.url ? `<a href="${TR.utils.escapeHtml(metadata.url)}" target="_blank" rel="noopener">ספריא ↗</a>` : ''}`;
  }

  function handleSynopsisGridClick(event) {
    const removeCandidate = event.target.closest('[data-remove-candidate]');
    if (removeCandidate) {
      toggleCandidateSynopsis(removeCandidate.dataset.recordId, removeCandidate.dataset.removeCandidate, false);
      return;
    }
    const openCandidate = event.target.closest('[data-open-candidate]');
    if (openCandidate) {
      selectRecord(openCandidate.dataset.recordId, false);
      state.activeCandidateId = openCandidate.dataset.openCandidate;
      setView('read');
      renderAll();
      return;
    }
  }

  function exportSynopsisHtml() {
    const continuous = state.synopsis.mode === 'continuous';
    const sourceElement = continuous ? els.continuousSynopsis : els.synopsisGrid;
    const hasContent = continuous
      ? sourceElement.querySelector('.continuous-passage')
      : sourceElement.querySelector('.synopsis-column');
    if (!state.model || !hasContent) {
      showToast('יש לבחור טקסטים לפני הייצוא.', 'error');
      return;
    }
    const clone = sourceElement.cloneNode(true);
    clone.querySelectorAll('button, .mini-spinner').forEach(element => element.remove());
    const title = continuous
      ? `סינופסיס רציף החל מ־${sourceCanonicalRef(activeRecord())}`
      : `סינופסיס ${sourceCanonicalRef(activeRecord())}`;
    const html = `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><title>${TR.utils.escapeHtml(title)}</title><style>
      body{font-family:Arial,sans-serif;margin:0;padding:24px;background:#f3f5f7;color:#17212b}h1{font-family:Georgia,serif}.synopsis-grid,.continuous-columns{display:flex;gap:12px;overflow:auto;align-items:stretch;direction:rtl}.synopsis-column,.continuous-column{flex:0 0 380px;background:white;border:1px solid #dbe2e8;border-radius:12px;overflow:hidden}.synopsis-column-head,.continuous-column-head{padding:14px;border-bottom:1px solid #dbe2e8}.synopsis-column-head h3,.continuous-column-head h4{margin:4px 0}.synopsis-column-head p,.synopsis-column-head small,.continuous-column-head p{color:#637180}.synopsis-text-scroll,.continuous-column-text{padding:18px;max-height:70vh;overflow:auto;font-family:Georgia,'Times New Roman',serif;font-size:1.08rem;line-height:2}.continuous-passage{margin:0 0 20px;padding:12px;background:#fff;border:1px solid #dbe2e8;border-radius:12px}.continuous-passage-head{padding:8px 4px}.alignment-token,.union-match{border-radius:3px}.alignment-token.exact,.union-match{background:color-mix(in srgb,var(--match-color,#2f6b50) var(--match-opacity,32%),transparent);box-shadow:inset 0 -2px 0 var(--match-color,#2f6b50)}.alignment-token.related{background:color-mix(in srgb,var(--match-color,#6b5a91) 22%,transparent)}.alignment-token.fuzzy{background:color-mix(in srgb,var(--match-color,#9b7048) 18%,transparent)}.synopsis-column-metadata,.continuous-column-foot{padding:12px;border-top:1px solid #dbe2e8;font-size:.8rem}</style></head><body><h1>${TR.utils.escapeHtml(title)}</h1>${clone.outerHTML}</body></html>`;
    TR.utils.downloadText(`synopsis_${continuous ? 'continuous_' : ''}${Date.now()}.html`, html, 'text/html;charset=utf-8');
    showToast('קובץ הסינופסיס נוצר.', 'success');
  }

  function renderDiagnostics() {
    if (!state.model) return;
    const diagnosticsModeLabel = {
      all: t('הכול', 'All'),
      sefariaOnly: t('ספריא בלבד', 'Sefaria only'),
      nonSefariaOnly: t('לא-ספריא בלבד', 'Non-Sefaria only')
    }[state.diagnostics.mode] || t('הכול', 'All');
    const issues = state.model.structuralIssues || { total: 0, byCode: [], byDataset: [] };
    const issueCards = issues.byCode.length
      ? issues.byCode.map(item => `<div><span>${TR.utils.escapeHtml(issueLabel(item.code))}</span><strong>${item.count}</strong></div>`).join('')
      : '<div><span>מבנה מקומי</span><strong>תקין</strong></div>';
    const resolved = state.diagnostics.results.filter(result => result.ok).length;
    const failed = state.diagnostics.results.filter(result => !result.ok).length;
    els.diagnosticSummary.innerHTML = `
      <div><span>מועמדים</span><strong>${TR.utils.compactNumber(state.model.candidateCount, 0)}</strong></div>
      <div><span>${TR.utils.escapeHtml(t('מצב בדיקה', 'Diagnostics mode'))}</span><strong>${TR.utils.escapeHtml(diagnosticsModeLabel)}</strong></div>
      <div><span>הערות מבניות</span><strong>${TR.utils.compactNumber(issues.total, 0)}</strong></div>
      ${issueCards}
      ${state.diagnostics.results.length ? `<div><span>דגימות שנפתרו</span><strong>${resolved}/${state.diagnostics.results.length}</strong></div><div><span>דגימות שלא נפתרו</span><strong>${failed}</strong></div>` : ''}`;

    if (!state.diagnostics.results.length) {
      const structuralRows = issues.byDataset.map(dataset => `
        <tr><td>${TR.utils.escapeHtml(dataset.label)}</td><td>${dataset.candidates} מועמדים עם הערות מבניות</td><td>תבנית היררכית v3</td><td><span class="diagnostic-state ${dataset.issueCount ? 'is-warning' : 'is-ok'}">${dataset.issueCount ? `${dataset.issueCount} הערות` : 'תקין'}</span></td><td>בדיקה מקומית</td><td>${TR.utils.escapeHtml(dataset.codes.map(item => `${issueLabel(item.code)}: ${item.count}`).join(' · '))}</td></tr>`).join('');
      els.diagnosticTableBody.innerHTML = structuralRows || '<tr><td colspan="6" class="empty-table">לא נמצאו בעיות מבניות. לחץ על הבדיקה כדי לאמת דגימות מול ספריא.</td></tr>';
      return;
    }

    els.diagnosticTableBody.innerHTML = state.diagnostics.results.map(result => {
      const candidate = result.candidate;
      const template = result.parsed?.refCandidates?.[0] || result.parsed?.display || '';
      const issueText = [result.problem, ...(result.structuralIssues || []).map(issue => issue.message)].filter(Boolean).join(' ');
      return `<tr>
        <td>${TR.utils.escapeHtml(candidate.datasetLabel)}</td>
        <td><b>${TR.utils.escapeHtml(candidate.bookTitle)}</b><small>${TR.utils.escapeHtml(candidate.sourceLocation)}</small></td>
        <td>${TR.utils.escapeHtml(template)}</td>
        <td>${result.ok ? `<a href="${TR.utils.escapeHtml(result.url)}" target="_blank" rel="noopener">${TR.utils.escapeHtml(result.ref)} ↗</a>` : '<span class="diagnostic-state is-error">לא נפתר</span>'}</td>
        <td>${TR.utils.escapeHtml(diagnosticMethodLabel(result.resolution))}</td>
        <td>${TR.utils.escapeHtml(issueText || 'התבנית זוהתה ואומתה.')}</td>
      </tr>`;
    }).join('');
  }

  async function runDiagnostics() {
    if (!state.model || state.diagnostics.running) return;
    state.diagnostics.running = true;
    els.runDiagnosticsBtn.disabled = true;
    const perBook = TR.utils.clamp(Number(els.diagnosticSampleInput.value) || 1, 1, 5);
    const pool = state.model.getCandidatePoolByDiagnosticsMode(state.diagnostics.mode);
    if (!pool.length) {
      state.diagnostics.running = false;
      els.runDiagnosticsBtn.disabled = false;
      showToast(t('אין מועמדים מתאימים למצב הבדיקה שנבחר.', 'No candidates match the selected diagnostics mode.'), 'info');
      renderDiagnostics();
      return;
    }
    const grouped = new Map();
    for (const candidate of pool) {
      const list = grouped.get(candidate.bookSlug) || [];
      if (!list.some(item => item.sourceLocation === candidate.sourceLocation) && list.length < perBook) list.push(candidate);
      grouped.set(candidate.bookSlug, list);
    }
    const selectedPriority = [];
    state.synopsis.candidatesByRecord.forEach(ids => ids.forEach(id => {
      const candidate = state.model.candidateMap.get(id);
      if (candidate) selectedPriority.push(candidate);
    }));
    const samples = [];
    const seen = new Set();
    for (const candidate of [...selectedPriority, ...[...grouped.values()].flat()]) {
      if (seen.has(candidate.sourceLocation)) continue;
      seen.add(candidate.sourceLocation);
      samples.push(candidate);
    }
    state.diagnostics.results = [];
    renderDiagnostics();
    let complete = 0;
    const queue = [...samples];
    const workers = Array.from({ length: Math.min(4, queue.length || 1) }, async () => {
      while (queue.length) {
        const candidate = queue.shift();
        if (!candidate) break;
        const result = await sefaria.diagnoseCandidate(candidate);
        state.diagnostics.results.push(result);
        complete += 1;
        els.runDiagnosticsBtn.textContent = `בודק ${complete}/${samples.length}`;
        if (complete % 4 === 0 || complete === samples.length) renderDiagnostics();
      }
    });
    await Promise.all(workers);
    state.diagnostics.running = false;
    els.runDiagnosticsBtn.disabled = false;
    els.runDiagnosticsBtn.textContent = t('בדוק דגימות', 'Run diagnostics');
    renderDiagnostics();
    showToast(t(
      `האבחון הסתיים: ${state.diagnostics.results.filter(item => item.ok).length} מתוך ${samples.length} דגימות נפתרו.`,
      `Diagnostics complete: ${state.diagnostics.results.filter(item => item.ok).length} of ${samples.length} samples resolved.`
    ), state.diagnostics.results.some(item => !item.ok) ? 'info' : 'success');
  }

  function issueLabel(code) {
    return ({
      'missing-location': 'location חסר',
      'missing-separator': 'המפריד __ חסר',
      'missing-categories': 'קטגוריות חסרות',
      'book-mismatch': 'אי־התאמה בשם הספר',
      'missing-suffix': 'יחידה פנימית חסרה',
      'missing-address': 'כתובת מספרית חסרה',
      'nested-work-path': 'החיבור נמצא באמצע הנתיב',
      'mixed-hierarchy-address': 'ערבוב כותרת וכתובת בנתיב'
    })[code] || code;
  }

  function diagnosticMethodLabel(method) {
    return ({
      'fixed-template': 'תבנית קבועה',
      'hierarchy-template': 'נתיב היררכי מאומת',
      'schema-template': 'סכמת הספר',
      'name-autocomplete': 'השלמה של ספריא',
      'direct': 'מראה מקום ישיר',
      'autocomplete': 'השלמה של ספריא',
      'unresolved': 'לא נפתר',
      'network-error': 'שגיאת רשת',
      'search': 'חיפוש בלבד'
    })[method] || method || 'ממתין';
  }

  function renderActiveVisualization() {
    if (state.activeView === 'synopsis') renderSynopsis();
    else if (state.activeView === 'reverse') renderReverse();
    else if (state.activeView === 'matrix') renderMatrix();
    else if (state.activeView === 'network') renderNetwork();
    else if (state.activeView === 'scatter') renderScatter();
    else if (state.activeView === 'library') renderLibrary();
    else if (state.activeView === 'diagnostics') renderDiagnostics();
  }

  function setView(view) {
    state.activeView = view || 'read';
    if (state.activeView === 'synopsis' && state.synopsis.autoApply && state.synopsis.strategy !== 'manual') {
      const record = activeRecord();
      if (record && !selectedCandidatesForRecord(record.id).size) applySynopsisStrategy(record, false);
    }
    els.tabs.forEach(tab => {
      const active = tab.dataset.view === state.activeView;
      tab.classList.toggle('is-active', active);
      tab.setAttribute('aria-selected', String(active));
    });
    els.views.forEach(panel => panel.classList.toggle('is-active', panel.dataset.view === state.activeView));
    renderActiveVisualization();
    savePreferences();
  }

  function selectRecord(recordId, rerender = true) {
    const record = state.model?.getRecord(recordId);
    if (!record) return;
    state.activeRecordId = record.id;
    state.activeCandidateId = state.model.getCandidates(record.id, state.filters)[0]?.id || chooseDefaultCandidate(record)?.id || null;
    if (rerender) renderAll();
  }

  function selectCandidate(candidateId) {
    state.activeCandidateId = candidateId;
    renderComparison();
    renderCandidateList();
    savePreferences();
  }

  function stepRecord(direction) {
    if (!state.visibleRecords.length) return;

    if (state.reverse.sequenceLocked && state.reverse.sequenceRecordIds.length) {
      const sequenceIndex = state.reverse.sequenceRecordIds.indexOf(state.activeRecordId);
      const baseIndex = sequenceIndex >= 0 ? sequenceIndex : (state.reverse.sequenceIndex >= 0 ? state.reverse.sequenceIndex : 0);
      openReverseSequenceAt(baseIndex + direction);
      return;
    }

    const index = Math.max(0, state.visibleRecords.findIndex(record => record.id === state.activeRecordId));
    const next = state.visibleRecords[(index + direction + state.visibleRecords.length) % state.visibleRecords.length];
    selectRecord(next.id);
  }

  function stepCandidate(direction) {
    const candidates = state.model?.getCandidates(state.activeRecordId, state.filters) || [];
    if (!candidates.length) return;
    const index = Math.max(0, candidates.findIndex(candidate => candidate.id === state.activeCandidateId));
    const next = candidates[(index + direction + candidates.length) % candidates.length];
    selectCandidate(next.id);
  }

  function updateAfterFilters(resetCandidate = true) {
    if (!state.model) return;
    if (resetCandidate) state.activeCandidateId = null;
    renderAll();
  }

  function resetFilters() {
    state.filters = {
      query: '', minNorm: 0, minScore: 0, exactOnly: false,
      sortBy: 'normScore', bookSlugs: [], categories: []
    };
    syncControlsFromState();
    renderBookMultiOptions();
    renderCategoryMultiOptions();
    updateAfterFilters();
  }

  function syncControlsFromState() {
    els.searchInput.value = state.filters.query;
    els.minNormInput.value = String(state.filters.minNorm);
    els.minNormValue.textContent = TR.utils.percent(state.filters.minNorm, 0);
    els.minScoreInput.value = String(state.filters.minScore);
    els.minScoreValue.textContent = TR.utils.compactNumber(state.filters.minScore, 0);
    els.exactOnlyInput.checked = state.filters.exactOnly;
    els.sortSelect.value = state.filters.sortBy;
    els.matrixMetricSelect.value = state.matrix.metric;
    els.matrixGranularitySelect.value = state.matrix.granularity;
    els.matrixBooksInput.value = String(state.matrix.books);
    els.matrixBooksValue.textContent = String(state.matrix.books);
    els.networkModeSelect.value = state.network.mode;
    els.networkThresholdInput.value = String(state.network.minNorm);
    els.networkThresholdValue.textContent = TR.utils.percent(state.network.minNorm, 0);
    els.syncSynopsisScrollInput.checked = state.synopsis.syncScroll;
    els.synopsisColumnWidthInput.value = String(state.synopsis.columnWidth);
    els.synopsisTopCountInput.value = String(state.synopsis.topCount);
    els.synopsisStrategySelect.value = state.synopsis.strategy;
    els.synopsisAutoApplyInput.checked = state.synopsis.autoApply;
    els.continuousPassageCountInput.value = String(state.synopsis.continuousCount);
    els.diagnosticSampleInput.value = String(state.diagnostics.samplePerBook);
    els.diagnosticModeSelect.value = state.diagnostics.mode;
    els.reverseDatasetModeSelect.value = state.reverse.mode;
    els.reverseOrderSelect.value = state.reverse.orderBy;
    els.reverseTopInput.value = String(state.reverse.topCount);
    if (state.model) {
      updateDatasetSummary();
      updateBookSummary();
      updateCategorySummary();
      refreshReverseOptions(false);
    }
  }

  function exportCsv() {
    if (!state.model) return;
    const csv = `\uFEFF${state.model.toCsv(state.filters)}`;
    const safeLabel = state.model.label.replace(/\.json$/i, '').replace(/[^\w\u0590-\u05FF-]+/g, '_');
    TR.utils.downloadText(`${safeLabel}_filtered_textreuse.csv`, csv, 'text/csv;charset=utf-8');
    showToast('קובץ ה־CSV נוצר לפי כל המאגרים והמסננים הפעילים.', 'success');
  }

  function handleKeyboard(event) {
    if (['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'].includes(document.activeElement?.tagName)) return;
    if (state.activeView === 'read') {
      if (event.key === 'ArrowDown') { event.preventDefault(); stepRecord(1); }
      if (event.key === 'ArrowUp') { event.preventDefault(); stepRecord(-1); }
      if (event.key === 'ArrowLeft') { event.preventDefault(); stepCandidate(1); }
      if (event.key === 'ArrowRight') { event.preventDefault(); stepCandidate(-1); }
      return;
    }
    if (state.activeView === 'synopsis') {
      if (event.key === 'ArrowDown' || event.key === 'PageDown') { event.preventDefault(); navigateSynopsisRecord(1); }
      if (event.key === 'ArrowUp' || event.key === 'PageUp') { event.preventDefault(); navigateSynopsisRecord(-1); }
    }
  }

  function savePreferences() {
    try {
      localStorage.setItem(TR.config.storageKeys.preferences, JSON.stringify({
        filters: state.filters,
        matrix: state.matrix,
        network: { ...state.network, selected: null },
        synopsis: {
          topCount: state.synopsis.topCount,
          syncScroll: state.synopsis.syncScroll,
          columnWidth: state.synopsis.columnWidth,
          mode: state.synopsis.mode,
          strategy: state.synopsis.strategy,
          autoApply: state.synopsis.autoApply,
          continuousCount: state.synopsis.continuousCount
        },
        diagnostics: {
          samplePerBook: state.diagnostics.samplePerBook,
          mode: state.diagnostics.mode
        },
        reverse: {
          mode: state.reverse.mode,
          topCount: state.reverse.topCount,
          orderBy: state.reverse.orderBy,
          sequenceLocked: state.reverse.sequenceLocked
        },
        activeView: state.activeView
      }));
    } catch { /* Ignore storage errors. */ }
  }

  function restorePreferences() {
    try {
      const saved = JSON.parse(localStorage.getItem(TR.config.storageKeys.preferences) || '{}');
      if (saved.filters) {
        state.filters = { ...state.filters, ...saved.filters };
        if (saved.filters.bookSlug && !saved.filters.bookSlugs) state.filters.bookSlugs = [saved.filters.bookSlug];
        if (!Array.isArray(state.filters.bookSlugs)) state.filters.bookSlugs = [];
        if (!Array.isArray(state.filters.categories)) state.filters.categories = [];
      }
      if (saved.matrix) state.matrix = { ...state.matrix, ...saved.matrix };
      if (saved.network) state.network = { ...state.network, ...saved.network, selected: null };
      if (!['cooccurrence', 'source', 'sourceGeniza'].includes(state.network.mode)) state.network.mode = 'cooccurrence';
      if (saved.synopsis) {
        state.synopsis = { ...state.synopsis, ...saved.synopsis, candidatesByRecord: new Map(), metadataRunId: 0 };
        state.synopsis.topCount = TR.utils.clamp(Number(state.synopsis.topCount) || 3, 1, 12);
        state.synopsis.continuousCount = TR.utils.clamp(Number(state.synopsis.continuousCount) || 8, 2, 30);
        state.synopsis.mode = state.synopsis.mode === 'continuous' ? 'continuous' : 'single';
        if (!['recommended', 'strongest', 'onePerBook', 'onePerDataset', 'fullAlignment', 'manual'].includes(state.synopsis.strategy)) state.synopsis.strategy = 'recommended';
        state.synopsis.autoApply = state.synopsis.autoApply !== false;
      }
      if (saved.diagnostics) {
        state.diagnostics = { ...state.diagnostics, ...saved.diagnostics };
        if (!['all', 'sefariaOnly', 'nonSefariaOnly'].includes(state.diagnostics.mode)) state.diagnostics.mode = 'all';
      }
      if (saved.reverse) {
        state.reverse = { ...state.reverse, ...saved.reverse };
        if (!['book', 'genizaAll', 'genizaFragment', 'vrrManuscript'].includes(state.reverse.mode)) state.reverse.mode = 'book';
        state.reverse.topCount = TR.utils.clamp(Number(state.reverse.topCount) || 30, 3, 120);
        if (!['source', 'score'].includes(state.reverse.orderBy)) state.reverse.orderBy = 'source';
        state.reverse.sequenceRecordIds = [];
        state.reverse.sequenceIndex = -1;
        state.reverse.sequenceLocked = Boolean(state.reverse.sequenceLocked);
      }
    } catch { /* Ignore malformed storage. */ }
  }

  function setLoading(active, title = '', detail = '', progress = 0) {
    state.loading = active;
    clearTimeout(state.loadingFallbackTimer);
    els.loadingOverlay.hidden = !active;
    els.loadingDismissBtn.hidden = true;
    if (!active) return;
    els.loadingTitle.textContent = title;
    els.loadingDetail.textContent = detail;
    els.loadingProgress.style.width = `${TR.utils.clamp(progress, 0, 100)}%`;
    state.loadingFallbackTimer = setTimeout(() => {
      if (state.loading && state.model) els.loadingDismissBtn.hidden = false;
    }, 7000);
  }

  function forceOpenWorkspace() {
    if (!state.model) return;
    showWorkspace();
    setLoading(false);
    try { renderAll(); } catch (error) { showToast(`שגיאה בתצוגה: ${error.message}`, 'error'); }
  }

  function handleStartupError(event) {
    const error = event?.reason || event?.error;
    if (!state.loading) return;
    if (state.model) showWorkspace();
    setLoading(false);
    showToast(`שגיאה באתחול: ${error?.message || 'שגיאה לא מזוהה'}`, 'error');
  }

  function showEmptyState(message) {
    els.workspace.hidden = true;
    els.emptyState.hidden = false;
    const messageElement = els.emptyState.querySelector('[data-empty-message]');
    if (messageElement) messageElement.textContent = message;
  }

  function showWorkspace() {
    els.emptyState.hidden = true;
    els.workspace.hidden = false;
  }

  function showToast(message, type = 'info') {
    els.toast.textContent = message;
    els.toast.dataset.type = type;
    els.toast.hidden = false;
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => { els.toast.hidden = true; }, 4200);
  }

  function emptyMessage(text) {
    const element = document.createElement('div');
    element.className = 'empty-list';
    element.textContent = text;
    return element;
  }

  function excerpt(text, maxLength) {
    const normalized = String(text || '').replace(/\s+/g, ' ').trim();
    return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1)}…` : normalized;
  }

  function formatDateRange(value) {
    if (!Array.isArray(value) || !value.length) return '';
    return value.length === 1 || value[0] === value[1] ? String(value[0]) : `${value[0]}–${value[1]}`;
  }

  function metadataStateLabel(status) {
    return ({ ready: 'נטען', loading: 'טוען', error: 'שגיאה', idle: 'ממתין' })[status] || 'ממתין';
  }

  function formatBytes(bytes) {
    const value = Number(bytes || 0);
    if (value < 1024) return `${value} B`;
    if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
    return `${(value / 1024 / 1024).toFixed(1)} MB`;
  }

  document.addEventListener('DOMContentLoaded', init);
  return { init };
})();
