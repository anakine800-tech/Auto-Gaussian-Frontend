import {test,expect} from '@playwright/test';
import type {Page} from '@playwright/test';
import {adoptionState,calculationType,catalogObjects,chainObjects,defaultBasis,energyValue,inferRoles,keyReports,relativeEnergies,representativeAttempt,spinTreatment} from '../src/catalog-data';
import type {CatalogStudy,ChainObject,CompositionSource,EnergyBasis} from '../src/catalog-data';
import type {AttemptSummary} from '../src/api';
import {reportCategory} from '../src/analysis-summary';

const doc=(data:unknown)=>({data,error:null});
function attempt(id:string,route='# B3LYP/6-31G(d) SP',parents:string[]=[],state='fetched',multiplicity=1):AttemptSummary{return {id,label:id,template:'gaussian',state,review_state:'present',manifest:doc({template:'gaussian',science:{route,method_basis:'DO_NOT_SHOW_METHOD_RATIONALE'},parents:parents.map(attempt_id=>({attempt_id,relation:'derived_from'})),cluster:'synthetic-cluster'}),status:doc({state}),facts:doc({schema:'ag-facts/1',route,charge:0,multiplicity,n_atoms:3,energies:{scf:-75},...(/\bopt\b/i.test(route)?{opt_converged:true}:{}),...(/\bfreq\b/i.test(route)?{n_imag:0}:{}),...(/\bstable\b/i.test(route)?{wavefunction_stability:'stable'}:{}),...(multiplicity===3?{s2:2}:{}),termination:'normal'})};}
const geometry={atoms:[{atomic_number:8,x:0,y:0,z:0},{atomic_number:1,x:1,y:0,z:0},{atomic_number:1,x:0,y:1,z:0}]};
const source:CompositionSource={geometry:doc(geometry)};
function object(id:string,e=-75):ChainObject{return {id,name:'Water '+id,state_label:'S0',multiplicity:1,registered:true,status:'adopted',members:[{attempt:id+'-opt',role:'opt'},{attempt:id+'-freq',role:'freq'},{attempt:id+'-sp',role:'sp'}],adopted:{opt:{attempt:id+'-opt',report:null},freq:{attempt:id+'-freq',report:'adopted.md'},sp:{attempt:id+'-sp',report:'adopted.md'}},values:{scf_h:e,freq_scf_h:-74,zpe_h:.02,g_h:-73.99}};}
function fixture():CatalogStudy{
 const a=object('a'),b=object('b',-74.999);b.state_label='T1';b.multiplicity=3;
 const c={...object('c'),status:'candidate' as const,adopted:{},values:{}},history={...object('old'),status:'retired' as const};
 const objects=[a,b,c,history],attempts=objects.flatMap(o=>{
  const method=o.multiplicity===3?'UB3LYP':'RB3LYP';
  return [attempt(o.id+'-opt',`# ${method}/def2-TZVP Opt`,[], 'fetched',o.multiplicity!),attempt(o.id+'-freq',`# ${method}/def2-TZVP Freq`,[o.id+'-opt'],'fetched',o.multiplicity!),attempt(o.id+'-sp',`# ${method}/def2-TZVP SP`,[o.id+'-freq'],o.id==='c'?'finished':'fetched',o.multiplicity!)];
 });
 attempts.find(a=>a.id==='c-freq')!.review_state='empty';
 const analyses=['adopted.md','formal.md','pending.md','irrelevant.md'].map(name=>({name,...doc(null),schema:null,updated_at:name==='irrelevant.md'?'2099-01-01':'2026-01-01',catalog_kind:name==='formal.md'?'formal':undefined}));
 return {id:'val-water',catalog_review:{available:true,attempts:objects.filter(o=>o.status!=='retired').flatMap(o=>o.members.map(m=>m.attempt)),warning:null},study:{data:'# Synthetic water\n',error:null},sections:{'里程碑签字':{present:true,text:'Synthetic only',entries:[{text:'最终结果：待签 [pending](analyses/pending.md)',line:4,state:'pending'},{text:'已签 [adopted](analyses/adopted.md)',line:5,state:'recorded'}]}},attempts,graph:{nodes:attempts.map(a=>({id:a.id,state:a.state,missing:false})),edges:[]},analyses,structure_files:[],issues:[],energy_basis:'E+ZPE',catalog:{journal_ok:true,warning:null,state:{schema:'ag-catalog-state/1',objects,report_kinds:{'formal.md':'formal'}}}};
}
async function serve(page:Page,data=fixture()){
 await page.route('**/api/studies',r=>r.fulfill({json:{studies:[{id:'val-water',title:'合成水验证',type:'validation'},{id:'butane-demo',title:'合成正丁烷',type:'research'}],issues:[]}}));
 await page.route('**/api/studies/val-water',r=>r.fulfill({json:data}));
 await page.route('**/api/studies/val-water/attempts/*/comparison-structure',r=>r.fulfill({json:source}));
 return data;
}

