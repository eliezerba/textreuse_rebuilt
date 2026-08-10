const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'utils.js'), 'utf8');
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
vm.runInContext(source, context);

const rows = [{
  mode: 'single',
  recordId: 'record-1',
  sourceBookTitle: 'ספר המקור',
  sourceRef: 'פרק 1',
  rowKind: 'candidate',
  candidateBookTitle: 'מועמד',
  score: 0.8,
  norm_score: 0.75,
  alignment_score: 0.6,
  full_alignment: true
}];
const csv = context.TR.utils.rowsToCsv(rows, ['mode', 'recordId', 'sourceBookTitle', 'rowKind', 'candidateBookTitle', 'score', 'norm_score', 'alignment_score', 'full_alignment']);

assert.ok(csv.includes('mode,recordId,sourceBookTitle,rowKind,candidateBookTitle,score,norm_score,alignment_score,full_alignment'));
assert.ok(csv.includes('single'));
assert.ok(csv.includes('candidate'));
assert.ok(csv.includes('0.8'));

console.log('synopsis export test passed');
