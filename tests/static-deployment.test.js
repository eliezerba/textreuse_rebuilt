const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
assert(app.includes("new URL('data/manifest.json', window.location.href)"), 'static manifest discovery is missing');
assert(!app.includes("fetch('/api/json-files'"), 'root-relative API fetch breaks GitHub project pages');

const manifest = JSON.parse(fs.readFileSync(path.join(root, 'data', 'manifest.json'), 'utf8'));
assert(Array.isArray(manifest.files) && manifest.files.length > 0, 'manifest must contain at least one packaged data file');
for (const item of manifest.files) {
  assert(item.name && item.path, 'manifest entry needs name/path');
  const full = path.resolve(root, 'data', item.path);
  assert(full.startsWith(path.resolve(root, 'data') + path.sep), 'manifest path must stay inside data/');
  assert(fs.existsSync(full), `manifest file does not exist: ${item.path}`);
}
for (const required of ['index.html', '.nojekyll', 'START_TEXTREUSE.bat', 'start_server.py', 'start_server.js']) {
  assert(fs.existsSync(path.join(root, required)), `missing deployment/startup file: ${required}`);
}
console.log('static deployment test passed');
