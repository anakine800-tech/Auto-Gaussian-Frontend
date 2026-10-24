import {test,expect} from '@playwright/test';
import type {Page} from '@playwright/test';
import {comparisonEntries,comparisonEnergy,comparisonObjects,inspectProtocol,protocolDifference} from '../src/quick-comparison';
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
 await expect(page.getByTestId('structure-comparison-3')).toBeVisible();await page.getByRole('group',{name:'从比较篮选择 2–3 个结构'}).getByLabel('prepared',{exact:true}).uncheck();await expect(page.getByTestId('structure-comparison-3')).toHaveCount(0);
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