test('role inference agrees with T119: TS, combined, SP, templates and scan',()=>{
 for(const [route,roles] of [['# b3lyp/6-31g(d) opt=(ts,calcfc)',['ts']],['# HF/STO-3G Opt Freq SP',['opt','freq']],['# HF/STO-3G',['sp']],['# HF/STO-3G Opt=(QST2)',['ts']],['# HF/STO-3G Stable=Opt',['stable']],['# HF/STO-3G IRC',['irc']],['# HF/STO-3G Scan',['scan']],['# guess=read',[]]] as const)expect(inferRoles({template:'gaussian',science:{route}})).toEqual(roles);
 expect(inferRoles({template:'crest'})).toEqual(['crest']);expect(inferRoles({template:'xtb',template_params:{'--opt':'tight'}})).toEqual(['opt']);expect(inferRoles({template:'xtb',science:{scan:{steps:3}}})).toEqual(['scan']);expect(inferRoles({template:'xtb',science:{scan:{}}})).toEqual(['sp']);expect(calculationType({...attempt('xtb'),template:'xtb',manifest:doc({template:'xtb'})})).toBe('xTB · SP');
});

test('suggest parity fixture: branch, cycle, missing parent and assigned bridge',()=>{
 const data=fixture();data.attempts=[attempt('a','',[]),attempt('b','',['a']),attempt('c','',['a']),attempt('d','',['e']),attempt('e','',['d']),attempt('f','',['missing']),attempt('g','',['bridge']),attempt('h','',['bridge']),attempt('bridge','',[])];
 data.catalog!.state={schema:'ag-catalog-state/1',objects:[{...object('object-1'),status:'retired',members:[{attempt:'bridge',role:'opt'}]}]};
 expect(chainObjects(data).filter(o=>!o.registered).map(o=>[o.id,o.members.map(m=>m.attempt)])).toEqual([['object-2',['a','b','c']],['object-3',['d','e']],['object-4',['f']],['object-5',['g']],['object-6',['h']]]);
 data.catalog!.journal_ok=false;
 expect(chainObjects(data).every(o=>!o.registered)).toBe(true);
 expect(chainObjects(data).find(o=>o.members.some(m=>m.attempt==='bridge'))!.members.map(m=>m.attempt)).toEqual(['bridge','g','h']);
});

for(const basis of ['E','E+ZPE','G'] as EnergyBasis[])test(`energy formula ${basis}: hand calculation and missing fields`,()=>{
 const a=object('a'),b=object('b',-74.999);b.values.zpe_h=.03;b.values.g_h=-73.98;
 const data=[attempt('a-sp'),attempt('b-sp'),attempt('a-freq','# B3LYP/6-31G(d) Freq'),attempt('b-freq','# B3LYP/6-31G(d) Freq')],sources={'a-sp':source,'b-sp':source};
 const result=relativeEnergies([a,b],data,sources,basis);
 expect(energyValue(a,basis)).toBeCloseTo(basis==='E'?-75:basis==='E+ZPE'?-74.98:-74.99,10);
 expect(result.rows[1].relative).toBeCloseTo((basis==='E'?.001:.011)*627.5094740631,8);
 expect(result.referenceId).toBe('a');expect(relativeEnergies([a,b],data,sources,basis,'b').rows[0].relative).toBeCloseTo(-result.rows[1].relative!,8);
 for(const field of basis==='E'?['scf_h']:basis==='E+ZPE'?['scf_h','zpe_h']:['scf_h','g_h','freq_scf_h']){const changed=structuredClone(a);changed.values[field]=null;expect(energyValue(changed,basis)).toBeNull();delete changed.values[field];expect(energyValue(changed,basis)).toBeNull();}
 expect(energyValue({...a,registered:false},basis)).toBeNull();expect(energyValue({...a,status:'candidate'},basis)).toBeNull();expect(energyValue({...a,status:'retired'},basis)).toBeNull();
});

