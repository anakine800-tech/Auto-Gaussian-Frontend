import {test,expect} from '@playwright/test';
test.use({baseURL:'http://127.0.0.1:18766',viewport:{width:1440,height:1200}});

test('optional resource tiers keep fixed order and four digit walltime reaches the existing prepare action',async({page})=>{
 const posts:Record<string,string>[]=[];
 await page.route('**/api/actions/butane-demo/prepared',async route=>{
  const response=await route.fetch(),data=await response.json(),c=data.clusters.default;
  c.tiers={ultra:{cores:12,mem_mb:38400},max:{cores:10,mem_mb:32000},...c.tiers};c.max_walltime='1234:00:00';
  await route.fulfill({json:data});
 });
 await page.route('**/api/actions',route=>{posts.push(route.request().postDataJSON());return route.fulfill({json:{stdout:'Synthetic validation only',stderr:'',exit_code:1,timed_out:false}});});
 await page.goto('/#/butane-demo/prepared');await page.getByRole('button',{name:'基于此新建',exact:true}).click();
 const tier=page.getByLabel('档位',{exact:true});
 expect(await tier.locator('option').evaluateAll(es=>es.map(e=>(e as HTMLOptionElement).value))).toEqual(['mini','simple','general','complex','max','ultra']);
 await tier.selectOption('ultra');await expect(page.getByLabel('输入全文')).toHaveValue(/^%nprocshared=12\n%mem=38400MB/);
 await expect(page.getByText('单作业时限上限：1234 小时',{exact:false})).toBeVisible();
 await page.getByLabel('walltime',{exact:true}).fill('1234:00:01');await expect(page.getByRole('button',{name:'保存并新建',exact:true})).toBeDisabled();
 await expect(page.getByRole('alert')).toContainText('walltime 超过');
 for(const value of ['00:00:00','1:00:00','12345:00:00']){await page.getByLabel('walltime',{exact:true}).fill(value);await expect(page.getByRole('button',{name:'保存并新建',exact:true})).toBeDisabled();}
 expect(posts).toHaveLength(0);
 await page.getByLabel('walltime',{exact:true}).fill('1234:00:00');await page.getByLabel('方法依据',{exact:true}).fill('Synthetic only');
 await page.getByRole('button',{name:'保存并新建',exact:true}).click();await expect(page.getByTestId('ag-stdout')).toContainText('Synthetic validation only');
 expect(posts).toHaveLength(1);expect(posts[0]).toMatchObject({action:'prepare',tier:'ultra',walltime:'1234:00:00'});
 // The existing result refresh remounts the action controls; reopen normally.
 await page.getByRole('button',{name:'基于此新建',exact:true}).click();await tier.selectOption('ultra');
 await page.getByLabel('集群',{exact:true}).selectOption('batch');
 expect(await tier.locator('option').evaluateAll(es=>es.map(e=>(e as HTMLOptionElement).value))).toEqual(['mini','simple','general','complex']);
 await expect(tier).toHaveValue('simple');await expect(page.getByText('单作业时限上限：未配置（调度器仍可能限制）',{exact:false})).toBeVisible();
});

test('wait limit displays partial output and running notice without inventing an exit code',async({page})=>{
 let posts=0;
 await page.route('**/api/actions',route=>{
  posts++;
  return route.fulfill({json:{stdout:'partial output\n',stderr:'partial error\n',exit_code:null,timed_out:true,
   notice:'ag 仍在运行，不要重复操作，结果以 ag status 为准。'}});
 });
 await page.goto('/#/butane-demo/prepared');
 await page.getByRole('button',{name:'刷新状态',exact:true}).click();
 const output=page.getByRole('region',{name:'ag 输出'});
 await expect(output).toContainText('退出码：未取得');
 await expect(output).toContainText('页面等待已结束（未终止 ag）');
 await expect(output.getByRole('alert')).toContainText('ag 仍在运行，不要重复操作，结果以 ag status 为准');
 await expect(page.getByTestId('ag-stdout')).toHaveText('partial output\n');
 await expect(page.getByTestId('ag-stderr')).toHaveText('partial error\n');
 expect(posts).toBe(1);
});

