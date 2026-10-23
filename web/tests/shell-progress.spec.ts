import {test,expect} from '@playwright/test';
import {PROGRESS} from '../src/progress-definitions';

test('four entries and help, old links replace history without losing query',async({page})=>{
 for(const [legacy,target] of [
  ['#/jobs','#/servers'],['#server','#/servers'],['#/butane-demo','#/s/butane-demo/research/progress'],
  ['#/s/butane-demo','#/s/butane-demo/research/progress'],['#/s/butane-demo/attempts?status=running','#/s/butane-demo/research/attempts?status=running'],
  ['#/s/butane-demo/a/anti?fileKind=record&file=status.json','#/s/butane-demo/research/a/anti?fileKind=record&file=status.json'],
  ['#/s/butane-demo/analysis','#/s/butane-demo/results'],['#/s/butane-demo/files','#/s/butane-demo/evidence/library'],
 ]){
  await page.goto('/#/help');
  const before=await page.evaluate(()=>history.length);
  await page.evaluate(hash=>{history.replaceState(null,'',hash);location.reload();},legacy);
  await expect.poll(()=>new URL(page.url()).hash).toBe(target);
  expect(await page.evaluate(()=>history.length)).toBe(before);
 }
 for(const name of ['服务器','研究','结果','证据']){
  await page.getByRole('navigation',{name:'顶部导航'}).getByRole('button',{name,exact:true}).click();
  await expect(page.getByRole('navigation',{name:'顶部导航'}).getByRole('button',{name,exact:true})).toHaveAttribute('aria-current','page');
 }
 await page.getByRole('link',{name:'使用说明',exact:true}).click();
 await expect(page.getByRole('link',{name:'使用说明',exact:true})).toHaveAttribute('aria-current','page');
 for(const rule of [PROGRESS.running.detail,PROGRESS.fetch.detail,PROGRESS.review.detail,PROGRESS.sign.detail,PROGRESS.reviewFallback])await expect(page.locator('.help-page')).toContainText(rule);
});

test('T118 file viewer stays canonical across reload and legacy navigation',async({page})=>{
 const file='#/butane-demo/file/notes/'+encodeURIComponent('说明.txt')+'?source=report';
 await page.goto('/#/help');
 const before=await page.evaluate(()=>history.length);
 await page.evaluate(hash=>{history.replaceState(null,'',hash);location.reload();},file);
 await expect(page.locator('pre')).toHaveText('只读本地文件示例');
 expect(new URL(page.url()).hash).toBe(file);expect(await page.evaluate(()=>history.length)).toBe(before);
 await expect(page.getByRole('navigation',{name:'顶部导航'}).getByRole('button',{name:'证据',exact:true})).toHaveAttribute('aria-current','page');
 await page.reload();await expect(page.locator('pre')).toHaveText('只读本地文件示例');expect(new URL(page.url()).hash).toBe(file);
 await page.goto('/#/s/butane-demo/analysis/file/reading/overview.md');
 await expect(page).toHaveURL(/\/results\/file\/reading\/overview.md$/);
 await page.getByRole('article',{name:'报告正文'}).getByRole('link',{name:'普通文件',exact:true}).click();
 await expect(page.locator('pre')).toHaveText('只读本地文件示例');
 expect(new URL(page.url()).hash).toBe(file.split('?')[0]);
});

test('switcher groups, filter, recent order, keyboard and Escape restore focus',async({page})=>{
 await page.route('**/api/studies',r=>r.fulfill({json:{studies:[
  {id:'butane-demo',title:'Synthetic butane',type:'research'},
  {id:'ensemble-demo',title:'Synthetic ensemble',type:'research'},
  {id:'test-water',title:'Validation water',type:'test'},
 ],issues:[]}}));
 await page.goto('/#/s/ensemble-demo');
 const trigger=page.getByRole('button',{name:/Study ▾/});await trigger.click();
 const dialog=page.getByRole('dialog',{name:'切换 Study'});
 await expect(dialog.getByLabel('筛选 Study')).toBeFocused();
 await expect(dialog.getByRole('listbox',{name:'研究',exact:true}).getByRole('option').first()).toContainText('ensemble-demo');
 await expect(dialog.getByRole('option',{name:/Validation water/})).toHaveCount(0);
 await dialog.getByRole('button',{name:/验证与测试/}).click();
 await expect(dialog.getByRole('option',{name:/Validation water/})).toBeVisible();
 await dialog.getByLabel('筛选 Study').fill('butane');
 await dialog.getByLabel('筛选 Study').press('ArrowDown');await expect(dialog.getByRole('option')).toBeFocused();
 await page.keyboard.press('Enter');await expect(page).toHaveURL(/butane-demo\/research\/progress$/);
 await trigger.click();await page.keyboard.press('Escape');await expect(dialog).not.toBeVisible();await expect(trigger).toBeFocused();
 await page.reload();await trigger.click();await expect(dialog.getByRole('listbox',{name:'研究',exact:true}).getByRole('option').first()).toContainText('butane-demo');
});

test('search reaches unopened studies and incomplete results are explicit',async({page})=>{
 await page.goto('/#/help');
 await page.getByLabel('全局搜索').fill('representatives.xyz');
 const results=page.getByRole('region',{name:'搜索结果'});
 await expect(results.getByRole('link').first()).toContainText('representatives.xyz');
 await results.getByRole('link').first().click();await expect(page).toHaveURL(/evidence\/library\?file=analyses%2F(?:cluster-demo%2F)?representatives.xyz$/);
 await page.route('**/api/search?*',r=>r.fulfill({json:{groups:[],incomplete:true,truncated:false,message:'索引未完成：合成上限'}}));
 await page.getByLabel('全局搜索').fill('absent-synthetic');
 await expect(results).toContainText('索引未完成');await expect(results).toContainText('本机 study 中没有匹配的编号、标签或文件名');
});

