import {test,expect} from '@playwright/test';
import type {Page} from '@playwright/test';
import {comparisonEntries,comparisonEnergy,comparisonObjects,inspectProtocol,protocolDifference,loadComparisonSources} from '../src/quick-comparison';
import type {CompareSource,EvidenceCatalog} from '../src/quick-comparison';
const geometry={units:'angstrom',atoms:[{center:1,atomic_number:8,x:0,y:0,z:0},{center:2,atomic_number:1,x:1,y:0,z:0},{center:3,atomic_number:1,x:0,y:1,z:0}]};
const source=(id:string,route='# HF/STO-3G SP',shift=0,multiplicity=1):CompareSource=>({id,facts:{error:null,data:{program:'gaussian',program_version:'Synthetic revision',route,charge:0,multiplicity,n_atoms:3,units:{energy:'Hartree'},energies:{scf:-76+shift,zpe:.02,g:-75.8+shift},n_imag:0,frequencies_low:[25,50,100],s2:0,wavefunction_stability:'stable',opt_converged:true,freq_step_converged:true,termination:'normal'}},geometry:{error:null,data:geometry}});
function fixture(){
 const sources:Record<string,CompareSource>={},objects=['anti','gauche','prepared'].map((id,i)=>{
  const shift=i*.002;for(const role of ['opt','freq','sp'])sources[id+'-'+role]=source(id+'-'+role,`# HF/STO-3G ${role}`,shift,i===2?3:1);
  sources[id]=source(id,'# HF/STO-3G SP',shift,i===2?3:1);
  return {id:'water-'+i,name:'Water '+String.fromCharCode(65+i),status:'adopted',members:[id,id+'-opt',id+'-freq',id+'-sp'].map(attempt=>({attempt,role:'sp'})),adopted:Object.fromEntries(['opt','freq','sp'].map(role=>[role,{attempt:id+'-'+role,report:'summary.md'}])),values:{scf_h:-77+shift,zpe_h:.02,g_h:-75.8+shift,freq_scf_h:-76+shift}};
 });
 return {sources,catalog:{journal_ok:true,warning:null,state:{schema:'ag-catalog-state/1',objects}} as EvidenceCatalog};
}
test('adopted layers and H4 formulas use adopted snapshots with explicit reference',()=>{
 const {sources,catalog}=fixture(),entries=comparisonEntries(['anti','gauche','prepared'],comparisonObjects(catalog),sources);
 expect(entries[0].layers.opt?.id).toBe('anti-opt');
 expect(comparisonEnergy(entries[0],entries[1],'opt').value).toBe(-76);
 expect(comparisonEnergy(entries[0],entries[1],'sp').value).toBe(-77);
 expect(comparisonEnergy(entries[0],entries[1],'zero').value).toBeCloseTo(-76.98,9);
 expect(comparisonEnergy(entries[0],entries[1],'g').value).toBeCloseTo(-76.8,9);
 expect(comparisonEnergy(entries[1],entries[0],'sp').delta).toBeCloseTo(1.255018948,7);
 expect(comparisonEnergy(entries[2],entries[0],'sp').stateGap).toBe(true);
 expect(comparisonEnergy(entries[2],entries[0],'sp').delta).toBeCloseTo(2.510037896,7);
 entries[0].object!.values.freq_scf_h=null;
 expect(comparisonEnergy(entries[0],entries[1],'g').reason).toContain('能量缺失');
 expect(comparisonEnergy(entries[0],entries[1],'g').value).toBeNull();
});
test('unregistered entries never borrow parents, or call Opt+Freq a standalone SP',()=>{
 const sources={a:source('a','# HF/STO-3G Opt Freq'),b:source('b')};
 const [a,b]=comparisonEntries(['a','b'],[],sources);
 expect(a.layers.sp).toBeUndefined();expect(a.layers.opt?.id).toBe('a');
 expect(comparisonEnergy(a,a,'opt').value).toBe(-76);
 expect(comparisonEnergy(a,a,'sp').value).toBeNull();
 expect(b.layers.opt).toBeUndefined();expect(comparisonEnergy(b,b,'sp').value).toBe(-76);
});
test('unsupported methods, invalid units, composition, version and all protocol mismatches stay blocked',()=>{
 for(const change of [
  {route:'# MP2/STO-3G'},{route:'# HF/Gen'},{route:'# HF/STO-3G SCRF=Read'},
  {route:'# B3LYP/STO-3G'},{route:'# HF/6-31G'},{route:'# HF/STO-3G em=gd3'},
  {route:'# HF/STO-3G SCRF=(SMD,Solvent=Water)'},{route:'# HF/STO-3G 6D'},
  {program_version:null},{program_version:'other'},{charge:1},{multiplicity:0},{units:{}},
 ]){
  const a=source('a'),b=source('b');Object.assign(b.facts.data!,change);
  const entries=comparisonEntries(['a','b'],[],{a,b});const cell=comparisonEnergy(entries[1],entries[0],'sp');
  expect(cell.value).toBeNull();expect(cell.delta).toBeNull();expect(cell.reason).not.toBe('');
 }
 const a=source('a'),b=source('b');b.geometry={data:null,error:'invalid'};expect(inspectProtocol(b).errors.join()).toContain('几何');
 expect(protocolDifference(a,b).reason).toContain('几何');
 // Same-spin R/U is still a method mismatch. Only differing spin permits the
 // normalized R/U state difference, with the underlying functional unchanged.
 expect(protocolDifference(source('a','# RHF/STO-3G'),source('b','# UHF/STO-3G')).reason).toContain('方法');
});
test('missing adopted sources, ambiguous membership and frequency identity mismatch do not backfill',()=>{
 const {sources,catalog}=fixture(),objects=comparisonObjects(catalog);
 objects[0].adopted.freq=undefined;let entries=comparisonEntries(['anti','gauche'],objects,sources);
 expect(comparisonEnergy(entries[0],entries[1],'g').value).toBeNull();
 objects[1].members.push('anti');entries=comparisonEntries(['anti'],objects,sources);expect(entries[0].error).toContain('多个');
 const other=fixture();(other.sources['anti-freq'].facts.data as any).charge=1;
 entries=comparisonEntries(['anti','gauche'],comparisonObjects(other.catalog),other.sources);
 expect(comparisonEnergy(entries[0],entries[1],'zero').value).toBeNull();
});
async function mock(page:Page){
 const {sources,catalog}=fixture();
 await page.route('**/api/studies/butane-demo/evidence',r=>r.fulfill({json:{files:[],issues:[],truncated:false,catalog}}));
 await page.route('**/comparison-structure',r=>{const id=r.request().url().split('/').at(-2)!;return r.fulfill({json:sources[id]??source(id)});});
}
for(const [width,height] of [[1440,900],[1280,800],[390,844]])test(`three-item comparison, geometry and responsive evidence ${width}`,async({page},info)=>{
 await page.setViewportSize({width,height});await mock(page);const writes:string[]=[],errors:string[]=[];page.on('request',r=>{if(r.method()!=='GET')writes.push(r.method());});page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/#/s/butane-demo/research/attempts?cmp=anti,gauche,prepared');
 await expect(page.getByRole('button',{name:/快速比较|结构对比/})).toHaveCount(0);
 await page.getByRole('complementary',{name:'比较篮'}).getByRole('button',{name:'打开比较',exact:true}).click();
 await expect(page).toHaveURL(/#\/butane-demo\/compare\?cmp=/);
 await expect(page.getByRole('heading',{name:'比较（前端现场计算，非正式结果）',exact:true})).toBeVisible();
 for(const name of ['口径核对','能量','性质','几何','结构叠合'])await expect(page.getByRole('heading',{name,exact:true})).toBeVisible();
 await expect(page.getByRole('table',{name:'分层能量'})).toContainText('-76.800000');await expect(page.getByRole('table',{name:'分层能量'})).toContainText('电子态能差');
 await page.getByLabel('参照项',{exact:true}).selectOption('gauche');await expect(page.getByRole('table',{name:'分层能量'})).toContainText('Δ -1.255');
 await page.getByLabel('只看有差异的行').check();await expect(page.getByRole('table',{name:'opt 口径核对'})).not.toContainText('程序版本 · 一致');await page.getByLabel('只看有差异的行').uncheck();
 await page.getByLabel('比较原子对',{exact:true}).fill('1-2,2-3');await expect(page.getByRole('table',{name:'几何距离'})).toContainText('1.4142');
 await expect(page.getByLabel('Kabsch RMSD')).toContainText('RMSD 0.000000 Å');
 await expect(page.getByTestId('structure-comparison-3')).toBeVisible();await page.getByRole('group',{name:'从比较篮选择 2–10 个结构'}).getByLabel('prepared',{exact:true}).uncheck();await expect(page.getByTestId('structure-comparison-3')).toHaveCount(0);
 await page.getByLabel('比较原子对',{exact:true}).fill('1-99');await expect(page.getByRole('table',{name:'几何距离'})).toContainText('原子编号超出结构');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
 await page.getByLabel('比较原子对',{exact:true}).fill('1-2,2-3');await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:info.outputPath(`t122-compare-${width}.png`),fullPage:true});
 expect(writes).toEqual([]);expect(errors).toEqual([]);
});

