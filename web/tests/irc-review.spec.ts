import {test,expect} from '@playwright/test';
import {spawn} from 'node:child_process';
import type {ChildProcess} from 'node:child_process';
import {resolve} from 'node:path';

const base='http://127.0.0.1:18769';let server:ChildProcess;let errors='';
test.beforeAll(async({request})=>{
 server=spawn(resolve(process.env.AUTOG_SOURCE_PYTHON??'../.venv/bin/python'),['-B','-m','tests.irc_review_fixture'],{cwd:resolve('..'),stdio:['ignore','ignore','pipe']});
 server.stderr?.on('data',x=>errors+=String(x));server.on('error',e=>errors+=e.message);
 await expect.poll(async()=>{if(server.exitCode!==null)throw Error(errors);try{return (await request.get(base+'/api/studies')).status();}catch{return 0;}},{timeout:15000}).toBe(200);
});
test.afterAll(async()=>{if(server?.exitCode===null&&server.signalCode===null)await new Promise<void>(done=>{server.once('exit',()=>done());server.kill('SIGTERM');});});
test.beforeEach(async({page})=>{
 const writes:string[]=[],failures:string[]=[];
 page.on('request',r=>{if(!['GET','HEAD'].includes(r.method()))writes.push(r.url());});page.on('pageerror',e=>failures.push(e.message));
 await page.exposeFunction('ircTraffic',()=>({writes,failures}));
});
test.afterEach(async({page})=>{
 if(page.url().startsWith('http')){expect(await page.evaluate(()=>(window as any).ircTraffic())).toEqual({writes:[],failures:[]});expect(await page.locator('body').textContent()).not.toMatch(/已验证|通过验收/);}
});

test('saved curves, statuses, sources and neutral endpoint supplementation',async({page})=>{
 await page.goto(base+'/#/irc-demo');
 await page.getByRole('button',{name:'结果',exact:true}).click();
 await page.getByRole('region',{name:'IRC 报告列表'}).getByRole('link',{name:'review.json',exact:true}).click();
 const view=page.getByRole('region',{name:'IRC 查看页',exact:true});
 await expect(view).toContainText('仍需人工审阅 SCF/电子态连续性');
 await expect(page.getByTestId('forward-count')).toContainText('非零路径点 4 · 含 TS 点数 5 · XYZ 帧数 5');
 await expect(page.getByTestId('reverse-count')).toContainText('已核对 SHA-256');
 const energy=page.getByRole('region',{name:'能量曲线',exact:true});
 await expect(energy.getByTestId('irc-point')).toHaveCount(8);
 await expect(energy.getByTestId('irc-stop-marker')).toHaveCount(2);
 await expect(energy).toContainText('max_points');await expect(energy).toContainText('最后已接受点 2');
 for(const pair of ['1-2','1-3']){const chart=page.getByRole('region',{name:'键长曲线 '+pair,exact:true});await expect(chart.getByTestId('irc-point')).toHaveCount(8);await expect(chart.getByTestId('irc-reference')).toHaveCount(4);}
 const row=page.getByTestId('reverse-energy-drop');await expect(row).toContainText('met_by_endpoint_optimization');await expect(row).toContainText('实际降能：0.4 kcal/mol');await expect(row).toContainText('阈值：3 kcal/mol');
 await row.getByText('原始依据、文件与行号',{exact:true}).click();await expect(row.locator('pre')).toContainText('energy_lines');await expect(row.locator('pre')).toContainText('attempts/synthetic-reverse/outputs/water.log');
 await expect(page.getByRole('table',{name:'forward 判据表'})).toContainText('tool_checks_passed');
 await expect(page.getByRole('table',{name:'reverse 判据表'})).toContainText('n_imag：0');
 await expect(page.getByTestId('vibration-controls')).toHaveCount(0);
});