test('pairwise protocol checks, composition, charge and electronic state gaps',()=>{
 const a=object('a'),b=object('b',-74.999),spA=attempt('a-sp');
 for(const [route,reason] of [['# HF/6-31G(d) SP','方法不同'],['# M062X/6-31G(d) SP','方法不同'],['# B3LYP/def2SVP SP','基组不同'],['# B3LYP/6-31G(d) SP SCRF=(SMD,Solvent=Water)','溶剂不同'],['# B3LYP/6-31G(d) SP EmpiricalDispersion=GD3BJ','色散不同'],['# B3LYP/Gen SP','自定义基组']]){
  const result=relativeEnergies([a,b],[spA,attempt('b-sp',route)],{'a-sp':source,'b-sp':source},'E');expect(result.rows[0].relative).toBe(0);expect(result.rows[1].relative).toBeNull();expect(result.rows[1].reason).toContain(reason);
 }
 const spB=attempt('b-sp',undefined,[],'fetched',3);
 const gap=relativeEnergies([a,b],[spA,spB],{'a-sp':source,'b-sp':source},'E');expect(gap.rows[1].stateGap).toBe(true);expect(gap.rows[1].relative).toBeCloseTo(.627509474,8);
 (spB.facts.data as any).charge=1;expect(relativeEnergies([a,b],[spA,spB],{'a-sp':source,'b-sp':source},'E').rows[1].reason).toContain('电荷不同');
 (spB.facts.data as any).charge=0;
 const other=structuredClone(source);(other.geometry!.data as any).atoms[0].atomic_number=6;
 expect(relativeEnergies([a,b],[spA,spB],{'a-sp':source,'b-sp':other},'E').rows[1].reason).toContain('元素组成不同');
 expect(relativeEnergies([a,b],[spA,spB],{'a-sp':source},'E').rows[1].reason).toContain('元素组成缺失');
 expect(defaultBasis({...fixture(),energy_basis:'G'})).toBe('G');expect(defaultBasis({...fixture(),energy_basis:undefined})).toBe('E+ZPE');
});

for(const basis of ['E','E+ZPE','G'] as EnergyBasis[])test(`spin prefixes are informational for ${basis} electronic state gaps`,()=>{
 const a=object('a'),b={...object('b',-74.999),state_label:'T1',multiplicity:3},sources={'a-sp':source,'b-sp':source};
 for(const [s0,t1] of [['RB3LYP','UB3LYP'],['B3LYP','ROB3LYP'],['rB3LYP','uB3LYP'],['RωB97X-D','UωB97X-D']]){
  const attempts=[attempt('a-sp',`# ${s0}/def2-TZVP SP`),attempt('b-sp',`# ${t1}/def2-TZVP SP`,[],'fetched',3),attempt('a-freq',`# ${s0}/def2-TZVP Freq`),attempt('b-freq',`# ${t1}/def2-TZVP Freq`,[],'fetched',3)];
  const result=relativeEnergies([a,b],attempts,sources,basis);
  expect(result.rows[1].reason).toBeNull();expect(result.rows[1].stateGap).toBe(true);expect(result.rows[1].relative).toBeCloseTo(.627509474,8);
 }
 for(const [method,label] of [['RB3LYP','R'],['UB3LYP','U'],['ROB3LYP','RO'],['B3LYP','未显式指定'],['R','未显式指定'],['RO','未显式指定'],['U','未显式指定']])expect(spinTreatment(`# ${method}/def2-TZVP SP`)).toBe(label);
});

