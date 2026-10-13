import {test,expect} from '@playwright/test';

test('results default, sorting, saved thermo and nested representatives',async({page},info)=>{
 const writes:string[]=[],errors:string[]=[];
 page.on('request',r=>{if(!['GET','HEAD'].includes(r.method()))writes.push(r.url());});page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/#/butane-demo');
 await expect(page.getByRole('button',{name:'结果',exact:true})).toHaveAttribute('aria-current','page');
 const table=page.getByRole('table',{name:'Attempt 结果表'});
 await expect(table).toContainText('-157.0025');await expect(table).toContainText('unknown');
 await expect(page.getByRole('table',{name:'热化学表'})).toContainText('50.000%');
 await expect(page.getByRole('region',{name:'三维分子结构'})).toContainText('14 / 14 原子');
 await table.getByRole('button',{name:'SCF / Eh',exact:false}).click();
 await expect(table.locator('tbody tr').first()).toContainText('opt-demo');
 await page.getByRole('link',{name:'analyses/cluster-demo/representatives.xyz',exact:true}).click();
 await expect(page.getByRole('heading',{name:'analyses/cluster-demo/representatives.xyz',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'下一帧',exact:true}).click();
 await expect(page.getByLabel('帧号')).toHaveValue('2');
 await page.screenshot({path:info.outputPath('results.png'),fullPage:true});
 await table.locator('tbody tr').filter({hasText:'opt-demo'}).locator('td').nth(1).click();
 await expect(page).toHaveURL(/#\/butane-demo\/opt-demo$/);
 await expect(page.getByRole('heading',{name:'opt-demo',exact:true})).toBeVisible();
 expect(writes).toEqual([]);expect(errors).toEqual([]);
});

test('nested analyses deep link and Markdown disables HTML, scripts and outbound links',async({page})=>{
 const outside:string[]=[];page.on('request',r=>{if(r.url().includes('example.invalid'))outside.push(r.url());});
 await page.goto('/#/butane-demo/analyses/cluster-demo/representatives.xyz');
 await expect(page.getByLabel('帧号')).toHaveValue('1');
 await expect(page.getByRole('region',{name:'三维分子结构'})).toContainText('14 / 14 原子');
 await page.getByRole('button',{name:'研究说明',exact:true}).click();
 const md=page.locator('.markdown');
 await expect(md.locator('strong')).toHaveText('Markdown 正常渲染');
 await expect(md.locator('script,img,iframe')).toHaveCount(0);
 await expect(md.locator('a')).toHaveCount(1);
 await md.getByRole('link',{name:'当前阻塞'}).click();
 await expect(page.getByRole('button',{name:'研究说明',exact:true})).toHaveAttribute('aria-current','page');
 expect(await page.evaluate(()=>Reflect.get(window,'syntheticXss'))).toBeUndefined();expect(outside).toEqual([]);
});

test('optimization chart, convergence, standard/input frames and playback',async({page},info)=>{
 await page.goto('/#/butane-demo/opt-demo');
 await page.getByRole('button',{name:'优化过程',exact:true}).click();
 await expect(page.getByRole('img',{name:'优化相对能量折线图'})).toBeVisible();
 await expect(page.getByRole('heading',{name:'第 1 段 · 3 步'})).toBeVisible();
 const table=page.getByRole('table',{name:'第 1 段收敛表'});
 await expect(table).toContainText('0.0009');await expect(table).toContainText('NO');
 await page.getByRole('button',{name:'下一步',exact:true}).click();
 await expect(page.getByLabel('第 1 段优化步')).toHaveValue('2');
 await expect(page.getByRole('region',{name:'三维分子结构'})).toContainText('14 / 14 原子');
 await page.getByRole('button',{name:'播放优化过程',exact:true}).click();
 await expect(page.getByLabel('第 1 段优化步')).toHaveValue('3');
 await expect(table).toContainText('YES');
 await expect(page.getByRole('button',{name:'播放优化过程',exact:true})).toBeVisible();
 await page.screenshot({path:info.outputPath('optimization.png'),fullPage:true});
 await page.goto('/#/butane-demo/opt-failed');await page.getByRole('button',{name:'优化过程',exact:true}).click();
 await expect(page.getByRole('article',{name:'优化段 1'})).toContainText('终止：error');
 await page.getByLabel('第 1 段优化步').fill('3');await expect(table).toContainText('NO');
});

test('server snapshot, warnings, links and 30 second GET polling',async({page},info)=>{
 await page.clock.install();
 let reads=0;const writes:string[]=[];
 page.on('request',r=>{if(r.url().endsWith('/api/monitor'))reads++;if(!['GET','HEAD'].includes(r.method()))writes.push(r.method());});
 await page.goto('/#server');
 await expect(page.getByRole('table',{name:'本人作业表'})).toContainText('00:03:12 / 01:00:00');
 await expect(page.locator('.core-count')).toHaveText('8 / 44');
 await expect(page.getByRole('table',{name:'节点表'})).toContainText('synthetic-node');
 await expect(page.getByRole('table',{name:'队列表'})).toContainText('demo');
 await expect(page.getByText('需人工确认后 ag cancel',{exact:true})).toBeVisible();
 await expect(page.getByText('运行 ag status 核对',{exact:true})).toBeVisible();
 const first=reads;await page.clock.fastForward(30001);await expect.poll(()=>reads).toBe(first+1);
 await page.screenshot({path:info.outputPath('server.png'),fullPage:true});
 await page.getByRole('link',{name:'opt-demo',exact:true}).click();
 await expect(page.getByRole('heading',{name:'opt-demo',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'服务器',exact:true}).click();await expect(page.getByRole('heading',{name:'服务器监控',exact:true})).toBeVisible();
 expect(writes).toEqual([]);
});

test('server stale, failed, one-shot, missing, malformed and oversized states',async({page,request})=>{
 const data=await (await request.get('/api/monitor')).json();
 const cases=[
  {body:{...data,sampled_at:'2000-01-01T00:00:00Z'},text:'数据已过期'},
  {body:{...data,ok:false,error:'Synthetic sampler failure',last_ok_at:'2000-01-01T00:00:00Z'},text:'非最新'},
  {body:{...data,ok:false,error:'No previous sample',last_ok_at:null,own:null,cluster:null},text:'尚无成功采样'},
  {body:{...data,sampled_at:'2000-01-01T00:00:00Z',interval_seconds:null},text:'单次采样'},
  {body:{detail:'请在终端运行 ag monitor --watch 120'},status:404,text:'请在终端运行 ag monitor --watch 120'},
  {body:{detail:'快照格式不正确'},status:422,text:'快照格式不正确'},
  {body:{detail:'File exceeds display size limit'},status:413,text:'File exceeds display size limit'},
 ];
 for(const c of cases){
  await page.route('**/api/monitor',route=>route.fulfill({status:c.status??200,contentType:'application/json',body:JSON.stringify(c.body)}));
  await page.goto('/?snapshot='+cases.indexOf(c)+'#server');await expect(page.getByRole('region',{name:'服务器监控'})).toContainText(c.text);
  if(c.text==='非最新')await expect(page.getByRole('table',{name:'本人作业表'})).toContainText('synthetic-opt');
  if(c.text==='单次采样')await expect(page.getByText('数据已过期',{exact:true})).toHaveCount(0);
  await page.unroute('**/api/monitor');
 }
});

test('three new views fit mobile viewport',async({page})=>{
 await page.setViewportSize({width:390,height:844});
 for(const path of ['/#/butane-demo','/#/butane-demo/opt-demo','/#server']){
  await page.goto(path);
  if(path.endsWith('opt-demo'))await page.getByRole('button',{name:'优化过程',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Study 查看器'})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
 }
});
