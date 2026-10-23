import {test,expect} from '@playwright/test';
import type {Locator,Page} from '@playwright/test';
import {analysisConclusion,analysisType} from '../src/analysis-summary';
import {compareAttempts} from '../src/quick-comparison';
import type {Attempt} from '../src/api';

const attempt=(id:string,e=-76,g=-75.9):Attempt=>({id,manifest:{data:null,error:null},status:{data:null,error:null},facts:{data:{program:'gaussian',program_version:'Synthetic G revision',route:'# HF/STO-3G Opt Freq',units:{energy:'Hartree'},charge:0,multiplicity:1,n_atoms:3,energies:{scf:e,g}},error:null},geometry:{data:{units:'angstrom',atoms:[{center:1,atomic_number:8,x:0,y:0,z:0},{center:2,atomic_number:1,x:.95,y:0,z:0},{center:3,atomic_number:1,x:0,y:.95,z:0}]},error:null},input_geometry:{data:null,error:null},review:{data:null,error:null},input_files:[],logs:[],issues:[]});
test('saved conclusions cover report types and missing fields without scientific inference',()=>{
 expect(analysisConclusion({schema:'ag-ensemble/1',candidates:[{},{}],bin_summary:[{}],references:{xtb:2,opt:null}})).toBe('候选 2 · 分组 1 · 最低者 xtb: 2 / opt: —');
 expect(analysisConclusion({schema:'ag-irc-review/1',directions:{forward:{summary:'tool_checks_passed'},reverse:{}}})).toBe('forward：tool_checks_passed · reverse：—');
 expect(analysisConclusion({schema:'ag-thermo/1',ensemble_G:0,units:{energy:'Hartree'}})).toBe('系综 G：0 Eh');
 expect(analysisConclusion({schema:'ag-profile/1',selectivity:[{id:'demo',pairwise:[{a:'R',b:'S',ddG_barrier_kcal:1.2,ratio_a_over_b:7.5}],products:{R:{fraction:.88}}}]})).toContain('R/S ΔΔG‡ 1.2 kcal/mol · 比 7.5 · 选择性 R: 0.88');
 expect(analysisConclusion({schema:'ag-channel-coverage/1',channels:[{imbalances:[]}]})).toBe('报告记录：未列出不均衡');
 expect(analysisConclusion({schema:'ag-channel-coverage/1',channels:[{imbalances:[{}]}]})).toBe('报告记录：存在不均衡');
 expect(analysisConclusion({schema:'ag-channel-coverage/1',channels:[{}]})).toBe('不均衡：—');
 expect(analysisConclusion({schema:'ag-nci/1',frames:[{frame:1,fragment_pairs:[{atom_pairs:[{atoms:[1,2],percent:20},{atoms:[2,3],percent:80}]}]}]})).toBe('帧 1：原子 2–3 80% / 原子 1–2 20%');
 for(const schema of ['ag-ensemble/1','ag-irc-review/1','ag-thermo/1','ag-profile/1','ag-channel-coverage/1','ag-nci/1'])expect(analysisConclusion({schema})).toContain('—');
 expect(analysisConclusion({attempts:[{attempt:'demo',product_configuration:'C1:R',product_centers:[{label:'unknown'},{label:'needs_review'}],catalyst_check:{status:'changed'}}]},'ts-labels/demo/labels.json')).toBe('demo：产物构型 C1:R · unknown 1 / needs_review 1 · 催化剂自检 changed');
 expect(analysisType(null,'ts-labels/demo/labels.json')).toBe('ts');expect(analysisType(null,'other/demo/labels.json')).toBe('file');
 expect(analysisConclusion({schema:'future/1',summary:'invented'})).toBe('—');expect(analysisType('future/1')).toBe('file');for(const schema of ['constructor','__proto__','toString'])expect(analysisType(schema)).toBe('file');
});
test('quick comparison matches T82 protocol normalization and relative energy units',()=>{
 const a=attempt('a'),b=attempt('b',-75.998,-75.897);
 (b.facts.data as any).route='# hf / sto-3g SP';
 const result=compareAttempts([a,b]);expect(result.differences).toEqual([]);
 expect(result.rows[0].relativeElectronic).toBe(0);expect(result.rows[0].relativeFree).toBe(0);
 expect(result.rows[1].relativeElectronic).toBeCloseTo(1.2550189481262,8);expect(result.rows[1].relativeFree).toBeCloseTo(1.8825284221893,8);
 (b.facts.data as any).energies.g=null;expect(compareAttempts([a,b]).rows[1].relativeFree).toBeNull();
});
test('comparison keeps saved termination and imaginary count without inferring completion or changing energies',()=>{
 for(const [termination,nImag,expectedTermination,expectedImag] of [
  ['normal',0,'normal',0],['error',2,'error',2],['incomplete',1,'incomplete',1],['unknown',null,'unknown',null],
  [undefined,undefined,null,null],[null,null,null,null],['',-1,null,null],['   ',1.5,null,null],
  [true,'0',null,null],[{},false,null,null],['future_status',NaN,'future_status',null],['normal',Infinity,'normal',null],
 ] as const){
  const a=attempt('a'),b=attempt('b',-75.998,-75.897);
  Object.assign(b.facts.data as object,{termination,n_imag:nImag,frequencies_cm1:[-100,-50]});
  b.status.data={state:'finished',termination:'normal',n_imag:0};
  const result=compareAttempts([a,b]);expect(result.differences).toEqual([]);
  expect(result.rows[1].termination).toBe(expectedTermination);expect(result.rows[1].nImag).toBe(expectedImag);
  expect(result.rows[1].relativeElectronic).toBeCloseTo(1.2550189481262,8);expect(result.rows[1].relativeFree).toBeCloseTo(1.8825284221893,8);
 }
});
for(const [field,value,diagnostic] of [
 ['route','# B3LYP/STO-3G Freq','方法不同'],['route','# HF/6-31G Freq','基组不同'],['route','# HF/STO-3G EmpiricalDispersion=GD3BJ','色散不同'],
 ['route','# HF/STO-3G SCRF=(SMD,Solvent=Water)','溶剂'],['route','# HF/STO-3G 6D','基函数形式不同'],
 ['program_version','Another synthetic revision','程序版本不同'],['charge',1,'电荷不同'],['multiplicity',3,'多重度不同'],
 ['program_version',null,'缺少程序版本'],['route','# MP2/STO-3G','非 SCF'],['route','# HF/Gen','自定义'],['units',{},'Hartree'],
] as const)test(`quick comparison refuses ${field} ${String(value)}`,()=>{
 const a=attempt('a'),b=attempt('b');(b.facts.data as any)[field]=value;
 const result=compareAttempts([a,b]);expect(result.differences.join(' ')).toContain(diagnostic);expect(result.rows.every(r=>r.relativeElectronic===null&&r.relativeFree===null)).toBe(true);
});
test('quick comparison rejects mismatched or missing composition, unknown/custom route evidence',()=>{
 const a=attempt('a'),b=attempt('b');(b.geometry.data as any).atoms[0].atomic_number=6;
 expect(compareAttempts([a,b]).differences.join(' ')).toContain('元素组成不同');b.geometry.data=null;expect(compareAttempts([a,b]).differences.join(' ')).toContain('最终几何');
 for(const route of ['# HF/STO-3G SCRF=Read','# HF/STO-3G 5D 6D','# HF/STO-3G em=gd3 em=gd3bj','# mystery/STO-3G']){const b=attempt('b');(b.facts.data as any).route=route;expect(compareAttempts([a,b]).differences.length).toBeGreaterThan(0);}
});
async function fullyVisible(locator:Locator,page:Page){await expect(locator).toBeVisible();const box=(await locator.boundingBox())!,size=page.viewportSize()!;expect(box.x).toBeGreaterThanOrEqual(0);expect(box.y).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(size.width);expect(box.y+box.height).toBeLessThanOrEqual(size.height);}
for(const size of [{width:1440,height:860},{width:1280,height:720}])test(`T98 library and quick comparison ${size.width}x${size.height}`,async({page},info)=>{
 await page.setViewportSize(size);const writes:string[]=[],errors:string[]=[];page.on('request',r=>{if(!['GET','HEAD'].includes(r.method()))writes.push(r.method());});page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/#/s/butane-demo/analysis');await page.getByRole('link',{name:'thermo-demo.json',exact:true}).locator('..').locator('.analysis-conclusion').scrollIntoViewIfNeeded();await expect(page.getByRole('region',{name:'热化学列表'})).toContainText('系综 G：-157.00065446 Eh');
 await page.getByRole('link',{name:'ts-labels/synthetic/labels.json',exact:true}).locator('..').locator('.analysis-conclusion').scrollIntoViewIfNeeded();await expect(page.getByRole('region',{name:'其他列表'})).toContainText('产物构型 C1:R · unknown 1 / needs_review 0 · 催化剂自检 unchanged');await expect(page.getByRole('region',{name:'其他列表'})).toContainText('建议，待确认');
 await page.getByRole('link',{name:'nci-demo.json',exact:true}).locator('..').locator('.analysis-conclusion').scrollIntoViewIfNeeded();await expect(page.getByRole('region',{name:'电子态检查列表'})).toContainText('原子 1–3 75%');
 for(const title of ['热化学','能量与排序','阶段审阅','电子态检查','图与演示','其他'])await expect(page.getByRole('heading',{name:new RegExp('^'+title+' ')})).toHaveCount(1);
 for(const title of ['构象集合','IRC'])await expect(page.getByRole('heading',{name:new RegExp('^'+title+' ')})).toHaveCount(0);
 await fullyVisible(page.locator('.report-layout'),page);expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(size.width);await expect(page.locator('body')).not.toContainText('已验证');await page.screenshot({path:info.outputPath(`analysis-${size.width}x${size.height}.png`)});
 await page.getByRole('link',{name:'profile-demo.json',exact:true}).click();await expect(page).toHaveURL(/analysis\/thermo\/profile-demo.json$/);await expect(page.locator('pre')).toContainText('ddG_barrier_kcal');await page.goBack();
 await page.route('**/api/studies/butane-demo/attempts/*',async route=>{const id=route.request().url().split('/').at(-1)!;if(['anti','gauche'].includes(id)){const data=attempt(id,id==='anti'?-157:-156.998,id==='anti'?-156.9:-156.897);Object.assign(data.facts.data as object,{termination:id==='anti'?'normal':'error',n_imag:id==='anti'?0:2});await route.fulfill({json:data});}else await route.continue();});
 await page.getByRole('button',{name:'Study',exact:true}).click();await page.getByRole('button',{name:'Attempts',exact:true}).click();
 await page.getByRole('checkbox',{name:'比较 anti',exact:true}).check();await page.getByRole('checkbox',{name:'比较 gauche',exact:true}).check();await page.getByRole('button',{name:'快速比较（2）',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'快速比较（前端计算，非正式结果）'}),table=dialog.getByRole('table');await expect(table).toContainText('1.255');await expect(table).toContainText('1.883');
 await expect(table.getByRole('columnheader')).toHaveText(['Attempt','termination','n_imag','E / Eh','G / Eh','ΔE / kcal/mol','ΔG / kcal/mol']);
 await expect(table.getByRole('row').nth(1).getByRole('cell')).toHaveText(['anti','normal','0','-157.000000','-156.900000','0.000','0.000']);
 await expect(table.getByRole('row').nth(2).getByRole('cell')).toHaveText(['gauche','error','2','-156.998000','-156.897000','1.255','1.883']);
 await expect(table.getByText('normal',{exact:true})).toHaveClass(/tone-neutral/);await expect(table.getByText('error',{exact:true})).toHaveClass(/tone-bad/);
 await expect(table.getByRole('row').nth(1).getByRole('cell').nth(2)).toHaveCSS('text-align','right');
 await fullyVisible(table,page);for(const header of await table.getByRole('columnheader').all())await fullyVisible(header,page);
 for(const selector of ['.Drawer','.quick-comparison .table-scroll'])expect(await page.locator(selector).evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(size.width);await page.screenshot({path:info.outputPath(`comparison-${size.width}x${size.height}.png`)});
 await page.getByRole('button',{name:'关闭抽屉'}).click();await page.getByRole('checkbox',{name:'比较 waiting',exact:true}).check();await page.getByRole('button',{name:'快速比较（3）',exact:true}).click();await expect(dialog).toContainText('拒绝快速比较');await expect(dialog.getByRole('table')).toHaveCount(0);
 expect(writes).toEqual([]);expect(errors).toEqual([]);
});
test('comparison displays incomplete, unknown and missing facts without falling back to status',async({page})=>{
 let saved=false;const writes:string[]=[];page.on('request',r=>{if(!['GET','HEAD'].includes(r.method()))writes.push(r.method());});
 await page.route('**/api/studies/butane-demo/attempts/*',async route=>{
  const id=route.request().url().split('/').at(-1)!;const data=attempt(id);
  data.status.data={state:'finished',termination:'normal',n_imag:0};
  Object.assign(data.facts.data as object,saved?{termination:id==='anti'?'incomplete':'unknown',n_imag:id==='anti'?1:null}:{frequencies_cm1:[-100]});
  await route.fulfill({json:data});
 });
 await page.goto('/#/s/butane-demo/attempts');for(const id of ['anti','gauche'])await page.getByRole('checkbox',{name:`比较 ${id}`,exact:true}).check();
 const dialog=page.getByRole('dialog',{name:'快速比较（前端计算，非正式结果）'});
 await page.getByRole('button',{name:'快速比较（2）',exact:true}).click();
 for(const row of [1,2])await expect(dialog.getByRole('row').nth(row).getByRole('cell')).toHaveText([row===1?'anti':'gauche','—','—','-76.000000','-75.900000','0.000','0.000']);
 await page.getByRole('button',{name:'关闭抽屉'}).click();saved=true;await page.getByRole('button',{name:'快速比较（2）',exact:true}).click();
 await expect(dialog.getByRole('row').nth(1).getByRole('cell')).toHaveText(['anti','incomplete','1','-76.000000','-75.900000','0.000','0.000']);
 await expect(dialog.getByRole('row').nth(2).getByRole('cell')).toHaveText(['gauche','unknown','—','-76.000000','-75.900000','0.000','0.000']);
 for(const status of ['incomplete','unknown'])await expect(dialog.getByText(status,{exact:true})).toHaveClass(/tone-warn/);
 expect(writes).toEqual([]);
});
test('Attempt retains one usable structure selection, with all structure interactions',async({page})=>{
 await page.goto('/#/s/butane-demo/a/anti');await expect(page.getByLabel('预览结构',{exact:true})).toHaveCount(1);await expect(page.getByLabel('结构来源',{exact:true})).toHaveCount(0);await page.getByLabel('预览结构',{exact:true}).selectOption('input');await expect(page.getByRole('region',{name:'三维分子结构'})).toContainText('输入结构');await page.getByLabel('预览结构',{exact:true}).selectOption('final');await expect(page.getByRole('region',{name:'三维分子结构'})).toContainText('最终结构');
});

test('fixed TS labels routes and pending CSV do not claim channel assignment',async({page})=>{
 await page.goto('/#/s/butane-demo/analysis/ts/ts-labels/synthetic/labels.json');await expect(page.locator('pre')).toContainText('product_configuration');
 await page.goto('/#/s/butane-demo/analysis/ts/ts-labels/synthetic/channel-suggestions.csv');await expect(page.getByRole('article',{name:'报告正文'}).getByText('建议，待确认',{exact:true})).toHaveClass(/tone-warn/);await expect(page.getByRole('table')).toContainText('pending_confirmation');await expect(page.locator('body')).not.toContainText('已归类');
 await page.getByRole('textbox',{name:'全局搜索'}).fill('channel-suggestions.csv');await page.getByRole('region',{name:'搜索结果'}).getByRole('link').click();await expect(page).toHaveURL(/analysis\/ts\/ts-labels\/synthetic\/channel-suggestions.csv$/);
 await page.goto('/#/s/butane-demo/analysis/ts/other/synthetic/labels.json');await expect(page.getByRole('alert')).toContainText('无法打开链接');
});

test('twenty reports keep metadata discovery and read bodies only for visible rows',async({page,request})=>{
 const data=await (await request.get('/api/studies/butane-demo')).json();
 data.analyses=Array.from({length:20},(_,i)=>({name:`synthetic-${String(i).padStart(2,'0')}.json`,schema:'ag-thermo/1',data:null,error:null,updated_at:'2026-01-01T00:00:00Z'}));
 await page.route('**/api/studies/butane-demo',route=>route.fulfill({json:data}));
 const reads:string[]=[];
 await page.route('**/api/studies/butane-demo/reports/*',route=>{reads.push(route.request().url().split('/').at(-1)!);return route.fulfill({json:{data:{schema:'ag-thermo/1',units:{energy:'Hartree'},ensemble_G:0},error:null}});});
 await page.goto('/#/s/butane-demo/analysis');await expect(page.getByText('系综 G：0 Eh',{exact:true}).first()).toBeVisible();
 expect(reads.length).toBeLessThan(20);expect(reads).not.toContain('synthetic-19.json');
 await page.getByRole('link',{name:'synthetic-19.json',exact:true}).scrollIntoViewIfNeeded();
 await expect.poll(()=>reads.includes('synthetic-19.json')).toBe(true);
});

const methodAttempt=(id:string,method:string,multiplicity:unknown=1)=>{const a=attempt(id);Object.assign(a.facts.data as object,{route:`# ${method} / STO-3G Opt Freq`,multiplicity});return a;};
for(const [left,right,multiplicity,normalized] of [
 ['M062X','RM062X',1,'rm062x'],['M062X','UM062X',3,'um062x'],['m062x','rM062x',1,'rm062x'],
 ['revTPSS','RrevTPSS',1,'rrevtpss'],['revTPSS','UrevTPSS',3,'urevtpss'],['revTPSSh','RrevTPSSh',1,'rrevtpssh'],
 ['CAM-B3LYP','RCAM-B3LYP',1,'rcam-b3lyp'],['M06-2X','UM06-2X',2,'um06-2x'],['HF','RHF',1,'rhf'],['HF','UHF',2,'uhf'],
] as const)test(`T103 omitted prefix ${left}/${right} multiplicity ${multiplicity}`,()=>{
 const result=compareAttempts([methodAttempt('A',left,multiplicity),methodAttempt('B',right,multiplicity)]);
 expect(result.differences).toEqual([]);expect(result.protocol.方法).toBe(normalized);expect(result.rows[1].relativeElectronic).toBe(0);
});
for(const [left,right] of [['RM062X','UM062X'],['ROM062X','UM062X'],['ROM062X','RM062X'],['M062X','UM062X'],['revTPSS','UrevTPSS'],['CAM-B3LYP','RCAMB3LYP']] as const)test(`T103 explicit methods stay distinct ${left}/${right}`,()=>{
 const result=compareAttempts([methodAttempt('A',left),methodAttempt('B',right)]);
 expect(result.differences.join(' ')).toContain(`方法不同：A = ${left}`);expect(result.differences.join(' ')).toContain(`B = ${right}`);
 if(left==='M062X')expect(result.differences).toEqual(['方法不同：A = M062X（按单重态视为 RM062X）；B = UM062X']);
 expect(result.rows.every(r=>r.relativeElectronic===null&&r.relativeFree===null)).toBe(true);
});
test('T103 missing or invalid multiplicity still refuses comparison',()=>{
 for(const multiplicity of [undefined,null,0,-1,1.5,'1',true]){const b=methodAttempt('B','RM062X');(b.facts.data as any).multiplicity=multiplicity;const result=compareAttempts([methodAttempt('A','M062X'),b]);expect(result.differences).toEqual(['B：缺少正整数多重度']);expect(result.rows.every(r=>r.relativeElectronic===null)).toBe(true);}
});
for(const [width,height] of [[1440,860],[1280,720]])test(`T103 prefix comparison and original-spelling diagnostic ${width}x${height}`,async({page},info)=>{
 await page.setViewportSize({width,height});let explicit='RM062X';const writes:string[]=[];page.on('request',r=>{if(!['GET','HEAD'].includes(r.method()))writes.push(r.method());});
 await page.route('**/api/studies/butane-demo/attempts/*',r=>{const id=r.request().url().split('/').at(-1)!;return r.fulfill({json:methodAttempt(id,id==='anti'?'M062X':explicit)});});
 await page.goto('/#/s/butane-demo/attempts');for(const id of ['anti','gauche'])await page.getByRole('checkbox',{name:`比较 ${id}`,exact:true}).check();
 await page.getByRole('button',{name:'快速比较（2）',exact:true}).click();const dialog=page.getByRole('dialog',{name:'快速比较（前端计算，非正式结果）'});
 await expect(dialog.getByRole('table')).toBeVisible();await dialog.locator('.Collapsible > summary').filter({hasText:'比较口径'}).click();await expect(dialog).toContainText('方法：M062X（按单重态视为 RM062X）');
 await fullyVisible(dialog.getByRole('table'),page);await page.screenshot({path:info.outputPath(`t103-prefix-equal-${width}x${height}.png`)});
 await page.getByRole('button',{name:'关闭抽屉'}).click();explicit='UM062X';await page.getByRole('button',{name:'快速比较（2）',exact:true}).click();
 await expect(dialog).toContainText('方法不同：anti = M062X（按单重态视为 RM062X）；gauche = UM062X');await expect(dialog.getByRole('table')).toHaveCount(0);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);expect(writes).toEqual([]);
 await page.screenshot({path:info.outputPath(`t103-prefix-different-${width}x${height}.png`)});
});