for(const basis of ['E+ZPE','G'] as EnergyBasis[])test(`${basis} checks the adopted Freq independently of SP`,()=>{
 const objects=[object('a'),object('b',-74.999)],sp=[attempt('a-sp'),attempt('b-sp')],sources={'a-sp':source,'b-sp':source};
 const freqA=attempt('a-freq','# RB3LYP/def2-SVP Freq');
 for(const [route,reason] of [['# UM062X/def2-SVP Freq','Freq 方法不同'],['# UB3LYP/def2-TZVP Freq','Freq 基组不同'],['# UB3LYP/def2-SVP Freq EmpiricalDispersion=GD3BJ','Freq 色散不同'],['# UB3LYP/def2-SVP Freq 6D','Freq 基函数形式不同'],['# UB3LYP/def2-SVP Freq SCRF=(SMD,Solvent=Water)','Freq 溶剂不同'],['# UB3LYP/Gen Freq','Freq 自定义基组信息不足'],['# UB3LYP/def2-SVP Freq SCRF=(SMD,Solvent=Water,Read)','Freq 溶剂信息不足']]){
  const attempts=[...sp,freqA,attempt('b-freq',route)],result=relativeEnergies(objects,attempts,sources,basis);
  expect(result.rows[0].relative).toBe(0);expect(result.rows[1].relative).toBeNull();expect(result.rows[1].reason).toBe(reason);
  expect(relativeEnergies(objects,attempts,sources,'E').rows[1].relative).toBeCloseTo(.627509474,8);
 }
 const missing=relativeEnergies(objects,[...sp,freqA],sources,basis);expect(missing.rows[1].relative).toBeNull();expect(missing.rows[1].reason).toBe('缺少已采用的 Freq Attempt');
 const badReference=relativeEnergies(objects,[...sp,freqA],sources,basis,'b');expect(badReference.rows[0].reason).toBe('参照对象：缺少已采用的 Freq Attempt');
});

test('G checks Freq temperature and pressure, using defaults only when absent',()=>{
 const objects=[object('a'),object('b',-74.999)],sp=[attempt('a-sp'),attempt('b-sp')],sources={'a-sp':source,'b-sp':source};
 const freqA=attempt('a-freq','# RB3LYP/def2-SVP Freq');
 for(const suffix of ['', 'Temperature = 298.150 Pressure = 1.000', 'temperature=2.9815D2 pressure=1e0']){
  const result=relativeEnergies(objects,[...sp,freqA,attempt('b-freq',`# UB3LYP/def2-SVP Freq ${suffix}`)],sources,'G');
  expect(result.rows[1].reason).toBeNull();expect(result.rows[1].relative).toBeCloseTo(.627509474,8);
 }
 for(const [suffix,reason] of [['temperature=300','Freq 温度不同'],['pressure=2','Freq 压力不同'],['temperature=unknown','Freq 温度无法识别'],['pressure=','Freq 压力无法识别'],['temperature=298.15 temperature=300','Freq 温度无法识别'],['pressure=1e999','Freq 压力无法识别']]){
  const attempts=[...sp,freqA,attempt('b-freq',`# UB3LYP/def2-SVP Freq ${suffix}`)],result=relativeEnergies(objects,attempts,sources,'G');
  expect(result.rows[1].relative).toBeNull();expect(result.rows[1].reason).toBe(reason);
  expect(relativeEnergies(objects,attempts,sources,'E+ZPE').rows[1].relative).toBeCloseTo(.627509474,8);
 }
});

