import {test,expect} from '@playwright/test';

test('old entry routes and tabs resolve to the same files',async({page})=>{
 for(const [old,canonical,heading] of [
  ['#server','#/jobs','服务器监控'],
  ['#/butane-demo','#/s/butane-demo','结果总览'],
  ['#/butane-demo?tab=overview','#/s/butane-demo/files/document?tab=overview','study.md'],
  ['#/butane-demo?tab=graph','#/s/butane-demo/files/graph?tab=graph','Attempt 关系图'],
  ['#/butane-demo?tab=attempts','#/s/butane-demo/attempts?tab=attempts','anti'],
  ['#/butane-demo?tab=analyses','#/s/butane-demo/analysis?tab=analyses','分析报告'],
  ['#/butane-demo/analyses/thermo-demo.json','#/s/butane-demo/analysis/file/thermo-demo.json','thermo-demo.json'],
  ['#/s/butane-demo/files/analyses/thermo-demo.json','#/s/butane-demo/files/analyses/thermo-demo.json','thermo-demo.json'],
 ]){
  await page.goto('/'+old);await expect.poll(()=>new URL(page.url()).hash).toBe(canonical);
  await expect(page.getByRole('heading',{name:heading,exact:true})).toBeVisible();
 }
 await page.goto('/?tab=structures&keep=1#/butane-demo');
 await expect(page).toHaveURL(/\?tab=structures&keep=1#\/s\/butane-demo\/files\/structures$/);
 await expect(page.getByRole('heading',{name:'结构与构象文件',exact:true})).toBeVisible();
 await page.goto('/#/s/butane-demo/analysis/file/missing.json');await expect(page.getByRole('alert')).toContainText('missing.json');
});

test('cached input and log search selects an exact file without typing requests',async({page})=>{
 await page.goto('/#/s/butane-demo/a/anti');
 await expect(page.getByTestId('raw-log')).toBeVisible();await expect(page.getByTestId('input-text')).toBeVisible();
 const inputName=await page.getByRole('combobox',{name:'输入文件',exact:true}).inputValue();
 const logName=await page.getByLabel('输出日志',{exact:true}).inputValue();
 await page.getByRole('navigation',{name:'顶部导航'}).getByRole('button',{name:'Study',exact:true}).click();
 await expect(page.getByRole('heading',{name:'thermo-demo.json',exact:true})).toBeVisible();
 const requests:string[]=[];page.on('request',r=>requests.push(r.url()));
 for(const [name,kind,label] of [[inputName,'inputs','输入文件'],[logName,'logs','输出日志']]){
  requests.length=0;await page.getByRole('textbox',{name:'全局搜索'}).fill(name);
  const results=page.getByRole('region',{name:'搜索结果'});
  const hit=results.getByRole('link').filter({hasText:`butane-demo / anti · ${kind}`});
  await expect(hit).toHaveCount(1);expect(requests).toEqual([]);await hit.click();
  await expect(page).toHaveURL(new RegExp(`fileKind=${kind}&file=`));await expect(page.getByRole('combobox',{name:label,exact:true})).toHaveValue(name);
  await expect(kind==='inputs'?page.getByTestId('input-text'):page.getByTestId('raw-log')).toBeVisible();
 }
 await page.getByRole('textbox',{name:'全局搜索'}).fill('status.json');
 await page.getByRole('region',{name:'搜索结果'}).getByRole('link').filter({hasText:'butane-demo / anti · record'}).click();
 await expect(page.locator('#record-status\\.json')).toBeVisible();
});

test('return link restores legacy filters, candidate, sort and reading position after reload',async({page,request})=>{
 const attempt=await (await request.get('/api/studies/butane-demo/attempts/anti')).json();
 await page.route('**/api/studies/descriptor-demo/attempts/source-demo',r=>r.fulfill({json:{...attempt,id:'source-demo',logs:[],input_files:[]}}));
 await page.route('**/api/studies/descriptor-demo/ensembles/ensemble.json',async route=>{const response=await route.fetch();const data=await response.json();data.manifest.routes.forEach((r:{attempts:string[]})=>r.attempts=['source-demo']);await route.fulfill({json:data});});
 const params=new URLSearchParams({ensembleScope:'#/descriptor-demo/ensembles/ensemble.json',ensembleBin0:'trans'});
 await page.goto('/?'+params+'#/descriptor-demo/ensembles/ensemble.json?candidate=10');
 const table=page.getByRole('table',{name:'构象能量表'}),filters=page.getByRole('region',{name:'局部构象筛选'});
 await expect(filters.getByLabel('trans',{exact:true})).toBeChecked();await expect(table.locator('tbody tr')).toHaveCount(2);
 await table.getByRole('button',{name:'编号',exact:false}).click();
 const first=await table.locator('tbody tr').first().getAttribute('data-candidate');
 const source=table.getByRole('link').first();await source.scrollIntoViewIfNeeded();
 await page.evaluate(()=>scrollTo(0,250));await expect.poll(()=>page.evaluate(()=>scrollY)).toBe(250);
 const url=page.url(),y=await page.evaluate(()=>scrollY);
 await source.click();await expect(page).toHaveURL(/\/a\//);await expect(page.getByRole('link',{name:'← 返回列表'})).toHaveAttribute('href',url);
 await page.reload();await page.getByRole('link',{name:'← 返回列表'}).click();await expect(page).toHaveURL(url);
 await expect(filters.getByLabel('trans',{exact:true})).toBeChecked();await expect(table.locator('tbody tr').first()).toHaveAttribute('data-candidate',first!);
 await expect(table.locator('tr[data-candidate="10"]')).toHaveAttribute('aria-selected','true');
 await expect.poll(()=>page.evaluate(()=>scrollY)).toBeCloseTo(y,0);
});

test('invalid precise file links fail before reading any Study file',async({page})=>{
 const requests:string[]=[];page.on('request',r=>{if(r.url().includes('/api/studies'))requests.push(r.url());});
 for(const query of ['fileKind=logs&file=..%2Fsecret','fileKind=record&file=other.json','fileKind=inputs&file=input.gjf&file=other.gjf']){
  await page.goto('/#/s/butane-demo/a/anti?'+query);await expect(page.getByRole('alert')).toContainText('无法打开链接');
 }
 expect(requests).toEqual([]);
});

test('job and overview return links retain their source and sort',async({page})=>{
 await page.goto('/#/jobs');await page.getByRole('link',{name:'opt-demo',exact:true}).click();
 await expect(page.getByRole('heading',{name:'opt-demo',exact:true})).toBeVisible();await page.getByRole('link',{name:'← 返回列表'}).click();await expect(page).toHaveURL(/#\/jobs$/);
 await page.goto('/#/s/butane-demo');const table=page.getByRole('table',{name:'Attempt 结果表'});
 await table.getByRole('button',{name:'SCF / Eh',exact:false}).click();await expect(table.locator('tbody tr').first()).toContainText('opt-demo');
 await table.getByRole('button',{name:'opt-demo',exact:true}).click();await expect(page.getByRole('heading',{name:'opt-demo',exact:true})).toBeVisible();
 await page.getByRole('link',{name:'← 返回列表'}).click();await expect(page).toHaveURL(/#\/s\/butane-demo$/);await expect(table.locator('tbody tr').first()).toContainText('opt-demo');
});