test('chain and comparison adapters return identical deltas, blank reasons and state-gap flags',async()=>{
 const {catalogObjects,relativeEnergies}=await import('../src/catalog-data');
 const cases=[
  {},{route:'# HF/STO-3G Freq Temperature = 298.150 Pressure = 1.000'},
  {route:'# HF/STO-3G Freq temperature=2.9815D2 pressure=1e0'},
  {route:'# HF/STO-3G Freq temperature=300'},{route:'# HF/STO-3G Freq pressure=2'},
  {route:'# HF/STO-3G Freq temperature=unknown'},{route:'# HF/STO-3G Freq pressure='},
  {route:'# HF/STO-3G Freq temperature=298.15 temperature=300'},
  {route:'# HF/STO-3G Freq pressure=1e999'},
  {program_version:'Other revision'},{units:{}},{charge:1},
  {route:'# B3LYP/STO-3G Freq'},{route:'# MP2/STO-3G Freq'},
  {route:'# HF/STO-3G Freq SCRF=(SMD,Solvent=Water)'},
 ];
 for(const change of cases){
  const {sources,catalog}=fixture();Object.assign(sources['prepared-freq'].facts.data!,change);
  const chainObjects=catalogObjects({catalog} as any),objects=comparisonObjects(catalog);
  const attempts=Object.values(sources).map(s=>({id:s.id,facts:s.facts})) as any;
  const entries=comparisonEntries(['anti','prepared'],objects,sources);
  for(const [basis,metric] of [['E','sp'],['E+ZPE','zero'],['G','g']] as const)for(const ref of [0,1]){
   const referenceId=ref===0?'water-0':'water-2';
   const rows=relativeEnergies(chainObjects,attempts,sources,basis,referenceId).rows;
   for(const [i,id] of [[0,'water-0'],[1,'water-2']] as const){
    const row=rows.find(r=>r.object.id===id)!,cell=comparisonEnergy(entries[i],entries[ref],metric);
    expect({value:row.energy,delta:row.relative,reason:row.reason??'',stateGap:row.stateGap}).toEqual(cell);
   }
  }
 }
});

