import {test,expect,type Page,type Route} from '@playwright/test';
test.use({baseURL:'http://127.0.0.1:18766',viewport:{width:1440,height:1100}});
const labels={enough:'当前容量足够',queue:'需要排队',unknown:'无法判断',not_applicable:'规格不适用'};
type Verdict=keyof typeof labels;
function advice(request:Record<string,string>,availability:Verdict='enough'){
 const detail={availability,fits_total:availability==='unknown'?null:availability!=='not_applicable',reasons:['Synthetic capacity evidence'],cpu_source:'synthetic CPU allocation',memory_source:'synthetic requested memory'};
 return {...request,target_node:request.target_node??null,cores:48,mem_gb:96,...detail,sampled_at:new Date().toISOString(),valid_until:new Date(Date.now()+180000).toISOString(),snapshot_fresh:true,nodes:[{name:request.target_node??'compute-a',...detail}]};
}
async function context(page:Page,options:{defaults?:boolean;nodes?:boolean;blockedHalf?:boolean}={defaults:true}){
 await page.route('**/api/actions/butane-demo/prepared',async route=>{
  const response=await route.fetch(),data=await response.json();
  data.clusters.default.tiers.max={cores:48,mem_gb:96,mem_mb:76800};
  if(options.defaults){data.clusters.default.default_tier='max';data.clusters.batch.default_tier='mini';}
  if(options.nodes){
   const c=data.clusters.default;c.node_targeting={default_fraction:'1/2',fractions:['1/2','1/4']};
   c.tiers.mini={cores:12,mem_gb:24,mem_mb:19200};c.tiers.general={cores:24,mem_gb:48,mem_mb:38400};
   data.node_targets={default:{fresh:true,valid_until:new Date(Date.now()+180000).toISOString(),nodes:[
    {name:'idle-a',priority_group:1,order:1,priority:1,status:'available',selectable:true,reason:'Synthetic idle'},
    {name:'busy-b',priority_group:2,order:2,priority:2,status:'occupied',selectable:true,reason:'Synthetic occupied; can queue'},
    {name:'legacy-c',priority_group:3,order:3,priority:3,status:'occupied',reason:'Legacy occupied'},
    {name:'restricted-d',priority_group:4,order:4,priority:4,status:'restricted',selectable:false,reason:'Synthetic restricted'},
    {name:'denied-e',priority_group:null,order:5,priority:5,status:'forbidden',selectable:false,reason:'Synthetic denied'},
    {name:'disabled-f',priority_group:5,order:6,priority:6,status:'available',selectable:false,reason:'Synthetic disabled'}
   ].map(n=>({...n,options:[{fraction:'1/2',cores:24,mem_gb:48,tier:'general',...(options.blockedHalf&&n.name==='busy-b'?{selectable:false}:{})},{fraction:'1/4',cores:12,mem_gb:24,tier:'mini',...(options.blockedHalf?{selectable:true}:{})}]}))}};
  }
  await route.fulfill({json:data});
 });
}
async function open(page:Page){await page.goto('/#/butane-demo/prepared');await page.getByRole('button',{name:'基于此新建',exact:true}).click();}
const panel=(page:Page)=>page.getByRole('region',{name:'申请容量',exact:true});

test('defaults, manual overrides, reopening and entry switching keep scheduler and input resources aligned',async({page},info)=>{
 await context(page);
 const requests:Record<string,string>[]=[];
 await page.route('**/api/attempt-capacity',route=>{const body=route.request().postDataJSON();requests.push(body);return route.fulfill({json:advice(body)});});
 await open(page);
 const tier=page.getByLabel('档位',{exact:true}),input=page.getByLabel('输入全文',{exact:true});
 await expect(tier).toHaveValue('max');await expect(input).toHaveValue(/^%nprocshared=48\n%mem=76800MB/);
 await expect(page.getByLabel('草稿资源',{exact:true})).toHaveText('申请 48 核 · 调度内存 96 GB · Gaussian 输入内存 76800 MB');
 const original=(await input.inputValue()).split('\n').slice(2).join('\n');
 await expect(panel(page)).toContainText(labels.enough);
 await tier.selectOption('general');await expect(panel(page).getByRole('button',{name:'刷新容量'})).toBeEnabled();
 await panel(page).getByRole('button',{name:'刷新容量'}).click();await expect(panel(page).getByRole('button',{name:'刷新容量'})).toBeEnabled();
 await expect(tier).toHaveValue('general');
 await page.getByLabel('集群',{exact:true}).selectOption('batch');await expect(tier).toHaveValue('mini');
 await expect(input).toHaveValue(/^%nprocshared=8\n%mem=12800MB/);
 await page.getByLabel('集群',{exact:true}).selectOption('default');await expect(tier).toHaveValue('max');
 expect((await input.inputValue()).split('\n').slice(2).join('\n')).toBe(original);
 await page.getByRole('button',{name:'收起表单'}).click();await page.getByRole('button',{name:'基于此新建',exact:true}).click();
 await expect(tier).toHaveValue('max');await expect(panel(page)).toContainText(labels.enough);
 expect(requests.every(r=>Object.keys(r).sort().join(',')==='cluster,tier')).toBe(true);
 await page.screenshot({path:info.outputPath('capacity-desktop.png')});
});

