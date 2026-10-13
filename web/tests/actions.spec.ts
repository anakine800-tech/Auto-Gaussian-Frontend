import {test,expect} from '@playwright/test';
test.use({baseURL:'http://127.0.0.1:18766',viewport:{width:1440,height:1200}});

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
 await expect(page).toHaveURL(/#\/butane-demo\/butane-demo-001-browser$/);
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
 await expect(page.locator('header .readonly')).toHaveText('只读');
 await expect(page.getByRole('region',{name:'计算操作'})).toHaveCount(0);
 expect((await request.post('http://127.0.0.1:18765/api/actions')).status()).toBe(405);
 expect((await request.post('/api/actions')).status()).toBe(403);
});
