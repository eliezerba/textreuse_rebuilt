/* TEXTREUSE V5 — client-only parallel explorer and alignment utilities.
 * Data model and readers are shared with the original application: no input
 * format is rewritten, no additional network access, no API credentials.
 */
window.TR = window.TR || {};
TR.reuseLab = (() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const esc = s => TR.utils.escapeHtml(String(s ?? ''));
  const tr = (he, en) => TR.i18n?.t(he, en) || he;
  const PAGE_SIZE = 24;
  const palette = ['#d7e8f5','#fae4b4','#dceacb','#f5d9df','#dcdcf4','#d2ebea','#f1dfc9','#e4dfd4'];
  const METRICS = [
    ['score','score',false],['normScore','norm_score',false],['alignmentScore','alignment_score',false],
    ['matched','matched pairs',true],['sumWords','distinct target words',true],
    ['longestRun','longest parallel run',true],['coverage','query coverage',true],['exactPct','exact share',true]
  ];
  const metricNames = {
    score: ['ציון גולמי (score)','Raw score'], normScore: ['ציון מנורמל בתוך הקטע','Within-passage normalized score'],
    alignmentScore: ['איכות יישור','Alignment score'], matched: ['מספר זוגות מילים','Aligned word pairs'],
    sumWords: ['מילים ייחודיות במועמד','Distinct candidate words'],
    longestRun: ['הרצף המקביל הארוך ביותר','Longest parallel run'],
    coverage: ['כיסוי קטע המקור','Query coverage'], exactPct: ['אחוז התאמות מדויקות','Exact-match share']
  };
  const model = { getData:null, openRead:null, openSynopsis:null, current:null, rows:[], shown:0, busy:false };
  const highlight = {mode:'groups', intensity:'medium', selected:null, pinned:false};
  const filters = { metric:'score', threshold:'', search:'', dataset:'', book:'', category:'', alignment:'all', mode:'all', context:7, queryMode:'full' };
  let metricsCache = new WeakMap();
  const clean = s => String(s || '').replace(/\s+/g,' ').trim();
  const words = s => clean(s).split(/\s+/).filter(Boolean);
  const matchType = kind => {
    const v=String(kind||'').toLowerCase();
    if (v.includes('exact')) return 'exact';
    if (v.includes('morph')||v.includes('lemma')||v.includes('stem')) return 'morph';
    if (v.includes('semantic')||v.includes('synonym')) return 'semantic';
    return 'approx';
  };
  const textDetails = (record, candidate) => {
    if (!candidate) return {};
    const details=candidate.details||{};
    if (!details.__largeStoreRef) return details;
    return {...details,passage_text: record?.analysisText || record?.originalText || '',source_text:candidate.sourceText||''};
  };
  function pairGroups(details, alignment) {
    let data=details?.alignment_sequence;
    if (typeof data==='string') { try { data=JSON.parse(data); } catch { data=null; } }
    const groups=[];
    const validTuple=p=>Array.isArray(p)&&p.length>=2&&Number.isInteger(+p[0])&&Number.isInteger(+p[1])&&+p[0]>=0&&+p[1]>=0;
    function add(group){
      const pairs=[];
      function walk(v){ if(validTuple(v)){pairs.push({originalIndex:+v[0],candidateIndex:+v[1],strength:Number(v[2]??1),kind:String(v[3]||'match')});return;}
        if(Array.isArray(v))v.forEach(walk); }
      walk(group); if(pairs.length)groups.push(pairs);
    }
    if(Array.isArray(data)){
      if(data.every(validTuple)) add(data);
      else data.forEach(add);
    }
    if(!groups.length && Array.isArray(alignment?.pairs) && alignment.pairs.length) add(alignment.pairs.map(p=>[p.originalIndex,p.candidateIndex,p.strength,p.kind]));
    return groups;
  }
  function groupsFor(record,candidate){
    const details=textDetails(record,candidate);
    const al=candidate?.alignment || (TR.utils.normalizedAlignment?.(details)) || {pairs:[]};
    return pairGroups(details,al);
  }
  function statistics(record,candidate){
    if(metricsCache.has(candidate))return metricsCache.get(candidate);
    const g=groupsFor(record,candidate), pairs=g.flat();
    const result={known:!!pairs.length, matched:null, sumWords:null, longestRun:null, coverage:null, exactPct:null, runs:[]};
    if(pairs.length){
      const valid=pairs.filter(p=>Number.isInteger(p.originalIndex)&&Number.isInteger(p.candidateIndex));
      const distinctQuery=new Set(valid.map(p=>p.originalIndex));
      const distinctTarget=new Set(valid.map(p=>p.candidateIndex));
      const exact=valid.filter(p=>matchType(p.kind)==='exact').length;
      const srcCount=words(textDetails(record,candidate).passage_text || record.analysisText || record.originalText).length;
      result.matched=valid.length;result.sumWords=distinctTarget.size;
      result.coverage=srcCount ? Math.min(1,distinctQuery.size/srcCount) : null;
      result.exactPct=valid.length ? exact/valid.length : null;
      const runs=[];
      g.forEach((chunk,gid)=>{
        const unique=[...new Map(chunk.map(p=>[`${p.originalIndex}:${p.candidateIndex}`,p])).values()]
          .sort((a,b)=>a.originalIndex-b.originalIndex||a.candidateIndex-b.candidateIndex);
        let run=[];
        for(const p of unique){
          if(run.length&&(p.originalIndex!==run.at(-1).originalIndex+1||p.candidateIndex!==run.at(-1).candidateIndex+1)){
            if(run.length)runs.push({group:gid,pairs:run});run=[];
          } run.push(p);
        }
        if(run.length)runs.push({group:gid,pairs:run});
      });
      result.runs=runs;
      result.longestRun=Math.max(0,...runs.map(r=>r.pairs.length));
    }
    metricsCache.set(candidate,result);return result;
  }
  function metricValue(record,candidate,key){
    if(!METRICS.some(m=>m[0]===key))return 0;
    if(['score','normScore','alignmentScore'].includes(key)) return Number(candidate[key]||0);
    return statistics(record,candidate)[key];
  }
  function metricLabel(key){const a=metricNames[key]||[key,key];return tr(a[0],a[1]);}
  function fmt(key,v){
    if(v===null||v===undefined||!Number.isFinite(Number(v)))return '—';
    if(key==='coverage'||key==='exactPct')return `${(v*100).toFixed(0)}%`;
    if(key==='normScore'||key==='alignmentScore')return Number(v).toFixed(3);
    if(key==='score')return Number(v).toFixed(1);
    return String(v);
  }
  function renderWords(record,candidate,role,options={}) {
    const d=textDetails(record,candidate);
    const text=role==='original'?(d.passage_text||record?.analysisText||record?.originalText||'')
      :(d.source_text||candidate?.sourceText||'');
    const tokens=words(text), groups=groupsFor(record,candidate);
    if(!groups.length){
      if(!options.contextOnly && TR.utils.alignedTextHtml)
        return TR.utils.alignedTextHtml(d,role,{color:'#315a70',colorMode:'system'});
      return esc(tokens.join(' '));
    }
    const hits=new Map();
    for(let g=0;g<groups.length;g++)for(const pair of groups[g]){
      const at=role==='original'?pair.originalIndex:pair.candidateIndex;
      if(!Number.isInteger(at)||at<0||at>=tokens.length)continue;
      const prev=hits.get(at)||{groups:new Set(),type:matchType(pair.kind),types:new Set()};
      prev.groups.add(g);prev.types.add(matchType(pair.kind));
      if(matchType(pair.kind)==='exact')prev.type='exact';
      hits.set(at,prev);
    }
    const ctx=options.contextOnly ? Number(options.context ?? 7):null;
    const paintMode=options.paintMode || (options.contextOnly!==undefined ? highlight.mode : 'groups');
    const visible=new Set();
    if(ctx!==null){for(const i of hits.keys())for(let j=Math.max(0,i-ctx);j<=Math.min(tokens.length-1,i+ctx);j++)visible.add(j);}
    const out=[];let omitted=false;
    for(let i=0;i<tokens.length;i++){
      if(ctx!==null&&!visible.has(i)){if(!omitted)out.push('<span class="v5-ellipsis" aria-label="omitted text">…</span>');omitted=true;continue;}
      omitted=false;
      const hit=hits.get(i);
      if(!hit){out.push(`<span class="alignment-plain-token">${esc(tokens[i])}</span>`);continue;}
      const ids=[...hit.groups], bg=paintMode==='types'?({exact:'#c7e9ce',morph:'#d8e1fc',semantic:'#ead9f7',approx:'#f8e3bd'}[hit.type]):palette[ids[0]%palette.length];
      const selected=options.contextOnly===undefined || highlight.selected===null || ids.includes(highlight.selected);
      const painted=paintMode!=='none' && (highlight.selected===null || selected);
      out.push(`<span class="v5-match v5-${hit.type} ${painted?'v5-painted':''} ${selected?'':'v5-dimmed'}" style="--v5-match:${bg};background-color:${painted?bg:'transparent'}" data-tr-ids="${ids.join(' ')}" tabindex="0" title="${esc(tr('התאמה: ','Match: '))}${esc([...hit.types].join(', '))} · ${esc(tr('קבוצה','group'))} ${ids.map(n=>n+1).join(', ')}">${esc(tokens[i])}</span>`);
    }
    return out.join(' ');
  }
  function attachHover(){
    document.addEventListener('mouseover',event=>{
      const word=event.target.closest?.('.v5-match[data-tr-ids]');
      if(word && !highlight.pinned)highlightPeers(word);
      else if(!event.target.closest?.('.v5-comparison, .text-comparison, .synopsis-stage-card, .continuous-synopsis'))clearPeers();
    });
    document.addEventListener('focusin',event=>{const w=event.target.closest?.('.v5-match[data-tr-ids]');if(w)highlightPeers(w);});
    document.addEventListener('focusout',event=>{if(event.target.closest?.('.v5-match'))clearPeers();});
    document.addEventListener('mouseout',event=>{if(event.target.closest?.('.v5-match') && !event.relatedTarget?.closest?.('.v5-match'))clearPeers();});
  }
  function clearPeers(){if(highlight.pinned)return;document.querySelectorAll('.v5-peer').forEach(el=>el.classList.remove('v5-peer'));}
  function highlightPeers(word){
    document.querySelectorAll('.v5-peer').forEach(el=>el.classList.remove('v5-peer'));
    const container=word.closest('.v5-comparison')||word.closest('.text-comparison')||word.closest('.synopsis-grid')||word.closest('.continuous-columns');
    if(!container)return;
    const ids=new Set((word.dataset.trIds||'').split(' '));
    container.querySelectorAll('.v5-match[data-tr-ids]').forEach(node=>{
      if(node.dataset.trIds.split(' ').some(x=>ids.has(x)))node.classList.add('v5-peer');
    });
  }
  function currentData(){return model.getData?.()||{};}
  function getRows(){
    const {model:data,filters:globalFilters}=currentData();
    if(!data)return [];
    const base=[];
    for(const record of data.records){
      // Respect all existing dataset/book/category and text filters.
      for(const candidate of data.getCandidates(record.id,globalFilters||{})) {
        if(filters.dataset&&candidate.datasetId!==filters.dataset)continue;
        if(filters.book&&candidate.bookSlug!==filters.book)continue;
        if(filters.category&&!candidate.categories?.includes(filters.category))continue;
        if(filters.alignment==='aligned'&&!statistics(record,candidate).known)continue;
        if(filters.alignment==='unaligned'&&statistics(record,candidate).known)continue;
        const q=clean(filters.search).toLocaleLowerCase();
        if(q && ![candidate.bookTitle,candidate.sourceLocation,candidate.datasetLabel,record.rawId,record.displayRef,
          candidate.sourceText,record.originalText,...(candidate.categories||[])].some(x=>String(x||'').toLocaleLowerCase().includes(q)))continue;
        const score=metricValue(record,candidate,filters.metric);
        const threshold=filters.threshold===''?null:Number(filters.threshold);
        if(threshold!==null && (score===null || score<threshold))continue;
        base.push({record,candidate,value:score});
      }
    }
    base.sort((a,b)=>(b.value===null?-Infinity:b.value)-(a.value===null?-Infinity:a.value)||b.candidate.score-a.candidate.score);
    return base;
  }
  function updateOptions(){
    const {model:data}=currentData();if(!data)return;
    const existing=(id)=>$(id)?.value||'';
    const datasets=new Map(data.datasets.map(x=>[x.id,x.label]));
    const books=new Map(), cats=new Set();
    for(const book of data.books||[])books.set(book.slug,book.localTitle||book.title||book.slug);
    for(const record of data.records)for(const c of record.candidates){if(c.isSelf)continue;
      books.set(c.bookSlug,c.localMetadata?.title||c.bookTitle||c.bookSlug);
      (c.categories||[]).forEach(cat=>cats.add(String(cat)));
    }
    const options=(id,entries,allText)=>{
      const select=$(id);if(!select)return;
      const old=existing(id);
      select.innerHTML=`<option value="">${esc(allText)}</option>` + entries.map(([id,label])=>`<option value="${esc(id)}">${esc(label)}</option>`).join('');
      select.value=entries.some(([id])=>id===old)?old:'';
    };
    options('v5-dataset',[...datasets],tr('כל המאגרים','All datasets'));
    options('v5-book',[...books].sort((a,b)=>a[1].localeCompare(b[1])),tr('כל החיבורים','All works'));
    options('v5-category',[...cats].sort().map(x=>[x,x]),tr('כל הקטגוריות','All categories'));
  }
  function render(){
    const root=$('v5-results');if(!root)return;
    const data=currentData().model;
    if(!data){root.innerHTML=`<p class="v5-empty">${tr('טען קבצים כדי להתחיל.','Load datasets to begin.')}</p>`;return;}
    if(model.lastModel!==data){updateOptions();model.lastModel=data;}
    const rows=getRows();model.rows=rows;model.shown=0;
    const missing=rows.filter(r=>r.value===null).length;
    $('v5-count').textContent=tr(`${rows.length.toLocaleString('he-IL')} מקבילות לפי המסננים`,` ${rows.length.toLocaleString('en-US')} parallels match the filters`);
    const caveat = filters.metric==='normScore' ? tr('הציון המנורמל הוא יחסי למועמדים של אותו קטע; אין לפרש דירוג רוחבי כהשוואה מכוילת בין קטעים.','Normalized scores are passage-relative; global ranks are not calibrated across passages.') :
      filters.metric==='score' ? tr('הציון הגולמי תלוי גם באורך; דירוג רוחבי אינו הוכחה לעוצמת הזיקה ההיסטורית.','Raw score is length-sensitive; cross-passage ranks are not evidence of historical dependence.') : '';
    $('v5-warning').textContent=[caveat,missing ? tr(`${missing} תוצאות ללא נתוני יישור מפורטים מוצגות ללא ציון במדד זה.`,`${missing} results lack direct alignment data for this measure.`) : ''].filter(Boolean).join(' · ');
    root.innerHTML='';if(root.dataset)root.dataset.highlightIntensity=highlight.intensity;renderMore();updateHighlightButtons();
  }
  function maxGroup(){let max=-1;for(const row of model.rows){const groups=groupsFor(row.record,row.candidate);max=Math.max(max,groups.length-1);}return max;}
  function stepGroup(direction){const max=maxGroup();if(max<0)return;highlight.selected=highlight.selected===null?(direction>0?0:max):((highlight.selected+direction+max+1)%(max+1));render();}
  function updateHighlightButtons(){const label=$('v51-selected');if(label)label.textContent=highlight.selected===null?tr('כל הקבוצות','All groups'):tr('קבוצה ','Group ')+(highlight.selected+1);const pin=$('v51-pin');if(pin){pin.setAttribute('aria-pressed',String(highlight.pinned));pin.textContent=highlight.pinned?tr('בטל נעילת הדגשה','Unpin highlight'):tr('נעל הדגשה','Pin highlight');}}
  function renderMore(){
    const root=$('v5-results');if(!root)return;
    const slice=model.rows.slice(model.shown,model.shown+PAGE_SIZE);
    root.insertAdjacentHTML('beforeend',slice.map((r,i)=>card(r,model.shown+i+1)).join(''));
    model.shown+=slice.length;
    $('v5-more').hidden=model.shown>=model.rows.length;
    if(!model.rows.length)root.innerHTML=`<p class="v5-empty">${tr('לא נמצאו התאמות במסננים שנבחרו. נסה לאפס מסננים.','No parallels match these filters. Try resetting the filters.')}</p>`;
  }
  function card(row,index){
    const {record:r,candidate:c}=row;
    const stat=statistics(r,c), d=textDetails(r,c),hasPairs=stat.known;
    const id=esc(c.id),rid=esc(r.id);
    const contextOnly=filters.queryMode==='context';
    const p=renderWords(r,c,'original',{contextOnly,context:filters.context,paintMode:highlight.mode});
    const s=renderWords(r,c,'candidate',{contextOnly,context:filters.context,paintMode:highlight.mode});
    const attrs=`data-v5-record="${rid}" data-v5-candidate="${id}"`;
    const chips=[['score',c.score],['normScore',c.normScore],['alignmentScore',c.alignmentScore],['sumWords',stat.sumWords],['longestRun',stat.longestRun],['coverage',stat.coverage],['exactPct',stat.exactPct]];
    const title=c.localMetadata?.heTitle||c.localMetadata?.title||c.bookTitle;
    return `<article class="v5-result-card v5-comparison" ${attrs}>
      <div class="v5-result-top"><div><span class="v5-rank">#${index}</span> <strong>${esc(r.displayRef||r.rawId)}</strong><span class="v5-arrow"> ⇄ </span><strong>${esc(title)}</strong> <small>${esc(c.displayRef||c.sourceLocation)}</small></div>
      <div class="v5-result-actions"><button type="button" class="secondary-button" data-v5-action="read" ${attrs}>${tr('פתח בקריאה','Open in reading')}</button>
      <button type="button" class="text-button" data-v5-action="synopsis" ${attrs}>${tr('פתח בסינופסיס','Open synopsis')}</button></div></div>
      <div class="v5-metadata">${esc(c.datasetLabel||c.datasetId)} · ${esc((c.categories||[]).join(' › '))}${!hasPairs?` · ${tr('אין רצף יישור מפורט','No direct alignment sequence')}`:''}</div>
      <div class="v5-chips">${chips.map(([k,v])=>`<span class="v5-chip"><span>${esc(metricLabel(k))}</span><b>${esc(fmt(k,v))}</b></span>`).join('')}</div>
      <div class="v5-pair-columns"><section><div class="v5-col-label">${tr('קטע המקור','Source passage')}</div><div class="v5-parallel-text" dir="auto">${p||'—'}</div></section>
      <section><div class="v5-col-label">${tr('המקבילה שנמצאה','Candidate parallel')}</div><div class="v5-parallel-text" dir="auto">${s||'—'}</div></section></div>
      <details class="v5-source-detail"><summary>${tr('פרטי מקור ומדדים','Source details and measures')}</summary>
      <dl><dt>Source ID</dt><dd>${esc(r.rawId)}</dd><dt>Candidate location</dt><dd>${esc(c.sourceLocation)}</dd>
      <dt>Dataset</dt><dd>${esc(c.datasetLabel||c.datasetId)}</dd><dt>Alignment origin</dt><dd>${esc(c.alignment?.origin||'none')}</dd>
      <dt>${tr('זוגות התאמה','Aligned pairs')}</dt><dd>${esc(fmt('matched',stat.matched))}</dd>
      <dt>${tr('מילים ייחודיות במקור','Distinct query words')}</dt><dd>${esc(stat.known?new Set(groupsFor(r,c).flat().map(x=>x.originalIndex)).size:'—')}</dd></dl></details>
      </article>`;
  }
  function download(name,text,mime){TR.utils.downloadText(name,text,mime);}
  const quote=value=>'"'+String(value??'').replaceAll('"','""').replace(/[\r\n]+/g,' ')+'"';
  function rowsCsv(rows){
    const head=['dataset','source_id','source_ref','candidate_id','candidate_location','work','categories','score','norm_score','alignment_score','matched_pairs','distinct_target_words','longest_run','query_coverage','exact_percentage','alignment_origin','passage_text','candidate_text'];
    const body=rows.map(({record:r,candidate:c})=>{const s=statistics(r,c),d=textDetails(r,c);
      return [c.datasetLabel||c.datasetId,r.rawId,r.displayRef,c.id,c.sourceLocation,c.bookTitle,(c.categories||[]).join(' > '),c.score,c.normScore,c.alignmentScore,s.matched,s.sumWords,s.longestRun,s.coverage,s.exactPct,c.alignment?.origin||'',d.passage_text||r.analysisText,d.source_text||c.sourceText].map(quote).join(',');
    });return '\ufeff'+[head.join(','),...body].join('\r\n');
  }
  function docPage(rows,doctype=true){
    const items=rows.map(({record:r,candidate:c},i)=>{
      const d=textDetails(r,c);const stat=statistics(r,c);
      return `<article class="comparison"><h2>${i+1}. ${esc(r.displayRef||r.rawId)} — ${esc(c.bookTitle)} (${esc(c.displayRef||c.sourceLocation)})</h2>
      <p class="meta">${esc(c.datasetLabel||c.datasetId)} · score ${esc(fmt('score',c.score))} · norm ${esc(fmt('normScore',c.normScore))} · longest run ${esc(fmt('longestRun',stat.longestRun))}</p>
      <table><tr><th>${tr('קטע המקור','Source passage')}</th><th>${tr('המקבילה שנמצאה','Candidate')}</th></tr>
      <tr><td>${renderWords(r,c,'original')}</td><td>${renderWords(r,c,'candidate')}</td></tr></table>
      <p class="meta">${esc(c.sourceLocation)}</p></article>`;
    }).join('');
    return `${doctype?'<!doctype html>':''}<html dir="${TR.i18n?.isHebrew()?'rtl':'ltr'}"><head><meta charset="utf-8"><title>TEXTREUSE V5</title><style>
      body{font-family:Arial,sans-serif;margin:22px;color:#202b36}.comparison{margin:20px 0 28px;break-inside:avoid}h2{font-size:18px}table{width:100%;border-collapse:collapse;table-layout:fixed}th,td{width:50%;border:1px solid #bfcbd2;padding:12px;vertical-align:top;line-height:1.9;font-family:Arial,sans-serif}td{font-size:16px}.meta{color:#60717e;font-size:12px}.v5-match{background:var(--v5-match,#deebf2);border-radius:3px;padding:1px 2px}.v5-ellipsis{color:#aaa}@media print{.comparison{break-inside:avoid}}</style></head><body><h1>TEXTREUSE · V5</h1><p>${tr('תוצאות מסוננות','Filtered matches')} · ${rows.length}</p>${items}</body></html>`;
  }
  function exportVisible(format){
    const rows=model.rows;
    if(!rows.length)return;
    if(format==='csv'){download('textreuse_v5_parallels.csv',rowsCsv(rows),'text/csv;charset=utf-8');return;}
    if(format==='html'||format==='doc'){
      const limit=Math.min(rows.length,400);
      if(rows.length>400&&!confirm(tr('לייצוא HTML/Word ייכללו 400 ההתאמות הראשונות. להמשיך?','HTML/Word export includes the first 400 parallels. Continue?')))return;
      download('textreuse_v5_parallels.'+format,docPage(rows.slice(0,limit)),format==='doc'?'application/msword':'text/html;charset=utf-8');return;
    }
    if(format==='pdf'){
      if(rows.length>100&&!confirm(tr('הדפסה ל־PDF תכלול את 100 התוצאות הראשונות. להמשיך?','Print to PDF includes the first 100 matches. Continue?')))return;
      const w=window.open('','_blank');if(!w){alert(tr('אפשר חלונות קופצים כדי להדפיס ל־PDF.','Enable pop-ups to print to PDF.'));return;}
      w.document.open();w.document.write(docPage(rows.slice(0,100)));w.document.close();w.focus();w.addEventListener('load',()=>w.print(),{once:true});return;
    }
    if(format==='png'||format==='jpg'){exportPng(rows[0],format);return;}
    if(format==='pptx'){exportPptx(rows.slice(0,40));}
  }
  function groupIndexMap(record,candidate,role){
    const result=new Map();
    groupsFor(record,candidate).forEach((group,gid)=>group.forEach(pair=>{
      const at=role==='original'?pair.originalIndex:pair.candidateIndex;
      if(Number.isInteger(at)&&at>=0&&!result.has(at))result.set(at,gid);
    }));
    return result;
  }
  function exportPng({record:r,candidate:c},format='png'){
    // Raster export renders the same ACT chunk groups as the browser (no external screenshots).
    const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');
    canvas.width=1600;canvas.height=1000;
    ctx.fillStyle='#fff';ctx.fillRect(0,0,1600,1000);
    ctx.fillStyle='#213745';ctx.font='bold 34px Arial';ctx.textAlign='right';ctx.direction='rtl';ctx.fillText('TEXTREUSE · V5',1540,64);
    ctx.font='27px Arial';ctx.fillText(clean(r.displayRef)+'  ↔  '+clean(c.bookTitle),1540,116);
    ctx.fillStyle='#eaf0f3';ctx.fillRect(45,145,1510,3);
    function column(text,x,width,label,role){
      ctx.textAlign='right';ctx.direction='rtl';ctx.fillStyle='#315a70';ctx.font='bold 24px Arial';ctx.fillText(label,x+width-16,191);
      ctx.strokeStyle='#d2dfe5';ctx.strokeRect(x,207,width,733);ctx.font='24px Arial';
      const map=groupIndexMap(r,c,role),ws=words(text),right=x+width-18,space=ctx.measureText(' ').width;
      let cursor=right,line=0;
      for(let i=0;i<ws.length;i++){
        const token=ws[i],measured=ctx.measureText(token).width;
        if(cursor-measured<x+16&&cursor!==right){line++;cursor=right;}
        if(line>=20)break;
        const y=255+line*33;
        if(map.has(i)){ctx.fillStyle=palette[map.get(i)%palette.length];ctx.fillRect(cursor-measured-4,y-24,measured+6,30);}
        ctx.fillStyle='#1b2730';ctx.fillText(token,cursor,y);
        cursor-=measured+space;
      }
      if(line>=20||ws.length>400){ctx.fillStyle='#758694';ctx.fillText('…',right,923);}
    }
    const d=textDetails(r,c);
    column(d.passage_text||r.analysisText||r.originalText,815,740,tr('קטע המקור','Source passage'),'original');
    column(d.source_text||c.sourceText,45,740,tr('המקבילה','Parallel'),'candidate');
    canvas.toBlob(blob=>{if(!blob)return;const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='textreuse_v5_comparison.'+(format==='jpg'?'jpg':'png');a.click();setTimeout(()=>URL.revokeObjectURL(url),5000);},format==='jpg'?'image/jpeg':'image/png',0.92);
  }
  function slideRuns(record,candidate,role){
    const d=textDetails(record,candidate);
    const tokenList=words(role==='original'?(d.passage_text||record.analysisText||record.originalText):(d.source_text||candidate.sourceText));
    const groups=groupIndexMap(record,candidate,role);
    const runs=tokenList.slice(0,220).map((token,index)=>{
      const gid=groups.get(index);
      const options=gid===undefined?{}:{highlight:palette[gid%palette.length].slice(1)};
      return {text:token+' ',options};
    });
    if(tokenList.length>220)runs.push({text:'…',options:{italic:true}});
    return runs;
  }
  async function exportPptx(rows){
    if(typeof PptxGenJS==='undefined'){alert(tr('ספריית ייצוא PowerPoint אינה זמינה.','PowerPoint export library is unavailable.'));return;}
    if(model.rows.length>40&&!confirm(tr('הייצוא יכלול את 40 ההתאמות הראשונות. להמשיך?','PowerPoint export includes the first 40 matches. Continue?')))return;
    try{
      const pptx=new PptxGenJS();pptx.layout='LAYOUT_WIDE';pptx.author='TEXTREUSE V5';pptx.subject='Filtered text parallels';
      for(const {record:r,candidate:c} of rows){
        const slide=pptx.addSlide();slide.background={color:'F8FAFC'};
        slide.addText(`${r.displayRef||r.rawId}  ⇄  ${c.bookTitle}`,{x:.5,y:.35,w:12.3,h:.7,fontFace:'Arial',fontSize:21,bold:true,rtlMode:true,color:'244456',breakLine:false});
        
        [0,1].forEach(i=>{const x=i?0.5:6.8;
          slide.addText(i?tr('המקבילה','Candidate'):tr('קטע המקור','Source'),{x,y:1.27,w:5.9,h:.35,fontSize:13,color:'315A70',rtlMode:true});
          slide.addText(slideRuns(r,c,i?'candidate':'original'),{x,y:1.74,w:5.95,h:4.55,fontSize:16,fontFace:'Arial',rtlMode:true,margin:.14,valign:'top',breakLine:false,color:'17212B',fill:{color:'FFFFFF'},line:{color:'DCE5EB',width:.7}});
        });
        slide.addText(`score ${c.score} · norm ${c.normScore} · ${c.sourceLocation}`,{x:.5,y:6.75,w:12.3,h:.28,fontSize:10,color:'697782',rtlMode:true});
      }
      await pptx.writeFile({fileName:'textreuse_v5_parallels.pptx'});
    }catch(error){alert(tr('שגיאה בייצוא PowerPoint: ','PowerPoint export failed: ')+error.message);}
  }
  function langApply(){
    const map={
      'v5-section-title':['חקר מקבילות','Parallel Explorer'], 'v5-section-subtitle':['כל תוצאות ההתאמה מכל קטעי המקור, מסוננות וממוינות יחד. לחיצה על תוצאה תחזיר אותך למסכי הקריאה.','Explore matching passages across all source records. Open a result in reading or synopsis.'],
      'v5-reset':['איפוס מסנני הסקירה','Reset explorer filters'], 'v5-more':['הצג עוד','Load more'],
      'v5-export-label':['ייצוא תוצאות','Export results'], 'v5-metric-label':['דרג לפי','Rank by'],
      'v5-threshold-label':['סף מינימלי','Minimum value'], 'v5-search-label':['חיפוש במקבילות','Search parallels'],
      'v5-dataset-label':['מאגר','Dataset'], 'v5-book-label':['חיבור','Work'],
      'v5-category-label':['קטגוריה','Category'], 'v5-aligned-label':['מצב היישור','Alignment availability'],
      'v5-text-label':['תצוגת טקסט','Text display'], 'v5-ctx-label':['מילות הקשר','Context words']
    };
    Object.entries(map).forEach(([id,val])=>{if($(id))$(id).textContent=tr(...val);});
    const legend=document.querySelector('.v5-match-legend');
    if(legend)legend.innerHTML=`<span><i class="v5-key exact"></i> ${tr('התאמה מדויקת','Exact match')}</span><span><i class="v5-key approximate"></i> ${tr('התאמה מקורבת','Approximate match')}</span><span>${tr('צבעים שונים = קבוצות יישור; מעבר עכבר מדגיש מילים קשורות.','Distinct colours identify alignment groups; hover highlights related words.')}</span>`;
    const metric=$('v5-metric');if(metric){const previous=metric.value;metric.innerHTML=METRICS.map(([key])=>`<option value="${key}">${esc(metricLabel(key))}</option>`).join('');metric.value=previous||filters.metric;}
    const alignment=$('v5-aligned');if(alignment){const v=alignment.value;alignment.innerHTML=`<option value="all">${tr('הכול','All')}</option><option value="aligned">${tr('עם יישור מפורט','With direct alignment')}</option><option value="unaligned">${tr('ללא יישור מפורט','Without direct alignment')}</option>`;alignment.value=v||filters.alignment;}
    const display=$('v5-text-mode');if(display){const v=display.value;display.innerHTML=`<option value="full">${tr('טקסט מלא','Full text')}</option><option value="context">${tr('התאמות והקשר','Matches and context')}</option>`;display.value=v||filters.queryMode;}
    const ex=$('v5-export');if(ex){ex.options[0].textContent=tr('בחר פורמט…','Choose format…');}
    if(currentData().model){updateOptions();render();}
  }
  function mount(cfg){
    Object.assign(model,cfg);
    attachHover();
    const paint=$('v51-paint'); if(paint){paint.value=highlight.mode;paint.addEventListener('change',e=>{highlight.mode=e.target.value;render();});}
    const intensity=$('v51-intensity');if(intensity){intensity.value=highlight.intensity;intensity.addEventListener('change',e=>{highlight.intensity=e.target.value;$('v5-results')?.setAttribute('data-highlight-intensity',highlight.intensity);});}
    $('v51-clear')?.addEventListener('click',()=>{highlight.selected=null;highlight.pinned=false;render();});
    $('v51-pin')?.addEventListener('click',()=>{highlight.pinned=!highlight.pinned;if(!highlight.pinned){document.querySelectorAll('.v5-peer').forEach(x=>x.classList.remove('v5-peer'));}updateHighlightButtons();});
    $('v51-previous')?.addEventListener('click',()=>stepGroup(-1));
    $('v51-next')?.addEventListener('click',()=>stepGroup(1));
    $('v5-results')?.addEventListener('click',event=>{const word=event.target.closest('.v5-match[data-tr-ids]');if(!word)return;const id=Number(word.dataset.trIds.split(' ')[0]);highlight.selected=highlight.selected===id?null:id;render();});
    const controls={
      'v5-metric':'metric','v5-threshold':'threshold','v5-search':'search','v5-dataset':'dataset','v5-book':'book',
      'v5-category':'category','v5-aligned':'alignment','v5-text-mode':'queryMode','v5-context':'context'
    };
    let searchTimer=null;
    Object.entries(controls).forEach(([id,key])=>{$(id)?.addEventListener(id==='v5-search'?'input':'change',event=>{
      filters[key]=event.target.value;
      if(id==='v5-search'){clearTimeout(searchTimer);searchTimer=setTimeout(render,220);}else render();
    });});
    $('v5-reset')?.addEventListener('click',()=>{
      Object.assign(filters,{metric:'score',threshold:'',search:'',dataset:'',book:'',category:'',alignment:'all',queryMode:'full',context:7});
      Object.entries(controls).forEach(([id,key])=>{if($(id))$(id).value=filters[key];});render();
    });
    $('v5-more')?.addEventListener('click',renderMore);
    $('v5-results')?.addEventListener('click',event=>{
      const button=event.target.closest('button[data-v5-action]');if(!button)return;
      const {v5Record:recordId,v5Candidate:candidateId,v5Action:action}=button.dataset;
      if(action==='read')model.openRead?.(recordId,candidateId);
      if(action==='synopsis')model.openSynopsis?.(recordId,candidateId);
    });
    $('v5-export')?.addEventListener('change',e=>{const value=e.target.value;e.target.value='';if(value)exportVisible(value);});
    document.addEventListener('tr-language-changed',langApply);
    langApply();
  }
  return {mount,render,renderWords,statistics,metricValue,pairGroups,rowsCsv,docPage,exportPng,getRows,filters};
})();
