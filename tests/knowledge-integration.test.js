const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const context = {
  window: {}, document: {}, console,
  setTimeout, clearTimeout,
  requestAnimationFrame: callback => callback(),
  TR: {}
};
context.window = context;
context.window.TR = context.TR;
vm.createContext(context);
for (const file of ['config.js', 'utils.js', 'ref-templates.js', 'knowledge.js', 'data-model.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), context, { filename: file });
}

(async () => {
  const raw = {
    'Book_A__1': {
      candidates: [
        { elastic_id: 'self', alignment_details: {
          location: 'Book_A__1', passage_text: 'source passage', source_text: 'source passage',
          source_categories: ['Musar', 'Book_A', '1'], score: 100, norm_score: 1,
          alignment_score: 1, full_alignment_ind: 1
        }},
        { elastic_id: 'target', source_family: 'local', alignment_details: {
          location: 'Custom_Work__2', passage_text: 'source passage', source_text: 'normalized candidate',
          source_categories: ['Custom', 'Custom_Work', '2'], score: 82, norm_score: 0.76,
          alignment_score: 0.71, full_alignment_ind: 0,
          alignment_sequence: [[0, 0, 1, 'exact']]
        }}
      ]
    }
  };

  const model = await context.TR.DataModel.fromRaw(raw, 'reuse.json', () => {}, { datasetId: 'reuse-1' });
  assert.strictEqual(model.records.length, 1);
  assert.strictEqual(model.records[0].candidates.length, 1, 'self candidate remains excluded');
  const candidate = model.records[0].candidates[0];
  assert.strictEqual(candidate.sourceFamily, 'local');
  assert.strictEqual(candidate.isSefariaLike, false, 'explicit local provider must not be forced through Sefaria');
  assert.strictEqual(candidate.alignment.origin, 'alignment_sequence');

  const registry = context.TR.CorpusRegistry.fromItems([
    { location: 'Book_A__1', sentence: 'source passage', orig_sentence: 'SOURCE ORIGINAL', title: 'Book A', resource_id: 'book-a', passage_id: '1' },
    { location: 'Custom_Work__2', sentence: 'normalized candidate', orig_sentence: 'CUSTOM ORIGINAL', title: 'Custom Work', resource_id: 'custom-work', passage_id: '2', versions: 'Local edition', source_type: 'local' }
  ], 'corpus.ndjson', 'corpus-1');

  model.attachRegistry(registry);
  assert.strictEqual(model.records[0].originalSourceText, 'SOURCE ORIGINAL');
  assert.strictEqual(candidate.originalSourceText, 'CUSTOM ORIGINAL');
  assert.strictEqual(candidate.resourceId, 'custom-work');
  assert.strictEqual(candidate.passageId, '2');
  assert.strictEqual(candidate.relation.type, 'text-reuse');
  assert.strictEqual(candidate.relation.source.resourceId, 'book-a');
  assert.strictEqual(candidate.relation.target.resourceId, 'custom-work');
  assert.ok(candidate.localMetadata.selector === null || typeof candidate.localMetadata.selector === 'object');
  assert.ok(model.books.some(book => book.localResource), 'book catalog should retain a local resource mapping');

  const matrix = model.aggregateMatrix({ granularity: 'segment' });
  assert.ok(Array.isArray(matrix.rows));
  assert.doesNotThrow(() => model.buildCooccurrenceGraph({ minNorm: 0 }));
  assert.doesNotThrow(() => model.buildSourceBookGraph({ minNorm: 0 }));
  assert.doesNotThrow(() => model.buildSourceToGenizaGraph({ minNorm: 0 }));
  assert.ok(model.getScatterPoints().length >= 1);
  const reverseGroups = model.getReverseGroups();
  assert.ok(reverseGroups.length >= 1);
  assert.doesNotThrow(() => model.getReverseMatches({ groupKey: reverseGroups[0].key }));
  const csv = model.toCsv();
  assert.ok(csv.includes('source_resource_id'));
  assert.ok(csv.includes('version_source'));

  const originalAlignmentIndexMap = context.TR.utils.alignmentIndexMap;
  context.TR.utils.alignmentIndexMap = () => new Map();
  const longText = 'אבג '.repeat(400);
  const compactRaw = {
    'Big_Book__1': { candidates: [
      { elastic_id: 'c1', alignment_details: { location: 'Other__1', passage_text: longText, source_text: longText + 'מועמד', score: 44, norm_score: .4 } }
    ] }
  };
  const compactModel = await context.TR.DataModel.fromRaw(compactRaw, 'large.json', () => {}, { datasetId: 'large-1', compact: true, largeSourceId: 'large-source' });
  const compactRecord = compactModel.records[0];
  const compactCandidate = compactRecord.candidates[0];
  assert.ok(compactRecord.originalText.length < longText.length, 'compact mode must not retain the entire passage text in RAM');
  assert.ok(compactCandidate.sourceText.length < longText.length, 'compact mode must retain only a candidate preview in RAM');
  assert.strictEqual(compactCandidate.largeSourceId, 'large-source');
  assert.ok(compactCandidate.details.__largeStoreRef.includes('large-source'));
  context.TR.utils.alignmentIndexMap = originalAlignmentIndexMap;

  console.log('knowledge layer integration test passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
