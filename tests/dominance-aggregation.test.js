const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'data-model.js'), 'utf8');
const context = { window: {}, console, TR: {} };
context.window = context;
context.window.TR = context.TR;
context.TR.config = { palette: ['#111111', '#222222', '#333333'] };
context.TR.utils = {
  finite(value) { return Number.isFinite(Number(value)) ? Number(value) : 0; },
  normalizeText(value) { return String(value || '').toLowerCase().trim(); },
  hashColor(key) { return key === 'a' ? '#111111' : '#222222'; }
};
vm.createContext(context);
vm.runInContext(source, context);

function candidate(id, recordId, bookSlug, values) {
  return {
    id, recordId, bookSlug, bookTitle: bookSlug.toUpperCase(), categories: [], isSelf: false,
    score: values.score, normScore: values.norm, alignmentScore: values.align,
    fullAlignment: Boolean(values.full), searchBlob: ''
  };
}

const r1 = { id: 'r1', rawId: 'r1', datasetId: 'd', datasetLabel: 'D', index: 0, chapter: 1, displayRef: 'יחידה 1', searchBlob: '', sourceBook: { slug: 'base', title: 'Base', categories: [] }, candidates: [] };
const r2 = { id: 'r2', rawId: 'r2', datasetId: 'd', datasetLabel: 'D', index: 1, chapter: 1, displayRef: 'יחידה 2', searchBlob: '', sourceBook: { slug: 'base', title: 'Base', categories: [] }, candidates: [] };
r1.candidates = [
  candidate('a1', 'r1', 'a', { score: 70, norm: 0.7, align: 0.5, full: true }),
  candidate('a2', 'r1', 'a', { score: 90, norm: 0.9, align: 0.8, full: false }),
  candidate('b1', 'r1', 'b', { score: 30, norm: 0.3, align: 0.2, full: false })
];
r2.candidates = [candidate('b2', 'r2', 'b', { score: 80, norm: 0.8, align: 0.7, full: true })];

const books = [
  { slug: 'a', title: 'A', categories: [], candidateCount: 2, nonSelfCandidateCount: 2 },
  { slug: 'b', title: 'B', categories: [], candidateCount: 2, nonSelfCandidateCount: 2 },
  { slug: 'base', title: 'Base', categories: [], candidateCount: 0, nonSelfCandidateCount: 0 }
];
const model = new context.TR.DataModel({ label: 'D', records: [r1, r2], books, targetBooks: [books[2]], datasets: [{ id: 'd', label: 'D' }] });

const maxNorm = model.aggregateDominance({ metric: 'normScore', aggregation: 'max' });
assert.strictEqual(maxNorm.records.length, 2);
assert.strictEqual(maxNorm.books[0].slug, 'b', 'sources should rank by total dominance across the base text');
assert.strictEqual(maxNorm.books.find(book => book.slug === 'a').values[0].value, 0.9);
assert.strictEqual(maxNorm.books.find(book => book.slug === 'a').values[1], null);
assert.strictEqual(maxNorm.books.find(book => book.slug === 'b').values[1].value, 0.8);
assert.strictEqual(maxNorm.maxValue, 1, 'normalized metrics should use a fixed 0-1 axis');

const avgScore = model.aggregateDominance({ metric: 'score', aggregation: 'avg' });
assert.strictEqual(avgScore.books.find(book => book.slug === 'a').values[0].value, 80);
assert.strictEqual(avgScore.maxValue, 80);

const fullRate = model.aggregateDominance({ metric: 'fullAlignment', aggregation: 'avg' });
assert.strictEqual(fullRate.books.find(book => book.slug === 'a').values[0].value, 0.5);

console.log('dominance aggregation test passed');
