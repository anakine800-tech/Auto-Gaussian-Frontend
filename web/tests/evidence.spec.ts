import {test,expect} from '@playwright/test';
import type {Page} from '@playwright/test';
async function setup(page:Page){
 await page.route('**/api/studies/butane-demo/evidence',r=>r.fulfill({json:{truncated:false,issues:[],catalog:{state:null,journal_ok:false,warning:null},files:[
  {path:'analyses/summary.md',type:'report',size_bytes:50,updated_at:'2026-10-24T00:00:00Z',attempts:['anti'],objects:[],referenced_by:[{kind:'adoption',object:'water-a',role:'sp'}]},
  {path:'analyses/data.csv',type:'table',size_bytes:10,updated_at:'2026-10-24T00:00:00Z',attempts:['gauche'],objects:[],referenced_by:[{kind:'markdown',path:'analyses/summary.md'}]},
  {path:'attempts/anti/review.md',type:'review',size_bytes:10,updated_at:'2026-10-24T00:00:00Z',attempts:['anti'],objects:[],referenced_by:[]},
 ]}}));
 await page.route('**/files/analyses/summary.md?*',r=>r.fulfill({json:{data:'# Synthetic report\n[Data](data.csv)',error:null}}));
 await page.route('**/files/analyses/data.csv?*',r=>r.fulfill({json:{data:'value\n1\n',error:null}}));
}
for(const [width,height] of [[1440,900],[1280,800],[390,844]])test(`file facets, unique rows, references and preview ${width}`,async({page},info)=>{
 await setup(page);await page.setViewportSize({width,height});await page.goto('/#/s/butane-demo/evidence/library');
 const table=page.getByRole('table',{name:'证据文件列表'});await expect(table.getByRole('row')).toHaveCount(4);
 await expect(page.getByRole('complementary',{name:'文件类型'})).toContainText('报告（1）');
 await page.getByRole('button',{name:'表格（1）',exact:true}).click();await expect(table.getByRole('row')).toHaveCount(2);
 await table.getByRole('button',{name:'analyses/data.csv',exact:true}).click();await expect(page.getByRole('complementary',{name:'文件预览'})).toContainText('value');
 await table.getByRole('button',{name:'analyses/summary.md',exact:true}).click();await expect(page.getByRole('complementary',{name:'文件预览'})).toContainText('Synthetic report');
 await page.getByRole('button',{name:'全部（3）',exact:true}).click();await page.getByLabel('关联对象或 Attempt').selectOption('attempt:anti');await expect(table.getByRole('row')).toHaveCount(3);
 await expect(table).toContainText('采用 SP');expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
 await page.screenshot({path:info.outputPath(`t122-evidence-${width}.png`),fullPage:true});
});
test('lineage displays one connected object with branches, review colors and Attempt navigation',async({page,request},info)=>{
 const data=await (await request.get('/api/studies/butane-demo')).json();data.attempts=data.attempts.filter((a:any)=>['anti','gauche','prepared','waiting'].includes(a.id));
 data.graph={nodes:[],edges:[{parent:'anti',child:'gauche',relation:'geometry'},{parent:'anti',child:'prepared',relation:'geometry'}]};
 data.attempts.forEach((a:any)=>{a.facts={error:null,data:{multiplicity:a.id==='prepared'?3:1}};a.review_state=a.id==='anti'?'present':'missing';});
 await setup(page);await page.route('**/api/studies/butane-demo',r=>r.fulfill({json:data}));await page.goto('/#/s/butane-demo/evidence/lineage');
 await expect(page.locator('.lineage-node')).toHaveCount(3);await expect(page.locator('.lineage-row')).toHaveCount(2);await expect(page.locator('.lineage-node.review-present')).toHaveCount(1);
 await expect(page.locator('.lineage-view')).not.toContainText('waiting ·');await expect(page.locator('.lineage-row').nth(1)).toContainText('anti → geometry');
 await page.screenshot({path:info.outputPath('t122-lineage-1440.png'),fullPage:true});
 await page.locator('.lineage-node').filter({hasText:'prepared'}).click();await expect(page).toHaveURL(/research\/a\/prepared/);
});
test('legacy evidence routes replace history, keep file identity and reject traversal',async({page})=>{
 for(const [old,ending] of [
  ['#/s/butane-demo/files/graph','/evidence/lineage'],['#/butane-demo?tab=graph','/evidence/lineage?tab=graph'],
  ['#/s/butane-demo/files/structures','/evidence/library'],['#/s/butane-demo/files/analyses/thermo-demo.json','/evidence/library?file=analyses%2Fthermo-demo.json'],
  ['#/s/butane-demo/files/document','/evidence/document'],
 ]){
  await page.goto('/#/help');const before=await page.evaluate(()=>history.length);await page.evaluate(hash=>{location.hash=hash;},old);
  await expect.poll(()=>new URL(page.url()).hash).toBe('#/s/butane-demo'+ending);
  expect(await page.evaluate(()=>history.length)).toBe(before+1);
 }
 await page.goto('/#/s/butane-demo/evidence/library?file=..%2Foutside.txt');await expect(page.getByRole('alert')).toContainText('路径格式不正确');
});
test('server legend matches resource fills',async({page})=>{
 await page.goto('/#/servers');await expect(page.getByLabel('资源颜色图例')).toHaveText('深色 = 本人浅色 = 他人空白 = 空闲斜纹 = 未知');
 await expect(page.locator('.legend-mine')).toHaveCSS('background-color','rgb(20, 102, 107)');await expect(page.locator('.legend-others')).toHaveCSS('background-color','rgb(154, 191, 189)');
 const same=await page.evaluate(()=>getComputedStyle(document.querySelector('.legend-unknown')!).backgroundImage===getComputedStyle(document.querySelector('.resource-unknown')!).backgroundImage);expect(same).toBe(true);
});
