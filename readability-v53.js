/* V5.3 – personalized reading preferences, fully local and independent from data adapters. */
(() => {
 'use strict';
 const $ = id => document.getElementById(id);
 const root = document.documentElement;
 const layout = $('v52-reading-layout');
 const dialog = $('v53-settings-dialog');
 if (!layout || !dialog) return;
 const prefKey='textreuse-v53-reading-preferences', oldKey='textreuse-v52-readability';
 const defaults={font:'Assistant',size:17,leading:'1.4',weight:'400',spacing:'0',source:false,candidates:false};
 const fontSet=new Set(['Assistant','Arial','David','Noto Sans Hebrew','sans-serif']);
 const leadSet=new Set(['1.15','1.25','1.3','1.4','1.5','1.65']);
 const wtSet=new Set(['400','500','600']);
 const spaceSet=new Set(['0','0.2','0.5']);
 const readJson = key => {try{return JSON.parse(localStorage.getItem(key)||'null')}catch{return null}};
 const sanitize = raw => ({
  font:fontSet.has(raw?.font)?raw.font:defaults.font,
  size:Number.isFinite(Number(raw?.size))?Math.max(15,Math.min(27,Math.round(Number(raw.size)))):defaults.size,
  leading:leadSet.has(String(raw?.leading))?String(raw.leading):defaults.leading,
  weight:wtSet.has(String(raw?.weight))?String(raw.weight):defaults.weight,
  spacing:spaceSet.has(String(raw?.spacing))?String(raw.spacing):defaults.spacing,
  source:!!raw?.source,candidates:!!raw?.candidates
 });
 // Migrate only the column states from V5.2: V5.3 intentionally revises its default typography.
 const saved=readJson(prefKey), old=readJson(oldKey);
 const migratedBefore=localStorage.getItem('textreuse-v54-migrated')==='1';
 // Adjust unchanged V5.3 defaults, while retaining actual customized preferences.
 const migrated = saved ? {...saved,
   size: !migratedBefore && Number(saved.size)===19 ? 17 : saved.size,
   leading: !migratedBefore && String(saved.leading)==='1.3' ? '1.4' : saved.leading
 } : {...defaults,source:old?.source,candidates:old?.candidates};
 try{localStorage.setItem('textreuse-v54-migrated','1')}catch(_e){}
 let state=sanitize(migrated);
 const fonts={Assistant:'"Assistant",Arial,sans-serif',Arial:'Arial,sans-serif',David:'David,"Times New Roman",serif','Noto Sans Hebrew':'"Noto Sans Hebrew",Arial,sans-serif','sans-serif':'system-ui,sans-serif'};
 function draw(){
  root.style.setProperty('--v52-text-size',state.size+'px');
  root.style.setProperty('--v52-reading-leading',state.leading);
  root.style.setProperty('--v53-font-family',fonts[state.font]);
  root.style.setProperty('--v53-weight',state.weight);
  root.style.setProperty('--v53-spacing',state.spacing+'px');
  layout.classList.toggle('v52-source-collapsed',state.source);
  layout.classList.toggle('v52-candidates-collapsed',state.candidates);
  for(const [id,isOn,closed,open] of [
   ['v52-toggle-source',state.source,'הרחב ספר מקור','צמצם ספר מקור'],
   ['v52-toggle-candidates',state.candidates,'הרחב קטעים לבחירה','צמצם קטעים לבחירה']
  ]){$(id).setAttribute('aria-pressed',String(isOn));$(id).textContent=isOn?closed:open;}
  $('v52-focus').setAttribute('aria-pressed',String(state.source&&state.candidates));
  $('v52-font-size').value=state.size; $('v52-font-value').textContent=state.size+'px';
  for(const [id,key] of [['v53-font','font'],['v53-size','size'],['v53-leading','leading'],['v53-weight','weight'],['v53-spacing','spacing']])$(id).value=state[key];
  $('v53-size-value').textContent=state.size+'px';
  try{localStorage.setItem(prefKey,JSON.stringify(state))}catch(_e){}
 }
 $('v52-toggle-source').addEventListener('click',()=>{state.source=!state.source;draw()});
 $('v52-toggle-candidates').addEventListener('click',()=>{state.candidates=!state.candidates;draw()});
 $('v52-focus').addEventListener('click',()=>{const on=!(state.source&&state.candidates);state.source=on;state.candidates=on;draw()});
 $('v52-font-size').addEventListener('input',ev=>{state.size=+ev.target.value;draw()});
 $('v52-reset').addEventListener('click',()=>{state=sanitize(defaults);draw()});
 for(const [id,key] of [['v53-font','font'],['v53-size','size'],['v53-leading','leading'],['v53-weight','weight'],['v53-spacing','spacing']]){
  $(id).addEventListener(id==='v53-size'?'input':'change',ev=>{state=sanitize({...state,[key]:ev.target.value});draw()});
 }
 const openSettings=()=>{if(typeof dialog.showModal==='function'){if(!dialog.open)dialog.showModal()}else dialog.setAttribute('open','')};
 $('v53-settings-open').addEventListener('click',openSettings);
 $('v54-settings-float').addEventListener('click',openSettings);
 $('v53-settings-reset').addEventListener('click',()=>{state=sanitize({...defaults,source:state.source,candidates:state.candidates});draw()});
 draw();
})();
