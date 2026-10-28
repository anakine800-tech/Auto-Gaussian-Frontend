import {test,expect} from '@playwright/test';
import type {Page} from '@playwright/test';
import {spawn} from 'node:child_process';
import type {ChildProcess} from 'node:child_process';
import {resolve} from 'node:path';
import {openSection} from './disclosure';

const servers:ChildProcess[]=[];
let base='',actions='';
test.beforeAll(async({request})=>{
 const python=resolve(process.env.AUTOG_SOURCE_PYTHON??'../.venv/bin/python');
 for(const flags of [[],['--actions']]){
  const child=spawn(python,['-B','-m','tests.test_crest_diagnostics','--serve',...flags],{cwd:resolve('..'),stdio:['ignore','pipe','pipe']});servers.push(child);
  let errors='';child.stderr?.on('data',chunk=>errors+=String(chunk));
  const url=await new Promise<string>((done,reject)=>{
   let output='';const timeout=setTimeout(()=>reject(Error('Fixture startup timeout: '+errors)),15000);
   child.on('error',reject);child.on('exit',()=>{clearTimeout(timeout);reject(Error(errors));});
   child.stdout?.on('data',chunk=>{output+=String(chunk);const match=output.match(/http:\/\/127\.0\.0\.1:\d+/);if(match){clearTimeout(timeout);done(match[0]);}});
  });
  if(flags.length)actions=url;else base=url;
  await expect.poll(async()=>{try{return (await request.get(url+'/api/studies')).status();}catch{return 0;}},{timeout:15000}).toBe(200);
 }
});
test.afterAll(async()=>{
 await Promise.all(servers.map(child=>new Promise<void>(done=>{if(child.exitCode!==null||child.signalCode!==null)return done();child.once('exit',()=>done());child.kill('SIGTERM');})));
});

const panel=(page:Page)=>page.getByRole('region',{name:'CREST 诊断',exact:true});
const go=(page:Page,name='error',url=base)=>page.goto(`${url}/#/s/crest-demo/research/a/crest-${name}`);
async function expand(page:Page){
 await panel(page).getByText(/^查看诊断来源（/).click();
 const source=panel(page).locator('.crest-source').filter({hasText:'job.slurm.err'});
 await source.locator('summary').click();return source;
}

test('summary is immediate, excerpts are lazy and escaped, complete log stays paged',async({page})=>{
 const writes:string[]=[],reads:string[]=[],errors:string[]=[];
 page.on('request',r=>{if(!['GET','HEAD'].includes(r.method()))writes.push(r.url());if(r.url().includes('/crest-diagnostics/')||r.url().includes('/logs/'))reads.push(r.url());});
 page.on('pageerror',e=>errors.push(e.message));
 await go(page);await expect(panel(page)).toContainText('错误证据');await expect(panel(page)).toContainText('发现运行时错误证据');
 await expect(panel(page)).toContainText('不能证明根因');expect(reads).toEqual([]);
 await expect(page.getByRole('group',{name:'Attempt 操作',exact:true})).toHaveCount(0);
 const source=await expand(page);await expect(source).toContainText('来源匹配（完整文件 SHA-256）');
 await expect(source.locator('.crest-hit')).toContainText('145 Fortran runtime error: <script>');
 expect(await page.evaluate(()=>(window as any).crestExecuted)).toBeUndefined();
 await expect(source.locator('script')).toHaveCount(0);
 await source.locator('summary').click();await expect(source.getByLabel('诊断来源片段')).toBeHidden();
 await source.locator('summary').click();await expect(source.getByLabel('诊断来源片段')).toBeVisible();
 await source.getByRole('button',{name:'查看完整日志 · job.slurm.err',exact:true}).click();
 const log=page.getByRole('region',{name:'日志分页',exact:true});
 await expect(page.getByLabel('输出日志',{exact:true})).toHaveValue('job.slurm.err');await expect(log).toContainText('共 260 行 · 1–120 行');
 await expect(log.getByTestId('raw-log')).not.toContainText('Fortran');
 await log.getByRole('button',{name:'下一页',exact:true}).click();await expect(log).toContainText('121–240 行');await expect(log.getByTestId('raw-log')).toContainText('<script>');
 await log.getByRole('button',{name:'下一页',exact:true}).click();await expect(log).toContainText('241–260 行');
 await log.getByRole('button',{name:'上一页',exact:true}).click();await expect(log).toContainText('121–240 行');
 await openSection(page,'频率与虚频审阅');await expect(page.getByRole('button',{name:'解析振动位移'})).toHaveCount(0);
 await openSection(page,'优化过程');await expect(page.getByLabel('优化日志')).toHaveCount(0);
 expect(writes).toEqual([]);expect(errors).toEqual([]);
});

