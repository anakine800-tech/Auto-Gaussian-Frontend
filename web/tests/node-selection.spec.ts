import {test,expect} from '@playwright/test';
test.use({baseURL:'http://127.0.0.1:18766'});

async function candidates(page:import('@playwright/test').Page,mode='fresh'){
 await page.route('**/api/actions/butane-demo/prepared',async route=>{
  const response=await route.fetch(),data=await response.json();
  data.clusters.default.node_targeting={default_fraction:'1/2',fractions:['1/2','1/4']};
  data.clusters.default.tiers.mini={cores:12,mem_mb:19200};
  data.clusters.default.tiers.general={cores:24,mem_mb:38400};
  const statuses=['available','occupied','insufficient','restricted','unknown','available','forbidden'];
  const names=['compute-a','compute-b','compute-c','compute-fast','compute-unknown','compute-last','login-a'];
  data.node_targets={default:{fresh:mode!=='error',valid_until:new Date(Date.now()+(mode==='stale'?-1:180000)).toISOString(),
   nodes:names.map((name,i)=>({name,priority:i+1,status:statuses[i],reason:'Synthetic evidence only',options:[
    {fraction:'1/2',cores:24,mem_gb:48,tier:'general'},
    {fraction:'1/4',cores:12,mem_gb:24,tier:mode==='missing-tier'?null:'mini'}]}))}};
  data.manifest.node_target={name:'compute-a',fraction:'1/2',slots:48,queue:'batch'};
  data.manifest.cores=24;data.manifest.mem_gb=48;
  await route.fulfill({json:data});
 });
}

test('explicit node, half default, quarter resources, immutable submission summary and opt-out',async({page},info)=>{
 const posts:Record<string,string>[]=[];
 await candidates(page);
 await page.route('**/api/actions',route=>{posts.push(route.request().postDataJSON());return route.fulfill({json:{stdout:'Synthetic prepare only',stderr:'',exit_code:1,timed_out:false}});});
 await page.goto('/#/butane-demo/prepared');
 await page.getByRole('button',{name:'提交',exact:true}).click();
 await expect(page.getByRole('region',{name:'提交摘要'})).toContainText('目标节点：compute-a · 比例 1/2 · 24 核 / 48 GB');
 await page.getByRole('button',{name:'返回',exact:true}).click();
 await page.getByRole('button',{name:'基于此新建',exact:true}).click();
 const target=page.getByLabel('目标节点',{exact:true}),fraction=page.getByLabel('核数比例',{exact:true});
 await expect(target).toHaveValue('');await expect(fraction).toHaveValue('1/2');
 await expect(page.getByRole('button',{name:'保存并新建',exact:true})).toBeDisabled();
 expect(await target.locator('option').evaluateAll(es=>es.map(e=>(e as HTMLOptionElement).value))).toEqual(['','compute-a','compute-b','compute-c','compute-fast','compute-unknown','compute-last','login-a']);
 await expect(target.locator('option[value="login-a"]')).toHaveJSProperty('disabled',true);
 await expect(target.locator('option[value="compute-fast"]')).toHaveJSProperty('disabled',true);
 await expect(page.getByText('compute-fast：特殊核限制待验证',{exact:false})).toBeVisible();
 // Native selectors retain keyboard semantics. No click on a preselected candidate.
 await target.focus();await target.press('1');await target.press('Tab');
 await expect(fraction).toBeFocused();
 await expect(target).toHaveValue('compute-a');await expect(page.getByText('申请 24 核 / 48 GB · general')).toBeVisible();
 await fraction.selectOption('1/4');await expect(page.getByText('申请 12 核 / 24 GB · mini')).toBeVisible();
 await expect(page.getByLabel('输入全文')).toHaveValue(/^%nprocshared=12\n%mem=19200MB/);
 await page.getByLabel('方法依据',{exact:true}).fill('Synthetic only');
 await page.getByRole('button',{name:'保存并新建',exact:true}).click();
 await expect(page.getByTestId('ag-stdout')).toContainText('Synthetic prepare only');
 expect(posts).toHaveLength(1);expect(posts[0]).toMatchObject({target_node:'compute-a',node_fraction:'1/4',tier:'mini'});
 await page.getByRole('button',{name:'基于此新建',exact:true}).click();await expect(target).toHaveValue('');
 await page.getByLabel('集群',{exact:true}).selectOption('batch');await expect(target).toHaveCount(0);
 await expect(page.getByLabel('档位',{exact:true})).toBeEnabled();
 await page.screenshot({path:info.outputPath('legacy-selector.png')});
});

for(const mode of ['stale','error','missing-tier'])test(`node selection fails closed: ${mode}`,async({page})=>{
 await candidates(page,mode);await page.goto('/#/butane-demo/prepared');
 await page.getByRole('button',{name:'基于此新建',exact:true}).click();
 if(mode==='missing-tier'){
  await page.getByLabel('目标节点',{exact:true}).selectOption('compute-a');
  await page.getByLabel('核数比例',{exact:true}).selectOption('1/4');
  await expect(page.getByText('此比例无可用档位或资源不足')).toBeVisible();
 }else await expect(page.getByRole('alert')).toContainText('节点数据过期或不可用');
 await expect(page.getByRole('button',{name:'保存并新建',exact:true})).toBeDisabled();
});

test('mobile drawer keeps labelled native controls and no horizontal overflow',async({page},info)=>{
 await page.setViewportSize({width:390,height:844});await candidates(page);
 await page.goto('/#/butane-demo/prepared');await page.getByRole('button',{name:'基于此新建',exact:true}).click();
 await expect(page.getByRole('group',{name:'PBS 节点选择'})).toBeVisible();
 await expect(page.getByLabel('目标节点',{exact:true})).toBeVisible();
 await page.getByLabel('目标节点',{exact:true}).selectOption('compute-a');
 await expect(page.getByLabel('核数比例',{exact:true})).toHaveValue('1/2');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
 await page.screenshot({path:info.outputPath('node-selection-mobile.png')});
});

test('open selection expires without accepting an old recommendation',async({page})=>{
 await page.clock.install();await candidates(page);
 await page.goto('/#/butane-demo/prepared');await page.getByRole('button',{name:'基于此新建',exact:true}).click();
 await page.getByLabel('目标节点',{exact:true}).selectOption('compute-a');
 await expect(page.getByRole('button',{name:'保存并新建',exact:true})).toBeEnabled();
 await page.clock.fastForward(181000);
 await expect(page.getByRole('alert')).toContainText('节点数据过期或不可用');
 await expect(page.getByRole('button',{name:'保存并新建',exact:true})).toBeDisabled();
});
