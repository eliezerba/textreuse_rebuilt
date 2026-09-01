#!/usr/bin/env node
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { URL } = require('url');

const appDir = __dirname;
const startPort = 8765;
const endPort = 8865;
const dataExts = new Set(['.json', '.jsonl', '.ndjson']);
const mime = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.jsonl': 'application/x-ndjson; charset=utf-8', '.ndjson': 'application/x-ndjson; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8'
};

function listRootDataFiles() {
  return fs.readdirSync(appDir, { withFileTypes: true })
    .filter(e => e.isFile() && dataExts.has(path.extname(e.name).toLowerCase()))
    .map(e => {
      const full = path.join(appDir, e.name);
      const st = fs.statSync(full);
      return { name: e.name, url: `/api/file?name=${encodeURIComponent(e.name)}`, size: st.size, modified: Math.floor(st.mtimeMs / 1000) };
    });
}

function sendJson(res, payload, status = 200) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': body.length, 'Cache-Control': 'no-store, max-age=0' });
  res.end(body);
}

function sendFile(res, fullPath) {
  fs.stat(fullPath, (err, st) => {
    if (err || !st.isFile()) return sendJson(res, { error: 'not found' }, 404);
    const ext = path.extname(fullPath).toLowerCase();
    res.writeHead(200, { 'Content-Type': mime[ext] || 'application/octet-stream', 'Content-Length': st.size, 'Cache-Control': 'no-store, max-age=0' });
    const stream = fs.createReadStream(fullPath);
    stream.on('error', () => { try { res.destroy(); } catch {} });
    stream.pipe(res);
  });
}

function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res, { error: 'method not allowed' }, 405);
  const u = new URL(req.url, 'http://localhost');
  if (u.pathname === '/api/health') return sendJson(res, { ok: true });
  if (u.pathname === '/api/json-files') return sendJson(res, { files: listRootDataFiles() });
  if (u.pathname === '/api/file') {
    const name = path.basename(u.searchParams.get('name') || '');
    if (!name || !dataExts.has(path.extname(name).toLowerCase())) return sendJson(res, { error: 'file not allowed' }, 404);
    return sendFile(res, path.join(appDir, name));
  }

  let rel;
  try { rel = decodeURIComponent(u.pathname); } catch { return sendJson(res, { error: 'bad path' }, 400); }
  if (rel === '/') rel = '/index.html';
  const candidate = path.resolve(appDir, '.' + rel);
  if (candidate !== appDir && !candidate.startsWith(appDir + path.sep)) return sendJson(res, { error: 'forbidden' }, 403);
  return sendFile(res, candidate);
}

function openBrowser(url) {
  const cmd = process.platform === 'win32' ? `start "" "${url}"` : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
  exec(cmd, () => {});
}

function tryPort(port) {
  if (port > endPort) {
    console.error(`Could not find a free port between ${startPort} and ${endPort}.`);
    process.exit(1);
  }
  const server = http.createServer(handler);
  server.once('error', err => {
    if (err && err.code === 'EADDRINUSE') return tryPort(port + 1);
    console.error(err);
    process.exit(1);
  });
  server.listen(port, '127.0.0.1', () => {
    const url = `http://localhost:${port}/`;
    console.log('TEXTREUSE Viewer is running.');
    console.log(`Open: ${url}`);
    console.log('Press Ctrl+C to stop the server.');
    setTimeout(() => openBrowser(url), 500);
  });
}

tryPort(startPort);
