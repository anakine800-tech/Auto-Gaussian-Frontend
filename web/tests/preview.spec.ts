import {test,expect} from '@playwright/test';

test('prepared hash opens input geometry and metadata before submit',async({page},info)=>{
 const writes:string[]=[];page.on('request',r=>{if(!['GET','HEAD'].includes(r.method()))writes.push(r.url());});
 await page.goto('/#/butane-demo/prepared');
 await expect(page.getByRole('heading',{name:'prepared',exact:true})).toBeVisible();
 await expect(page.getByLabel('预览结构')).toHaveValue('input');
 await expect(page.getByRole('region',{name:'三维分子结构'})).toContainText('14 / 14 原子');
 const summary=page.getByRole('region',{name:'输入参数'});
 await expect(summary).toContainText('C4H10');await expect(summary).toContainText('8GB');
 await expect(summary).toContainText('# HF/STO-3G Opt Freq');
 await expect(page.getByTestId('input-text')).toContainText('%nprocshared=8');
 expect(writes).toEqual([]);
 await page.screenshot({path:info.outputPath('prepared-input.png')});
});

test('parent input diff highlights route changes',async({page},info)=>{
 await page.goto('/#/butane-demo/prepared');
 await page.getByRole('button',{name:'与父 Attempt 输入对比'}).click();
 await expect(page.getByTestId('input-diff')).toContainText('-# HF/STO-3G Opt');
 await expect(page.getByTestId('input-diff')).toContainText('+# HF/STO-3G Opt Freq');
 await expect(page.getByTestId('input-diff').locator('.diff-added').last()).toContainText('Opt Freq');
 await page.getByTestId('input-diff').scrollIntoViewIfNeeded();
 await page.screenshot({path:info.outputPath('input-diff.png')});
});

test('existing final geometry can switch to input and back',async({page})=>{
 await page.goto('/#/butane-demo/anti');
 await expect(page.getByLabel('预览结构')).toHaveValue('final');
 await page.getByLabel('预览结构').selectOption('input');
 await expect(page.getByLabel('结构来源')).toContainText('输入结构');
 await page.getByLabel('预览结构').selectOption('final');
 await expect(page.getByLabel('结构来源')).toContainText('final.xyz');
});

test('structure deep link changes frames and shows comments',async({page},info)=>{
 const sizes:number[]=[];page.on('response',async response=>{if(response.url().includes('/structures/'))sizes.push((await response.body()).length);});
 await page.goto('/#/butane-demo/structures/butane/conformers.xyz');
 await expect(page.getByLabel('帧号')).toHaveValue('1');
 await expect(page.getByTestId('frame-comment')).toContainText('-1.25');
 await page.getByRole('button',{name:'下一帧',exact:true}).click();
 await expect(page.getByLabel('帧号')).toHaveValue('2');await expect(page.getByTestId('frame-comment')).toContainText('-1.1');
 await page.getByLabel('帧号').fill('3');await expect(page.getByTestId('frame-comment')).toContainText('-0.95');
 await page.getByRole('button',{name:'上一帧',exact:true}).click();await expect(page.getByLabel('帧号')).toHaveValue('2');
 await expect(page.getByRole('region',{name:'三维分子结构'})).toContainText('14 / 14 原子');
 expect(sizes.every(n=>n<10000)).toBeTruthy();
 await page.screenshot({path:info.outputPath('conformer-frames.png')});
 await page.goto('/#/butane-demo/analyses/representatives.xyz');
 await expect(page.getByLabel('帧号')).toHaveValue('1');
 await expect(page.getByRole('region',{name:'结构文件'})).toContainText('/ 2');
});

test('keyword search and last termination links locate lines',async({page},info)=>{
 await page.goto('/#/butane-demo/anti');
 await page.getByLabel('日志关键词').fill('Error termination');
 await page.getByRole('button',{name:'搜索下一处',exact:true}).click();
 await expect(page.locator('.log-match')).toContainText('Error termination first synthetic marker');
 await page.getByRole('button',{name:'搜索下一处',exact:true}).click();
 await expect(page.locator('.log-match')).toContainText('Error termination last synthetic marker');
 await page.getByRole('button',{name:'最后一次 Normal termination',exact:true}).click();
 await expect(page.locator('.log-match')).toContainText('Normal termination final synthetic marker');
 await page.getByRole('button',{name:'最后一次 Error termination',exact:true}).click();
 await expect(page.locator('.log-match')).toContainText('Error termination last synthetic marker');
 await page.locator('.log-match').scrollIntoViewIfNeeded();
 await page.screenshot({path:info.outputPath('log-search.png')});
});

test('hash history and unknown attempts do not silently select another',async({page})=>{
 await page.goto('/#/butane-demo/prepared');
 await expect(page.getByLabel('预览结构')).toHaveValue('input');
 await page.getByRole('button',{name:'xtb-prepared',exact:true}).click();
 await expect(page).toHaveURL(/#\/butane-demo\/xtb-prepared$/);
 await expect(page.getByRole('region',{name:'输入参数'})).toContainText('C4H10');
 await page.goBack();await expect(page.getByRole('heading',{name:'prepared',exact:true})).toBeVisible();
 await page.goto('/#/butane-demo/missing-attempt');
 await expect(page.getByRole('alert')).toContainText('File or directory not available');
});