const capacityIds=Array.from({length:11},(_,i)=>`candidate-${String(i+1).padStart(2,'0')}`);
async function manySources(page:Page,{failed='',missing='',deformed=false}:{failed?:string;missing?:string;deformed?:boolean}={}){
 const sources:Record<string,CompareSource>=Object.fromEntries(capacityIds.map(id=>[id,source(id)]));
 sources['shared-result']=source('shared-result','# HF/STO-3G Opt Freq');
 if(deformed)sources[capacityIds[2]].geometry={error:null,data:{...geometry,atoms:geometry.atoms.map((a,i)=>i===1?{...a,x:1.6,y:.2}:a)}};
 if(missing)sources[missing].geometry={data:null,error:'Synthetic final.xyz missing'};
 const catalog={journal_ok:true,warning:null,state:{schema:'ag-catalog-state/1',objects:capacityIds.map((id,i)=>({
  id:`object-${i+1}`,name:`Synthetic object ${i+1}`,status:'adopted',members:[{attempt:id,role:'opt'}],
  adopted:Object.fromEntries(['opt','freq','sp'].map(role=>[role,{attempt:'shared-result',report:'synthetic.md'}])),
  values:{scf_h:-76+i*.001,zpe_h:.02,g_h:-75.8,freq_scf_h:-76},
 }))}};
 await page.route('**/api/studies/butane-demo/evidence',r=>r.fulfill({json:{files:[],issues:[],truncated:false,catalog}}));
 const reads:string[]=[];
 await page.route('**/comparison-structure',r=>{
  const id=r.request().url().split('/').at(-2)!;reads.push(id);
  return id===failed?r.fulfill({status:404,json:{detail:'Synthetic source unavailable'}}):r.fulfill({json:sources[id]??source(id)});
 });
 return reads;
}

