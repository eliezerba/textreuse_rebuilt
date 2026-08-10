const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const dataModelPath = path.join(__dirname, '..', 'data-model.js');
const source = fs.readFileSync(dataModelPath, 'utf8');

const context = {
  window: {},
  console,
  setTimeout,
  clearTimeout,
  TR: {}
};
context.window = context;
context.window.TR = context.TR;

context.TR.utils = {
  finite(value) { return Number.isFinite(Number(value)) ? Number(value) : 0; },
  normalizeText(value) {
    return String(value || '')
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[\s_.,:;\-–—/\\]+/g, ' ')
      .trim();
  },
  nextFrame: async () => {}
};
context.TR.refTemplates = {
  parseLocation() {
    return {
      bookSlug: 'book-slug',
      bookTitle: 'Book Title',
      display: 'פרק 1',
      simpleRef: 'פרק 1',
      searchQuery: 'פרק 1'
    };
  }
};

vm.createContext(context);
vm.runInContext(source, context);

function makeModel(label, recordId, candidate, refTemplate = { display: 'פרק 1', address: '1', addressTokens: ['1'], namedPathTitles: [], namedTitle: '' }, rawId = recordId) {
  const record = {
    id: recordId,
    rawId: rawId,
    index: 0,
    datasetId: label,
    datasetLabel: label,
    location: rawId,
    displayRef: refTemplate.display,
    refTemplate,
    chapter: 1,
    originalText: 'original',
    bookText: 'original',
    sourceBook: { slug: 'book-slug', title: 'Book Title', categories: [] },
    bookPassage: null,
    candidates: [candidate],
    removedSelfCount: 0,
    bestCandidate: candidate,
    bestNormScore: candidate.normScore,
    bestScore: candidate.score,
    reuseBookCount: 1,
    exactCandidateCount: candidate.fullAlignment ? 1 : 0,
    searchBlob: 'candidate'
  };

  return new context.TR.DataModel({
    label,
    records: [record],
    books: [{ slug: 'book-slug', title: 'Book Title', categories: [], candidateCount: 1, nonSelfCandidateCount: 1, recordIds: [record.id], sourceRecordIds: [record.id], selfCount: 0, fullAlignmentCount: 0, detailedAlignmentCount: 0, scoreSum: candidate.score, normSum: candidate.normScore, alignmentSum: candidate.alignmentScore, maxScore: candidate.score, maxNormScore: candidate.normScore, maxAlignmentScore: candidate.alignmentScore, metadata: null, metadataStatus: 'idle' }],
    targetBooks: [{ slug: 'book-slug', title: 'Book Title', categories: [] }],
    datasets: [{ id: label, label }]
  });
}

const candidateA = {
  id: 'a',
  rawCandidateId: 'a',
  recordId: 'dataset-a::record-1',
  rawRecordId: 'record-1',
  datasetId: 'dataset-a',
  datasetLabel: 'מאגר א',
  index: 0,
  categories: [],
  topCategory: 'לא מזוהה',
  bookSlug: 'book-slug',
  bookTitle: 'Book Title',
  provisionalRef: 'פרק 1',
  sefariaQuery: 'פרק 1',
  displayRef: 'פרק 1',
  refTemplate: { display: 'פרק 1' },
  sourceFamily: 'sefariaLike',
  sourceManuscript: '',
  sourceFragment: '',
  isSefariaLike: true,
  score: 90,
  normScore: 0.8,
  alignmentScore: 0.7,
  fullAlignment: true,
  isSelf: false,
  passageText: 'passage',
  bookText: 'passage',
  sourceText: 'source',
  datasetText: 'source',
  originalHtml: null,
  candidateHtml: null,
  hasDetailedAlignment: false,
  searchBlob: 'candidate' 
};

const candidateB = {
  ...candidateA,
  id: 'b',
  rawCandidateId: 'b',
  recordId: 'dataset-b::record-2',
  rawRecordId: 'record-2',
  datasetId: 'dataset-b',
  datasetLabel: 'מאגר ב',
  score: 70,
  normScore: 0.6,
  alignmentScore: 0.6,
  fullAlignment: false
};

// Two records with different rawIds (different source passages) — must NOT merge
const refA = { display: 'פרק 1', address: '1', addressTokens: ['1'], namedPathTitles: [], namedTitle: '' };
const refB = { display: 'פרק 2', address: '2', addressTokens: ['2'], namedPathTitles: [], namedTitle: '' };
const modelA = makeModel('מאגר א', 'dataset-a::record-1', candidateA, refA, 'source_book__1_1');
const modelB = makeModel('מאגר ב', 'dataset-b::record-2', candidateB, refB, 'source_book__1_2');
const combined = context.TR.DataModel.combine([modelA, modelB], 'combined');
assert.strictEqual(combined.records.length, 2, 'different source passages must remain separate');
assert.strictEqual(combined.records[0].candidates.length, 1, 'each record keeps its own candidates');
assert.strictEqual(String(combined.records[0].datasetLabel), 'מאגר א');
assert.strictEqual(String(combined.records[1].datasetLabel), 'מאגר ב');

// Two records with the SAME rawId (same source passage, different datasets) — MUST merge
const candidateA2 = { ...candidateA, id: 'x', rawCandidateId: 'x', datasetId: 'ds-x', datasetLabel: 'גניזה', normScore: 0.9 };
const candidateB2 = { ...candidateA, id: 'y', rawCandidateId: 'y', datasetId: 'ds-y', datasetLabel: 'ספרות רבנית', normScore: 0.7 };
const modelSR_A = makeModel('גניזה', 'ds-x::Shemot_Rabbah__1_1', candidateA2, refA, 'Shemot_Rabbah__1_1');
const modelSR_B = makeModel('ספרות רבנית', 'ds-y::Shemot_Rabbah__1_1', candidateB2, refA, 'Shemot_Rabbah__1_1');
const combinedSR = context.TR.DataModel.combine([modelSR_A, modelSR_B], 'combined-sr');
assert.strictEqual(combinedSR.records.length, 1, 'same source passage from two datasets must merge into one record');
assert.strictEqual(combinedSR.records[0].candidates.length, 2, 'merged record must contain candidates from both datasets');
assert.strictEqual(combinedSR.records[0].candidates[0].normScore, 0.9, 'candidates must be sorted by normScore descending');
assert.strictEqual(combinedSR.records[0].candidates[1].normScore, 0.7);

console.log('data-model combine test passed');
