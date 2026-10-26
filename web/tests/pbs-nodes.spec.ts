import {test,expect} from '@playwright/test';
import type {Page} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {nodeAllocation,orderedResourceTiers,resourceWalltimeLabel,resourceWalltimeSeconds,serverModels} from '../src/jobs-data';
import type {ClusterRow} from '../src/jobs-data';

const now=Date.parse('2026-10-20T03:00:00Z');
function rows():ClusterRow[]{return JSON.parse(readFileSync(new URL('../../tests/monitor-fixtures/t143/pbs-nodes-synthetic.json',import.meta.url),'utf8')).clusters;}
async function setup(page:Page,data=rows()){
 await page.clock.install({time:now});
 await page.route('**/api/monitor',r=>r.fulfill({json:{clusters:data}}));
 await page.goto('/#/servers');
 await expect(page.locator('.server-card')).toHaveCount(data.length);
}
async function openNodes(page:Page){
 const disclosure=page.getByRole('tabpanel').locator('summary').filter({hasText:'节点与队列'});
 if(await disclosure.locator('..').getAttribute('open')===null)await disclosure.click();
 return page.getByRole('table',{name:'节点表',exact:true});
}

test('resource time limits retain exact hours and reject invalid values',()=>{
 expect(resourceWalltimeLabel(undefined)).toBe('未配置（调度器仍可能限制）');
 expect(resourceWalltimeLabel('1234:00:00')).toBe('1234 小时');
 expect(resourceWalltimeLabel('36:30:15')).toBe('36 小时 30 分 15 秒（36:30:15）');
 expect(resourceWalltimeSeconds('00:00:01')).toBe(1);
 for(const value of [null,undefined,true,0,3600,'00:00:00','1:00:00','12345:00:00','24:60:00','24:00:60','２４:00:00','24:00:00\n'])expect(resourceWalltimeSeconds(value)).toBeNull();
 expect(orderedResourceTiers({ultra:6,complex:4,mini:1,max:5,general:3,simple:2})).toEqual([['mini',1],['simple',2],['general',3],['complex',4],['max',5],['ultra',6]]);
 expect(orderedResourceTiers({mini:1,metadata:0})).toEqual([['mini',1]]);
});

for(const count of [4,5,6])test(`resource detail displays ${count} configured tiers in fixed order and exact optional limits`,async({page},testInfo)=>{
 const names=['mini','simple','general','complex','max','ultra'].slice(0,count),data=rows().slice(0,2),own=data[0].snapshot!.own!;
 own.tiers=Object.fromEntries([...names].reverse().map((name,i)=>[name,{cores:i+1,mem_gb:(i+1)*4}]));
 own.max_queued_cores=18;own.shared_with=[data[1].name];data[1].snapshot!.own!.max_queued_cores=12;data[1].snapshot!.own!.shared_with=[data[0].name];
 if(count===5)own.max_walltime='36:30:15';if(count===6)own.max_walltime='1234:00:00';
 await setup(page,data);const panel=page.getByRole('tabpanel');await panel.locator('summary').filter({hasText:'限额、档位与存储'}).click();
 const table=panel.getByRole('table',{name:'档位表'});await expect(table.locator('tbody tr')).toHaveCount(count);
 await expect(table.locator('tbody tr td:first-child')).toHaveText(names);
 await expect(panel).toContainText('本人排队上限 12 核');
 await expect(panel).toContainText(count===4?'单作业时限上限：未配置（调度器仍可能限制）':count===5?'单作业时限上限：36 小时 30 分 15 秒（36:30:15）':'单作业时限上限：1234 小时');
 await expect(panel).not.toContainText('无限制');
 await panel.locator('details').filter({has:page.locator('summary').filter({hasText:'限额、档位与存储'})}).screenshot({path:testInfo.outputPath(`resource-tiers-${count}.png`)});
});

test('node proportions require complete, finite and consistent operands',()=>{
 expect(nodeAllocation(16,6)).toEqual({total:16,assigned:6,remaining:10,percent:37.5,inconsistent:false});
 expect(nodeAllocation(16,0)).toMatchObject({remaining:16,percent:0});
 for(const [total,used] of [[undefined,2],[16,undefined],[null,2],[16,null],[0,0],[0,2],[-1,2],[16,-1],[NaN,2],[16,Infinity]] as const){
  expect(nodeAllocation(total,used)).toMatchObject({remaining:null,percent:null});
 }
 expect(nodeAllocation(8,10)).toEqual({total:8,assigned:10,remaining:null,percent:null,inconsistent:true});
 const data=rows().slice(0,1);data[0].snapshot!.cluster!.hardware_capacity_known=true;data[0].snapshot!.cluster!.nodes=data[0].snapshot!.cluster!.nodes.slice(0,3);
 expect(serverModels(data,now)[0]).toMatchObject({freeNodes:1,freeCores:18,totalNodes:3});
 data[0].snapshot!.cluster!.nodes[0].cores_used=null;
 expect(serverModels(data,now)[0]).toMatchObject({freeNodes:null,freeCores:null,totalNodes:3});
});

