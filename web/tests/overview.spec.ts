import {test,expect} from '@playwright/test';
import type {Locator,Page} from '@playwright/test';

async function fullyVisible(locator:Locator,page:Page){
 await expect(locator).toBeVisible();const box=(await locator.boundingBox())!,size=page.viewportSize()!;
 expect(box.x).toBeGreaterThanOrEqual(0);expect(box.y).toBeGreaterThanOrEqual(0);
 expect(box.x+box.width).toBeLessThanOrEqual(size.width);expect(box.y+box.height).toBeLessThanOrEqual(size.height);
}
for(const size of [{width:1440,height:860},{width:1280,height:720}])test(`T95 first-screen overview and table ${size.width}x${size.height}`,async({page},info)=>{
 await page.setViewportSize(size);
 const writes:string[]=[],errors:string[]=[];page.on('request',r=>{if(!['GET','HEAD'].includes(r.method()))writes.push(r.url());});page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/#/s/butane-demo');
 await expect(page.getByRole('article',{name:'待审',exact:true}).locator('.kpi-value')).toHaveText('2');
 await expect(page.getByRole('article',{name:'待签',exact:true}).locator('.kpi-value')).toContainText('2');
 await fullyVisible(page.locator('.overview-kpis'),page);
 for(const title of ['要处理的事','关键结果'])await fullyVisible(page.getByRole('heading',{name:title,exact:true}),page);
 for(const title of ['研究说明','进度日志'])await expect(page.locator('details').filter({has:page.locator('summary').filter({hasText:new RegExp('^'+title+'$')})})).not.toHaveAttribute('open');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(size.width);
 await page.screenshot({path:info.outputPath(`overview-${size.width}x${size.height}.png`)});
 await page.getByRole('button',{name:'Attempts',exact:true}).click();
 const table=page.getByRole('table',{name:'Attempt 结果表'});
 await fullyVisible(table.locator('thead'),page);await expect(table.locator('th')).toHaveCount(10);
 await expect(table.locator('tbody tr').first()).toContainText('xtb-prepared');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(size.width);
 await page.screenshot({path:info.outputPath(`attempts-${size.width}x${size.height}.png`)});
 await page.getByText('显示列',{exact:true}).click();
 for(const label of ['集群','核数','用时','父 Attempt','提交时间'])await page.getByRole('checkbox',{name:label,exact:true}).check();
 await expect(table.locator('th')).toHaveCount(15);
 await expect(table.locator('tbody tr').filter({hasText:'opt-demo'})).toContainText('00:03:12');
 await expect(table.locator('tbody tr').filter({hasText:'opt-demo'}).locator('td').last()).toHaveText('—');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(size.width);
 expect(writes).toEqual([]);expect(errors).toEqual([]);
});

test('KPI rules use explicit saved state, facts and review availability',async({page,request})=>{
 const data=await (await request.get('/api/studies/butane-demo')).json();
 const find=(id:string)=>data.attempts.find((a:{id:string})=>a.id===id);
 find('anti').state='running';find('gauche').review_state='empty';find('opt-demo').review_state='unreadable';
 find('opt-failed').facts={data:null,error:'Malformed synthetic facts'};
 await page.route('**/api/studies/butane-demo',r=>r.fulfill({json:data}));
 await page.goto('/#/s/butane-demo');
 for(const [label,count] of [['在跑','1'],['待审','1'],['待签','2']])await expect(page.getByRole('article',{name:label,exact:true}).locator('.kpi-value')).toContainText(count);
 await page.getByRole('article',{name:'待审',exact:true}).getByRole('link').click();
 await expect(page.getByRole('table',{name:'Attempt 结果表'}).locator('tbody tr')).toHaveCount(1);
 await expect(page.getByRole('table',{name:'Attempt 结果表'})).toContainText('gauche');
 await page.getByRole('button',{name:'重置',exact:true}).click();
 await expect(page.getByRole('table',{name:'Attempt 结果表'}).locator('tbody tr')).toHaveCount(data.attempts.length);
});

