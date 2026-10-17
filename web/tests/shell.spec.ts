import {test,expect} from '@playwright/test';
import type {Locator,Page} from '@playwright/test';
import {readFileSync,readdirSync} from 'node:fs';
import {resolve,join} from 'node:path';

async function fullyVisible(locator:Locator,page:Page){
 await expect(locator).toBeVisible();const box=await locator.boundingBox();const size=page.viewportSize()!;
 expect(box).not.toBeNull();expect(box!.x).toBeGreaterThanOrEqual(0);expect(box!.y).toBeGreaterThanOrEqual(0);
 expect(box!.x+box!.width).toBeLessThanOrEqual(size.width);expect(box!.y+box!.height).toBeLessThanOrEqual(size.height);
}
for(const size of [{width:1440,height:860},{width:1280,height:720}])test(`four entry screenshots and first-screen shell ${size.width}x${size.height}`,async({page},info)=>{
 await page.setViewportSize(size);await page.clock.setFixedTime(new Date('2026-10-17T02:00:00Z'));
 await page.goto('/#/s/butane-demo');await expect(page.getByRole('table',{name:'Attempt 结果表'})).toContainText('opt-demo');
 for(const [entry,name,ready] of [['作业','jobs','服务器监控'],['Study','study','结果总览'],['分析','analysis','分析报告'],['文件','files','研究文件']]){
  await page.getByRole('navigation',{name:'顶部导航'}).getByRole('button',{name:entry,exact:true}).click();
  await expect(page.getByRole('heading',{name:ready,exact:true})).toBeVisible();
  if(entry==='作业')await expect(page.getByRole('table',{name:'本人作业表'})).toBeVisible();
  if(entry==='分析')await expect(page.getByRole('heading',{name:'thermo-demo.json',exact:true})).toBeVisible();
  if(entry==='文件')await expect(page.getByRole('heading',{name:'study.md',exact:true})).toBeVisible();
  await page.evaluate(()=>window.scrollTo(0,0));
  await fullyVisible(page.locator('.app-header'),page);await fullyVisible(page.locator('.context-bar'),page);
  await fullyVisible(page.getByRole('heading',{name:ready,exact:true}),page);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(size.width);
  await page.screenshot({path:info.outputPath(`${name}-${size.width}x${size.height}.png`)});
 }
});

test('legacy exact links replace history and preserve both query locations',async({page})=>{
 await page.goto('/?keep=1#/s/butane-demo/files');
 await expect(page.getByRole('heading',{name:'study.md',exact:true})).toBeVisible();
 await page.evaluate(()=>{location.hash='#/butane-demo/prepared?extra=retained';});
 await expect(page).toHaveURL(/\?keep=1#\/s\/butane-demo\/a\/prepared\?extra=retained$/);
 await expect(page.getByRole('heading',{name:'prepared',exact:true})).toBeVisible();
 await page.goBack();await expect(page).toHaveURL(/#\/s\/butane-demo\/files$/);
 await page.goForward();await expect(page).toHaveURL(/#\/s\/butane-demo\/a\/prepared\?extra=retained$/);
 await page.goto('/#/ensemble-demo/ensembles/ensemble.json?candidate=2');
 await expect(page).toHaveURL(/#\/s\/ensemble-demo\/analysis\/ensemble\/ensemble.json\?candidate=2$/);
 await expect(page.getByRole('button',{name:'候选 2 缩略图'})).toHaveAttribute('aria-pressed','true');
 await page.goto('/#/butane-demo/structures/butane/conformers.xyz');
 await expect(page).toHaveURL(/#\/s\/butane-demo\/files\/structures\/butane\/conformers.xyz$/);
 await expect(page.getByLabel('帧号')).toHaveValue('1');
});

test('search reads only cached studies and navigates Attempts and filenames',async({page})=>{
 await page.goto('/#/s/butane-demo');await expect(page.getByRole('table',{name:'Attempt 结果表'})).toContainText('opt-demo');
 await expect(page.getByRole('heading',{name:'thermo-demo.json',exact:true})).toBeVisible();
 const requests:string[]=[];page.on('request',r=>requests.push(r.url()));
 await page.getByRole('textbox',{name:'全局搜索'}).fill('opt-demo');
 const results=page.getByRole('region',{name:'搜索结果'});
 await expect(results).toContainText('已读取的 1 个 Study');await expect(results.getByRole('link')).toHaveCount(1);
 expect(requests).toEqual([]);
 await results.getByRole('link').click();await expect(page).toHaveURL(/#\/s\/butane-demo\/a\/opt-demo$/);
 await page.getByRole('textbox',{name:'全局搜索'}).fill('thermo-demo.json');await results.getByRole('link').click();
 await expect(page.getByRole('heading',{name:'thermo-demo.json',exact:true})).toBeVisible();
 await page.getByRole('textbox',{name:'全局搜索'}).fill('no-such-file');await expect(results).toContainText('没有匹配项');
 await page.getByRole('textbox',{name:'全局搜索'}).press('Escape');await expect(results).toHaveCount(0);
});

test('last Study and disclosure survive reload; inaccessible storage falls back',async({page})=>{
 await page.goto('/#/s/ensemble-demo');await expect(page.getByRole('heading',{name:'ensemble-demo',exact:true})).toBeVisible();
 await page.locator('.study-sidebar summary').click();await expect(page.locator('.study-sidebar details')).not.toHaveAttribute('open');
 await page.goto('/');await expect(page).toHaveURL(/#\/s\/ensemble-demo$/);await expect(page.locator('.study-sidebar details')).not.toHaveAttribute('open');
 await page.addInitScript(()=>{Storage.prototype.getItem=()=>{throw Error('unavailable');};Storage.prototype.setItem=()=>{throw Error('unavailable');};});
 await page.goto('/');await expect(page).toHaveURL(/#\/s\/butane-demo$/);await expect(page.locator('.study-sidebar details')).toHaveAttribute('open');
 await page.locator('.study-sidebar summary').click();await page.reload();await expect(page.locator('.study-sidebar details')).toHaveAttribute('open');
});

test('all referenced CSS variables are defined',()=>{
 const source=resolve('src');const walk=(dir:string):string[]=>readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(join(dir,e.name)):/\.(css|tsx)$/.test(e.name)?[join(dir,e.name)]:[]);
 const files=walk(source),all=files.map(f=>readFileSync(f,'utf8')).join('\n');
 const defined=new Set([...all.matchAll(/(--[\w-]+)\s*:/g)].map(m=>m[1]));
 const missing=files.flatMap(file=>[...readFileSync(file,'utf8').matchAll(/var\((--[\w-]+)/g)].filter(m=>!defined.has(m[1])).map(m=>`${file.slice(source.length+1)}: ${m[1]}`));
 expect(missing).toEqual([]);
 expect(files.filter(f=>f.endsWith('.tsx')).filter(f=>/<style\b|style=\{/.test(readFileSync(f,'utf8')))).toEqual([]);
});


test('direct jobs entry can open the first Study without remembered state',async({page})=>{
 await page.goto('/#/jobs');
 const nav=page.getByRole('navigation',{name:'顶部导航'});
 await expect(nav.getByRole('button',{name:'Study',exact:true})).toBeEnabled();
 await nav.getByRole('button',{name:'Study',exact:true}).click();
 await expect(page).toHaveURL(/#\/s\/butane-demo$/);
 await expect(page.getByRole('table',{name:'Attempt 结果表'})).toBeVisible();
});
