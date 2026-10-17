import {test,expect} from '@playwright/test';

test('study navigation, saved thermo, missing parents and unknown status',async({page})=>{
 await page.goto('/');
 await expect(page.getByRole('heading',{name:'Auto-Gaussian'})).toBeVisible();
 await page.getByRole('button',{name:'文件',exact:true}).click();await page.getByRole('button',{name:'研究说明',exact:true}).click();
 await expect(page.getByText('仅用于查看器测试；能量与振动数据为虚构，不是研究结果。',{exact:false})).toBeVisible();
 await page.getByRole('button',{name:'分析',exact:true}).click();
 const table=page.getByRole('table',{name:'热化学表'});
 await expect(table).toContainText('简并度');await expect(table).toContainText('50.000%');
 await expect(page.getByText('ensemble_G', {exact:false}).first()).toContainText('-157.00065446');
 await expect(page.getByRole('heading',{name:'dedup-demo.json'})).toBeVisible();
 await expect(page.getByRole('heading',{name:'cluster-demo.json'})).toBeVisible();
 await page.getByRole('button',{name:'文件',exact:true}).click();await page.getByRole('button',{name:'关系图',exact:true}).click();
 await expect(page.getByRole('img',{name:'Attempt 关系图'})).toBeVisible();
 await expect(page.getByText('missing-seed · 缺失父节点')).toBeVisible();
 await page.getByRole('button',{name:'waiting · unknown'}).click();
 await page.getByText('manifest.json 与 status.json',{exact:true}).click();
 await expect(page.locator('#record-status\\.json')).toContainText('unknown');
 await expect(page.getByRole('heading',{name:'waiting',exact:true})).toBeVisible();
 await expect(page.getByText('尚无 outputs 日志。')).toBeVisible();
});

test('final.xyz molecule, Gaussian vectors, animation and exact log pages',async({page},testInfo)=>{
 await page.goto('/');await page.getByRole('button',{name:'Attempts',exact:true}).click();
 await page.getByRole('table',{name:'Attempt 结果表'}).getByRole('link',{name:'anti',exact:true}).click();
 await expect(page.getByRole('region',{name:'三维分子结构'})).toContainText('14 / 14 原子');
 await expect(page.getByTestId('raw-log')).toContainText('Synthetic pagination line');
 const first=await page.getByTestId('raw-log').textContent();
 await page.getByRole('button',{name:'下一页',exact:true}).click();
 await expect(page.getByTestId('raw-log')).not.toHaveText(first!);
 await page.getByRole('button',{name:'上一页',exact:true}).click();
 await expect(page.getByTestId('raw-log')).toHaveText(first!);
 await page.getByRole('button',{name:'解析振动位移'}).click();
 await page.getByLabel('振动模式',{exact:true}).selectOption('0');
 await expect(page.getByTestId('vibration-controls')).toContainText('-42');
 await expect(page.getByTestId('vibration-controls')).toContainText('播放中');
 await page.getByRole('button',{name:'暂停动画',exact:true}).click();
 await expect(page.getByTestId('vibration-controls')).toContainText('已暂停');
 await page.getByRole('button',{name:'关闭模式',exact:true}).click();
 await expect(page.getByTestId('vibration-controls')).toHaveCount(0);
 await expect(page.getByLabel('结构来源')).toContainText('final.xyz');
 await page.screenshot({path:testInfo.outputPath('desktop.png'),fullPage:true});
});

test('all UI traffic is read-only, old controls absent and refresh works',async({page})=>{
 const writes:string[]=[];const errors:string[]=[];
 page.on('request',r=>{if(!['GET','HEAD'].includes(r.method()))writes.push(r.url());});
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/');
 for(const name of ['Attempts','文件','关系图','分析','文件','研究说明'])await page.getByRole('button',{name,exact:true}).click();
 await page.getByRole('button',{name:'刷新',exact:true}).click();
 await expect(page.getByRole('heading',{name:'study.md'})).toBeVisible();
 for(const name of ['提交','取消作业','任务中心','项目库','归档导入','连接集群'])await expect(page.getByRole('button',{name,exact:true})).toHaveCount(0);
 expect(writes).toEqual([]);expect(errors).toEqual([]);
});

test('mobile study, attempts and molecule stay usable',async({page},testInfo)=>{
 await page.setViewportSize({width:390,height:844});await page.goto('/');
 await page.getByRole('button',{name:'Attempts',exact:true}).click();
 await page.getByRole('table',{name:'Attempt 结果表'}).getByRole('link',{name:'anti',exact:true}).click();
 await expect(page.getByRole('region',{name:'三维分子结构'})).toContainText('14 / 14 原子');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
 await page.screenshot({path:testInfo.outputPath('mobile.png'),fullPage:true});
});

test('malformed log leaves final.xyz and saved facts available',async({page})=>{
 await page.route('**/vibrations/*',route=>route.fulfill({status:422,contentType:'application/json',body:JSON.stringify({detail:'No unambiguous supported Gaussian Cartesian vibration table'})}));
 await page.goto('/');await page.getByRole('button',{name:'Attempts',exact:true}).click();
 await page.getByRole('table',{name:'Attempt 结果表'}).getByRole('link',{name:'anti',exact:true}).click();
 await page.getByRole('button',{name:'解析振动位移'}).click();
 await expect(page.getByText('No unambiguous supported Gaussian Cartesian vibration table')).toBeVisible();
 await expect(page.getByRole('region',{name:'三维分子结构'})).toContainText('14 / 14 原子');
 await expect(page.getByRole('heading',{name:'facts.json'})).toBeVisible();
});