test('chart point selects actual frame, highlights atoms, restores URL and history',async({page})=>{
 await page.goto(base+'/#/irc-demo/irc-reviews/review.json?direction=forward&point=0');
 const energy=page.getByRole('region',{name:'能量曲线',exact:true});
 await energy.locator('circle[data-direction="reverse"][data-point="2"]').click();
 await expect(page).toHaveURL(base+'/#/s/irc-demo/results/irc/review.json?direction=reverse&point=2');
 await expect(page.getByTestId('irc-selected')).toHaveText('reverse 点 2 · XYZ 帧 2（从 0 开始）');
 const atom=page.locator('.irc-structure [data-testid="molecule-atom"][data-center="1"] circle');
 await expect(atom).toHaveCSS('stroke','rgb(189, 91, 17)');
 await page.getByLabel('IRC 高亮原子对').selectOption('1-3');
 await expect(page.locator('.irc-structure [data-testid="molecule-atom"][data-center="3"] circle')).toHaveCSS('stroke','rgb(189, 91, 17)');
 await page.getByRole('button',{name:'上一点',exact:true}).click();await expect(page.getByTestId('irc-selected')).toContainText('reverse 点 1 · XYZ 帧 1');
 await page.goBack();await expect(page.getByLabel('IRC 路径点')).toHaveValue('2');
 await page.reload();await expect(page.getByTestId('irc-selected')).toContainText('reverse 点 2');
 await expect(page.locator('.irc-structure [data-testid="molecule-atom"][data-center="2"] title')).toContainText('1.1, 0, 0');
});

test('missing energy breaks the curve and frame mapping does not assume point equals frame',async({page})=>{
 await page.goto(base+'/#/gaps/irc-reviews/review.json?direction=forward&point=1');
 await expect(page.getByText('此点缺少几何，未借用其他帧。',{exact:true})).toBeVisible();
 const curve=page.getByRole('region',{name:'能量曲线',exact:true}).locator('path[data-direction="forward"]');
 expect((await curve.getAttribute('d'))?.match(/M/g)).toHaveLength(2);
 await page.getByRole('button',{name:'下一点',exact:true}).click();
 await expect(page.getByTestId('irc-selected')).toContainText('forward 点 2 · XYZ 帧 1');
 await expect(page.locator('.irc-structure [data-testid="molecule-atom"][data-center="2"] title')).toContainText('1.1, 0, 0');
});

test('missing hashes remain explicit; corrupt report returns only an error',async({page})=>{
 await page.goto(base+'/#/unhashed/irc-reviews/review.json?direction=reverse&point=0');
 await expect(page.getByTestId('reverse-count')).toContainText('未核对哈希');
 await page.goto(base+'/#/invalid/irc-reviews/review.json');
 await expect(page.getByRole('alert').filter({hasText:'SHA-256 mismatch'})).toBeVisible();
 await expect(page.getByRole('region',{name:'IRC 查看页',exact:true})).toHaveCount(0);
 await expect(page.getByTestId('molecule-scene')).toHaveCount(0);
});

test('unknown URL point is explicit and mobile page keeps charts scrollable',async({page})=>{
 await page.setViewportSize({width:390,height:844});
 await page.goto(base+'/#/irc-demo/irc-reviews/review.json?direction=forward&point=999');
 await expect(page.getByText('URL 中的路径点不存在。',{exact:true})).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+2)).toBe(true);
 await page.getByLabel('IRC 路径点').selectOption('0');
 await expect(page.locator('.irc-structure').getByTestId('molecule-scene')).toBeVisible();
 await page.goto(base+'/#/irc-demo/irc-reviews/review.json?direction=wrong&point=-1');
 await expect(page.getByRole('alert').filter({hasText:'无法打开链接'})).toBeVisible();
});