test('catalog review counts and list agree, mismatch falls back with warning',async({page,request})=>{
 const data=await (await request.get('/api/studies/butane-demo')).json();
 data.catalog_review={available:true,attempts:['opt-demo'],warning:null};
 await page.route('**/api/studies/butane-demo',r=>r.fulfill({json:data}));
 await page.goto('/#/s/butane-demo');
 const kpi=page.getByRole('article',{name:'待审阅',exact:true});
 await expect(kpi.locator('.kpi-value')).toHaveText('1');await expect(kpi).toContainText(PROGRESS.review.detail);
 await kpi.getByRole('link').click();await expect(page.getByRole('table',{name:'Attempt 结果表'}).locator('tbody tr')).toHaveCount(1);
 await expect(page.getByRole('table',{name:'Attempt 结果表'})).toContainText('opt-demo');
 data.catalog_review={available:false,attempts:[],warning:'登记记录格式或日志哈希不一致，按没有登记处理'};
 await page.reload();await page.getByRole('button',{name:'进展',exact:true}).click();
 await expect(kpi.locator('.kpi-value')).toHaveText('2');await expect(kpi).toContainText(PROGRESS.reviewFallback);await expect(page.getByRole('status').filter({hasText:'哈希'})).toBeVisible();
});

test('five milestone states, source line, recent files collapsed and last three log entries',async({page,request})=>{
 const data=await (await request.get('/api/studies/butane-demo')).json();
 data.sections['里程碑签字']={present:true,text:'Synthetic source',entries:['recorded','pending','not_started','not_applicable','unknown'].map((state,i)=>({state,line:i+2,label:'Milestone '+i,text:'Original '+i}))};
 data.sections['进度日志']={present:true,text:'Synthetic log',entries:Array.from({length:5},(_,i)=>({line:20+i,text:'Log '+i}))};
 await page.route('**/api/studies/butane-demo',r=>r.fulfill({json:data}));await page.goto('/#/s/butane-demo');
 for(const label of ['已签','待签','未开始','不适用','无法识别'])await expect(page.locator('#milestones').getByText(label,{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'第 6 行原文：Original 4 ↗'}).click();await expect(page.getByRole('dialog')).toContainText('第 6 行');await page.getByRole('button',{name:'关闭抽屉'}).click();
 await expect(page.locator('details').filter({has:page.locator('summary').filter({hasText:'最近改动的文件'})})).not.toHaveAttribute('open');
 await page.locator('summary').filter({hasText:/^进度日志$/}).click();await expect(page.getByRole('button',{name:'Log 4 ↗'})).toBeVisible();await expect(page.getByRole('button',{name:'Log 0 ↗'})).not.toBeVisible();
 await page.getByRole('article',{name:'待签字',exact:true}).getByRole('button').click();await expect(page.locator('#milestones')).toContainText('仅待签');await expect(page.locator('#milestones').getByText('已签',{exact:true})).toHaveCount(0);
});

test('basket survives detail, reload, navigation, shared link and seventh-item rejection',async({page,context})=>{
 await page.goto('/#/s/butane-demo/attempts');
 const boxes=page.getByRole('table',{name:'Attempt 结果表'}).getByRole('checkbox');
 for(let i=0;i<6;i++)await boxes.nth(i).check();
 const selected=await boxes.nth(0).getAttribute('aria-label');
 await boxes.nth(6).click();await expect(boxes.nth(6)).not.toBeChecked();await expect(page.getByRole('complementary',{name:'比较篮'})).toContainText('最多 6 项');
 const url=page.url();await page.getByRole('table',{name:'Attempt 结果表'}).getByRole('link',{name:'anti',exact:true}).click();await expect(page).toHaveURL(/research\/a\/anti\?cmp=/);
 await page.reload();const removed=page.getByRole('complementary',{name:'比较篮'}).getByRole('button',{name:/^移除 /}).last();await removed.click();
 await page.getByRole('link',{name:'← 返回列表'}).click();await expect(page.getByRole('checkbox',{name:selected!,exact:true})).toBeChecked();
 await expect(page.getByRole('table',{name:'Attempt 结果表'}).locator('input:checked')).toHaveCount(5);
 await page.getByRole('button',{name:'结果',exact:true}).click();await expect(page.getByRole('complementary',{name:'比较篮'})).toContainText('5 / 6');
 const other=await context.newPage();await other.goto(url);await expect(other.getByRole('table',{name:'Attempt 结果表'}).locator('input:checked')).toHaveCount(6);
 await other.goto('/#/s/butane-demo/attempts?cmp=anti,gauche');await expect(other.getByRole('table',{name:'Attempt 结果表'}).locator('input:checked')).toHaveCount(2);
 await other.getByRole('complementary',{name:'比较篮'}).getByRole('button',{name:'打开比较',exact:true}).click();
 await expect(other.getByRole('heading',{name:'比较（前端现场计算，非正式结果）'})).toBeVisible();
 await expect(other.getByRole('region',{name:'任意结构对比'})).toBeVisible();await other.close();
});

for(const size of [{width:1440,height:860},{width:1280,height:720},{width:390,height:844}])test(`synthetic shell screenshots ${size.width}`,async({page},info)=>{
 await page.setViewportSize(size);await page.goto('/#/s/butane-demo');await expect(page.getByRole('heading',{name:'还缺什么',exact:true})).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(size.width);
 await page.screenshot({path:info.outputPath(`progress-${size.width}.png`)});
 await page.getByRole('button',{name:/Study ▾/}).click();await expect(page.getByRole('dialog',{name:'切换 Study'})).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(size.width);
 await page.screenshot({path:info.outputPath(`switcher-${size.width}.png`)});
});