test('missing and empty template sections are explicit, source drawer is readonly',async({page,request})=>{
 const data=await (await request.get('/api/studies/butane-demo')).json();
 for(const present of [false,true]){
  for(const title of ['当前阻塞','待你决定','里程碑签字'])data.sections[title]={present,text:'',entries:[]};
  await page.route('**/api/studies/butane-demo',r=>r.fulfill({json:data}));
  await page.goto('/?case='+present+'#/s/butane-demo');
  const work=page.getByRole('region',{name:'要处理的事'});
  await expect(work).toContainText(present?'此节暂无条目':'study.md 中没有此节');
  await work.getByRole('button',{name:'当前阻塞 ↗',exact:true}).click();
  await expect(page.getByRole('dialog')).toContainText(present?'此节暂无内容':'study.md 中没有此节');
  await page.getByRole('button',{name:'关闭抽屉'}).click();await page.unroute('**/api/studies/butane-demo');
 }
 await page.goto('/#/s/butane-demo');
 await page.getByRole('button',{name:'科学审阅：合成数据不用于科学验收。 ↗',exact:true}).click();
 await expect(page.getByRole('dialog')).toContainText('第 6 行');
 await expect(page.getByRole('dialog')).toContainText('只读原文');
 await page.getByRole('button',{name:'关闭抽屉'}).click();
 await page.getByText('研究说明',{exact:true}).click();await expect(page.getByRole('heading',{name:'study.md',exact:true})).toBeVisible();
 await page.reload();await expect(page.getByRole('heading',{name:'study.md',exact:true})).toBeVisible();
});

test('reports sort by local file update, open the same report and do not invent conclusions',async({page})=>{
 await page.goto('/#/s/butane-demo');
 const panel=page.getByRole('region',{name:'关键结果'});
 await expect(panel.locator('li').first()).toContainText('thermo-demo.json');
 await expect(panel.locator('li').first().locator('time')).toHaveAttribute('datetime','2026-01-02T02:00:00+00:00');
 await panel.getByRole('link',{name:'thermo-demo.json',exact:true}).click();
 await expect(page).toHaveURL(/\/analysis\/thermo\/thermo-demo.json$/);
 await expect(page.getByRole('table',{name:'热化学表'})).toContainText('50.000%');
 await page.getByRole('link',{name:'← 返回列表'}).click();await expect(panel).toBeVisible();
});

test('table filters and numeric sort survive shared URL, detail reload, return and browser back',async({page,request})=>{
 const data=await (await request.get('/api/studies/butane-demo')).json();
 const prototype=data.attempts.find((a:{id:string})=>a.id==='opt-demo');
 data.attempts.push(...Array.from({length:25},(_,i)=>({...prototype,id:'synthetic-'+String(i+1).padStart(3,'0'),label:'Synthetic long table',facts:{data:{energies:{scf:-100-i}},error:null}})));
 await page.route('**/api/studies/butane-demo',r=>r.fulfill({json:data}));
 await page.goto('/#/s/butane-demo/attempts?retained=1');
 await page.getByLabel('状态筛选').selectOption('fetched');await page.getByLabel('类型筛选').selectOption('gaussian');await page.getByRole('checkbox',{name:'需要我处理'}).check();
 const table=page.getByRole('table',{name:'Attempt 结果表'});
 await table.getByRole('button',{name:'电子能 / Eh',exact:false}).click();
 await expect(table.locator('tbody tr').first()).toContainText('opt-demo');
 await expect(table.locator('tbody tr')).toHaveCount(27);
 expect(page.url()).toContain('retained=1');expect(page.url()).toContain('status=fetched&type=gaussian&attention=1&sort=energy&order=asc');
 await page.reload();await expect(page.getByLabel('状态筛选')).toHaveValue('fetched');await expect(page.getByRole('checkbox',{name:'需要我处理'})).toBeChecked();
 await table.getByRole('link',{name:'opt-demo',exact:true}).scrollIntoViewIfNeeded();
 await page.evaluate(()=>scrollTo(0,200));await expect.poll(()=>page.evaluate(()=>scrollY)).toBe(200);
 const url=page.url(),y=await page.evaluate(()=>scrollY);expect(y).toBeGreaterThan(0);
 await table.getByRole('link',{name:'opt-demo',exact:true}).click();await expect(page.getByRole('heading',{name:'opt-demo',exact:true})).toBeVisible();
 await page.reload();await page.getByRole('link',{name:'← 返回列表'}).click();await expect(page).toHaveURL(url);
 await expect(page.getByLabel('类型筛选')).toHaveValue('gaussian');await expect(table.locator('tbody tr').first()).toContainText('opt-demo');
 await expect.poll(()=>page.evaluate(()=>scrollY)).toBeCloseTo(y,0);
 await table.getByRole('button',{name:'编号',exact:false}).click();await expect(page).toHaveURL(/sort=id&order=asc/);
 await page.goBack();await expect(page).toHaveURL(url);await expect(table.locator('thead th').nth(6)).toHaveAttribute('aria-sort','ascending');
});

