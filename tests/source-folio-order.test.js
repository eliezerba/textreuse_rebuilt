const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const context = { window: {}, console, TR: {} };
context.window = context;
context.window.TR = context.TR;
context.TR.config = { palette: [] };
context.TR.utils = {
  finite(value) { return Number.isFinite(Number(value)) ? Number(value) : 0; },
  normalizeText(value) { return String(value || '').toLowerCase().trim(); },
  hashColor() { return '#000'; }
};
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'data-model.js'), 'utf8'), context);

const make = (rawId, index, slug = 'oppenheimer-128') => ({
  rawId, index,
  sourceBook: { slug },
  refTemplate: { namedPathTitles: [], namedTitle: '', addressTokens: [] }
});

const records = [
  make('Oppenheimer_128_fol_200r_1', 0),
  make('Oppenheimer_128_fol_30r_1', 1),
  make('Oppenheimer_128_fol_100r_1', 2),
  make('Oppenheimer_128_fol_2v_1', 3),
  make('Oppenheimer_128_fol_1r_2', 4),
  make('Oppenheimer_128_fol_1v_1', 5),
  make('Oppenheimer_128_fol_1r_1', 6),
  make('Oppenheimer_128_fol_2r_1', 7)
].sort(context.TR.DataModel.compareSourceRecords);

assert.deepStrictEqual(records.map(r => r.rawId), [
  'Oppenheimer_128_fol_1r_1',
  'Oppenheimer_128_fol_1r_2',
  'Oppenheimer_128_fol_1v_1',
  'Oppenheimer_128_fol_2r_1',
  'Oppenheimer_128_fol_2v_1',
  'Oppenheimer_128_fol_30r_1',
  'Oppenheimer_128_fol_100r_1',
  'Oppenheimer_128_fol_200r_1'
]);

// Also accept separators between the folio number and recto/verso marker.
const variants = [
  make('MS_X_fol-200-r-1', 0, 'ms-x-200'),
  make('MS_X_folio_30_r_2', 1, 'ms-x-30'),
  make('MS_X_fol 30r 1', 2, 'ms-x-30b'),
  make('MS_X_fol_100_v_1', 3, 'ms-x-100')
].sort(context.TR.DataModel.compareSourceRecords);

assert.deepStrictEqual(variants.map(r => r.rawId), [
  'MS_X_fol 30r 1',
  'MS_X_folio_30_r_2',
  'MS_X_fol_100_v_1',
  'MS_X_fol-200-r-1'
]);

console.log('source folio order test passed');
