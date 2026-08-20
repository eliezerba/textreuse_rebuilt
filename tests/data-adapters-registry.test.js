const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const context = {
  window: {},
  document: {},
  console,
  setTimeout,
  clearTimeout,
  TR: {}
};
context.window = context;
context.window.TR = context.TR;
vm.createContext(context);
for (const file of ['utils.js', 'ref-templates.js', 'knowledge.js', 'data-adapters.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), context, { filename: file });
}

const ndjson = [
  JSON.stringify({
    location: 'Musar_Menorat_HaMaor_Aboab__Introductions_10',
    segment: 10,
    sentence: 'normalized text',
    orig_sentence: 'original text',
    title: 'Menorat HaMaor (Aboab)',
    he_title: 'מנורת המאור (אבוהב)',
    categories: ['Musar', 'Menorat_HaMaor_Aboab', 'Introductions'],
    versions: 'Torat Emet',
    versionSource: 'https://example.org/source',
    from_word: 1,
    to_word: 2,
    text_length: 2
  }),
  JSON.stringify({
    location: 'Musar_Menorat_HaMaor_Aboab__Introductions_11',
    segment: 11,
    sentence: 'next segment',
    orig_sentence: 'next original',
    title: 'Menorat HaMaor (Aboab)',
    categories: ['Musar', 'Menorat_HaMaor_Aboab', 'Introductions']
  })
].join('\n');

const parsedCorpus = context.TR.dataAdapters.parseSourceText(ndjson, 'corpus.ndjson');
assert.strictEqual(parsedCorpus.kind, 'corpus');
assert.strictEqual(parsedCorpus.items.length, 2);

const registry = context.TR.CorpusRegistry.fromItems(parsedCorpus.items, 'corpus.ndjson', 'source-1');
assert.strictEqual(registry.entries.length, 2);
const first = registry.lookup('Musar_Menorat_HaMaor_Aboab__Introductions_10');
assert.ok(first, 'registry must resolve a corpus location');
assert.strictEqual(first.analysisText, 'normalized text');
assert.strictEqual(first.originalText, 'original text');
assert.strictEqual(first.versions, 'Torat Emet');
assert.strictEqual(first.fromWord, 1);
assert.strictEqual(first.toWord, 2);
assert.ok(registry.resources.size >= 1, 'registry must aggregate textual resources');

const textReuse = JSON.stringify({
  source_book__1_1: {
    passage_text: 'source text',
    candidates: [{ source_text: 'candidate', location: 'other_book__2_3', score: 1 }]
  }
});
const parsedTextReuse = context.TR.dataAdapters.parseSourceText(textReuse, 'reuse.json');
assert.strictEqual(parsedTextReuse.kind, 'textreuse');
assert.ok(parsedTextReuse.raw.source_book__1_1);


assert.strictEqual(context.TR.utils.htmlColor('color: #12AbEf; background: white'), '#12AbEf');
assert.strictEqual(context.TR.utils.htmlColor('font-weight:bold;color: rgb(12, 34, 56)'), 'rgb(12, 34, 56)');
assert.strictEqual(context.TR.utils.htmlBackgroundColor('background-color: #ffeedd; color:#111'), '#ffeedd');

console.log('data adapters and corpus registry test passed');