for(const verdict of Object.keys(labels) as Verdict[])test(`backend verdict is advisory and preserves save: ${verdict}`,async({page})=>{
 await context(page);await page.route('**/api/attempt-capacity',route=>route.fulfill({json:advice(route.request().postDataJSON(),verdict)}));
 await open(page);await expect(panel(page)).toContainText(labels[verdict]);await expect(panel(page)).toContainText('synthetic requested memory');
 await expect(panel(page)).toContainText('数据时间：');await expect(panel(page)).toContainText('容量足够不保证立即启动');
 await expect(page.getByRole('button',{name:'保存并新建',exact:true})).toBeEnabled();
});

test('late responses cannot replace current entry tier or selected node',async({page})=>{
 await context(page,{nodes:true});const pending:Route[]=[];
 await page.route('**/api/attempt-capacity',route=>{pending.push(route);});
 await open(page);expect(pending).toHaveLength(0);
 await page.getByLabel('目标节点',{exact:true}).selectOption('idle-a');await expect.poll(()=>pending.length).toBe(1);
 await page.getByLabel('目标节点',{exact:true}).selectOption('busy-b');await expect.poll(()=>pending.length).toBe(2);
 await page.getByLabel('核数比例',{exact:true}).selectOption('1/4');await expect.poll(()=>pending.length).toBe(3);
 await page.getByLabel('集群',{exact:true}).selectOption('batch');await expect.poll(()=>pending.length).toBe(4);
 const newest=pending[3];await newest.fulfill({json:{...advice(newest.request().postDataJSON(),'queue'),reasons:['Current batch mini request']}});
 await expect(panel(page)).toContainText('Current batch mini request');
 for(const stale of pending.slice(0,3).reverse())await stale.fulfill({json:{...advice(stale.request().postDataJSON()),reasons:['Wrong stale request']}});
 await expect(panel(page)).toContainText('Current batch mini request');await expect(panel(page)).not.toContainText('Wrong stale request');
 await expect(page.getByLabel('集群',{exact:true})).toHaveValue('batch');
});

test('occupied selectable nodes preserve order fractions and legacy restrictions',async({page})=>{
 await context(page,{nodes:true});const calls:Record<string,string>[]=[];
 await page.route('**/api/attempt-capacity',route=>{const r=route.request().postDataJSON();calls.push(r);return route.fulfill({json:advice(r,'queue')});});
 await open(page);const target=page.getByLabel('目标节点',{exact:true});
 expect(await target.locator('option').evaluateAll(es=>es.map(e=>(e as HTMLOptionElement).value))).toEqual(['','idle-a','busy-b','legacy-c','restricted-d','denied-e','disabled-f']);
 for(const name of ['legacy-c','restricted-d','denied-e','disabled-f'])await expect(target.locator(`option[value="${name}"]`)).toHaveJSProperty('disabled',true);
 await target.selectOption('busy-b');await expect(panel(page)).toContainText(labels.queue);
 await expect(page.getByRole('row').filter({has:page.getByRole('rowheader',{name:'busy-b'})})).toContainText('已占用 · 可选择');
 await expect(page.getByRole('button',{name:'保存并新建',exact:true})).toBeEnabled();
 await page.getByLabel('核数比例',{exact:true}).selectOption('1/4');await expect(page.getByLabel('输入全文')).toHaveValue(/^%nprocshared=12\n%mem=19200MB/);
 await expect(panel(page).getByRole('button',{name:'刷新容量'})).toBeEnabled();await panel(page).getByRole('button',{name:'刷新容量'}).click();
 await expect(panel(page).getByRole('button',{name:'刷新容量'})).toBeEnabled();await expect(target).toHaveValue('busy-b');
 expect(calls.at(-1)).toEqual({cluster:'default',tier:'mini',target_node:'busy-b'});
});

