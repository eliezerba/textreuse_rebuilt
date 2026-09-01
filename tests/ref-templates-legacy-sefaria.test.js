const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const context = { window: {}, console, TR: {} };
context.window = context;
context.window.TR = context.TR;
context.TR.utils = {
  normalizeText(value) {
    return String(value || '').toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  }
};
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'ref-templates.js'), 'utf8'), context);

const parsed = context.TR.refTemplates.parseLocation(
  'Midrash_Aggadah-Mishnat_Rabbi_Eliezer-NEWYORK1934_Sefaria_1_3_1',
  ['Midrash', 'Aggadah', 'Sefaria', 'print edition']
);
assert.strictEqual(parsed.locationFormat, 'legacy-sefaria-hyphen');
assert.strictEqual(parsed.bookTitle, 'Mishnat Rabbi Eliezer');
assert.strictEqual(parsed.encodedCategory, 'Midrash_Aggadah');
assert.strictEqual(parsed.editionToken, 'NEWYORK1934');
assert.deepStrictEqual(Array.from(parsed.addressTokens), ['1', '3', '1']);
assert.strictEqual(parsed.directRef, 'Mishnat Rabbi Eliezer 1:3:1');

const nested = context.TR.refTemplates.parseLocation(
  'Midrash_Aggadic_Midrash-Yalkut_Shimoni_on_Torah-Sefaria_Remez_92_1_1',
  ['Midrash', 'Aggadah', 'Sefaria']
);
assert.strictEqual(nested.bookTitle, 'Yalkut Shimoni on Torah');
assert.deepStrictEqual(Array.from(nested.namedPathTitles), ['Remez']);
assert.deepStrictEqual(Array.from(nested.addressTokens), ['92', '1', '1']);

const canonical = context.TR.refTemplates.applyHierarchy(parsed, { canonicalTitle: 'Mishnat Rabbi Eliezer', resolution: 'sefaria-hierarchy' });
assert.strictEqual(canonical.bookTitle, 'Mishnat Rabbi Eliezer');
assert.strictEqual(canonical.locationFormat, 'legacy-sefaria-hyphen');
assert.deepStrictEqual(Array.from(canonical.addressTokens), ['1', '3', '1']);

let variants = context.TR.refTemplates.addressVariants(['1', '3', '1'], 2, [], { legacySefaria: true, bookTitle: 'Mishnat Rabbi Eliezer' });
assert.strictEqual(variants[0].address, '1:3', 'legacy Sefaria rows should prefer dropping the trailing internal index');
variants = context.TR.refTemplates.addressVariants(['2', '12', '4', '1'], 3, [], { legacySefaria: true, bookTitle: 'Radak on II Kings' });
assert.strictEqual(variants[0].address, '12:4:1', 'numbered biblical books should drop the redundant leading book ordinal instead');

console.log('legacy Sefaria location parsing test passed');
