const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

async function runFake(file, ackBatches = false) {
  const messages = [];
  let context;
  context = {
    self: {}, console, TextDecoder, Blob, fetch, setTimeout,
    postMessage: message => {
      messages.push(message);
      if (ackBatches && message.batchToken) {
        setTimeout(() => context.self.onmessage({ data: { type:'ack', batchToken: message.batchToken } }), 0);
      }
    }
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname,'..','large-file-worker.js'),'utf8'), context);
  await context.self.onmessage({ data: { type:'parse', file, ackBatches } });
  return messages;
}

(async () => {
  const nd = new Blob([
    JSON.stringify({location:'Book__1',sentence:'a'}),'\n',
    JSON.stringify({location:'Book__2',sentence:'b'}),'\n'
  ]); nd.name = 'corpus.ndjson';
  const messages = await runFake(nd);
  assert.ok(messages.some(m => m.type === 'batch' && m.kind === 'corpus'));
  assert.strictEqual(messages.find(m => m.type === 'done').count, 2);

  const tr = new Blob([JSON.stringify({
    'Book__1': { candidates: [{alignment_details:{location:'Other__2',source_text:'b',passage_text:'a'}}] },
    'Book__2': { candidates: [] }
  })]); tr.name = 'reuse.json';
  const trMessages = await runFake(tr);
  assert.ok(trMessages.some(m => m.type === 'batch' && m.kind === 'textreuse'));
  assert.strictEqual(trMessages.find(m => m.type === 'done').count, 2);

  const wrapped = new Blob([JSON.stringify({ results: {
    'Book__1': { candidates: [{alignment_details:{location:'Other__2',source_text:'b',passage_text:'a'}}] },
    'Book__2': { candidates: [] }
  }})]); wrapped.name = 'wrapped.json';
  const wrappedMessages = await runFake(wrapped);
  assert.ok(wrappedMessages.some(m => m.type === 'batch' && m.kind === 'textreuse'));
  assert.strictEqual(wrappedMessages.find(m => m.type === 'done').count, 2);

  const wrappedCorpus = new Blob([JSON.stringify({ passages: [
    {location:'Book__1', sentence:'alpha'}, {location:'Book__2', sentence:'beta'}
  ]})]); wrappedCorpus.name = 'wrapped-corpus.json';
  const wrappedCorpusMessages = await runFake(wrappedCorpus);
  assert.ok(wrappedCorpusMessages.some(m => m.type === 'batch' && m.kind === 'corpus'));
  assert.strictEqual(wrappedCorpusMessages.find(m => m.type === 'done').count, 2);

  const many = {};
  for (let i = 0; i < 80; i += 1) many[`Book__${i}`] = { candidates: [{alignment_details:{location:`Other__${i}`,source_text:'b',passage_text:'a'}}] };
  const backpressured = new Blob([JSON.stringify(many)]); backpressured.name = 'large-map.json';
  const backpressureMessages = await runFake(backpressured, true);
  assert.strictEqual(backpressureMessages.find(m => m.type === 'done').count, 80);
  const dataBatches = backpressureMessages.filter(m => m.type === 'batch');
  assert.ok(dataBatches.every(m => Number.isFinite(m.batchToken)));
  // Large-file performance: 80 small top-level records should be grouped into
  // at most two batches instead of the previous 10 batches of eight records.
  assert.ok(dataBatches.length <= 2, `expected <=2 batches, got ${dataBatches.length}`);
  console.log('large file worker streaming parser test passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