test('report priority and selection use registration and explicit milestone references',()=>{
 expect(reportCategory({name:'report.json',schema:'ag-nci/1',catalog_kind:'formal',kind:'energy'}).kind).toBe('nci');
 for(const kind of ['formal','coverage','ts','nci'])expect(reportCategory({name:'report.md',catalog_kind:kind,kind:'energy'})).toEqual({kind,basis:'按登记'});
 expect(reportCategory({name:'ts-labels/synthetic/labels.json',schema:'ag-nci/1',catalog_kind:'formal'}).kind).toBe('nci');
 expect(reportCategory({name:'ts-labels/synthetic/labels.md',catalog_kind:'formal',kind:'energy'}).kind).toBe('formal');
 expect(reportCategory({name:'report.md',kind:'energy'}).kind).toBe('energy');expect(reportCategory({name:'report.html'}).kind).toBe('figure');
 const data=fixture(),objects=catalogObjects(data);
 expect(keyReports(data).map(r=>r.report.name)).toEqual(['formal.md','adopted.md','pending.md']);
 data.analyses.find(r=>r.name==='formal.md')!.schema='ag-thermo/1';
 expect(reportCategory(data.analyses.find(r=>r.name==='formal.md')!).kind).toBe('thermo');
 expect(keyReports(data).map(r=>r.report.name)).toEqual(['formal.md','adopted.md','pending.md']);
 expect(adoptionState(objects[0],data)).toBe('已签');data.sections['里程碑签字'].entries[1].state='pending';expect(adoptionState(objects[0],data)).toBe('待签');
 data.sections['里程碑签字'].entries[1].text='已签 unrelated.md';expect(adoptionState(objects[0],data)).toBe('候选');
 data.catalog!.journal_ok=false;expect(keyReports(data)).toEqual([]);
});

test('representative selection honors SP then Freq then Opt; fallback is last fetched in chain',()=>{
 const data=fixture(),o=catalogObjects(data)[0];expect(representativeAttempt(o,data.attempts)).toBe('a-sp');delete o.adopted.sp;expect(representativeAttempt(o,data.attempts)).toBe('a-freq');delete o.adopted.freq;expect(representativeAttempt(o,data.attempts)).toBe('a-opt');
 o.status='candidate';expect(representativeAttempt(o,data.attempts)).toBeNull();o.registered=false;expect(representativeAttempt(o,data.attempts)).toBe('a-sp');data.attempts.find(a=>a.id==='a-sp')!.state='finished';expect(representativeAttempt(o,data.attempts)).toBe('a-freq');
});

test('registered chains expand, filter, compare and populate flat table',async({page})=>{
 await serve(page);await page.goto('/#/val-water/chains');
 const table=page.getByRole('table',{name:'对象计算链',exact:true});
 await expect(table.locator(':scope > tbody > tr')).toHaveCount(3);await expect(table).toContainText('电子态能差');
 await table.getByRole('button',{name:'▸ Water a',exact:true}).click();
 const steps=page.getByRole('table',{name:'Water a的计算步骤'});await expect(steps).toContainText('RB3LYP/def2-TZVP');await expect(steps).not.toContainText('DO_NOT_SHOW_METHOD_RATIONALE');await expect(steps).toContainText('⟨S²⟩');
 await expect(steps.getByRole('columnheader',{name:'自旋处理',exact:true})).toBeVisible();await expect(steps.getByRole('cell',{name:'R',exact:true})).toHaveCount(3);await expect(steps.getByRole('row').filter({has:page.getByRole('link',{name:'a-sp',exact:true})})).toContainText('收敛 — · 虚频 —');
 await table.locator(':scope > tbody > tr').first().getByRole('button',{name:'＋比较'}).click();await expect(page).toHaveURL(/cmp=a-sp/);
 await page.getByLabel('电子态筛选').selectOption('T1');await expect(table.locator(':scope > tbody > tr')).toHaveCount(1);await expect(table).toContainText('Water b');
 await page.getByLabel('电子态筛选').selectOption('');await page.getByLabel('隐藏历史').uncheck();await expect(table).toContainText('Water old');
 await page.getByLabel('计算链状态筛选').selectOption('待取回');await expect(table).toContainText('Water c');await expect(table).not.toContainText('Water a');
 await page.getByLabel('计算链状态筛选').selectOption('');await page.getByLabel('只看需要我处理').check();await expect(table).toContainText('Water c');await expect(table).not.toContainText('Water old');
 await page.getByRole('button',{name:'全部 Attempt',exact:true}).click();const flat=page.getByRole('table',{name:'Attempt 结果表'});await expect(flat.getByRole('columnheader',{name:'对象 · 电子态'})).toBeVisible();await expect(flat.getByRole('columnheader',{name:'计算类型',exact:true})).toBeVisible();await expect(flat).toContainText('Water b · T1');await expect(flat.getByRole('checkbox',{name:'比较 a-sp',exact:true})).toBeChecked();
});

