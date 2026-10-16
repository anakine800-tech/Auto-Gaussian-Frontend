import {test,expect} from '@playwright/test';
import type {Page} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import {build} from 'vite';

const python=resolve(process.env.AUTOG_SOURCE_PYTHON??'../.venv/bin/python');
const fixture=JSON.parse(execFileSync(python,['-B','-m','tests.test_mode_reports','--browser-data'],{cwd:resolve('..'),encoding:'utf8'}));
const packet=fixture.packet,report=fixture.report;
const entry=(name='check.json',r=report,matches=true)=>({name,report:r,log_matches:matches});
const result=(reports:any[]=[],issues:any[]=[])=>({log_sha256:packet.log_sha256,reports,issues});
async function open(page:Page,reports:any[]=[],issues:any[]=[]){
 await page.route('**/vibrations/*',route=>route.fulfill({json:packet}));
 await page.route('**/mode-reports/*',route=>route.fulfill({json:result(reports,issues)}));
 await page.goto('/#/butane-demo/anti');await decode(page);
}
async function decode(page:Page){
 await page.getByRole('button',{name:'解析振动位移'}).click();
 await page.getByLabel('振动模式',{exact:true}).selectOption('0');
 await page.getByRole('button',{name:'回到参考结构',exact:true}).click();
}
async function pick(page:Page,a:number,b:number){
 for(const n of [a,b])await page.locator(`[data-testid="molecule-atom"][data-center="${n}"]`).click();
}

test('atom picks, independently calculated distances, multiple pairs, deletion and URL restore',async({page})=>{
 await open(page);await pick(page,1,2);await pick(page,1,3);
 const row=page.getByTestId('pair-1-2');
 await expect(row.locator('td').first()).toHaveText(report.pairs[0].distance.toFixed(3));
 for(const [i,key] of ['plus_distance','minus_distance','plus_change','minus_change'].entries())await expect(row.locator('td').nth(i+1)).toHaveText(report.pairs[0][key].toFixed(3));
 await expect(page.getByTestId('pair-1-3')).toContainText(report.pairs[1].plus_distance.toFixed(3));
 expect(new URL(page.url()).searchParams.get('modePairs')).toBe('1-2,1-3');
 await page.getByRole('button',{name:'删除原子对 1-2'}).click();await expect(row).toHaveCount(0);
 await page.reload();await decode(page);await expect(page.getByTestId('pair-1-3')).toBeVisible();await expect(row).toHaveCount(0);
 await expect(page.getByTestId('current-1-3')).toHaveCount(0);
 await expect(page.getByLabel('振动显示幅度')).toHaveValue('0.45');
});

test('review frames update, normalized amplitude and legacy animation stay separate',async({page})=>{
 await open(page);await pick(page,1,2);
 await page.getByLabel('振动显示幅度').fill('0.65');
 await page.getByLabel('启用审阅模式').check();
 await expect(page.getByTestId('current-1-2')).toHaveText('4.000');
 await expect(page.getByTestId('vibration-controls')).toContainText('最大原子位移 = 归一化振幅');
 await page.getByRole('button',{name:'继续播放',exact:true}).click();
 await expect(page.getByTestId('current-1-2')).not.toHaveText('4.000');
 await page.getByRole('button',{name:'回到参考结构',exact:true}).click();
 await expect(page.getByTestId('current-1-2')).toHaveText('4.000');
 await page.getByLabel('归一化振幅',{exact:true}).fill('0.4');
 await expect(page.getByTestId('pair-1-2').locator('td').nth(1)).toHaveText('3.300');
 await page.getByLabel('启用审阅模式').uncheck();
 await expect(page.getByTestId('current-1-2')).toHaveCount(0);
 await expect(page.getByLabel('振动显示幅度')).toHaveValue('0.65');
 await expect(page.getByTestId('pair-1-2').locator('td').nth(1)).toHaveText('3.300');
});

test('matching report defaults, provenance, per-direction comparison and report amplitude',async({page},testInfo)=>{
 const r=structuredClone(report);r.amplitude=.4;r.pairs[0].plus_distance=3.3;r.pairs[0].minus_distance=4.7;r.pairs[1].plus_distance=Math.sqrt(9+.09);r.pairs[1].minus_distance=Math.sqrt(9+.09);
 await open(page,[entry('match.json',r)]);
 await expect(page.getByLabel('归一化振幅',{exact:true})).toHaveValue('0.4');
 await expect(page.getByTestId('pair-1-2')).toBeVisible();
 const comparison=page.getByRole('table',{name:'报告距离对照'});
 await expect(comparison.locator('tbody tr')).toHaveCount(4);
 await expect(comparison.getByRole('cell',{name:'一致',exact:true})).toHaveCount(4);
 await expect(page.getByRole('region',{name:'模式审阅面板'})).toContainText('Standard orientation');
 await page.getByText(packet.log_sha256.slice(0,12)+'（展开）',{exact:true}).click();
 await expect(page.getByText(packet.log_sha256,{exact:true})).toBeVisible();
 await page.getByLabel('归一化振幅',{exact:true}).fill('0.5');await expect(comparison).toHaveCount(0);
 await page.getByRole('button',{name:'使用报告振幅进行对照'}).click();await expect(comparison).toBeVisible();
 await page.getByRole('region',{name:'模式审阅面板'}).screenshot({path:testInfo.outputPath('mode-review-panel.png')});
});