test('incomplete direction preserves unresolved and unknown statuses',async({page})=>{
 await page.goto(base+'/#/incomplete/irc-reviews/review.json?direction=reverse&point=2');
 const side=page.getByRole('region',{name:'reverse 判据',exact:true});
 await expect(side).toContainText('IRC 未完成');await expect(side).toContainText('unresolved：continuity、energy_drop、endpoint');
 await expect(side).toContainText('not_met');await expect(side).toContainText('unknown');
 await expect(page.getByRole('region',{name:'能量曲线',exact:true})).toContainText('corrector_failed');
});

for(const size of [{width:1440,height:860},{width:1280,height:720}])test(`T98 IRC unified components ${size.width}x${size.height}`,async({page},info)=>{
 await page.setViewportSize(size);await page.goto(base+'/#/s/irc-demo/analysis/irc/review.json');
 const heading=page.getByRole('heading',{name:'IRC 查看 · review.json',exact:true});await expect(heading).toBeVisible();
 const bounds=(await heading.boundingBox())!;expect(bounds.y).toBeGreaterThanOrEqual(0);expect(bounds.y+bounds.height).toBeLessThanOrEqual(size.height);
 await expect(page.getByTestId('forward-count')).toBeVisible();await expect(page.getByTestId('reverse-count')).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(size.width);await page.screenshot({path:info.outputPath(`irc-${size.width}x${size.height}.png`)});
});

test('three final structures use facts, highlight tracked atoms and link to Attempts',async({page})=>{
 await page.goto(base+'/#/s/irc-demo/analysis/irc/review.json');
 for(const [role,attempt,energy,nImag,distance] of [
  ['reverse','endpoint-reverse','-76.234568','0','1.5000'],
  ['ts','synthetic-ts','-76.123457','1','1.2500'],
  ['forward','endpoint-forward','-76.345679','0','1.0000']]){
  const card=page.getByTestId(`irc-comparison-${role}`);
  await expect(card.getByTestId('molecule-scene')).toBeVisible();
  await expect(card.locator('dd')).toHaveText([energy,nImag]);
  await expect(card.locator('.irc-structure-distances li')).toHaveText([`1-2${distance}`,'1-31.0000']);
  await expect(card).toContainText('前端按最终几何计算');
  await expect(card.getByRole('link')).toHaveAttribute('href',`#/s/irc-demo/research/a/${attempt}`);
  for(const atom of [1,2,3])await expect(card.locator(`[data-center="${atom}"] circle`)).toHaveCSS('stroke','rgb(189, 91, 17)');
 }
 const reverse=page.getByTestId('irc-comparison-reverse'),ts=page.getByTestId('irc-comparison-ts');
 const reverseBefore=await reverse.getByTestId('molecule-atom').first().getAttribute('transform');
 const tsBefore=await ts.getByTestId('molecule-atom').first().getAttribute('transform');
 await ts.getByTestId('molecule-scene').press('ArrowRight');
 await expect(ts.getByTestId('molecule-atom').first()).not.toHaveAttribute('transform',tsBefore!);
 await expect(reverse.getByTestId('molecule-atom').first()).toHaveAttribute('transform',reverseBefore!);
 await ts.getByRole('link').click();await expect(page).toHaveURL(base+'/#/s/irc-demo/research/a/synthetic-ts');
 await page.goBack();await expect(page.getByTestId('irc-comparison-ts')).toContainText('-76.123457');
});

test('absent endpoint, corrupt source and missing facts stay explicit per card',async({page})=>{
 await page.goto(base+'/#/s/xyz-reference/analysis/irc/review.json');
 const reverse=page.getByTestId('irc-comparison-reverse');
 await expect(reverse).toContainText('报告未提供端点 Attempt');
 await expect(reverse.getByTestId('molecule-scene')).toHaveCount(0);await expect(reverse.getByRole('link')).toHaveCount(0);
 await page.goto(base+'/#/s/changed-endpoint/analysis/irc/review.json');
 const forward=page.getByTestId('irc-comparison-forward');await expect(forward.getByRole('alert')).toContainText('SHA-256 mismatch');
 await expect(forward.getByTestId('molecule-scene')).toHaveCount(0);
 await expect(page.getByTestId('irc-comparison-ts').getByTestId('molecule-scene')).toBeVisible();
 await expect(page.getByRole('region',{name:'能量曲线',exact:true}).getByTestId('irc-point')).toHaveCount(8);
 await page.goto(base+'/#/s/unknown-facts/analysis/irc/review.json');
 await expect(reverse.locator('dd')).toHaveText(['未知','未知']);await expect(reverse.getByTestId('molecule-scene')).toBeVisible();
});