test('nine PBS nodes distinguish raw state, slots, memory, unknowns and inconsistent samples',async({page})=>{
 const requests:string[]=[];page.on('request',r=>{if(r.url().includes('/api/'))requests.push(r.method()+' '+new URL(r.url()).pathname);});
 await setup(page);const table=await openNodes(page);
 await expect(table.locator('tbody tr')).toHaveCount(9);
 await expect(table.getByRole('columnheader')).toHaveText(['节点','PBS 状态','slots（已分配 / 总）','剩余 slots','作业数','内存（已分配 / 总）']);
 const node=(letter:string)=>table.getByRole('row').filter({has:page.getByText('synthetic-node-'+letter,{exact:true})});
 await expect(node('a')).toContainText('free');await expect(node('a')).toContainText('6 / 16');
 await expect(node('a').getByRole('cell').nth(3)).toHaveText('10');
 await expect(node('a').getByRole('cell').nth(4)).toHaveText('2');
 await expect(node('a')).toContainText('37.5% 已分配');await expect(node('a')).toContainText('12 / 64 GB');await expect(node('a')).toContainText('18.8% 已分配');
 await expect(node('a').getByRole('progressbar',{name:'synthetic-node-a slots分配比例'})).toHaveAttribute('value','37.5');
 await expect(node('b').getByRole('cell').nth(3)).toHaveText('8');await expect(node('b')).toContainText('0% 已分配');
 await expect(node('c').getByRole('cell').nth(3)).toHaveText('0');await expect(node('c')).toContainText('100% 已分配');
 await expect(node('d')).toContainText('down');await expect(node('d').getByRole('cell').nth(3)).toHaveText('16');
 await expect(node('e')).toContainText('未知 / 64 GB');await expect(node('e').getByRole('progressbar')).toHaveCount(1);
 for(const letter of ['f','g','h','i'])await expect(node(letter).getByRole('cell').nth(3)).toHaveText('未知');
 await expect(node('f').getByRole('cell').nth(4)).toHaveText('未知');await expect(node('f').getByRole('progressbar')).toHaveCount(0);
 await expect(node('h')).toContainText('10 / 8');await expect(node('h')).toContainText('40 / 32 GB');await expect(node('h').getByText('分配超过总量；比例未知')).toHaveCount(2);await expect(node('h').getByRole('progressbar')).toHaveCount(0);
 await expect(node('i')).toContainText('0 / 0');await expect(node('i').getByRole('progressbar')).toHaveCount(0);
 await expect(page.getByText('slots 是调度器分配量，不是实时 CPU 利用率。',{exact:false})).toBeVisible();
 await page.getByRole('button',{name:'选择服务器 pbs-beta',exact:true}).click();
 await expect(page.getByRole('table',{name:'节点表'}).getByRole('cell').nth(3)).toHaveText('6');
 await page.getByRole('button',{name:'选择服务器 batch-alpha',exact:true}).click();
 await page.getByRole('tabpanel').locator('summary').filter({hasText:'节点与队列'}).click();
 await expect(page.getByRole('table',{name:'节点表'})).toHaveCount(0);
 await expect(page.getByRole('tabpanel')).toContainText('分区 CPU：已分配 12 / 空闲 28 / 其他 0 / 总数 40');
 expect(requests.every(r=>r.startsWith('GET '))).toBeTruthy();
 expect(requests.every(r=>/^GET \/api\/(monitor|studies(?:\/[^/]+(?:\/attempts\/[^/]+\/snapshots)?)?)$/.test(r))).toBeTruthy();
});

