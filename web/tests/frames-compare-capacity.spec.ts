import {spawn} from 'node:child_process';
import type {ChildProcess} from 'node:child_process';
import {resolve} from 'node:path';
import {test,expect} from '@playwright/test';
import type {Page,Locator} from '@playwright/test';
import {alignGeometry,alignmentReason} from '../src/geometry-alignment';
import type {Geometry} from '../src/molecule-viewer';
import {capacityGroups} from '../src/capacity-overview';
import {parseAtomPairs} from '../src/structure-comparison';
import {openSection} from './disclosure';

let server:ChildProcess;let serverErrors='';
test.beforeAll(async({request})=>{
 server=spawn(resolve(process.env.AUTOG_SOURCE_PYTHON??'../.venv/bin/python'),['-B','-m','tests.irc_review_fixture'],{cwd:resolve('..'),stdio:['ignore','ignore','pipe']});server.stderr?.on('data',x=>serverErrors+=String(x));server.on('error',e=>serverErrors+=e.message);
 await expect.poll(async()=>{if(server.exitCode!==null)throw Error(serverErrors);try{return (await request.get('http://127.0.0.1:18769/api/studies')).status();}catch{return 0;}},{timeout:15000}).toBe(200);
});
test.afterAll(async()=>{if(server?.exitCode===null&&server.signalCode===null)await new Promise<void>(done=>{server.once('exit',()=>done());server.kill('SIGTERM');});});
const water:Geometry={units:'angstrom',atoms:[{center:1,atomic_number:8,x:0,y:0,z:0},{center:2,atomic_number:1,x:1,y:0,z:0},{center:3,atomic_number:1,x:0,y:1,z:0}]};
const moved=(g:Geometry):Geometry=>({...g,atoms:g.atoms.map(a=>({...a,x:5-a.y,y:3+a.x,z:a.z-7}))});
test('Kabsch removes rigid motion, preserves distances/chirality and handles degeneracy',()=>{
 const tetra:Geometry={units:'angstrom',atoms:[...water.atoms,{center:4,atomic_number:6,x:0,y:0,z:1}]};
 for(const reference of [water,tetra,{...water,atoms:water.atoms.slice(0,1)},{...water,atoms:water.atoms.slice(0,2)}]){
  const input=moved(reference),before=JSON.stringify(input),aligned=alignGeometry(input,reference);
  aligned.atoms.forEach((a,i)=>{const b=reference.atoms[i];expect(a.x).toBeCloseTo(b.x,10);expect(a.y).toBeCloseTo(b.y,10);expect(a.z).toBeCloseTo(b.z,10);});expect(JSON.stringify(input)).toBe(before);
 }
 const mirror={...tetra,atoms:tetra.atoms.map(a=>({...a,z:-a.z}))},aligned=alignGeometry(mirror,tetra);
 expect(aligned.atoms.reduce((s,a,i)=>s+Math.hypot(a.x-tetra.atoms[i].x,a.y-tetra.atoms[i].y,a.z-tetra.atoms[i].z),0)).toBeGreaterThan(.1);
 expect(alignmentReason([water,{...water,atoms:[water.atoms[1],water.atoms[0],water.atoms[2]]}])).toContain('元素顺序');
 expect(alignmentReason([water,{...water,atoms:water.atoms.slice(1)}])).toContain('原子数');
 expect(parseAtomPairs('1-2, 2-3')).toEqual([[1,2],[2,3]]);for(const text of ['0-1','1-1','1;2','1-2,'])expect(()=>parseAtomPairs(text)).toThrow();
});
async function unchanged(page:Page,scene:Locator,change:()=>Promise<unknown>,ready:()=>Promise<unknown>){
 await scene.scrollIntoViewIfNeeded();await scene.press('ArrowRight');await scene.press('+');await scene.press('Shift+ArrowLeft');
 const handle=await scene.elementHandle();
 await page.evaluate(()=>new Promise<void>(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r()))));
 const before={y:await page.evaluate(()=>scrollY),camera:await scene.getAttribute('data-camera'),height:(await scene.boundingBox())!.height,container:await scene.evaluate(el=>el.closest('.frame-viewer')!.getBoundingClientRect().height)};
 await change();await ready();
 await expect.poll(()=>page.evaluate(()=>scrollY)).toBe(before.y);
 await expect(scene).toHaveAttribute('data-camera',before.camera!);
 expect((await scene.boundingBox())!.height).toBe(before.height);expect(await scene.evaluate(el=>el.closest('.frame-viewer')!.getBoundingClientRect().height)).toBe(before.container);
 expect(await scene.evaluate((el,previous)=>el===previous,handle)).toBe(true);
}
for(const [width,height] of [[1440,860],[1280,720]])test(`frame switches preserve scene, camera, scroll and height ${width}x${height}`,async({page},info)=>{
 await page.setViewportSize({width,height});
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/#/s/butane-demo/a/opt-demo');await openSection(page,'优化过程');
 const opt=page.getByRole('article',{name:'优化段 1'}),scene=opt.getByTestId('molecule-scene');await expect(scene).toBeVisible();
 // Click inside the DOM to avoid Playwright scrolling an off-screen control.
 await unchanged(page,scene,()=>opt.getByRole('button',{name:'下一步',exact:true}).evaluate((el:HTMLButtonElement)=>el.click()),()=>expect(opt.getByLabel('第 1 段优化步')).toHaveValue('2'));
 await opt.getByLabel('对齐到参考帧').check();await page.screenshot({path:info.outputPath(`frames-optimization-${width}.png`)});
 await page.goto('/#/s/ensemble-demo/analysis/ensemble/ensemble.json');
 const ensemble=page.getByRole('region',{name:'构象集合页'});await expect(ensemble.getByTestId('molecule-scene')).toBeVisible();
 await unchanged(page,ensemble.getByTestId('molecule-scene'),()=>page.getByRole('button',{name:'候选 2 缩略图',exact:true}).evaluate((el:HTMLButtonElement)=>el.click()),()=>expect(page).toHaveURL(/candidate=2$/));
 await page.goto('/#/s/butane-demo/files/structures/butane/conformers.xyz');await expect(page.getByTestId('molecule-scene')).toBeVisible();
 await unchanged(page,page.getByTestId('molecule-scene'),()=>page.getByRole('button',{name:'下一帧',exact:true}).evaluate((el:HTMLButtonElement)=>el.click()),()=>expect(page.getByTestId('frame-comment')).toContainText('-1.1'));
 await page.goto('/#/s/butane-demo/files/analyses/representatives.xyz');await expect(page.getByTestId('molecule-scene')).toBeVisible();
 await unchanged(page,page.getByTestId('molecule-scene'),()=>page.getByRole('button',{name:'下一帧',exact:true}).evaluate((el:HTMLButtonElement)=>el.click()),()=>expect(page.locator('.structure-frames')).toHaveAttribute('aria-busy','false'));
 await page.goto('http://127.0.0.1:18769/#/s/irc-demo/analysis/irc/review.json');
 const irc=page.getByRole('region',{name:'路径点结构',exact:true});await expect(irc.getByTestId('molecule-scene')).toBeVisible();
 await unchanged(page,irc.getByTestId('molecule-scene'),()=>irc.getByRole('button',{name:'下一点',exact:true}).evaluate((el:HTMLButtonElement)=>el.click()),()=>expect(page.getByTestId('irc-selected')).toContainText('forward 点 1'));
 await page.screenshot({path:info.outputPath(`frames-irc-${width}.png`)});
 expect(errors).toEqual([]);
});