test('multiple reports require selection; discrepancies are labeled individually',async({page})=>{
 const bad=structuredClone(report);bad.pairs[0].plus_distance+=.002;bad.pairs[0].minus_distance+=.0005;
 await open(page,[entry('a.json'),entry('b.json',bad)]);
 await expect(page.getByTestId('pair-1-2')).toHaveCount(0);
 await page.getByLabel('mode-review 报告',{exact:true}).selectOption('b.json');
 const table=page.getByRole('table',{name:'报告距离对照'});
 await expect(table.getByRole('cell',{name:'不一致',exact:true})).toHaveCount(1);
 await expect(table.getByRole('cell',{name:'一致',exact:true})).toHaveCount(3);
 await page.getByLabel('mode-review 报告',{exact:true}).selectOption('a.json');
 await expect(table.getByRole('cell',{name:'一致',exact:true})).toHaveCount(4);
});

test('another log or stale response never populates pairs; invalid reports leave animation usable',async({page})=>{
 const stale=structuredClone(report);stale.source.log_sha256='0'.repeat(64);
 await open(page,[entry('stale.json',stale,false)],[{name:'invalid.json',error:'mode-review 报告不合规：pairs[0].atoms 编号越界'}]);
 await expect(page.getByText('报告来自另一份 log，不自动带出',{exact:true})).toBeVisible();
 await expect(page.getByTestId('pair-1-2')).toHaveCount(0);
 await expect(page.getByRole('region',{name:'模式审阅面板'})).toContainText('编号越界');
 await page.getByRole('button',{name:'继续播放',exact:true}).click();await expect(page.getByTestId('vibration-controls')).toContainText('播放中');
});

test('matching hash with another mode does not populate or compare pairs',async({page})=>{
 const other=structuredClone(report);other.source_mode_index=2;
 await open(page,[entry('other-mode.json',other)]);
 await expect(page.getByRole('status').filter({hasText:'报告对应另一模式'})).toBeVisible();
 await expect(page.getByTestId('pair-1-2')).toHaveCount(0);await expect(page.getByRole('table',{name:'报告距离对照'})).toHaveCount(0);
});

test('an explicitly emptied URL selection survives matching report defaults',async({page})=>{
 await open(page,[entry()]);await expect(page.getByTestId('pair-1-2')).toBeVisible();
 for(const p of ['1-2','1-3'])await page.getByRole('button',{name:`删除原子对 ${p}`}).click();
 await page.reload();await decode(page);await expect(page.getByLabel('mode-review 报告',{exact:true})).toHaveValue('check.json');
 await expect(page.getByRole('table',{name:'原子对距离'}).locator('tbody tr')).toHaveCount(0);
});

test('mobile review panel stays within viewport and uses only GET requests',async({page})=>{
 const writes:string[]=[];page.on('request',r=>{if(!['GET','HEAD'].includes(r.method()))writes.push(r.url());});
 await page.setViewportSize({width:390,height:844});await open(page,[entry()]);
 await expect(page.getByRole('table',{name:'报告距离对照'})).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);expect(writes).toEqual([]);
});

