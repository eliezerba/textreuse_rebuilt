'use strict';

const MAX_BATCH_ITEMS = 64;
const TARGET_BATCH_CHARS = 4 * 1024 * 1024;
const MAX_PENDING_BATCHES = 2;
let backpressureEnabled = false;
let pendingBatches = 0;
let batchToken = 0;
let pendingWaiters = [];

let lastProgressPost = 0;
function emitProgress(bytes, totalBytes, count, force = false) {
  const now = Date.now();
  if (!force && now - lastProgressPost < 120) return;
  lastProgressPost = now;
  postMessage({ type: 'progress', bytes, totalBytes, count });
}

function emitBatch(message) {
  if (backpressureEnabled) {
    pendingBatches += 1;
    message.batchToken = ++batchToken;
  }
  postMessage(message);
}

function acknowledgeBatch() {
  if (!backpressureEnabled) return;
  pendingBatches = Math.max(0, pendingBatches - 1);
  const ready = pendingWaiters;
  pendingWaiters = [];
  ready.forEach(resolve => resolve());
}

function waitForPendingBelow(limit = MAX_PENDING_BATCHES) {
  if (!backpressureEnabled || pendingBatches < limit) return Promise.resolve();
  return new Promise(resolve => pendingWaiters.push(resolve));
}

async function waitForAllBatches() {
  while (backpressureEnabled && pendingBatches > 0) await waitForPendingBelow(1);
}

function looksLikePassage(item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
  const hasLocator = item.location || item.Location || item.passage_id || item.passageId || item.segment || item.id;
  const hasText = item.sentence !== undefined || item.orig_sentence !== undefined || item.text !== undefined || item.source_text !== undefined || item.passage_text !== undefined;
  return Boolean(hasLocator && hasText);
}

function looksLikeTextReuseRecord(item) {
  return Boolean(item && typeof item === 'object' && !Array.isArray(item) && Array.isArray(item.candidates));
}

function findStringEnd(buffer, start) {
  let escaped = false;
  for (let i = start + 1; i < buffer.length; i += 1) {
    const ch = buffer[i];
    if (escaped) { escaped = false; continue; }
    if (ch === '\\') { escaped = true; continue; }
    if (ch === '"') return i + 1;
  }
  return -1;
}

function scanValueEnd(buffer, start, state = null) {
  let scan = state;
  if (!scan) {
    let pos = start;
    while (pos < buffer.length && /\s/.test(buffer[pos])) pos += 1;
    if (pos >= buffer.length) return { end: -1, state: { type: 'pending', i: pos, start: pos } };
    const first = buffer[pos];
    if (first === '"') scan = { type: 'string', start: pos, i: pos + 1, escaped: false };
    else if (first === '{' || first === '[') scan = { type: 'structured', start: pos, i: pos, open: first, close: first === '{' ? '}' : ']', depth: 0, inString: false, escaped: false };
    else scan = { type: 'scalar', start: pos, i: pos };
  }
  if (scan.type === 'pending') {
    if (scan.i >= buffer.length) return { end: -1, state: scan };
    return scanValueEnd(buffer, scan.i, null);
  }
  if (scan.type === 'string') {
    for (let i = scan.i; i < buffer.length; i += 1) {
      const ch = buffer[i];
      if (scan.escaped) { scan.escaped = false; continue; }
      if (ch === '\\') { scan.escaped = true; continue; }
      if (ch === '"') return { end: i + 1, state: null };
    }
    scan.i = buffer.length;
    return { end: -1, state: scan };
  }
  if (scan.type === 'structured') {
    for (let i = scan.i; i < buffer.length; i += 1) {
      const ch = buffer[i];
      if (scan.inString) {
        if (scan.escaped) scan.escaped = false;
        else if (ch === '\\') scan.escaped = true;
        else if (ch === '"') scan.inString = false;
        continue;
      }
      if (ch === '"') { scan.inString = true; continue; }
      if (ch === scan.open) scan.depth += 1;
      else if (ch === scan.close) {
        scan.depth -= 1;
        if (scan.depth === 0) return { end: i + 1, state: null };
      }
    }
    scan.i = buffer.length;
    return { end: -1, state: scan };
  }
  for (let i = scan.i; i < buffer.length; i += 1) {
    if (buffer[i] === ',' || buffer[i] === '}' || buffer[i] === ']') return { end: i, state: null };
  }
  scan.i = buffer.length;
  return { end: -1, state: scan };
}