test('switching energy basis displays Freq mismatch reasons in both views',async({page})=>{
 const data=fixture();(data.attempts.find(a=>a.id==='b-freq')!.facts.data as any).route='# UM062X/def2-TZVP Freq temperature=300 pressure=2';
 await serve(page,data);await page.goto('/#/val-water/chains');
 const chains=page.getByRole('table',{name:'对象计算链',exact:true});await expect(chains).toContainText('Freq 方法不同');
 await page.getByLabel('能量口径').selectOption('E');await expect(chains).toContainText('0.628');await expect(chains).toContainText('电子态能差');await expect(chains).not.toContainText('Freq 方法不同');
 await page.getByLabel('能量口径').selectOption('G');await expect(chains).toContainText('Freq 方法不同、Freq 温度不同、Freq 压力不同');
 await page.getByRole('button',{name:'进展',exact:true}).click();const current=page.getByRole('table',{name:'当前采用的结果',exact:true});await expect(current).toContainText('Freq 方法不同');
 await page.getByLabel('能量口径').selectOption('G');await expect(current).toContainText('Freq 方法不同、Freq 温度不同、Freq 压力不同');
});

test('progress shows adopted sources, energy basis, explicit signatures and key report order',async({page})=>{
 const data=fixture();data.energy_basis='G';await serve(page,data);await page.goto('/#/s/val-water/research/progress');
 const current=page.getByRole('table',{name:'当前采用的结果',exact:true});await expect(current).toContainText('a-opt');await expect(current).toContainText('a-freq');await expect(current).toContainText('a-sp');await expect(current).toContainText('0.628');await expect(current).toContainText('已签');await expect(current).not.toContainText('Water old');await expect(page.getByLabel('能量口径')).toHaveValue('G');
 await expect(page.getByRole('region',{name:'关键报告',exact:true}).getByRole('link')).toHaveText(['formal.md','adopted.md','pending.md']);
});

for(const mismatch of [false,true])test(`unregistered fallback ${mismatch?'hash mismatch':'absent'}`,async({page})=>{
 const data=fixture();data.catalog=mismatch?{...data.catalog!,journal_ok:false,warning:'登记记录格式或日志哈希不一致，按没有登记处理'}:undefined;await serve(page,data);await page.goto('/#/val-water/chains');
 const table=page.getByRole('table',{name:'对象计算链'});await expect(table).toContainText('未登记');await expect(table).not.toContainText('已采用');await expect(table).toContainText('—');if(mismatch)await expect(page.getByRole('alert')).toContainText('哈希');
 await table.getByRole('button',{name:'＋比较'}).first().click();await expect(page).toHaveURL(/cmp=a-sp/);
 await page.getByRole('button',{name:'进展',exact:true}).click();for(const name of ['当前采用的结果','关键报告'])await expect(page.getByRole('region',{name,exact:true})).toContainText('尚未登记采用结果');
});

for(const size of [{width:1440,height:860},{width:1280,height:720},{width:390,height:844}])test(`synthetic screenshots and contained table scrolling ${size.width}`,async({page},info)=>{
 await serve(page);await page.setViewportSize(size);await page.goto('/#/val-water/chains');
 await expect(page.getByRole('table',{name:'对象计算链'})).toContainText('0.628');await page.getByRole('button',{name:'▸ Water a',exact:true}).click();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(size.width);await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:info.outputPath(`chains-${size.width}.png`),fullPage:false});
 await page.getByRole('button',{name:'进展',exact:true}).click();await expect(page.getByRole('table',{name:'当前采用的结果'})).toContainText('0.628');expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(size.width);await page.getByRole('region',{name:'当前采用的结果',exact:true}).evaluate(el=>window.scrollTo(0,el.getBoundingClientRect().top+window.scrollY-200));await page.screenshot({path:info.outputPath(`adoption-${size.width}.png`),fullPage:false});
 await page.getByRole('button',{name:/Study ▾/}).click();const dialog=page.getByRole('dialog',{name:'切换 Study'});await dialog.getByRole('button',{name:/验证与测试/}).click();await expect(dialog.getByRole('option',{name:/val-water/})).toBeVisible();await page.screenshot({path:info.outputPath(`validation-${size.width}.png`)});
});
