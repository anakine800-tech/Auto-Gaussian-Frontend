import {test,expect} from '@playwright/test';
import type {Page} from '@playwright/test';
import {spawn} from 'node:child_process';
import type {ChildProcess} from 'node:child_process';
import {resolve} from 'node:path';

// Real HTTP adapters + built UI, all data and ag processes are synthetic.
// Keep this fixture self-contained: the shared test server/config is unchanged.
const servers:ChildProcess[]=[];
const base='http://127.0.0.1:18767',actions='http://127.0.0.1:18768';
let serverErrors='';
test.beforeAll(async({request})=>{
 const python=resolve(process.env.AUTOG_SOURCE_PYTHON??'../.venv/bin/python');
 for(const flags of [[],['--actions']]){
  const child=spawn(python,['-B','-m','tests.integration_fixture',...flags],{cwd:resolve('..'),stdio:['ignore','ignore','pipe']});
  child.stderr?.on('data',chunk=>serverErrors+=String(chunk));
  child.on('error',error=>serverErrors+=error.message);servers.push(child);
 }
 for(const url of [base,actions])await expect.poll(async()=>{
  if(servers.some(p=>p.exitCode!==null))throw Error(serverErrors);
  try{return (await request.get(url+'/api/studies')).status();}catch{return 0;}
 },{timeout:15000}).toBe(200);
});
test.afterAll(async()=>{
 await Promise.all(servers.map(child=>new Promise<void>(done=>{
  if(child.exitCode!==null||child.signalCode!==null)return done();
  child.once('exit',()=>done());child.kill('SIGTERM');
 })));
});
test.beforeEach(async({page})=>{
 const writes:string[]=[],errors:string[]=[];
 page.on('request',r=>{if(r.url().startsWith(base)&&!['GET','HEAD'].includes(r.method()))writes.push(r.method()+' '+r.url());});
 page.on('pageerror',e=>errors.push(e.message));
 await page.exposeFunction('integrationTraffic',()=>({writes,errors}));
});
test.afterEach(async({page})=>{
 if(page.url().startsWith('http'))expect(await page.evaluate(()=>(window as any).integrationTraffic())).toEqual({writes:[],errors:[]});
});
async function decode(page:Page){
 await page.getByRole('button',{name:'解析振动位移'}).click();
 await page.getByLabel('振动模式',{exact:true}).selectOption('0');
 await page.getByRole('button',{name:'回到参考结构',exact:true}).click();
}
async function healthyResults(page:Page,study:string){
 await page.goto(base+'/#/'+study);
 await expect(page.getByRole('table',{name:'Attempt 结果表'})).toContainText('opt-demo');
 await expect(page.getByRole('heading',{name:'thermo-demo.json',exact:true})).toBeVisible();
}

test('results → ensemble → selected 3D → source CREST frames → back restores selection',async({page})=>{
 await healthyResults(page,'butane-demo');
 const results=page.getByRole('table',{name:'Attempt 结果表'});
 for(const id of ['sp-demo','opt-demo','crest-demo','anti'])await expect(results).toContainText(id);
 await page.getByRole('region',{name:'构象集合列表'}).getByRole('link',{name:'合成水集合'}).click();
 await page.getByRole('button',{name:'候选 2',exact:true}).click();
 const selected=base+'/#/butane-demo/ensembles/ensemble.json?candidate=2';
 await expect(page).toHaveURL(selected);
 await expect(page.getByRole('button',{name:'候选 2 缩略图'})).toHaveAttribute('aria-pressed','true');
 await expect(page.getByRole('region',{name:'三维分子结构'})).toContainText('候选 2 · 第 2 帧');
 await page.getByRole('table',{name:'构象能量表'}).locator('tr[data-candidate="2"]').getByRole('link',{name:'crest-demo'}).click();
 await expect(page).toHaveURL(base+'/#/butane-demo/crest-demo');
 const crest=page.getByRole('region',{name:'CREST 输出',exact:true});
 await crest.getByRole('link',{name:'attempts/crest-demo/crest-frames/crest_conformers.xyz',exact:true}).click();
 await expect(crest.getByTestId('frame-comment')).toContainText('能量 -76.0 Hartree');
 await crest.getByRole('button',{name:'下一帧',exact:true}).click();
 await expect(crest.getByLabel('帧号')).toHaveValue('2');
 await expect(crest.getByTestId('frame-comment')).toContainText('0.627509 kcal/mol');
 await page.goBack();await expect(page).toHaveURL(selected);
 await expect(page.locator('tr[data-candidate="2"]')).toHaveAttribute('aria-selected','true');
 await expect(page.getByRole('button',{name:'候选 2 缩略图'})).toHaveAttribute('aria-pressed','true');
 await page.reload();await expect(page.getByRole('region',{name:'三维分子结构'})).toContainText('候选 2 · 第 2 帧');
 await page.getByRole('link',{name:'返回结果',exact:true}).click();
 await expect(page).toHaveURL(base+'/#/butane-demo');
 await expect(results).toBeVisible();
 await expect(page.getByRole('button',{name:'取回结果',exact:true})).toHaveCount(0);
 const response=await page.request.post(base+'/api/actions',{data:{action:'fetch',study:'butane-demo',attempt:'anti'}});
 expect(response.status()).toBe(405);
});