class MapParser {
  constructor(onEntry, shouldPause = () => false) {
    this.shouldPause = shouldPause;
    this.paused = false;
    this.buffer = '';
    this.pos = 0;
    this.started = false;
    this.done = false;
    this.onEntry = onEntry;
    this.valueScanState = null;
  }
  push(text, final = false) {
    if (this.done) return;
    this.paused = false;
    this.buffer += text;
    while (true) {
      if (this.shouldPause()) { this.paused = true; break; }
      while (this.pos < this.buffer.length && /\s/.test(this.buffer[this.pos])) this.pos += 1;
      if (!this.started) {
        if (this.buffer[this.pos] !== '{') {
          if (final) throw new Error('Large JSON must be a top-level object or use NDJSON/JSONL.');
          return;
        }
        this.pos += 1;
        this.started = true;
      }
      while (this.pos < this.buffer.length && /\s|,/.test(this.buffer[this.pos])) this.pos += 1;
      if (this.buffer[this.pos] === '}') { this.done = true; this.pos += 1; break; }
      if (this.buffer[this.pos] !== '"') break;
      const keyEnd = findStringEnd(this.buffer, this.pos);
      if (keyEnd < 0) break;
      const keyText = this.buffer.slice(this.pos, keyEnd);
      const key = JSON.parse(keyText);
      let cursor = keyEnd;
      while (cursor < this.buffer.length && /\s/.test(this.buffer[cursor])) cursor += 1;
      if (cursor >= this.buffer.length || this.buffer[cursor] !== ':') break;
      cursor += 1;
      while (cursor < this.buffer.length && /\s/.test(this.buffer[cursor])) cursor += 1;
      const scanned = scanValueEnd(this.buffer, cursor, this.valueScanState);
      this.valueScanState = scanned.state;
      const valueEnd = scanned.end;
      if (valueEnd < 0) break;
      this.valueScanState = null;
      const valueText = this.buffer.slice(cursor, valueEnd);
      const value = JSON.parse(valueText);
      this.onEntry(key, value, valueText.length + keyText.length);
      this.pos = valueEnd;
      while (this.pos < this.buffer.length && /\s/.test(this.buffer[this.pos])) this.pos += 1;
      if (this.buffer[this.pos] === ',') this.pos += 1;
      if (this.pos > 8 * 1024 * 1024) {
        this.buffer = this.buffer.slice(this.pos);
        this.pos = 0;
      }
    }
    if (final && !this.done) {
      const rest = this.buffer.slice(this.pos).trim();
      if (rest && rest !== '}') throw new Error('Large JSON stream ended before the top-level object was complete.');
    }
  }
}

class ArrayParser {
  constructor(onItem, shouldPause = () => false) {
    this.shouldPause = shouldPause;
    this.paused = false;
    this.buffer = '';
    this.pos = 0;
    this.started = false;
    this.done = false;
    this.onItem = onItem;
    this.valueScanState = null;
  }
  push(text, final = false) {
    if (this.done) return;
    this.paused = false;
    this.buffer += text;
    while (true) {
      if (this.shouldPause()) { this.paused = true; break; }
      while (this.pos < this.buffer.length && /\s/.test(this.buffer[this.pos])) this.pos += 1;
      if (!this.started) {
        if (this.buffer[this.pos] !== '[') {
          if (final) throw new Error('Large corpus array is not valid JSON.');
          return;
        }
        this.started = true;
        this.pos += 1;
      }
      while (this.pos < this.buffer.length && /\s|,/.test(this.buffer[this.pos])) this.pos += 1;
      if (this.buffer[this.pos] === ']') { this.done = true; this.pos += 1; break; }
      const scanned = scanValueEnd(this.buffer, this.pos, this.valueScanState);
      this.valueScanState = scanned.state;
      const end = scanned.end;
      if (end < 0) break;
      this.valueScanState = null;
      const itemText = this.buffer.slice(this.pos, end);
      const item = JSON.parse(itemText);
      this.onItem(item, itemText.length);
      this.pos = end;
      if (this.pos > 8 * 1024 * 1024) {
        this.buffer = this.buffer.slice(this.pos);
        this.pos = 0;
      }
    }
    if (final && !this.done) throw new Error('Large JSON array ended before closing bracket.');
  }
}