for(const [name,status] of [['warning','未发现匹配错误'],['unknown','原因未明确'],['missing','错误输出不可用'],['incomplete','解析未完成'],['legacy','没有结构化来源'],['malformed','结构化诊断格式无效']])test(`diagnostic state ${name}`,async({page})=>{
 await go(page,name);await expect(panel(page)).toContainText(status);
 if(name==='legacy')await expect(page.getByRole('region',{name:'关键事实',exact:true})).toContainText('旧版合成错误提示');
 if(name==='warning')await expect(panel(page).locator('.crest-state')).toHaveText('未发现匹配错误');
});

for(const [name,reason] of [['mismatch','SHA-256 不符'],['lost','来源文件缺失']])test(`unverified source ${name} never becomes evidence`,async({page})=>{
 await go(page,name);const source=await expand(page);await expect(source).toContainText(reason);await expect(source.getByLabel('诊断来源片段')).toHaveCount(0);
});

test('empty logs and failed requests are explicit',async({page})=>{
 await go(page,'empty');await panel(page).getByText(/^查看诊断来源（/).click();
 await expect(panel(page)).toContainText('job.slurm.err · 空文件 · 没有命中行范围');
 await panel(page).getByRole('button',{name:'查看完整日志 · job.slurm.err',exact:true}).click();
 await expect(page.getByTestId('raw-log')).toHaveText('日志为空。');
 await page.route('**/crest-diagnostics/*?*',route=>route.fulfill({status:503,json:{detail:'合成读取失败'}}));
 await go(page);const source=await expand(page);await expect(source).toContainText('片段读取失败：合成读取失败');
});

test('normal searches, vibration selection and browser history remain usable',async({page})=>{
 await page.goto(base+'/#/s/butane-demo/research/a/anti');await openSection(page,'日志搜索');
 await page.getByLabel('日志关键词').fill('Frequencies --');await page.getByRole('button',{name:'搜索下一处'}).click();await expect(page.locator('.log-match')).toContainText('Frequencies --');
 await openSection(page,'频率与虚频审阅');await page.getByRole('button',{name:'解析振动位移'}).click();await page.getByLabel('振动模式',{exact:true}).selectOption('0');
 await expect(page.getByLabel('振动模式',{exact:true})).toHaveValue('0');
 await page.evaluate(()=>{window.location.hash='#/s/crest-demo/research/a/crest-error';});await expect(panel(page)).toBeVisible();
 await expand(page);await page.goBack();await expect(page.getByRole('heading',{name:'anti',exact:true})).toBeVisible();
 await page.goForward();await expect(panel(page)).toContainText('错误证据');
});

test('a late source response cannot cross Attempts',async({page})=>{
 let release:()=>void=()=>{};const gate=new Promise<void>(done=>release=done);
 await page.route('**/crest-diagnostics/*?*',async route=>{const response=await route.fetch();await gate;await route.fulfill({response}).catch(()=>{});});
 await go(page);await expand(page);await page.evaluate(()=>{window.location.hash='#/s/crest-demo/research/a/crest-empty';});
 await expect(panel(page)).toContainText('未发现匹配错误');release();
 await expect(panel(page)).not.toContainText('Fortran');await expect(panel(page).getByLabel('诊断来源片段')).toHaveCount(0);
});

for(const [width,height] of [[1440,960],[390,844]])test(`layout and read-only viewing in actions mode ${width}`,async({page},info)=>{
 const writes:string[]=[];page.on('request',r=>{if(!['GET','HEAD'].includes(r.method()))writes.push(r.url());});
 await page.setViewportSize({width,height});await go(page,'error',actions);await expect(panel(page)).toContainText('发现运行时错误证据');
 await page.screenshot({path:info.outputPath(`t160-summary-${width}.png`)});
 const source=await expand(page);await expect(source).toContainText('来源匹配');await source.scrollIntoViewIfNeeded();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
 await page.screenshot({path:info.outputPath(`t160-source-${width}.png`)});
 expect(writes).toEqual([]);
});
