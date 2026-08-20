window.TR = window.TR || {};

TR.largeFiles = (() => {
  'use strict';
  // Ordinary JSON.parse is much faster for medium-size files. Streaming is
  // reserved for genuinely large inputs where memory safety matters.
  const LARGE_THRESHOLD = 256 * 1024 * 1024;
  const VERY_LARGE_THRESHOLD = 1024 * 1024 * 1024;
  const DB_NAME = 'textreuse-large-raw-v1';
  const STORE_NAME = 'records';

  function isLarge(file) { return Boolean(file && file.size >= LARGE_THRESHOLD); }
  function isVeryLarge(file) { return Boolean(file && file.size >= VERY_LARGE_THRESHOLD); }

  let dbPromise = null;
  const pendingByKey = new Map();
  const pendingWrites = new Set();
  let pendingWriteBytes = 0;

  function openDb() {
    if (!('indexedDB' in window)) return Promise.resolve(null);
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => { dbPromise = null; reject(request.error); };
    });
    return dbPromise;
  }

  async function putBatch(sourceId, entries) {
    const db = await openDb();
    if (!db || !entries?.length) return false;
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      entries.forEach(([key, value]) => store.put(value, `${sourceId}::${key}`));
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error || new Error('IndexedDB write failed'));
      tx.onabort = () => reject(tx.error || new Error('IndexedDB write aborted'));
    });
    return true;
  }

  async function readRecord(sourceId, rawId) {
    const db = await openDb();
    if (!db) return null;
    return new Promise((resolve, reject) => {
      const req = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(`${sourceId}::${rawId}`);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  async function getRecord(sourceId, rawId) {
    const storageKey = `${sourceId}::${rawId}`;
    let value = await readRecord(sourceId, rawId);
    if (value) return value;
    const pending = pendingByKey.get(storageKey);
    if (pending) {
      try { await pending; } catch { return null; }
      value = await readRecord(sourceId, rawId);
    }
    return value || null;
  }

  function queueBatch(sourceId, entries, approxBytes = 0) {
    if (!entries?.length) return Promise.resolve(false);
    const storageKeys = entries.map(([key]) => `${sourceId}::${key}`);
    const bytes = Math.max(0, Number(approxBytes || 0));
    const promise = putBatch(sourceId, entries);
    pendingWrites.add(promise);
    pendingWriteBytes += bytes;
    storageKeys.forEach(key => pendingByKey.set(key, promise));
    const cleanup = () => {
      pendingWrites.delete(promise);
      pendingWriteBytes = Math.max(0, pendingWriteBytes - bytes);
      storageKeys.forEach(key => { if (pendingByKey.get(key) === promise) pendingByKey.delete(key); });
    };
    promise.then(cleanup, cleanup);
    return promise;
  }

  function rawWriteStatus() {
    return { count: pendingWrites.size, bytes: pendingWriteBytes };
  }

  async function waitForRawWrites(maxBytes = 0) {
    while (pendingWrites.size && pendingWriteBytes > maxBytes) {
      await Promise.race([...pendingWrites].map(p => p.catch(() => false)));
    }
  }

  function parseFile(file, handlers = {}) {
    return new Promise((resolve, reject) => {
      const worker = new Worker('large-file-worker.js');
      let finalInfo = null;
      worker.onmessage = async event => {
        const message = event.data || {};
        try {
          if (message.type === 'progress') handlers.onProgress?.(message);
          else if (message.type === 'batch') {
            try { await handlers.onBatch?.(message); }
            finally { if (message.batchToken) worker.postMessage({ type: 'ack', batchToken: message.batchToken }); }
          }
          else if (message.type === 'done') {
            finalInfo = message;
            worker.terminate();
            resolve(finalInfo);
          } else if (message.type === 'error') {
            worker.terminate(); reject(new Error(message.message));
          }
        } catch (error) {
          worker.terminate(); reject(error);
        }
      };
      worker.onerror = error => { worker.terminate(); reject(new Error(error.message || 'Large-file worker failed')); };
      worker.postMessage({ type: 'parse', file, ackBatches: true });
    });
  }


  function parseUrl(url, label = '', handlers = {}) {
    return new Promise((resolve, reject) => {
      const worker = new Worker('large-file-worker.js');
      worker.onmessage = async event => {
        const message = event.data || {};
        try {
          if (message.type === 'progress') handlers.onProgress?.(message);
          else if (message.type === 'batch') {
            try { await handlers.onBatch?.(message); }
            finally { if (message.batchToken) worker.postMessage({ type: 'ack', batchToken: message.batchToken }); }
          }
          else if (message.type === 'done') { worker.terminate(); resolve(message); }
          else if (message.type === 'error') { worker.terminate(); reject(new Error(message.message)); }
        } catch (error) { worker.terminate(); reject(error); }
      };
      worker.onerror = error => { worker.terminate(); reject(new Error(error.message || 'Large-file worker failed')); };
      worker.postMessage({ type: 'parse', url, label, ackBatches: true });
    });
  }

  async function requestPersistence() {
    try {
      if (!navigator.storage?.persist) return false;
      return await navigator.storage.persist();
    } catch { return false; }
  }

  async function storageEstimate() {
    try {
      if (!navigator.storage?.estimate) return null;
      const value = await navigator.storage.estimate();
      return { quota: Number(value.quota || 0), usage: Number(value.usage || 0) };
    } catch { return null; }
  }

  function compactFileSize(bytes) {
    const n = Number(bytes || 0);
    if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(2)} GB`;
    if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(1)} MB`;
    return `${Math.max(1, Math.round(n / 1024))} KB`;
  }

  return { LARGE_THRESHOLD, VERY_LARGE_THRESHOLD, isLarge, isVeryLarge, parseFile, parseUrl, putBatch, queueBatch, getRecord, rawWriteStatus, waitForRawWrites, requestPersistence, storageEstimate, compactFileSize };
})();
