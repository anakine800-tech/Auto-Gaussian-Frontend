import {test,expect} from '@playwright/test';
import type {Page} from '@playwright/test';
import {spawn} from 'node:child_process';
import type {ChildProcess} from 'node:child_process';
import {mkdirSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {catalogObjects,hasCatalog} from '../src/catalog-data';
import type {CatalogStudy} from '../src/catalog-data';

const base='http://127.0.0.1:18769';
let server:ChildProcess,errors='';
test.beforeAll(async({request})=>{
 const python=resolve(process.env.AUTOG_SOURCE_PYTHON??'../.venv/bin/python');
 server=spawn(python,['-B','-m','tests.catalog_v2_fixture'],{cwd:resolve('..'),stdio:['ignore','ignore','pipe']});
 server.stderr?.on('data',chunk=>errors+=String(chunk));
 server.on('error',error=>errors+=error.message);
 await expect.poll(async()=>{
  if(server.exitCode!==null)throw Error(errors);
  try{return (await request.get(base+'/api/studies')).status();}catch{return 0;}
 },{timeout:15000}).toBe(200);
});
test.afterAll(async()=>{
 if(server&&server.exitCode===null&&server.signalCode===null)await new Promise<void>(done=>{server.once('exit',()=>done());server.kill('SIGTERM');});
 expect(server?.exitCode,errors).toBe(0);
});
test.beforeEach(async({page})=>{
 const writes:string[]=[],pageErrors:string[]=[];
 page.on('request',r=>{if(r.url().startsWith(base)&&!['GET','HEAD'].includes(r.method()))writes.push(r.method());});
 page.on('pageerror',error=>pageErrors.push(error.message));
 await page.exposeFunction('ledgerTraffic',()=>({writes,pageErrors}));
});
test.afterEach(async({page})=>{
 if(page.url().startsWith(base))expect(await page.evaluate(()=>(window as any).ledgerTraffic())).toEqual({writes:[],pageErrors:[]});
});
async function open(page:Page,study='val-ledger'){
 await page.goto(`${base}/#/${study}/chains`);
 await page.getByRole('button',{name:'▸ 合成水 TS 对象',exact:true}).click();
 const panel=page.locator('.catalog-ledger');
 await expect(panel).toBeVisible();return panel;
}

test('v1 model has no ledger and v2 keeps the saved status',()=>{
 const state=JSON.parse(readFileSync(resolve('../tests/catalog-fixtures/t132/two-channels/state.json'),'utf8'));
 const data={catalog:{state,journal_ok:true,warning:null}} as CatalogStudy;
 expect(hasCatalog(data)).toBe(true);
 state.objects[0].channels[0].status='untried';
 expect(catalogObjects(data)[0].ledger?.channels[0].status).toBe('untried');
 state.schema='ag-catalog-state/1';
 expect(catalogObjects(data)[0]).not.toHaveProperty('ledger');
});

test('two channels, three origins, expectations, mismatches and all result history',async({page})=>{
 const panel=await open(page),table=panel.getByRole('table',{name:'登记通道',exact:true});
 await expect(table.locator('tbody tr')).toHaveCount(2);
 await expect(panel).toContainText('catalog 是登记视图，不是科学验收；状态由登记事件派生。');
 await expect(panel.getByRole('region',{name:'对象期望值'})).toContainText('值：H2O');
 await expect(panel.getByRole('region',{name:'对象期望值'})).toContainText('值：1');
 await expect(panel.getByRole('region',{name:'成员不一致'})).toContainText('只报告，未改动任何文件');
 await expect(panel.getByRole('region',{name:'成员不一致'})).toContainText('电荷 · 期望 1 · 实际 0');
 await expect(panel.getByRole('region',{name:'成员不一致'})).toContainText('多重度 · 期望 3 · 实际 1');
 const requests:string[]=[];page.on('request',r=>requests.push(r.url()));
 await panel.locator('summary').filter({hasText:'通道 A · 候选 2'}).click();
 const scan=panel.getByRole('article',{name:'候选 guess-scan'});
 await expect(scan).toContainText('扫描（scan）');
 await expect(scan.locator('.ledger-latest')).toContainText('归属不能唯一确定 · 候选通道：通道 A（a）、通道 B（b）');
 await expect(scan.getByRole('table',{name:'guess-scan 全部结果'}).locator('tbody tr')).toHaveCount(2);
 await expect(scan.getByRole('table',{name:'guess-scan 全部结果'})).toContainText('有诊断');
 await expect(scan.getByRole('table',{name:'guess-scan 全部结果'})).toContainText('无诊断');
 await scan.getByText('transform（原始 JSON）',{exact:true}).click();await expect(scan.locator('pre').first()).toContainText('"operation": "synthetic"');
 await scan.getByText('diagnosis（原始 JSON）',{exact:true}).click();await expect(scan.locator('pre').last()).toContainText('不作科学解释');
 const manual=panel.getByRole('article',{name:'候选 guess-manual'});
 await expect(manual).toContainText('手工（manual）');await expect(manual.locator('code')).toHaveText(/^[0-9a-f]{12}$/);
 await expect(manual.locator('.ledger-latest')).toContainText('暂定归属');
 await panel.locator('summary').filter({hasText:'未关联通道的候选 · 1'}).click();
 const literature=panel.getByRole('article',{name:'候选 guess-literature'});
 await expect(literature).toContainText('文献（literature）');await expect(literature).toContainText('10.0000/synthetic-water');await expect(literature).toContainText('暂无结果记录');
 expect(requests).toEqual([]);
 await expect(scan.getByRole('link',{name:'water-ts-synthetic'}).first()).toHaveAttribute('href',/#.*water-ts-synthetic/);
 await scan.getByRole('link',{name:'water-ts-synthetic'}).first().click();
 await expect(page).toHaveURL(/research\/a\/water-ts-synthetic/);
});

test('all six statuses, exact declarations, distinct tentative badge and discovered label',async({page})=>{
 const panel=await open(page,'val-six-statuses'),table=panel.getByRole('table',{name:'登记通道',exact:true});
 for(const label of ['未尝试','已尝试未找到','暂定找到 · 待负责人确认','已验证','待确认通道','低置信度排除'])await expect(table.locator('.StatusBadge').filter({hasText:new RegExp(`^${label}$`)})).toHaveCount(1);
 await expect(table.getByText('已验证',{exact:true})).toHaveClass(/tone-info/);
 await expect(table.getByText('暂定找到 · 待负责人确认',{exact:true})).toHaveClass(/tone-warn/);
 await expect(table).toContainText('采样中新发现');
 for(const id of ['E','F']){
  const row=table.getByRole('row').filter({has:page.getByRole('rowheader',{name:new RegExp(`通道 ${id}`)})});
  await expect(row).toContainText(`合成验证原话：通道 ${id}`);
  await expect(row.locator('time')).toHaveText('2026-01-01T00:00:00+00:00');
 }
 await expect(table).toContainText('理由：合成有限预算，没有全局结论');
 await panel.getByText('通道 A · 候选 2',{exact:true}).click();
 const scan=panel.getByRole('article',{name:'候选 guess-scan'});
 await expect(scan.getByRole('table',{name:'guess-scan 全部结果'}).locator('tbody tr')).toHaveCount(3);
 await expect(scan.locator('.ledger-latest')).toContainText('通道 B（b）、通道 D（d）');
});

for(const [study,label] of [['val-ledger','在声明的通道范围与采样预算内稳定'],['val-withdrawn','已撤销'],['val-no-coverage','尚无整体覆盖声明']])test(`coverage ${study}`,async({page})=>{
 const panel=await open(page,study),coverage=panel.getByRole('region',{name:'整体覆盖结论'});
 await expect(coverage).toContainText(label);
 if(study!=='val-no-coverage'){
  await expect(coverage).toContainText('合成 A、B 两个通道');await expect(coverage).toContainText('合成三份候选的展示预算');
  expect(await coverage.locator('blockquote').textContent()).toBe('  合成验证原话：只在声明的范围与预算内稳定。\n不是科学验收。  ');
  await expect(coverage.locator('time')).toHaveText('2026-01-01T00:00:00+00:00');
 }
});

test('unset and unknown expectations, nullable multiplicity and collapsible panel',async({page})=>{
 const panel=await open(page,'val-expectations'),values=panel.getByRole('region',{name:'对象期望值'});
 await expect(values).toContainText('未提供');await expect(values).toContainText('未知');await expect(values).toContainText('原记录未区分');
 await panel.locator(':scope > summary').click();await expect(values).toBeHidden();
});
for(const [study,warning] of [['val-invalid','登记记录格式'],['val-future','不支持的 catalog 版本'],['val-bad-hash','日志哈希不一致']])test(`invalid snapshot ${study} falls back`,async({page})=>{
 await page.goto(`${base}/#/${study}/chains`);await expect(page.getByRole('alert')).toContainText(warning);
 await expect(page.getByRole('table',{name:'对象计算链',exact:true})).toContainText('未登记');await expect(page.locator('.catalog-ledger')).toHaveCount(0);
});
test('v1 retains existing details and root containers do not become issues',async({page,request})=>{
 await page.goto(`${base}/#/val-v1/chains`);await page.getByRole('button',{name:'▸ 合成水 TS 对象',exact:true}).click();
 await expect(page.getByRole('table',{name:'合成水 TS 对象的计算步骤'})).toContainText('HF/STO-3G');await expect(page.locator('.catalog-ledger')).toHaveCount(0);
 const result=await (await request.get(base+'/api/studies')).json();expect(result.issues).toEqual([]);expect(result.studies.some((s:{id:string})=>s.id.startsWith('_')||s.id.startsWith('.'))).toBe(false);
});

for(const size of [{width:1440,height:860},{width:1280,height:720},{width:390,height:844}])test(`synthetic channel and expanded-ledger screenshots ${size.width}`,async({page})=>{
 await page.setViewportSize(size);const panel=await open(page);
 const directory=resolve('../tests/catalog-fixtures/t132');mkdirSync(directory,{recursive:true});
 const channels=panel.getByRole('region',{name:'通道表',exact:true});
 await channels.evaluate(el=>window.scrollTo(0,el.getBoundingClientRect().top+window.scrollY-160));
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(size.width);
 await page.screenshot({path:resolve(directory,`channels-${size.width}.png`)});
 await panel.getByText('通道 A · 候选 2',{exact:true}).click();
 const candidate=panel.getByRole('article',{name:'候选 guess-scan'});
 await candidate.evaluate(el=>window.scrollTo(0,el.getBoundingClientRect().top+window.scrollY-160));
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(size.width);
 const scroll=panel.locator('.ledger-scroll').first();
 if(size.width===390){expect(await scroll.evaluate(el=>el.scrollWidth>el.clientWidth)).toBe(true);await scroll.evaluate(el=>el.scrollLeft=el.scrollWidth);expect(await scroll.evaluate(el=>el.scrollLeft)).toBeGreaterThan(0);}
 await page.screenshot({path:resolve(directory,`ledger-${size.width}.png`)});
});