test('unknown filters do not silently show unrelated rows, absent facts sort last',async({page})=>{
 await page.goto('/#/s/butane-demo/attempts?status=not-recorded');
 const table=page.getByRole('table',{name:'Attempt 结果表'});
 await expect(table.locator('tbody tr')).toHaveCount(0);await expect(page.getByText('暂无记录。',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'重置'}).click();await table.getByRole('button',{name:'电子能 / Eh',exact:false}).click();
 await expect(table.locator('tbody tr').first()).toContainText('opt-demo');
 await table.getByRole('button',{name:'电子能 / Eh',exact:false}).click();
 await expect(table.locator('tbody tr').first()).toContainText('opt-demo');await expect(table.locator('tbody tr').last().locator('td').nth(6)).toHaveText('—');
 await page.getByLabel('类型筛选').selectOption('xtb');await expect(table.locator('tbody tr')).toHaveCount(1);
 await expect(table).toContainText('xtb-prepared');
});

test('saved values retain their source and missing timestamps are not inferred',async({page,request})=>{
 const data=await (await request.get('/api/studies/butane-demo')).json();
 const a=data.attempts.find((a:{id:string})=>a.id==='xtb-prepared');
 a.facts={data:{total_energy:-12.345,termination:'normal'},error:null};
 a.manifest.data.created_at='2026-01-01T00:00:00Z';a.status.data.updated_at='2026-01-02T00:00:00Z';
 a.manifest.data.science={method_basis:'Synthetic saved method with a long basis description'};
 await page.route('**/api/studies/butane-demo',r=>r.fulfill({json:data}));
 await page.goto('/#/s/butane-demo/attempts?type=xtb');
 const row=page.getByRole('table',{name:'Attempt 结果表'}).locator('tbody tr');
 await expect(row.locator('td').nth(6)).toHaveText('-12.345000');await expect(row.locator('td').nth(9)).toHaveText('—');
 await expect(row.locator('.method-abbreviation[title]')).toHaveAttribute('title',a.manifest.data.science.method_basis);
 await page.getByText('显示列',{exact:true}).click();await page.getByRole('checkbox',{name:'提交时间',exact:true}).check();
 await expect(row.locator('td').last()).toHaveText('—');
 await page.goto('/#/s/ensemble-demo');
 await page.getByRole('region',{name:'关键结果'}).getByRole('link',{name:'ensemble.json',exact:true}).click();
 await expect(page).toHaveURL(/\/analysis\/ensemble\/ensemble.json$/);
 await expect(page.getByRole('table',{name:'构象能量表'})).toBeVisible();
});