test('omitting all new viewer parameters preserves the original raw-amplitude animation',async({page})=>{
 const dir=await mkdtemp(join(tmpdir(),'t55-viewer-'));
 try{
  const source=join(dir,'entry.tsx');
  await writeFile(source,`import React from ${JSON.stringify(resolve('node_modules/react/index.js'))};
import {createRoot} from ${JSON.stringify(resolve('node_modules/react-dom/client.js'))};
import {MoleculeViewer} from ${JSON.stringify(resolve('src/molecule-viewer.tsx'))};
const p=${JSON.stringify(packet)};
createRoot(document.getElementById('root')).render(<><div id="omitted"><MoleculeViewer last={p.reference_geometry} vibration={p.modes[0]}/></div><div id="explicit"><MoleculeViewer last={p.reference_geometry} vibration={p.modes[0]} reviewMode={false} reviewAmplitude={.3} onAtomPick={undefined} onFrame={undefined}/></div></>);`);
  const bundle=await build({configFile:false,logLevel:'silent',define:{'process.env.NODE_ENV':JSON.stringify('production')},resolve:{alias:{'react/jsx-runtime':resolve('node_modules/react/jsx-runtime.js')}},build:{write:false,lib:{entry:source,name:'ModeHarness',formats:['iife']},minify:false}});
  const output=Array.isArray(bundle)?bundle[0].output:('output'in bundle?bundle.output:[]);
  const code=output.find(v=>v.type==='chunk');if(!code||code.type!=='chunk')throw Error('Missing harness bundle');
  await page.route('**/t55-harness',r=>r.fulfill({contentType:'text/html; charset=utf-8',body:'<meta charset="utf-8"><div id="root"></div><script src="/t55-harness.js"></script>'}));
  await page.route('**/t55-harness.js',r=>r.fulfill({contentType:'application/javascript; charset=utf-8',body:code.code}));
  await page.addInitScript(()=>{let id=0;const callbacks=new Map<number,FrameRequestCallback>();window.requestAnimationFrame=cb=>{callbacks.set(++id,cb);return id;};window.cancelAnimationFrame=id=>{callbacks.delete(id);};(window as any).step=(time:number)=>{const pending=[...callbacks.values()];callbacks.clear();for(const cb of pending)cb(time);};});
  await page.goto('/t55-harness');
  for(const id of ['omitted','explicit']){
   const region=page.locator('#'+id);await expect(region.getByLabel('振动显示幅度')).toHaveValue('0.45');
   await region.getByText('结构工具 · 显示 / 测量 / 视角',{exact:true}).click();await region.getByLabel('预设视角').selectOption('front');
  }
  await page.evaluate(()=>{(window as any).step(100);});await page.evaluate(()=>{(window as any).step(180);});
  const a=page.locator('#omitted [data-testid="molecule-atom"][data-center="1"]'),b=page.locator('#explicit [data-testid="molecule-atom"][data-center="1"]');
  await expect(a).toHaveAttribute('transform',await b.getAttribute('transform')??'');
  // Fixed front projection, .08 s tick cap, .6 cycles/s, RAW vector .6 × .45.
  const phase=Math.sin(.08*.6*2*Math.PI),scale=136/Math.sqrt((4-4/3)**2+1);
  const expectedX=300+(-4/3+.6*.45*phase)*scale;
  const transform=await a.getAttribute('transform');const x=Number(transform?.match(/translate\(([^ ]+)/)?.[1]);
  expect(x).toBeCloseTo(expectedX,8);
 }finally{await rm(dir,{recursive:true,force:true});}
});


test('changing modes preserves raw amplitude and camera while isolating pair selections',async({page})=>{
 await page.goto('/#/butane-demo/anti');await decode(page);
 await page.getByLabel('振动显示幅度').fill('0.65');
 await page.getByText('结构工具 · 显示 / 测量 / 视角',{exact:true}).click();
 await page.getByLabel('预设视角').selectOption('front');await page.getByRole('button',{name:'放大结构',exact:true}).click();
 const atom=page.locator('[data-testid="molecule-atom"][data-center="1"]');
 const before=await atom.getAttribute('transform');await pick(page,1,2);
 await page.getByLabel('振动模式',{exact:true}).selectOption('1');await page.getByRole('button',{name:'回到参考结构',exact:true}).click();
 await expect(page.getByLabel('振动显示幅度')).toHaveValue('0.65');await expect(atom).toHaveAttribute('transform',before!);
 await expect(page.getByTestId('pair-1-2')).toHaveCount(0);
 await page.getByLabel('振动模式',{exact:true}).selectOption('0');await expect(page.getByTestId('pair-1-2')).toBeVisible();
});

test('current review distance equals independent frame arithmetic',async({page})=>{
 await page.addInitScript(()=>{let id=0;const callbacks=new Map<number,FrameRequestCallback>();window.requestAnimationFrame=cb=>{callbacks.set(++id,cb);return id;};window.cancelAnimationFrame=id=>{callbacks.delete(id);};(window as any).step=(time:number)=>{const pending=[...callbacks.values()];callbacks.clear();for(const cb of pending)cb(time);};});
 await open(page);await pick(page,1,2);await page.getByLabel('启用审阅模式').check();
 await page.getByRole('button',{name:'继续播放',exact:true}).click();
 await page.evaluate(()=>{(window as any).step(100);});await page.evaluate(()=>{(window as any).step(180);});
 const expected=4-1.4*Math.sin(.08*.6*2*Math.PI)*.3/.8;
 await expect(page.getByTestId('current-1-2')).toHaveText(expected.toFixed(3));
});


test('the 0.001 angstrom boundary tolerates floating point subtraction only',async({page})=>{
 const boundary=structuredClone(report);boundary.pairs[0].minus_distance=4.526;
 const outside=structuredClone(boundary);outside.pairs[0].minus_distance=4.52601;
 await open(page,[entry('boundary.json',boundary),entry('outside.json',outside)]);
 await page.getByLabel('mode-review 报告',{exact:true}).selectOption('boundary.json');
 const table=page.getByRole('table',{name:'报告距离对照'});
 await expect(table.getByRole('cell',{name:'一致',exact:true})).toHaveCount(4);
 await page.getByLabel('mode-review 报告',{exact:true}).selectOption('outside.json');
 await expect(table.getByRole('cell',{name:'不一致',exact:true})).toHaveCount(1);
});