for(const size of [{width:1440,height:860},{width:1280,height:720}])test(`T104 all three cards fit first screen ${size.width}x${size.height}`,async({page},info)=>{
 await page.setViewportSize(size);await page.goto(base+'/#/s/irc-demo/analysis/irc/review.json');
 const block=page.getByRole('region',{name:'TS 与端点结构比对',exact:true});await expect(block).toBeVisible();
 await expect.poll(()=>block.evaluate(el=>getComputedStyle(el).getPropertyValue('--irc-scene-height'))).toMatch(/^\d+px$/);
 const notice=block.getByRole('note');
 await expect(notice).toHaveText('工具只核对和汇总；仍需人工审阅 SCF/电子态连续性和逐点几何，以及端点化学身份。');
 await expect(page.getByRole('region',{name:'IRC 查看页',exact:true}).getByRole('note')).toHaveCount(1);
 await expect(notice).toBeInViewport({ratio:1});
 const noticeBox=(await notice.boundingBox())!,headingBox=(await block.getByRole('heading',{name:'TS 与端点结构比对',exact:true}).boundingBox())!;
 expect(noticeBox.y).toBeGreaterThanOrEqual(headingBox.y+headingBox.height);
 const boxes=await page.locator('.irc-structure-card').evaluateAll(cards=>cards.map(card=>{
  const r=card.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom};
 }));
 expect(boxes).toHaveLength(3);
 expect(noticeBox.y+noticeBox.height).toBeLessThanOrEqual(boxes[0].y);
 const shellBottom=await page.locator('.context-bar').evaluate(el=>el.getBoundingClientRect().bottom);
 for(const b of boxes){expect(b.y).toBeGreaterThanOrEqual(shellBottom);expect(b.bottom).toBeLessThanOrEqual(size.height);expect(b.right).toBeLessThanOrEqual(size.width);}
 expect(boxes[0].y).toBe(boxes[1].y);expect(boxes[1].y).toBe(boxes[2].y);
 expect(boxes[0].right).toBeLessThan(boxes[1].x);expect(boxes[1].right).toBeLessThan(boxes[2].x);
 expect(await page.evaluate(()=>window.scrollY)).toBe(0);
 for(const role of ['reverse','ts','forward']){
  const card=page.getByTestId(`irc-comparison-${role}`);await expect(card.getByTestId('molecule-scene')).toBeInViewport({ratio:1});
  await expect(card.getByRole('link')).toBeInViewport({ratio:1});
 }
 await page.screenshot({path:info.outputPath(`t104-structures-${size.width}x${size.height}.png`)});
});

for(const width of [1023,390])test(`T104 narrow cards stack at ${width}`,async({page})=>{
 await page.setViewportSize({width,height:844});await page.goto(base+'/#/s/irc-demo/analysis/irc/review.json');
 await expect(page.getByTestId('irc-comparison-forward')).toBeVisible();
 const boxes=await page.locator('.irc-structure-card').evaluateAll(cards=>cards.map(card=>{const r=card.getBoundingClientRect();return {x:r.x,y:r.y,bottom:r.bottom};}));
 expect(boxes[0].x).toBe(boxes[1].x);expect(boxes[1].x).toBe(boxes[2].x);
 expect(boxes[0].bottom).toBeLessThan(boxes[1].y);expect(boxes[1].bottom).toBeLessThan(boxes[2].y);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
});