test('TS frequency → animation → review atom picks → matching saved report',async({page})=>{
 await healthyResults(page,'butane-demo');
 await page.getByRole('table',{name:'Attempt 结果表'}).getByRole('button',{name:'anti',exact:true}).click();
 await expect(page).toHaveURL(base+'/#/butane-demo/anti');await decode(page);
 await expect(page.getByLabel('振动模式',{exact:true})).toContainText('-100');
 await page.getByRole('button',{name:'继续播放',exact:true}).click();
 await expect(page.getByTestId('vibration-controls')).toContainText('播放中');
 await page.getByRole('button',{name:'回到参考结构',exact:true}).click();
 await page.getByLabel('启用审阅模式').check();
 await expect(page.getByTestId('current-1-2')).toHaveText('4.000');
 // Remove the report default, then restore it through actual atom clicks.
 await page.getByRole('button',{name:'删除原子对 1-2'}).click();
 for(const atom of [1,2])await page.locator(`[data-testid="molecule-atom"][data-center="${atom}"]`).click();
 await expect(page.getByTestId('pair-1-2').locator('td').nth(1)).toHaveText('3.475');
 const comparison=page.getByRole('table',{name:'报告距离对照'});
 await expect(comparison.getByRole('cell',{name:'一致',exact:true})).toHaveCount(4);
 expect(new URL(page.url()).searchParams.get('modePairs')).toContain('1-2');
 await page.reload();await decode(page);await expect(page.getByTestId('pair-1-2')).toBeVisible();
});

for(const [study,reason] of [['facts-missing','File not available'],['facts-broken','Malformed']]){
 test(study+' explains the missing facts while structure and other results remain readable',async({page})=>{
  await page.goto(base+'/#/'+study+'/anti');
  await expect(page.locator('section.file-view').filter({has:page.getByRole('heading',{name:'facts.json',exact:true})})).toContainText(reason);
  await expect(page.getByRole('region',{name:'三维分子结构'})).toContainText('3 / 3 原子');
  await healthyResults(page,study);
 });
}
for(const [study,reason] of [['xyz-replaced','sha256 mismatch'],['size-limit','size limit'],['frame-limit','frame'],['atom-limit','atom'],['symlink','Unsafe or unreadable file']]){
 test(study+' explains the refused ensemble and leaves other results readable',async({page})=>{
  await page.goto(base+'/#/'+study+'/ensembles/ensemble.json');
  await expect(page.getByRole('alert').filter({hasText:reason})).toBeVisible();
  await expect(page.getByRole('region',{name:'三维分子结构'})).toHaveCount(0);
  expect(await page.locator('body').textContent()).not.toContain('OUTSIDE_STUDY_SENTINEL');
  await healthyResults(page,study);
 });
}
test('another-log report explains mismatch while vibration remains usable',async({page})=>{
 await page.goto(base+'/#/report-other-log/anti');await decode(page);
 await expect(page.getByText('报告来自另一份 log，不自动带出',{exact:true})).toBeVisible();
 await expect(page.getByTestId('pair-1-2')).toHaveCount(0);
 await expect(page.getByRole('table',{name:'报告距离对照'})).toHaveCount(0);
 await page.getByRole('button',{name:'继续播放',exact:true}).click();
 await expect(page.getByTestId('vibration-controls')).toContainText('播放中');
 await healthyResults(page,'report-other-log');
});
test('truncated log explains unavailable displacement but retains raw log and structure',async({page})=>{
 await page.goto(base+'/#/log-truncated/anti');
 await page.getByRole('button',{name:'解析振动位移'}).click();
 await expect(page.getByRole('status').filter({hasText:'No unambiguous supported Gaussian Cartesian vibration table'})).toBeVisible();
 await expect(page.getByLabel('振动模式',{exact:true})).toHaveCount(0);
 await expect(page.getByTestId('raw-log')).toContainText('Harmonic frequencies');
 await expect(page.getByRole('region',{name:'三维分子结构'})).toContainText('3 / 3 原子');
 await healthyResults(page,'log-truncated');
});
test('T51 monitor snapshot displays running, queued and committed cap',async({page})=>{
 await page.goto(base+'/#server');
 await expect(page.getByRole('region',{name:'集群 fresh',exact:true})).toContainText('运行 8 · 排队 16 · 总上限 88');
});
for(const [name,reason] of [['expired','数据已过期'],['failed','采样失败：Synthetic sampling failure']]){
 test(name+' monitor labels retained values as noncurrent',async({page})=>{
  await page.goto(base+'/#server');
  const cluster=page.getByRole('region',{name:'集群 '+name,exact:true});
  await expect(cluster).toContainText(reason);await expect(cluster).toContainText('本人占用核数 · 非最新');
  await expect(cluster).toContainText('运行 8 · 排队 16 · 总上限 88');
  await expect(page.getByRole('region',{name:'集群 fresh',exact:true})).not.toContainText('非最新');
  await healthyResults(page,'butane-demo');
 });
}
test('action-mode fake fetch displays T52 facts and exit status',async({page})=>{
 await page.goto(actions+'/#/butane-demo/anti');
 await page.getByRole('button',{name:'取回结果',exact:true}).click();
 await expect(page.getByRole('region',{name:'ag 输出'})).toContainText('退出码：0');
 const stdout=JSON.parse(await page.getByTestId('ag-stdout').innerText());
 expect(stdout).toMatchObject({attempt_id:'anti',state:'fetched',facts:{status:'written'}});
 await expect(page.getByRole('region',{name:'三维分子结构'})).toBeVisible();
});