test('legacy default fallback and unavailable capacity do not change prepare capability',async({page})=>{
 await context(page,{defaults:false});let calls=0;
 await page.route('**/api/attempt-capacity',route=>{calls++;return route.fulfill({json:{...advice(route.request().postDataJSON(),'unknown'),capability_unavailable:true,reasons:['Synthetic old backend']}});});
 await open(page);await expect(page.getByLabel('档位',{exact:true})).toHaveValue('simple');
 await expect(panel(page)).toContainText('容量能力不可用');await expect(panel(page).getByRole('button',{name:'刷新容量'})).toBeDisabled();
 await expect(page.getByRole('button',{name:'保存并新建',exact:true})).toBeEnabled();expect(calls).toBe(1);
 await page.getByLabel('档位',{exact:true}).selectOption('general');await page.getByLabel('集群',{exact:true}).selectOption('batch');
 await expect(page.getByLabel('档位',{exact:true})).toHaveValue('general');
});

test('per-fraction selectability keeps a prohibited half visible until the user chooses a quarter',async({page})=>{
 await context(page,{nodes:true,blockedHalf:true});
 await page.route('**/api/attempt-capacity',route=>route.fulfill({json:advice(route.request().postDataJSON(),'unknown')}));
 await open(page);await page.getByLabel('目标节点',{exact:true}).selectOption('busy-b');
 const save=page.getByRole('button',{name:'保存并新建',exact:true}),fraction=page.getByLabel('核数比例',{exact:true});
 await expect(fraction).toHaveValue('1/2');await expect(page.getByLabel('档位',{exact:true})).toHaveValue('general');
 await expect(save).toBeDisabled();await expect(page.getByText('当前节点的此比例不可用，请明确选择其他比例或节点。')).toBeVisible();
 await fraction.selectOption('1/4');await expect(save).toBeEnabled();
 await expect(page.getByLabel('目标节点',{exact:true})).toHaveValue('busy-b');
 await expect(page.getByLabel('输入全文')).toHaveValue(/^%nprocshared=12\n%mem=19200MB/);
 await expect(panel(page)).toContainText(labels.unknown);
});

test('expiry and local query failures remain unknown without refreshing or resetting resources',async({page})=>{
 await page.clock.install();await context(page);let calls=0;
 await page.route('**/api/attempt-capacity',route=>{calls++;return calls===1?route.fulfill({json:advice(route.request().postDataJSON())}):route.fulfill({status:503,json:{detail:'Synthetic local failure'}});});
 await open(page);await expect(panel(page)).toContainText(labels.enough);await page.clock.fastForward(181000);
 await expect(panel(page)).toContainText('容量数据已过期');await expect(panel(page).getByRole('heading')).toContainText(labels.unknown);expect(calls).toBe(1);
 await panel(page).getByRole('button',{name:'刷新容量'}).click();await expect(panel(page)).toContainText('容量读取失败');
 await expect(page.getByLabel('档位',{exact:true})).toHaveValue('max');await expect(page.getByRole('button',{name:'保存并新建',exact:true})).toBeEnabled();
});

test('narrow form shows resources and advice without horizontal document overflow',async({page},info)=>{
 await page.setViewportSize({width:390,height:844});await context(page,{defaults:true,nodes:true});
 await page.route('**/api/attempt-capacity',route=>route.fulfill({json:advice(route.request().postDataJSON(),'queue')}));
 await open(page);await page.getByLabel('目标节点',{exact:true}).selectOption('busy-b');await expect(panel(page)).toContainText(labels.queue);
 await panel(page).scrollIntoViewIfNeeded();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
 await page.screenshot({path:info.outputPath('capacity-mobile.png')});
});

test('readonly and stale action token cannot gain capacity query access',async({page,request})=>{
 expect((await request.post('http://127.0.0.1:18765/api/attempt-capacity',{data:{cluster:'default',tier:'simple'}})).status()).toBe(405);
 expect((await request.post('/api/attempt-capacity',{data:{cluster:'default',tier:'simple'}})).status()).toBe(403);
 await context(page);await page.route('**/api/attempt-capacity',route=>route.fulfill({status:403,json:{detail:'Invalid action token'}}));
 await open(page);await expect(panel(page)).toContainText('前端已重启，请刷新页面');
});

test('temporary local read errors keep manual refresh enabled and recover on the next request',async({page})=>{
 await context(page);let calls=0;
 await page.route('**/api/attempt-capacity',route=>{
  calls++;const data=advice(route.request().postDataJSON(),calls===1?'unknown':'enough');
  return route.fulfill({json:{...data,reasons:[calls===1?'Synthetic temporary local read error':'Synthetic recovered observation']}});
 });
 await open(page);await expect(panel(page)).toContainText('Synthetic temporary local read error');
 const refresh=panel(page).getByRole('button',{name:'刷新容量'});
 await expect(refresh).toBeEnabled();expect(calls).toBe(1);
 await refresh.click();await expect(panel(page)).toContainText('Synthetic recovered observation');
 await expect(panel(page)).toContainText(labels.enough);await expect(refresh).toBeEnabled();
 expect(calls).toBe(2);await expect(page.getByLabel('档位',{exact:true})).toHaveValue('max');
});