const WRAPPER_KEY_RE = /^\s*\{\s*"(?:results|data|records|passages|textreuse|text_reuse)"\s*:\s*([\{\[])/i;

class WrappedParser {
  constructor(innerParser) {
    this.innerParser = innerParser;
    this.prefix = '';
    this.started = false;
  }
  get paused() { return Boolean(this.innerParser.paused); }
  push(text, final = false) {
    if (this.started) {
      this.innerParser.push(text, final);
      return;
    }
    this.prefix += text;
    const match = this.prefix.match(WRAPPER_KEY_RE);
    if (match) {
      const matched = match[0];
      const open = match[1];
      const openIndex = matched.lastIndexOf(open);
      const absoluteOpen = (match.index || 0) + openIndex;
      const rest = this.prefix.slice(absoluteOpen);
      this.prefix = '';
      this.started = true;
      this.innerParser.push(rest, final);
      return;
    }
    if (this.prefix.length > 512 * 1024 || final) {
      throw new Error('Large wrapped JSON must begin with results/data/records/passages/textreuse containing a map or array.');
    }
  }
}

function structuredModeFromHead(trimmed) {
  if (trimmed.startsWith('[')) return 'array';
  if (!trimmed.startsWith('{')) return '';
  const match = trimmed.match(WRAPPER_KEY_RE);
  if (match) return match[1] === '[' ? 'wrapped-array' : 'wrapped-map';
  return 'map';
}

function createStructuredParser(mode, onEntry, onItem, shouldPause = () => false) {
  if (mode === 'array') return new ArrayParser(onItem, shouldPause);
  if (mode === 'wrapped-array') return new WrappedParser(new ArrayParser(onItem, shouldPause));
  if (mode === 'wrapped-map') return new WrappedParser(new MapParser(onEntry, shouldPause));
  return new MapParser(onEntry, shouldPause);
}

async function pushWithBackpressure(parser, text) {
  parser.push(text, false);
  while (parser.paused) {
    await waitForPendingBelow();
    parser.push('', false);
  }
}


async function parseNdjson(file) {
  const reader = file.stream().getReader();
  const decoder = new TextDecoder('utf-8');
  let carry = '';
  let bytes = 0;
  let batch = [];
  let batchChars = 0;
  let count = 0;
  const flush = async () => {
    if (!batch.length) return;
    emitBatch({ type: 'batch', kind: 'corpus', items: batch, batchChars });
    batch = [];
    batchChars = 0;
    await waitForPendingBelow();
  };
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    carry += decoder.decode(value, { stream: true });
    const lines = carry.split(/\r?\n/);
    carry = lines.pop() || '';
    for (const line of lines) {
      if (!line.trim()) continue;
      const item = JSON.parse(line);
      if (!looksLikePassage(item)) throw new Error('NDJSON large-file mode expects one corpus passage object per line.');
      batch.push(item); batchChars += line.length; count += 1;
      if (batch.length >= MAX_BATCH_ITEMS || batchChars >= TARGET_BATCH_CHARS) await flush();
    }
    emitProgress(bytes, file.size, count);
  }
  carry += decoder.decode();
  if (carry.trim()) { const item = JSON.parse(carry); batch.push(item); batchChars += carry.length; count += 1; }
  await flush();
  await waitForAllBatches();
  postMessage({ type: 'done', kind: 'corpus', count, bytes: file.size });
}

async function parseStructured(file, mode) {
  const reader = file.stream().getReader();
  const decoder = new TextDecoder('utf-8');
  let bytes = 0;
  let count = 0;
  let inferredKind = '';
  let entryBatch = [];
  let itemBatch = [];
  let entryBatchChars = 0;
  let itemBatchChars = 0;
  const flushEntries = () => {
    if (!entryBatch.length) return;
    emitBatch({ type: 'batch', kind: 'textreuse', entries: entryBatch, batchChars: entryBatchChars });
    entryBatch = [];
    entryBatchChars = 0;
  };
  const flushItems = () => {
    if (!itemBatch.length) return;
    emitBatch({ type: 'batch', kind: 'corpus', items: itemBatch, batchChars: itemBatchChars });
    itemBatch = [];
    itemBatchChars = 0;
  };
  const onEntry = (key, value, approxChars = 0) => {
    if (!inferredKind) inferredKind = looksLikeTextReuseRecord(value) ? 'textreuse' : looksLikePassage(value) ? 'corpus' : 'unknown';
    if (inferredKind === 'textreuse') {
      entryBatch.push([key, value]); entryBatchChars += approxChars;
      if (entryBatch.length >= MAX_BATCH_ITEMS || entryBatchChars >= TARGET_BATCH_CHARS) flushEntries();
    } else if (inferredKind === 'corpus') {
      itemBatch.push({ location: value.location || value.Location || key, ...value }); itemBatchChars += approxChars;
      if (itemBatch.length >= MAX_BATCH_ITEMS || itemBatchChars >= TARGET_BATCH_CHARS) flushItems();
    } else throw new Error('Large JSON object is not a recognized TEXTREUSE/corpus map.');
    count += 1;
  };
  const onItem = (value, approxChars = 0) => {
    if (!looksLikePassage(value)) throw new Error('Large JSON array must contain corpus passage objects.');
    inferredKind = 'corpus'; itemBatch.push(value); itemBatchChars += approxChars; count += 1;
    if (itemBatch.length >= MAX_BATCH_ITEMS || itemBatchChars >= TARGET_BATCH_CHARS) flushItems();
  };
  const parser = createStructuredParser(mode, onEntry, onItem, () => backpressureEnabled && pendingBatches >= MAX_PENDING_BATCHES);
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    await pushWithBackpressure(parser, decoder.decode(value, { stream: true }));
    emitProgress(bytes, file.size, count);
  }
  await pushWithBackpressure(parser, decoder.decode());
  parser.push('', true);
  flushEntries(); flushItems();
  await waitForAllBatches();
  postMessage({ type: 'done', kind: inferredKind || (mode.endsWith('array') ? 'corpus' : 'unknown'), count, bytes: file.size });
}


async function parseNdjsonReader(reader, totalBytes, firstValue = null) {
  const decoder = new TextDecoder('utf-8');
  let carry = '';
  let bytes = 0;
  let batch = [];
  let batchChars = 0;
  let count = 0;
  const flush = async () => { if (batch.length) { emitBatch({ type: 'batch', kind: 'corpus', items: batch, batchChars }); batch = []; batchChars = 0; await waitForPendingBelow(); } };
  async function consume(value) {
    if (!value) return;
    bytes += value.byteLength;
    carry += decoder.decode(value, { stream: true });
    const lines = carry.split(/\r?\n/); carry = lines.pop() || '';
    for (const line of lines) {
      if (!line.trim()) continue;
      const item = JSON.parse(line);
      if (!looksLikePassage(item)) throw new Error('NDJSON large-file mode expects one corpus passage object per line.');
      batch.push(item); batchChars += line.length; count += 1; if (batch.length >= MAX_BATCH_ITEMS || batchChars >= TARGET_BATCH_CHARS) await flush();
    }
    emitProgress(bytes, totalBytes, count);
  }
  if (firstValue) await consume(firstValue);
  while (true) { const { value, done } = await reader.read(); if (done) break; await consume(value); }
  carry += decoder.decode();
  if (carry.trim()) { const item = JSON.parse(carry); if (!looksLikePassage(item)) throw new Error('Invalid final NDJSON passage.'); batch.push(item); batchChars += carry.length; count += 1; }
  await flush(); await waitForAllBatches(); postMessage({ type: 'done', kind: 'corpus', count, bytes });
}

async function parseStructuredReader(reader, totalBytes, mode, firstValue = null) {
  const decoder = new TextDecoder('utf-8');
  let bytes = 0, count = 0, inferredKind = '';
  let entryBatch = [], itemBatch = [], entryBatchChars = 0, itemBatchChars = 0;
  const flushEntries = () => { if (entryBatch.length) { emitBatch({ type: 'batch', kind: 'textreuse', entries: entryBatch, batchChars: entryBatchChars }); entryBatch = []; entryBatchChars = 0; } };
  const flushItems = () => { if (itemBatch.length) { emitBatch({ type: 'batch', kind: 'corpus', items: itemBatch, batchChars: itemBatchChars }); itemBatch = []; itemBatchChars = 0; } };
  const onEntry = (key, value, approxChars = 0) => {
    if (!inferredKind) inferredKind = looksLikeTextReuseRecord(value) ? 'textreuse' : looksLikePassage(value) ? 'corpus' : 'unknown';
    if (inferredKind === 'textreuse') { entryBatch.push([key, value]); entryBatchChars += approxChars; if (entryBatch.length >= MAX_BATCH_ITEMS || entryBatchChars >= TARGET_BATCH_CHARS) flushEntries(); }
    else if (inferredKind === 'corpus') { itemBatch.push({ location: value.location || value.Location || key, ...value }); itemBatchChars += approxChars; if (itemBatch.length >= MAX_BATCH_ITEMS || itemBatchChars >= TARGET_BATCH_CHARS) flushItems(); }
    else throw new Error('Large JSON object is not a recognized direct TEXTREUSE/corpus map.');
    count += 1;
  };
  const onItem = (value, approxChars = 0) => { if (!looksLikePassage(value)) throw new Error('Large JSON array must contain corpus passage objects.'); inferredKind = 'corpus'; itemBatch.push(value); itemBatchChars += approxChars; count += 1; if (itemBatch.length >= MAX_BATCH_ITEMS || itemBatchChars >= TARGET_BATCH_CHARS) flushItems(); };
  const parser = createStructuredParser(mode, onEntry, onItem, () => backpressureEnabled && pendingBatches >= MAX_PENDING_BATCHES);
  async function consume(value) {
    if (!value) return;
    bytes += value.byteLength; await pushWithBackpressure(parser, decoder.decode(value, { stream: true }));
    emitProgress(bytes, totalBytes, count);
  }
  if (firstValue) await consume(firstValue);
  while (true) { const { value, done } = await reader.read(); if (done) break; await consume(value); }
  await pushWithBackpressure(parser, decoder.decode()); parser.push('', true); flushEntries(); flushItems();
  await waitForAllBatches();
  postMessage({ type: 'done', kind: inferredKind || (mode.endsWith('array') ? 'corpus' : 'unknown'), count, bytes });
}

async function parseUrl(url, label = '') {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  if (!response.body) throw new Error('Streaming response body is unavailable in this browser.');
  const total = Number(response.headers.get('content-length') || 0);
  const reader = response.body.getReader();
  const first = await reader.read();
  if (first.done) throw new Error('Remote large file is empty.');
  const headText = new TextDecoder('utf-8').decode(first.value.slice(0, Math.min(first.value.byteLength, 256 * 1024)));
  const name = String(label || url).toLowerCase();
  const trimmed = headText.replace(/^\uFEFF/, '').trimStart();
  if (name.endsWith('.ndjson') || name.endsWith('.jsonl')) return parseNdjsonReader(reader, total, first.value);
  const firstLine = trimmed.split(/\r?\n/, 1)[0];
  if (trimmed.startsWith('{') && firstLine && firstLine.trim().endsWith('}') && trimmed.slice(firstLine.length).trimStart().startsWith('{')) {
    try { if (looksLikePassage(JSON.parse(firstLine))) return parseNdjsonReader(reader, total, first.value); } catch {}
  }
  const mode = structuredModeFromHead(trimmed);
  if (mode) return parseStructuredReader(reader, total, mode, first.value);
  throw new Error('Unsupported streamed remote JSON format.');
}

self.onmessage = async event => {
  if (event.data?.type === 'ack') { acknowledgeBatch(); return; }
  if (event.data?.type !== 'parse') return;
  backpressureEnabled = Boolean(event.data.ackBatches);
  pendingBatches = 0; batchToken = 0; pendingWaiters = []; lastProgressPost = 0;
  const file = event.data.file;
  try {
    if (event.data.url) return await parseUrl(event.data.url, event.data.label || '');
    const name = String(file.name || '').toLowerCase();
    if (name.endsWith('.ndjson') || name.endsWith('.jsonl')) return await parseNdjson(file);
    const head = await file.slice(0, 256 * 1024).text();
    const trimmed = head.replace(/^\uFEFF/, '').trimStart();
    const firstLine = trimmed.split(/\r?\n/, 1)[0];
    if (trimmed.startsWith('{') && firstLine && firstLine.trim().endsWith('}') && trimmed.slice(firstLine.length).trimStart().startsWith('{')) {
      try { if (looksLikePassage(JSON.parse(firstLine))) return await parseNdjson(file); } catch {}
    }
    const mode = structuredModeFromHead(trimmed);
    if (mode) return await parseStructured(file, mode);
    throw new Error('Unsupported large-file format. Use direct JSON, wrapped JSON, JSON array, JSONL, or NDJSON.');
  } catch (error) {
    postMessage({ type: 'error', message: error?.message || String(error) });
  }
};