for(const count of [2,3,6,10])test(`T192 ${count} structures reuse adopted sources and keep all table columns`,async({page})=>{
 const reads=await manySources(page);
 await page.goto('/#/butane-demo/compare?cmp='+capacityIds.slice(0,count).join(','));
 const block=page.getByRole('region',{name:'任意结构对比',exact:true});
 await expect(block.locator('.irc-structure-card')).toHaveCount(count);
 await expect(block.getByTestId('molecule-scene')).toHaveCount(count);
 await expect(page.getByRole('table',{name:'分层能量'}).getByRole('columnheader')).toHaveCount(count+1);
 await expect(page.getByRole('complementary',{name:'比较篮'})).toContainText(`${count} / 10`);
 await expect(block.getByLabel('Kabsch RMSD').locator('li')).toHaveCount(count);
 expect(reads.slice().sort()).toEqual([...capacityIds.slice(0,count),'shared-result'].sort());
 // Overlay selection reuses already parsed sources, including the source shared by every layer.
 const choices=page.getByRole('group',{name:'从比较篮选择 2–10 个结构'});
 await choices.getByLabel(capacityIds[count-1],{exact:true}).uncheck();
 await choices.getByLabel(capacityIds[count-1],{exact:true}).check();
 await expect(block.locator('.irc-structure-card')).toHaveCount(count);
 expect(reads.slice().sort()).toEqual([...capacityIds.slice(0,count),'shared-result'].sort());
});

for(const restore of ['URL','sessionStorage'])test(`T192 ${restore} restoration deduplicates and reports truncation at ten`,async({page})=>{
 await manySources(page);
 const ids=[capacityIds[0],capacityIds[0],...capacityIds.slice(1)];
 if(restore==='sessionStorage')await page.addInitScript(value=>sessionStorage.setItem('ag:cmp:butane-demo',JSON.stringify(value)),ids);
 await page.goto('/#/butane-demo/compare'+(restore==='URL'?'?cmp='+ids.join(','):''));
 const tray=page.getByRole('complementary',{name:'比较篮'});
 await expect(tray).toContainText('10 / 10');
 await expect(tray.getByRole('status')).toContainText('最多 10 项');
 await expect(tray.getByRole('status')).toContainText(restore==='URL'?'链接':'缓存');
 await expect(tray.getByRole('button',{name:/^移除 /})).toHaveCount(10);
 await expect(page.getByTestId('structure-comparison-10')).toBeVisible();
 expect(new URLSearchParams(new URL(page.url()).hash.split('?')[1]).get('cmp')?.split(',')).toEqual(capacityIds.slice(0,10));
 expect(await page.evaluate(()=>JSON.parse(sessionStorage.getItem('ag:cmp:butane-demo')!))).toEqual(capacityIds.slice(0,10));
 // A valid explicit URL still takes precedence over the restored selection.
 await page.goto('/#/butane-demo/compare?cmp='+[capacityIds[1],capacityIds[1],capacityIds[2]].join(','));
 await expect(tray).toContainText('2 / 10');
 await expect(tray.getByRole('button',{name:/^移除 /})).toHaveCount(2);
});

test('T192 a failed request and missing final file preserve eight usable structures',async({page})=>{
 const reads=await manySources(page,{failed:capacityIds[0],missing:capacityIds[4]});
 await page.goto('/#/butane-demo/compare?cmp='+capacityIds.slice(0,10).join(','));
 const block=page.getByRole('region',{name:'任意结构对比',exact:true});
 await expect(block.locator('.irc-structure-card')).toHaveCount(10);
 await expect(page.getByTestId('structure-comparison-1')).toContainText('Synthetic source unavailable');
 await expect(page.getByTestId('structure-comparison-1').locator('dd').first()).toHaveText('未知');
 await expect(page.getByTestId('structure-comparison-5')).toContainText('Synthetic final.xyz missing');
 await expect(block.getByTestId('molecule-scene')).toHaveCount(8);
 await expect(block.getByLabel('几何参照项')).toHaveValue(capacityIds[1]);
 await expect(block.getByLabel('对齐到第 2 个')).toBeChecked();
 await expect(block.getByLabel('Kabsch RMSD').locator('li').filter({hasText:'→'})).toHaveCount(8);
 await expect(block.getByLabel('Kabsch RMSD').locator('li').filter({hasText:'RMSD 未知'})).toHaveCount(2);
 await expect(page.getByRole('table',{name:'分层能量'})).toContainText('-76.000000');
 expect(reads.filter(id=>id==='shared-result')).toHaveLength(1);
});