test('new Attempt, automatic input preview/diff, two-step submit through fake ag',async({page},info)=>{
 const errors:string[]=[],posts:Record<string,unknown>[]=[];
 page.on('pageerror',e=>errors.push(e.message));
 page.on('request',r=>{if(r.method()==='POST')posts.push(r.postDataJSON());});
 await page.goto('/#/butane-demo/prepared');
 await expect(page.getByText('可操作（经 ag）',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'基于此新建',exact:true}).click();
 await page.getByLabel('档位',{exact:true}).selectOption('general');
 await page.getByLabel('标签',{exact:true}).fill('browser');
 await page.getByLabel('方法依据',{exact:true}).fill('兜底方法；合成正丁烷 UI 验证');
 const input=page.getByLabel('输入全文',{exact:true});
 await input.fill((await input.inputValue()).replace('Opt Freq','SP').replace('%nprocshared=22','%nprocshared=999'));
 await expect(input).toHaveValue(/%nprocshared=22\n%mem=40000MB/);
 await input.evaluate(element=>element.scrollTop=0);await input.blur();
 await page.getByRole('region',{name:'计算操作'}).screenshot({path:info.outputPath('new-attempt.png')});
 await page.getByRole('button',{name:'保存并新建',exact:true}).click();
 await expect(page).toHaveURL(/#\/s\/butane-demo\/research\/a\/butane-demo-001-browser$/);
 await expect(page.getByRole('region',{name:'三维分子结构'})).toContainText('14 / 14 原子');
 await expect(page.getByTestId('input-diff')).toContainText('# HF/STO-3G SP');
 await expect(page.getByTestId('input-diff')).toContainText('# HF/STO-3G Opt Freq');
 await expect(page.getByRole('region',{name:'输入参数'})).toContainText('40000MB');
 await page.getByRole('button',{name:'提交',exact:true}).click();
 const summary=page.getByRole('region',{name:'提交摘要'});
 await expect(summary).toContainText('general');await expect(summary).toContainText('# HF/STO-3G SP');
 expect(posts.filter(p=>p.action==='submit')).toHaveLength(0);
 await page.locator('#attempt-structure').scrollIntoViewIfNeeded();
 await page.screenshot({path:info.outputPath('preview-submit.png')});
 // Delay the HTTP response only to inspect the waiting UI; execution is fake.
 await page.route('**/api/actions',async route=>{const result=await route.fetch();await new Promise(resolve=>setTimeout(resolve,500));await route.fulfill({response:result});});
 await page.getByRole('button',{name:'确认摘要并提交',exact:true}).click();
 await expect(page.getByText('请在 Mac 弹窗中确认',{exact:false})).toBeVisible();
 await expect(page.getByTestId('ag-stdout')).toContainText('"action": "submit"');
 await expect(page.getByTestId('ag-stderr')).toHaveText('Synthetic ag stderr: no real calculation executed.\n');
 await expect(page.getByRole('button',{name:'取消计算',exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'提交',exact:true})).toHaveCount(0);
 await page.getByRole('region',{name:'ag 输出'}).screenshot({path:info.outputPath('submitted.png')});
 expect(posts.map(p=>p.action)).toEqual(['prepare','submit']);expect(errors).toEqual([]);
});

test('unknown has no submit; scheduler residue can cancel; readonly has no action buttons',async({page,request})=>{
 await page.goto('/#/butane-demo/waiting');
 await expect(page.getByRole('button',{name:'刷新状态',exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'提交',exact:true})).toHaveCount(0);
 await expect(page.getByRole('button',{name:'取消计算',exact:true})).toHaveCount(0);
 await page.goto('/#/butane-demo/opt-demo');
 await expect(page.getByRole('button',{name:'取消计算',exact:true})).toBeVisible();
 await page.goto('http://127.0.0.1:18765/#/butane-demo/prepared');
 await expect(page.getByRole('heading',{name:'prepared',exact:true})).toBeVisible();
 await expect(page.getByRole('banner').getByText('只读',{exact:true})).toHaveText('只读');
 await expect(page.getByRole('region',{name:'计算操作'})).toHaveCount(0);
 expect((await request.post('http://127.0.0.1:18765/api/actions')).status()).toBe(405);
 expect((await request.post('/api/actions')).status()).toBe(403);
});

test('clusters change tiers and input, warn across clusters and retain the parent cluster',async({page},info)=>{
 const errors:string[]=[],posts:Record<string,string>[]=[];
 page.on('pageerror',e=>errors.push(e.message));
 page.on('request',r=>{if(r.method()==='POST')posts.push(r.postDataJSON());});
 await page.goto('/#/butane-demo/prepared');
 await expect(page.locator('.attempt-detail')).toContainText('所属集群：default');
 await page.getByRole('button',{name:'基于此新建',exact:true}).click();
 await expect(page.getByLabel('集群',{exact:true})).toHaveValue('default');
 await page.getByLabel('档位',{exact:true}).selectOption('general');
 await expect(page.getByLabel('输入全文')).toHaveValue(/^%nprocshared=22\n%mem=40000MB/);
 await page.getByLabel('集群',{exact:true}).selectOption('batch');
 await expect(page.getByLabel('档位',{exact:true}).locator('option:checked')).toHaveText('general · 64 核 · 128000 MB');
 await expect(page.getByLabel('输入全文')).toHaveValue(/^%nprocshared=64\n%mem=128000MB/);
 await expect(page.getByText('同一能量曲线内的物种应在同一集群计算',{exact:true})).toBeVisible();
 await page.getByLabel('集群',{exact:true}).selectOption('default');
 await expect(page.getByText('同一能量曲线内的物种应在同一集群计算',{exact:true})).toHaveCount(0);
 await page.getByLabel('集群',{exact:true}).selectOption('batch');
 await page.getByLabel('walltime',{exact:true}).fill('02:30:00');
 await page.getByLabel('标签',{exact:true}).fill('clusters');
 await page.getByLabel('方法依据',{exact:true}).fill('Synthetic fallback');
 await page.screenshot({path:info.outputPath('clusters-form.png'),fullPage:true});
 await page.getByRole('button',{name:'保存并新建',exact:true}).click();
 await expect(page).toHaveURL(/butane-demo-001-clusters$/);
 expect(posts).toHaveLength(1);expect(posts[0].cluster).toBe('batch');
 await expect(page.locator('.attempt-detail')).toContainText('所属集群：batch');
 await page.getByRole('button',{name:'提交',exact:true}).click();
 const summary=page.getByRole('region',{name:'提交摘要'});
 await expect(summary).toContainText('batch');await expect(summary).toContainText('160 核时');
 await summary.screenshot({path:info.outputPath('cluster-submit-summary.png')});
 await page.getByRole('button',{name:'返回',exact:true}).click();
 await page.getByRole('button',{name:'基于此新建',exact:true}).click();
 await expect(page.getByLabel('集群',{exact:true})).toHaveValue('batch');
 await expect(page.getByText('同一能量曲线内的物种应在同一集群计算',{exact:true})).toHaveCount(0);
 expect(errors).toEqual([]);
});

test('removed parent cluster requires an explicit choice and disabled Gaussian cannot prepare',async({page})=>{
 await page.route('**/api/actions/butane-demo/prepared',async route=>{
  const response=await route.fetch(),data=await response.json();
  delete data.clusters.default;data.clusters.batch.programs_enabled.gaussian=false;
  await route.fulfill({json:data});
 });
 await page.goto('/#/butane-demo/prepared');
 await page.getByRole('button',{name:'基于此新建',exact:true}).click();
 await expect(page.getByLabel('集群',{exact:true})).toHaveValue('');
 await expect(page.getByText('父 Attempt 集群 default 未配置，请明确选择目标集群。')).toBeVisible();
 await expect(page.getByRole('button',{name:'保存并新建',exact:true})).toBeDisabled();
 await page.getByLabel('集群',{exact:true}).selectOption('batch');
 await expect(page.getByText('此集群未启用 Gaussian。')).toBeVisible();
 await expect(page.getByRole('button',{name:'保存并新建',exact:true})).toBeDisabled();
});


test('server reads both physical synthetic cluster caches',async({page})=>{
 await page.goto('/#server');
 await page.getByRole('button',{name:'选择服务器 default'}).click();
 await expect(page.getByRole('region',{name:'集群 default 详细信息',exact:true})).toContainText('synthetic-node');
 await page.getByRole('button',{name:'选择服务器 batch'}).click();
 const batch=page.getByRole('region',{name:'集群 batch 详细信息',exact:true});
 await batch.locator('summary').filter({hasText:'限额、档位与存储'}).click();
 await expect(batch).toContainText('预算 1000 · 已用 1.5 · 预留 2 核时');
 await expect(batch).toContainText('存储占用：0 GB');
 await expect(page.getByRole('region',{name:'集群 batch',exact:true})).toContainText('运行 16 · 排队 0 / 总上限 96');
});
