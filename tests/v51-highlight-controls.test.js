'use strict';
const assert = require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const base=path.resolve(__dirname,'..');
const html=fs.readFileSync(path.join(base,'index.html'),'utf8');
const js=fs.readFileSync(path.join(base,'reuse-lab.js'),'utf8');
const css=fs.readFileSync(path.join(base,'styles.css'),'utf8');
for (const control of ['v51-paint','v51-intensity','v51-previous','v51-next','v51-pin','v51-clear']) {
  assert.ok(html.includes(`id="${control}"`),`missing ${control}`);
  assert.ok(js.includes(`'${control}'`),`unwired ${control}`);
}
assert.ok((html.match(/data-color-mode="groups"/g)||[]).length>=2,'groups toggle absent in synopsis');
assert.ok(css.includes('.v5-match.v5-dimmed'));
assert.ok(css.includes('data-highlight-intensity'));
console.log('V5.1 highlight controls structural checks passed');
