const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname,'..');
const listeners = {};
class FakeElement {
  constructor(id){this.id=id;this.value='';this.innerHTML='';this.textContent='';this.hidden=false;this.listeners={};this.options=[{textContent:''}];}
  addEventListener(type,callback){this.listeners[type]=callback;}
  insertAdjacentHTML(_position,html){this.innerHTML+=html;}
  send(type,value){this.value=value;this.listeners[type]?.({target:this});}
}
const ids = ['v5-results','v5-count','v5-warning','v5-dataset','v5-book','v5-category','v5-metric','v5-threshold','v5-search','v5-aligned','v5-text-mode','v5-context','v5-more','v5-reset','v5-export',
  'v5-section-title','v5-section-subtitle','v5-export-label','v5-metric-label','v5-threshold-label','v5-search-label','v5-dataset-label','v5-book-label','v5-category-label','v5-aligned-label','v5-text-label','v5-ctx-label'];
const el=Object.fromEntries(ids.map(k=>[k,new FakeElement(k)]));
const legend=new FakeElement('legend');
const doc = {
  getElementById:id=>el[id]||null,
  querySelector:selector=>selector==='.v5-match-legend'?legend:null,
  addEventListener:(type,cb)=>{listeners[type]=cb;},
  querySelectorAll:()=>[]
};
const ctx = {window:{},document:doc,TR:{},setTimeout,clearTimeout,requestAnimationFrame:f=>f(),console};
ctx.window=ctx;ctx.window.TR=ctx.TR;
vm.createContext(ctx);
for(const file of ['config.js','utils.js','ref-templates.js','knowledge.js','data-model.js','reuse-lab.js']) {
  vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),ctx,{filename:file});
}
const raw=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/V5_SYNTHETIC_TEST_ONLY.json'),'utf8'));
(async()=>{
  const data=await ctx.TR.DataModel.fromRaw(raw,'synthetic.json',()=>{},{datasetId:'v5-synthetic'});
  // DOM-only html/matrix fallback in this fake harness.
  ctx.TR.utils.alignedTextHtml=()=>'[fallback alignment]';
  let read=null,synopsis=null;
  ctx.TR.reuseLab.mount({getData:()=>({model:data,filters:{}}),openRead:(r,c)=>{read=[r,c];},openSynopsis:(r,c)=>{synopsis=[r,c];}});
  ctx.TR.reuseLab.render();
  assert.equal((el['v5-results'].innerHTML.match(/class="v5-result-card/g)||[]).length,4);
  assert.ok(el['v5-count'].textContent.includes('4'));
  assert.ok(el['v5-book'].innerHTML.includes('Demo')||el['v5-book'].innerHTML.includes('Parallel'));
  assert.ok(el['v5-metric'].innerHTML.includes('longestRun'));
  assert.ok(el['v5-results'].innerHTML.includes('data-v5-action="read"'));
  el['v5-metric'].send('change','longestRun');
  assert.ok(el['v5-results'].innerHTML.includes('Demo_Parallel_C_p_3_2'));
  el['v5-threshold'].send('change','3');
  assert.equal((el['v5-results'].innerHTML.match(/class="v5-result-card/g)||[]).length,1);
  el['v5-reset'].listeners.click({target:el['v5-reset']});
  assert.equal((el['v5-results'].innerHTML.match(/class="v5-result-card/g)||[]).length,4);
  assert.equal(el['v5-metric'].value,'score');
  console.log('V5 browser-DOM harness: mounting, filters, global ranks and reset passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
