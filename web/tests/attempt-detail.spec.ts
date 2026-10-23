import {test,expect} from '@playwright/test';
import {openSection} from './disclosure';
for(const [width,height] of [[1440,860],[1280,720]])for(const id of ['anti','prepared'])test(`T96 first screen ${id} ${width}x${height}`,async({page},info)=>{
 await page.setViewportSize({width,height});await page.goto('http://localhost:18766/#/s/butane-demo/a/'+id);
 await expect(page.getByRole('group',{name:'Attempt 操作',exact:true})).toBeVisible();await expect(page.getByTestId('molecule-scene').first()).toBeVisible();
 await page.screenshot({path:info.outputPath(`t96-${id}-${width}x${height}.png`)});
 console.log('T96 layout',width,height,id,await page.evaluate(()=>['.app-header','.context-bar','.section-nav','.attempt-heading','.attempt-actions','.attempt-facts','.attempt-structure','.molecule-stage svg'].map(selector=>{const b=document.querySelector(selector)!.getBoundingClientRect();return {selector,top:b.top,height:b.height,bottom:b.bottom};})));
 for(const name of ['关键事实','三维结构']){const panel=page.getByRole('region',{name,exact:true});await expect(panel).toBeVisible();const box=await panel.boundingBox();expect(box!.y).toBeGreaterThanOrEqual(85);expect(box!.x).toBeGreaterThanOrEqual(0);expect(box!.x+box!.width).toBeLessThanOrEqual(width);expect(box!.y+box!.height,name).toBeLessThanOrEqual(height);}
 const scene=await page.getByTestId('molecule-scene').first().boundingBox();expect(scene!.height).toBeGreaterThanOrEqual(190);const tools=await page.locator('.attempt-structure .structure-tools > summary').boundingBox();expect(tools!.y+tools!.height).toBeLessThanOrEqual(height);
 const caption=await page.locator('.attempt-structure .scene-caption').boundingBox(),hint=await page.locator('.attempt-structure .model-hint').boundingBox(),tray=await page.getByRole('complementary',{name:'比较篮',exact:true}).boundingBox();expect(caption!.y+caption!.height).toBeLessThanOrEqual(hint!.y);expect(tools!.y+tools!.height).toBeLessThanOrEqual(tray!.y);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);await page.screenshot({path:info.outputPath(`t96-${id}-${width}x${height}.png`)});
});
test('facts locate lines, missing states and snapshots are explicit and readonly',async({page})=>{
 const writes:string[]=[];page.on('request',r=>{if(!['GET','HEAD'].includes(r.method()))writes.push(r.url());});
 await page.goto('/#/s/butane-demo/a/opt-demo');await page.getByRole('button',{name:'定位电子能 / Eh来源',exact:true}).click();await expect(page.locator('.log-match')).toContainText('-157.00250000');await expect(page.locator('#attempt-logs')).toContainText('未记录来源区间');
 await page.goto('/#/s/butane-demo/a/waiting');await expect(page.getByRole('region',{name:'关键事实',exact:true})).toContainText('尚无可读 facts');await openSection(page,'日志搜索');await expect(page.locator('#attempt-logs')).toContainText('尚无 outputs 日志');
 await page.goto('/#/s/butane-demo/a/prepared');await page.getByRole('button',{name:'定位方法 / 基组 / 溶剂来源',exact:true}).click();await expect(page.getByRole('region',{name:'输入参数',exact:true})).toBeVisible();
 await page.goto('/#/s/butane-demo/a/anti');await openSection(page,'快照 · 运行中快照，不是结果');const table=page.getByRole('table',{name:'本地快照摘要'});await expect(table).toContainText('synthetic-capture');await expect(table).toContainText('128');expect(await page.locator('body').textContent()).not.toContain('RAW_SNAPSHOT_LOG_SENTINEL');expect(writes).toEqual([]);
});
test('fact source range never jumps to another Link1 section',async({page})=>{
 await page.route('**/api/studies/butane-demo/attempts/opt-demo',async route=>{const response=await route.fetch();const data=await response.json();data.facts.data.fact_sources={'energies.scf':1};data.facts.data.job_sections=[{index:1,start_line:1,end_line:3}];await route.fulfill({json:data});});
 await page.goto('/#/s/butane-demo/a/opt-demo');await page.getByRole('button',{name:'定位电子能 / Eh来源',exact:true}).click();await expect(page.locator('#attempt-logs')).toContainText('记录的来源区间内没有匹配');await expect(page.locator('.log-match')).toHaveCount(0);
});
for(const state of ['prepared','submitting','submitted','running','finished','fetched','unknown','failed_presubmit'])test(`action availability ${state}`,async({page})=>{
 await page.route('**/api/actions/butane-demo/prepared',async route=>{const response=await route.fetch();const data=await response.json();data.state=state;data.can_cancel=['submitted','running'].includes(state);if(['unknown','failed_presubmit'].includes(state))data.source=null;await route.fulfill({json:data});});
 await page.goto('http://localhost:18766/#/s/butane-demo/a/prepared');const bar=page.getByRole('group',{name:'Attempt 操作',exact:true});await expect(bar).toBeVisible();
 await expect(bar.getByRole('button')).toHaveText(['刷新状态',...(state==='finished'?['取回结果']:[]),...(!['unknown','failed_presubmit'].includes(state)?['基于此新建']:[]),...(state==='prepared'?['提交']:[]),...(['submitted','running'].includes(state)?['取消计算']:[])]);
 if(['submitted','running'].includes(state)){await expect(bar.locator('.danger button')).toHaveText('取消计算');expect(await bar.locator('.danger button').evaluate(el=>getComputedStyle(el).color)).toBe('rgb(169, 60, 56)');}
});
test('numeric cells, measured sticky offset and metadata-only study response',async({page,request})=>{
 const metadata=await (await request.get('/api/studies/butane-demo')).json();expect(metadata.analyses.every((r:{data:unknown})=>r.data===null)).toBe(true);
 const bodies:string[]=[];page.on('request',r=>{if(r.url().includes('/reports/')||r.url().includes('/files/analyses/'))bodies.push(r.url());});await page.goto('/#/s/butane-demo');
 await page.getByText('最近改动的文件',{exact:true}).click();
 const link=page.getByRole('link',{name:'thermo-demo.json',exact:true});await expect(link).toHaveAttribute('href','#/s/butane-demo/results/thermo/thermo-demo.json');expect(bodies).toHaveLength(0);await link.click();await expect(page.getByRole('table',{name:'热化学表'})).toContainText('50.000%');expect(bodies.filter(url=>new URL(url).pathname.endsWith('/files/analyses/thermo-demo.json'))).toHaveLength(1);
 await page.goto('/#/s/butane-demo/attempts');const table=page.getByRole('table',{name:'Attempt 结果表'}),row=table.locator('tbody tr').filter({has:page.getByRole('link',{name:'opt-demo',exact:true})});await expect(row.locator('td.numeric').first()).toHaveText('-157.002500');await expect(row.locator('[title="-157.0025"]')).toBeVisible();expect(await row.locator('td.numeric').first().evaluate(el=>getComputedStyle(el).textAlign)).toBe('right');
 const offset=await table.locator('th').first().evaluate(el=>parseFloat(getComputedStyle(el).top)),actual=await page.evaluate(()=>document.querySelector('.app-header')!.getBoundingClientRect().height+document.querySelector('.context-bar')!.getBoundingClientRect().height);expect(offset).toBeCloseTo(actual,1);
});