for(const state of ['failed','expired','ambiguous','read-error','never-succeeded','legacy'] as const)test(`PBS ${state} snapshot keeps its evidence limits`,async({page})=>{
 const data=rows().slice(0,1),row=data[0],s=row.snapshot!;
 if(state==='failed'||state==='never-succeeded'){s.ok=false;s.error='Synthetic read failure';if(state==='never-succeeded')s.last_ok_at=null;}
 if(state==='expired')s.sampled_at=new Date(now-181000).toISOString();
 if(state==='ambiguous')row.ambiguous=true;
 if(state==='read-error')row.error='Synthetic source error';
 if(state==='legacy'){for(const n of s.cluster!.nodes){delete n.mem_assigned_gb;delete n.mem_total_gb;delete n.jobs;}}
 await setup(page,data);const table=await openNodes(page);
 if(state==='legacy'){
  await expect(table.locator('tbody tr').first()).toContainText('未知 / 未知 GB');
  await expect(table.locator('tbody tr').first().getByRole('cell').nth(4)).toHaveText('未知');
  await expect(table.locator('tbody tr').first().getByRole('progressbar')).toHaveCount(1);
 }else{
  await expect(page.getByText('节点数据非实时：',{exact:false})).toBeVisible();
  await expect(page.locator('.server-detail')).toHaveClass(/server-noncurrent/);
  await expect(table.locator('tbody tr')).toHaveCount(state==='never-succeeded'?0:9);
 }
});

for(const count of [4,5])for(const [width,height] of [[1440,900],[834,1112],[390,844]])test(`${count} cards and node table responsive and keyboard accessible ${width}`,async({page},testInfo)=>{
 await page.setViewportSize({width,height});await setup(page,rows().slice(0,count));
 const cards=page.locator('.server-card'),boxes=await cards.evaluateAll(es=>es.map(e=>{const b=e.getBoundingClientRect();return {x:b.x,y:b.y,width:b.width};}));
 expect(boxes.every(b=>b.width>200)).toBeTruthy();
 if(width===1440&&count===4)expect(new Set(boxes.map(b=>b.y)).size).toBe(1);
 if(width===1440&&count===5){
  expect(boxes[0].y).toBe(boxes[2].y);expect(boxes[3].y).toBe(boxes[4].y);expect(boxes[3].y).toBeGreaterThan(boxes[0].y);
  expect((boxes[3].x+boxes[4].x+boxes[4].width)/2).toBeCloseTo((boxes[0].x+boxes[2].x+boxes[2].width)/2,0);
 }
 const tabs=page.getByRole('tablist',{name:'服务器详情'});await tabs.getByRole('tab').first().focus();await page.keyboard.press('End');await expect(tabs.getByRole('tab').last()).toBeFocused();await page.keyboard.press('Home');await expect(tabs.getByRole('tab').first()).toBeFocused();
 const summary=page.getByRole('tabpanel').locator('summary').filter({hasText:'节点与队列'});await summary.focus();await page.keyboard.press('Enter');
 const region=page.getByRole('region',{name:'PBS 节点明细，可横向滚动'});await expect(region).toBeVisible();
 await page.keyboard.press('Tab');await expect(region).toBeFocused();
 expect(await region.evaluate(e=>getComputedStyle(e).outlineStyle)).not.toBe('none');
  if(width<900){await page.keyboard.press('ArrowRight');await expect.poll(()=>region.evaluate(e=>e.scrollLeft)).toBeGreaterThan(0);}
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
 await expect(page.getByRole('table',{name:'节点表'}).getByRole('columnheader')).toHaveCount(6);
 const bounds=await region.evaluate(e=>({regionBottom:e.getBoundingClientRect().bottom,lastRowBottom:e.querySelector('tbody tr:last-child')!.getBoundingClientRect().bottom,height:e.clientHeight,scrollHeight:e.scrollHeight}));
 expect(bounds.lastRowBottom).toBeLessThanOrEqual(bounds.regionBottom);expect(bounds.scrollHeight).toBeLessThanOrEqual(bounds.height+1);
 await page.evaluate(()=>document.fonts.ready);await region.evaluate(e=>e.scrollLeft=0);
 await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:testInfo.outputPath(`cards-${count}-${width}.png`)});
 await region.screenshot({path:testInfo.outputPath(`nodes-${count}-${width}.png`)});
});

test('five cards use one row on a wide desktop without changing labels',async({page})=>{
 await page.setViewportSize({width:1920,height:1080});await setup(page);
 const cards=page.locator('.server-card');expect(new Set(await cards.evaluateAll(es=>es.map(e=>e.getBoundingClientRect().y))).size).toBe(1);
 await expect(cards).toHaveCount(5);await expect(cards.nth(4)).toHaveAccessibleName('选择服务器 batch-beta');
});
