import {openSection} from './disclosure';
import {test,expect} from '@playwright/test';

test('list, table/thumbnail/3D linkage, sorting, reasons and saved URL',async({page})=>{
 const writes:string[]=[],errors:string[]=[];
 page.on('request',r=>{if(!['GET','HEAD'].includes(r.method()))writes.push(r.method());});
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/#/ensemble-demo');
 await page.getByRole('button',{name:'结果',exact:true}).click();
 await page.getByRole('region',{name:'构象集合列表'}).getByRole('link',{name:'合成水集合'}).click();
 const table=page.getByRole('table',{name:'构象能量表'});
 await expect(table).toContainText('42%');
 await table.getByRole('button',{name:'候选 2',exact:true}).click();
 await expect(page).toHaveURL(/candidate=2$/);
 await expect(page.getByRole('button',{name:'候选 2 缩略图'})).toHaveAttribute('aria-pressed','true');
 await expect(page.getByRole('region',{name:'三维分子结构'})).toContainText('候选 2 · 第 2 帧');
 const missing=table.locator('tr[data-candidate="2"] td').nth(3);
 await missing.hover();await expect(missing).toHaveAttribute('title',/missing:.*Synthetic missing calculation/);await expect(missing).toBeEmpty();
 await expect(table.locator('tr[data-candidate="3"] td').nth(3)).toHaveAttribute('title',/ambiguous: sp-a, sp-b/);
 await table.getByRole('button',{name:'xTB 相对能',exact:false}).click();
 await table.getByRole('button',{name:'xTB 相对能',exact:false}).click();
 await expect(table.locator('tbody tr').first()).toHaveAttribute('data-candidate','3');
 const thumbnail=page.getByRole('button',{name:'候选 1 缩略图'});await thumbnail.scrollIntoViewIfNeeded();await expect(thumbnail.locator('canvas')).toHaveAttribute('data-drawn','true');await thumbnail.click();
 await expect(table.locator('tr[data-candidate="1"]')).toHaveAttribute('aria-selected','true');
 await page.reload();await expect(page.getByRole('button',{name:'候选 1 缩略图'})).toHaveAttribute('aria-pressed','true');
 const viewer=page.getByRole('region',{name:'三维分子结构'});
 await expect(viewer).toContainText('3 / 3 原子');
 await viewer.getByText('结构工具 · 显示 / 测量 / 视角',{exact:true}).click();
 await viewer.getByLabel('测距原子 A',{exact:true}).selectOption('1');
 await viewer.getByLabel('测距原子 B',{exact:true}).selectOption('2');
 await expect(viewer.getByTestId('atom-distance')).toContainText('0.950');
 await expect(page.getByText('sp · unmatched-demo · 未匹配候选')).toBeVisible();
 await table.getByRole('link',{name:'crest-demo'}).first().click();
 await expect(page).toHaveURL(/#\/s\/ensemble-demo\/research\/a\/crest-demo$/);
 expect(writes).toEqual([]);expect(errors).toEqual([]);
});

test('per-source energies never form a cross-route sort column',async({page})=>{
 await page.goto('/#/ensemble-demo/ensembles/routes/separate.json');
 await expect(page.getByRole('note')).toHaveText('各路线 xTB 能量不可直接比较');
 const table=page.getByRole('table',{name:'构象能量表'});
 await expect(table.getByRole('button',{name:'xTB 相对能',exact:false})).toHaveCount(0);
 await table.locator('tbody tr').nth(1).getByText('各路线不可比较',{exact:true}).click();
 await expect(table.locator('tbody tr').nth(1)).toContainText('route-a · 帧 2: 0.1');
 await expect(table.locator('tbody tr').nth(1)).toContainText('route-b · 帧 2: 0.2');
 await table.getByRole('button',{name:'SP 相对能',exact:false}).click();
 await expect(table.locator('tbody tr').first()).toHaveAttribute('data-candidate','3');
});

test('55 candidates paginate and selection survives reload/back',async({page},info)=>{
 await page.goto('/#/ensemble-demo/ensembles/many/many.json');
 const grid=page.getByRole('group',{name:'候选缩略图'});
 await expect(grid.getByRole('button')).toHaveCount(50);
 await page.getByRole('button',{name:'下一组',exact:true}).click();
 await expect(grid.getByRole('button')).toHaveCount(5);
 await page.getByRole('button',{name:'候选 55 缩略图'}).click();
 await expect(page).toHaveURL(/candidate=55$/);
 await page.reload();await expect(page.getByRole('button',{name:'候选 55 缩略图'})).toHaveAttribute('aria-pressed','true');
 await page.getByRole('button',{name:'候选 54 缩略图'}).click();await page.goBack();
 await expect(page.getByRole('button',{name:'候选 55 缩略图'})).toHaveAttribute('aria-pressed','true');
 await page.screenshot({path:info.outputPath('ensemble.png'),fullPage:true});
 await page.setViewportSize({width:390,height:844});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test('CREST controls display energies, relative conversion and unknown comments',async({page},info)=>{
 await page.goto('/#/ensemble-demo/crest-demo');
 await openSection(page,'输入文件');const crest=page.getByRole('region',{name:'CREST 输出',exact:true});
 await crest.getByRole('link',{name:'attempts/crest-demo/crest-frames/crest_conformers.xyz',exact:true}).click();
 await expect(crest.getByTestId('frame-comment')).toContainText('能量 -76.0 Hartree');
 await crest.getByRole('button',{name:'下一帧',exact:true}).click();
 await expect(crest.getByLabel('帧号')).toHaveValue('2');
 await expect(crest.getByTestId('frame-comment')).toContainText('0.627509 kcal/mol');
 await expect(crest.getByTestId('frame-comment')).toContainText('仅供显示，以 facts 和后端分析为准');
 await crest.getByRole('button',{name:'下一帧',exact:true}).click();
 await expect(crest.getByTestId('frame-comment')).toContainText('能量 未知 Hartree');
 await crest.getByRole('link',{name:'attempts/crest-demo/crest-frames/crest_ensemble.xyz',exact:true}).click();
 await expect(crest.getByLabel('帧号')).toHaveValue('1');
 await page.screenshot({path:info.outputPath('crest.png'),fullPage:true});
 await page.goto('/#/ensemble-demo/gaussian-demo');await expect(page.getByRole('region',{name:'CREST 输出',exact:true})).toHaveCount(0);
});

test('broken ensemble and invalid selection remain errors',async({page})=>{
 await page.goto('/#/ensemble-demo/ensembles/missing.json');
 await expect(page.getByRole('alert')).toContainText('File not available');
 await expect(page.getByRole('region',{name:'三维分子结构'})).toHaveCount(0);
 await page.goto('/#/ensemble-demo/ensembles/ensemble.json?candidate=999');
 await expect(page.getByRole('alert')).toContainText('URL 中的候选不存在');
 await expect(page.getByRole('region',{name:'三维分子结构'})).toHaveCount(0);
});

test('T70 generated descriptors, filters, URL history and summary selection',async({page})=>{
 const writes:string[]=[],errors:string[]=[];
 page.on('request',r=>{if(!['GET','HEAD'].includes(r.method()))writes.push(r.method());});
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/#/descriptor-demo/ensembles/ensemble.json');
 const table=page.getByRole('table',{name:'构象能量表'});
 const filters=page.getByRole('region',{name:'局部构象筛选'});
 await expect(table.getByRole('columnheader',{name:'二面角 1–2–3–4'})).toBeVisible();
 await expect(table.getByRole('columnheader',{name:'距离 5–14（Å）'})).toBeVisible();
 await expect(table.locator('tbody tr')).toHaveCount(6);
 const first=table.locator('tr[data-candidate="10"]');
 await expect(first.locator('td').nth(9)).toHaveText('trans');
 await expect(first.locator('td').nth(9)).toHaveAttribute('title','-170.00000000537372°');
 await expect(first.locator('td').nth(11)).toHaveText(/^\d+\.\d{3}$/);
 await filters.getByLabel('gauche-', {exact:true}).check();
 await expect(table.locator('tbody tr')).toHaveCount(2);
 await expect(page).toHaveURL(/ensembleBin0=gauche-/);
 await filters.getByLabel('trans',{exact:true}).check();
 await expect(table.locator('tbody tr')).toHaveCount(4);
 await filters.getByLabel('只看近边界').check();
 await expect(table.locator('tbody tr')).toHaveCount(2);
 await expect(page).toHaveURL(/ensembleNearBoundary=1/);
 await table.getByRole('button',{name:'候选 30',exact:true}).click();
 await page.reload();
 await expect(filters.getByLabel('trans',{exact:true})).toBeChecked();
 await expect(filters.getByLabel('只看近边界')).toBeChecked();
 await expect(page.getByRole('region',{name:'三维分子结构'})).toContainText('候选 30 · 第 3 帧');
 await filters.getByLabel('只看近边界').uncheck();
 await expect(table.locator('tbody tr')).toHaveCount(4);
 await page.goBack();
 await expect(filters.getByLabel('只看近边界')).toBeChecked();
 await expect(table.locator('tbody tr')).toHaveCount(2);
 const summary=page.getByRole('table',{name:'分组汇总表'});
 await expect(summary.locator('tbody tr')).toHaveCount(3);
 await expect(summary.locator('tbody tr').first()).toContainText('sp');
 await summary.getByRole('link',{name:'候选 60'}).click();
 await expect(table.locator('tbody tr')).toHaveCount(6);
 await expect(table.locator('tr[data-candidate="60"]')).toHaveAttribute('aria-selected','true');
 await expect(page.getByRole('region',{name:'三维分子结构'})).toContainText('候选 60 · 第 6 帧');
 await filters.getByLabel('gauche+',{exact:true}).check();
 await filters.getByLabel('只看近边界').check();
 await expect(table.locator('tbody tr')).toHaveCount(0);
 await expect(filters).toContainText('符合筛选：0 / 6');
 await page.getByRole('button',{name:'清除局部筛选'}).click();
 await expect(table.locator('tbody tr')).toHaveCount(6);
 expect(writes).toEqual([]);expect(errors).toEqual([]);
});

test('invalid optional values keep energies and geometry; old manifests stay unchanged',async({page})=>{
 await page.goto('/#/descriptor-demo/ensembles/invalid.json');
 await expect(page.getByRole('alert')).toContainText('candidate 10.local.distances');
 const table=page.getByRole('table',{name:'构象能量表'});
 await expect(table.locator('tbody tr')).toHaveCount(6);
 await expect(table.getByRole('columnheader')).toHaveCount(9);
 await expect(page.getByRole('region',{name:'三维分子结构'})).toContainText('候选 10');
 await expect(page.getByRole('region',{name:'局部构象筛选'})).toHaveCount(0);
 await expect(page.getByRole('table',{name:'分组汇总表'})).toHaveCount(0);
 await page.goto('/?ensembleScope=%23%2Fdescriptor-demo%2Fensembles%2Fensemble.json&ensembleBin0=trans&ensembleNearBoundary=1#/ensemble-demo/ensembles/ensemble.json');
 await expect(table.getByRole('columnheader')).toHaveCount(9);
 await expect(table.locator('tbody tr')).toHaveCount(3);
 await expect(page.getByRole('alert')).toHaveCount(0);
 await expect(page.getByRole('region',{name:'局部构象筛选'})).toHaveCount(0);
});

for(const size of [{width:1440,height:860},{width:1280,height:720}])test(`T98 ensemble unified components ${size.width}x${size.height}`,async({page},info)=>{
 await page.setViewportSize(size);await page.goto('/#/s/ensemble-demo/analysis/ensemble/ensemble.json');
 const heading=page.getByRole('heading',{name:'合成水集合',exact:true}),table=page.getByRole('table',{name:'构象能量表'});
 await expect(heading).toBeVisible();await expect(table).toBeVisible();
 const box=(await table.locator('thead').boundingBox())!;expect(box.y).toBeGreaterThanOrEqual(0);expect(box.y+box.height).toBeLessThanOrEqual(size.height);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(size.width);await expect(page.locator('body')).not.toContainText('已验证');
 await page.screenshot({path:info.outputPath(`ensemble-${size.width}x${size.height}.png`)});
});