test('T192 changing geometry reference recomputes aligned coordinates and RMSD',async({page})=>{
 const reads=await manySources(page,{deformed:true});
 await page.goto('/#/butane-demo/compare?cmp='+capacityIds.slice(0,3).join(','));
 const block=page.getByRole('region',{name:'任意结构对比',exact:true}),rmsd=block.getByLabel('Kabsch RMSD');
 await expect(block.getByLabel('几何参照项')).toHaveValue(capacityIds[0]);
 const before=await page.getByTestId('structure-comparison-1').getByTestId('molecule-atom').locator('title').allTextContents();
 await expect(rmsd.locator('li').filter({hasText:`${capacityIds[2]} →`})).not.toContainText('RMSD 0.000000');
 await block.getByLabel('几何参照项').selectOption(capacityIds[2]);
 await expect(block.getByLabel('对齐到第 3 个')).toBeChecked();
 await expect(rmsd.locator('li').filter({hasText:`${capacityIds[2]} →`})).toContainText(`${capacityIds[2]} → ${capacityIds[2]}：RMSD 0.000000`);
 await expect(rmsd.locator('li').filter({hasText:`${capacityIds[0]} →`})).not.toContainText('RMSD 0.000000');
 await expect.poll(()=>page.getByTestId('structure-comparison-1').getByTestId('molecule-atom').locator('title').allTextContents()).not.toEqual(before);
 const unique=[...capacityIds.slice(0,3),'shared-result'];
 expect(reads.slice().sort()).toEqual(unique.slice().sort());
 await page.reload();await expect(block.getByTestId('molecule-scene')).toHaveCount(3);
 expect(reads.slice().sort()).toEqual([...unique,...unique].sort());
});

for(const width of [1440,390])test(`T192 ten structures wrap without covering selectors at ${width}`,async({page},info)=>{
 await page.setViewportSize({width,height:900});await manySources(page);
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/#/butane-demo/compare?cmp='+capacityIds.slice(0,10).join(','));
 const block=page.getByRole('region',{name:'任意结构对比',exact:true});
 await expect(block.getByTestId('molecule-scene')).toHaveCount(10);
 const boxes=await block.locator('.irc-structure-card').evaluateAll(cards=>cards.map(card=>{const r=card.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom};}));
 expect(new Set(boxes.map(b=>b.y)).size).toBeGreaterThan(1);
 const controls=await block.locator('.comparison-controls').boundingBox();
 for(const b of boxes){expect(b.x).toBeGreaterThanOrEqual(0);expect(b.right).toBeLessThanOrEqual(width);expect(b.y).toBeGreaterThanOrEqual(controls!.y+controls!.height);}
 const tableScroll=page.getByRole('table',{name:'分层能量'}).locator('..');
 if(width===390){expect(await tableScroll.evaluate(el=>el.scrollWidth>el.clientWidth)).toBe(true);expect(new Set(boxes.map(b=>b.x)).size).toBe(1);}
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
 await block.scrollIntoViewIfNeeded();await page.screenshot({path:info.outputPath(`t192-ten-structures-${width}.png`),fullPage:true});
 await block.screenshot({path:info.outputPath(`t192-structure-region-${width}.png`),style:'.app-header,.context-bar,.compare-tray{visibility:hidden!important}'});
 await block.locator('.irc-structure-card').first().scrollIntoViewIfNeeded();
 await page.screenshot({path:info.outputPath(`t192-structure-viewport-${width}.png`)});
 await block.evaluate(el=>{
  const bars=['.app-header','.context-bar'].reduce((sum,selector)=>sum+(document.querySelector(selector)?.getBoundingClientRect().height??0),0);
  window.scrollTo(0,window.scrollY+el.getBoundingClientRect().top-bars-12);
 });
 await page.screenshot({path:info.outputPath(`t192-controls-viewport-${width}.png`)});
 expect(errors).toEqual([]);
});


test('T192 source loading deduplicates JSON parsing and confines request failures',async()=>{
 const original=globalThis.fetch,reads:string[]=[],parses:string[]=[];
 globalThis.fetch=async input=>{
  const id=String(input).split('/').at(-2)!;reads.push(id);
  const value=source(id);
  if(id==='errored'){value.facts.error='Synthetic invalid facts';value.geometry.error='Synthetic invalid geometry';}
  return {ok:id!=='missing',status:id==='missing'?404:200,json:async()=>{parses.push(id);return id==='missing'?{detail:'Synthetic missing source'}:value;}} as Response;
 };
 try{
  const loaded=await loadComparisonSources('synthetic-study',['a','a','missing','b','a','missing','errored','errored'],new AbortController().signal);
  expect(reads.sort()).toEqual(['a','b','errored','missing']);expect(parses.sort()).toEqual(['a','b','errored','missing']);
  expect(loaded.a.geometry.data).toEqual(geometry);expect(loaded.b.facts.error).toBeNull();
  expect(loaded.missing.geometry).toEqual({data:null,error:'Synthetic missing source'});
  expect(loaded.missing.facts).toEqual({data:null,error:'Synthetic missing source'});
  expect(loaded.errored.facts).toEqual({data:null,error:'Synthetic invalid facts'});
  expect(loaded.errored.geometry).toEqual({data:null,error:'Synthetic invalid geometry'});
 }finally{globalThis.fetch=original;}
});