const source=(id:string,i:number,g:Geometry=water)=>({id,facts:{error:null,data:{program:'gaussian',program_version:'Synthetic G revision',route:'# HF/STO-3G Opt Freq',units:{energy:'Hartree'},charge:0,multiplicity:1,n_atoms:g.atoms.length,n_imag:i,energies:{scf:-76+i*.002}}},geometry:{error:null,data:g}});
async function compare(page:Page,count:number,mismatch=false,reordered=false){
 await page.route('**/comparison-structure',r=>{const id=r.request().url().split('/').at(-2)!,i=['anti','gauche','prepared'].indexOf(id),s=source(id,i,i===1?moved(water):water);if(mismatch&&i===1)s.facts.data.route='# B3LYP/STO-3G';if(reordered&&i===1)s.geometry.data={...water,atoms:[water.atoms[1],water.atoms[0],water.atoms[2]]};return r.fulfill({json:s});});
 await page.goto('/#/s/butane-demo/attempts');
 for(const id of ['anti','gauche','prepared'].slice(0,count))await page.getByRole('checkbox',{name:`比较 ${id}`,exact:true}).check();
 await page.getByRole('button',{name:`结构对比（${count}）`,exact:true}).click();
 await expect(page.getByTestId('structure-comparison-1').getByTestId('molecule-scene')).toBeVisible();
}
for(const [width,height] of [[1440,860],[1280,720]])for(const count of [2,3])test(`arbitrary ${count} structures, alignment and distances fit ${width}x${height}`,async({page},info)=>{
 await page.setViewportSize({width,height});const reads:string[]=[],writes:string[]=[];page.on('request',r=>{if(r.url().includes('/attempts/'))reads.push(r.url());if(r.method()!=='GET')writes.push(r.method());});
 await compare(page,count);const dialog=page.getByRole('dialog',{name:'结构对比',exact:true});
 await expect(dialog).toContainText('前端计算、非正式');await expect(page.getByTestId('structure-comparison-2')).toContainText('1.255');
 await dialog.getByLabel('对比原子对').fill('1-2,2-3');await dialog.getByLabel('对齐到第 1 个').check();
 for(let i=1;i<=count;i++){
  const card=page.getByTestId(`structure-comparison-${i}`);await expect(card.locator('.irc-structure-distances li')).toHaveText(['1-21.0000','2-31.4142']);
  await expect(card.locator('dd').nth(1)).toHaveText(String(i-1));await expect(card.getByRole('link')).toHaveAttribute('href',`#/s/butane-demo/research/a/${['anti','gauche','prepared'][i-1]}`);
  await expect(card.locator('[data-highlighted=true]')).toHaveCount(3);
 }
 const alignedAtoms=await page.getByTestId('structure-comparison-1').getByTestId('molecule-atom').evaluateAll(atoms=>atoms.map(a=>({center:a.getAttribute('data-center'),transform:a.getAttribute('transform')})).sort((a,b)=>Number(a.center)-Number(b.center)));
 const otherAtoms=await page.getByTestId('structure-comparison-2').getByTestId('molecule-atom').evaluateAll(atoms=>atoms.map(a=>({center:a.getAttribute('data-center'),transform:a.getAttribute('transform')})).sort((a,b)=>Number(a.center)-Number(b.center)));
 otherAtoms.forEach((a,i)=>{const values=a.transform!.match(/-?[\d.]+/g)!.map(Number),expected=alignedAtoms[i].transform!.match(/-?[\d.]+/g)!.map(Number);values.forEach((n,j)=>expect(n).toBeCloseTo(expected[j],8));});
 await expect.poll(()=>dialog.locator('.structure-comparison').evaluate(el=>getComputedStyle(el).getPropertyValue('--irc-scene-height'))).toMatch(/^\d+px$/);
 for(const card of await dialog.locator('.irc-structure-card').all()){const box=(await card.boundingBox())!;expect(box.x).toBeGreaterThanOrEqual(0);expect(box.y).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(width);expect(box.y+box.height).toBeLessThanOrEqual(height);await expect(card.getByTestId('molecule-scene')).toBeInViewport({ratio:1});}
 expect(writes).toEqual([]);expect(reads.every(url=>url.endsWith('/comparison-structure'))).toBe(true);
 await page.screenshot({path:info.outputPath(`t110-comparison-${count}-${width}.png`)});
 await dialog.getByRole('button',{name:'关闭抽屉'}).click();await page.getByRole('checkbox',{name:'比较 waiting',exact:true}).check();if(count===3)await expect(page.getByRole('button',{name:'结构对比（4）'})).toBeDisabled();
});
test('one selection disabled; incompatible protocols and atom order are explicit; narrow cards stack',async({page})=>{
 await page.goto('/#/s/butane-demo/attempts');await page.getByRole('checkbox',{name:'比较 anti',exact:true}).check();await expect(page.getByRole('button',{name:'结构对比（1）'})).toBeDisabled();
 await compare(page,2,true,true);const dialog=page.getByRole('dialog',{name:'结构对比',exact:true});await expect(dialog).toContainText('口径不同，不给相对能');await expect(dialog).toContainText('方法不同');await expect(dialog).toContainText('元素顺序不一致');await expect(dialog.getByLabel('对齐到第 1 个')).toBeDisabled();await expect(dialog).not.toContainText('ΔE / kcal/mol');
 await expect.poll(()=>dialog.locator('.structure-comparison').evaluate(el=>getComputedStyle(el).getPropertyValue('--irc-scene-height'))).toMatch(/^\d+px$/);
 for(const card of await dialog.locator('.irc-structure-card').all()){const box=(await card.boundingBox())!;expect(box.y+box.height).toBeLessThanOrEqual(page.viewportSize()!.height);}
 await page.setViewportSize({width:390,height:844});const cards=dialog.locator('.irc-structure-card'),first=(await cards.nth(0).boundingBox())!,second=(await cards.nth(1).boundingBox())!;expect(second.y).toBeGreaterThanOrEqual(first.y+first.height);expect(second.x).toBe(first.x);
 await dialog.getByLabel('对比原子对').fill('1-99');await expect(dialog).toContainText('原子编号超出');await expect(dialog.locator('[data-highlighted=true]')).toHaveCount(0);
});
test('frame alignment changes displayed coordinates and disables incompatible order',async({page})=>{
 await page.route('**/structures/butane/conformers.xyz?*',r=>{const frame=Number(new URL(r.request().url()).searchParams.get('frame'));return r.fulfill({json:{frame,frame_count:3,comment:'Synthetic water frames',geometry:frame===0?water:frame===1?moved(water):{...water,atoms:[water.atoms[1],water.atoms[0],water.atoms[2]]}}});});
 await page.goto('/#/s/butane-demo/files/structures/butane/conformers.xyz');const scene=page.getByTestId('molecule-scene');await expect(scene).toBeVisible();const original=await page.getByTestId('molecule-atom').first().getAttribute('transform');
 await expect(page.getByLabel('对齐到参考帧')).not.toBeChecked();await page.getByRole('button',{name:'下一帧',exact:true}).click();await expect(page.locator('.structure-frames')).toHaveAttribute('aria-busy','false');await expect(page.getByTestId('molecule-atom').first()).not.toHaveAttribute('transform',original!);
 await page.getByLabel('对齐到参考帧').check();const aligned=await page.getByTestId('molecule-atom').first().getAttribute('transform');const numbers=(s:string)=>s.match(/-?[\d.]+/g)!.map(Number);numbers(aligned!).forEach((n,i)=>expect(n).toBeCloseTo(numbers(original!)[i],8));
 await page.getByLabel('参考帧',{exact:true}).selectOption('1');await expect(page.locator('.structure-frames')).toHaveAttribute('aria-busy','false');await expect(page.getByLabel('参考帧',{exact:true})).toHaveValue('1');
 await page.getByRole('button',{name:'下一帧',exact:true}).click();await expect(page.getByLabel('对齐到参考帧')).toBeDisabled();await expect(page.locator('.frame-alignment')).toContainText('元素顺序不一致');
});
const now=Date.parse('2026-10-23T03:00:00Z');
test('shared capacity groups never sum duplicate samples or substitute per-job caps',async({request})=>{
 const sample=(await (await request.get('/api/monitor')).json()).clusters[0].snapshot;
 sample.sampled_at=sample.last_ok_at=new Date(now).toISOString();Object.assign(sample.own,{cores_running:8,cores_queued:16,committed_cap:128,max_queued_cores:64});
 const rows=['batch','batch-test'].map(name=>({name,source:'named',ambiguous:false,error:null,snapshot:structuredClone(sample)}));rows[0].snapshot.own.shared_with=['batch-test'];rows[1].snapshot.own.shared_with=['batch'];
 expect(capacityGroups(rows,now)[0].available).toBe(104);rows[1].snapshot.own.committed_cap=96;expect(capacityGroups(rows,now)[0].available).toBe(72);expect(capacityGroups(rows.slice(0,1),now)[0].available).toBeNull();
 const retained=structuredClone(rows);retained[0].snapshot.ok=false;retained[0].snapshot.sampled_at=new Date(now+1000).toISOString();retained[0].snapshot.last_ok_at=new Date(now-600000).toISOString();retained[0].snapshot.own.cores_running=99;
 expect(capacityGroups(retained,now)[0].running).toBe(8);expect(capacityGroups(retained,now)[0].available).toBeNull();
 delete rows[1].snapshot.own.committed_cap;expect(capacityGroups(rows,now)[0].cap).toBeNull();
});
test('invalid action token has dedicated restart message, other 403 stays distinct',async({page})=>{
 let posts=0,token=true;await page.route('**/api/actions',r=>{posts++;return r.fulfill({status:403,json:{detail:token?'Invalid action token':'Local same-origin access only'}});});await page.goto('http://127.0.0.1:18766/#/s/butane-demo/a/prepared');await page.getByRole('button',{name:'刷新状态',exact:true}).click();await expect(page.getByRole('alert')).toHaveText('前端已重启，请刷新页面');expect(posts).toBe(1);
 token=false;await page.getByRole('button',{name:'刷新状态',exact:true}).click();await expect(page.getByRole('alert')).toContainText('Local same-origin access only');await expect(page.getByRole('alert')).not.toContainText('前端已重启');expect(posts).toBe(2);
});

test('non-Gaussian saved energies display without granting relative comparison; missing geometry is per card',async({page})=>{
 await compare(page,2);await page.getByRole('button',{name:'关闭抽屉'}).click();
 await page.route('**/comparison-structure',r=>{const id=r.request().url().split('/').at(-2)!,s=source(id,0) as any;s.facts.data.program=id==='anti'?'xtb':'crest';s.facts.data.total_energy=-12.3456789;s.facts.data.best_energy=-13.4567891;delete s.facts.data.route;if(id==='gauche')s.geometry={data:null,error:'Invalid final.xyz'};return r.fulfill({json:s});});
 await page.getByRole('button',{name:'结构对比（2）'}).click();await expect(page.getByTestId('structure-comparison-1')).toContainText('-12.345679');await expect(page.getByTestId('structure-comparison-2')).toContainText('-13.456789');await expect(page.getByTestId('structure-comparison-2')).toContainText('Invalid final.xyz');await expect(page.getByTestId('structure-comparison-1').getByTestId('molecule-scene')).toBeVisible();await expect(page.getByRole('dialog',{name:'结构对比',exact:true})).toContainText('口径不同，不给相对能');
});
