import {test,expect} from '@playwright/test';
import type {Page} from '@playwright/test';
import type {ClusterRow,Job,Monitor} from '../src/jobs-data';
import {serverModels,segments} from '../src/jobs-data';
const now=Date.parse('2026-10-23T03:00:00Z'),iso=new Date(now).toISOString();
function job(id:string,mine:boolean,state='R',cores=8):Job{return {
 job_id:'synthetic-'+id,user:mine?'userA':'userB',name:'Synthetic '+id,mine,state,cores,queue:'queue-a',
 cores_kind:state==='R'?'allocated':'requested',mem_gb:12,elapsed_seconds:state==='R'?3420:null,
 elapsed_source:state==='R'?'start_time':null,walltime_limit_seconds:3600,
 start_time:state==='R'?'2026-10-23T02:03:00Z':null,qtime:'2026-10-23T01:00:00Z',
 study:mine?'butane-demo':null,attempt:mine?'anti':null,
};}
function snapshot(slurm=false):Monitor{
 const jobs=[job('other',false),job('own',true),job('queue-new',false,'Q',4),{...job('queue-old',false,'Q',4),qtime:'2026-10-22T01:00:00Z'},job('own-queue',true,'Q',8)];
 return {schema:'ag-monitor/1',sampled_at:iso,last_ok_at:iso,interval_seconds:slurm?60:30,ok:true,error:null,sample_duration_ms:200,
 own:{cores_in_use:16,core_cap:16,max_cores:16,cores_running:8,cores_queued:8,committed_cap:64,max_queued_cores:32,mem_running_gb:12,mem_queued_gb:12,tiers:{small:{cores:8,mem_gb:12}},jobs:jobs.filter(j=>j.mine)},
 cluster:{scheduler:slurm?'slurm':'pbs',display_order:null,cores_total:32,cores_used:16,hardware_capacity_known:true,
  hardware:{cores_total:32,cores_allocated:16,cores_idle:16,cores_other:0,mem_total_gb:slurm?null:64,mem_allocated_gb:slurm?null:24,source:slurm?'sinfo':'pbsnodes',error:null},
  job_summary:{running_jobs:2,running_cores:16,queued_jobs:3,queued_cores:16,others_running_jobs:1,others_running_cores:8,others_queued_jobs:2,others_queued_cores:8},jobs:slurm?jobs.filter(j=>j.mine):jobs,jobs_omitted:12,
  nodes:slurm?[]:[{name:'node-a',state:'free',cores_total:16,cores_used:0,mem_total_gb:32,mem_assigned_gb:0,jobs:0},{name:'node-b',state:'busy',cores_total:16,cores_used:16,mem_total_gb:32,mem_assigned_gb:24,jobs:2}],queues:[{name:'queue-a',running:2,queued:3}],
  storage_kib:2097152,storage_checked_at:iso,storage_sampled_at:iso,storage_error:null,
 },warnings:[{kind:'synthetic',detail:'合成警告：请核对作业状态',job_id:null,study:null,attempt:null}]};
}
function rows():ClusterRow[]{return ['slurm-b','pbs-b','slurm-a','pbs-a'].map(name=>{const s=snapshot(name.startsWith('slurm'));if(name.startsWith('slurm'))s.own!.shared_with=[name==='slurm-a'?'slurm-b':'slurm-a'];if(name==='pbs-b')s.cluster!.display_name='计算服务器 B';return {name,source:'named',ambiguous:false,error:null,snapshot:s};});}
async function setup(page:Page,data=rows()){
 await page.clock.install({time:now});
 await page.route('**/api/monitor',r=>r.fulfill({json:{clusters:data}}));
 await page.goto('/#/jobs');return data;
}
for(const [width,height] of [[1440,860],[1280,720],[390,844]])test(`server cards and grouped detail ${width}x${height}`,async({page},info)=>{
 await page.setViewportSize({width,height});const writes:string[]=[],errors:string[]=[];page.on('request',r=>{if(!['GET','HEAD'].includes(r.method()))writes.push(r.method());});page.on('pageerror',e=>errors.push(e.message));
 await setup(page);
 const cards=page.locator('.server-card');await expect(cards).toHaveCount(4);
 await expect(cards.nth(0)).toHaveAccessibleName('选择服务器 pbs-a');await expect(cards.nth(1)).toHaveAccessibleName('选择服务器 计算服务器 B（pbs-b）');
 await expect(cards.nth(0)).toHaveAttribute('aria-pressed','true');
 const cpu=cards.first().getByRole('img',{name:'核数：本人 8，他人 8，空闲 16，共 32',exact:true});await expect(cpu).toBeVisible();
 expect(await cpu.locator('.resource-mine').evaluate(e=>e.getBoundingClientRect().width/e.parentElement!.getBoundingClientRect().width)).toBeCloseTo(.25,1);
 await expect(cards.first().getByRole('img',{name:'内存：本人 12，他人 12，空闲 40，共 64 GB',exact:true})).toBeVisible();
 await expect(page.getByRole('heading',{name:'运行中 2 个作业 / 16 核',exact:true})).toBeVisible();
 const run=page.getByRole('table',{name:'运行中作业表'}),queue=page.getByRole('table',{name:'排队中作业表'});
 await expect(run.locator('tbody tr').first()).toContainText('本人');await expect(run).toContainText('95.0%');await expect(run.locator('.walltime-warning')).toHaveCount(2);
 expect(await run.locator('tbody tr').first().evaluate(e=>getComputedStyle(e).backgroundColor)).not.toBe(await run.locator('tbody tr').last().evaluate(e=>getComputedStyle(e).backgroundColor));
 await expect(queue.locator('tbody tr')).toHaveText([/Synthetic own-queue/,/Synthetic queue-old/,/Synthetic queue-new/]);
 await expect(page.getByText('其余 12 条未列出')).toBeVisible();for(const disclosure of await page.locator('.server-detail .Collapsible').all())await expect(disclosure).not.toHaveAttribute('open','');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
 if(width>=1100){const box=(await page.locator('.server-cards').boundingBox())!;expect(box.y+box.height).toBeLessThanOrEqual(height);}
 await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:info.outputPath(`t115-server-${width}x${height}.png`)});
 await page.screenshot({path:info.outputPath(`t115-server-${width}x${height}-full.png`),fullPage:true});
 await expect(page.getByRole('table',{name:'集群容量总览表'})).toHaveCount(0);await expect(page.getByRole('table',{name:'本人作业表'})).toHaveCount(0);
 expect(writes).toEqual([]);expect(errors).toEqual([]);
});
test('cards, tabs and arrow keys select detail; preferences persist per server',async({page})=>{
 await setup(page);const run=page.getByRole('table',{name:'运行中作业表'});await page.getByLabel('只看本人').check();await expect(run.locator('tbody tr')).toHaveCount(1);
 await page.getByRole('button',{name:'选择服务器 计算服务器 B（pbs-b）'}).click();await expect(page.getByLabel('只看本人')).not.toBeChecked();await expect(run.locator('tbody tr')).toHaveCount(2);
 await page.getByRole('tab',{name:'pbs-a 1 条警告'}).click();await expect(page.getByLabel('只看本人')).toBeChecked();
 await page.reload();await expect(page.getByLabel('只看本人')).toBeChecked();
 const tabs=page.getByRole('tablist');await tabs.getByRole('tab').first().focus();await page.keyboard.press('ArrowRight');await expect(tabs.getByRole('tab').nth(1)).toBeFocused();await expect(tabs.getByRole('tab').nth(1)).toHaveAttribute('aria-selected','true');
 await page.keyboard.press('End');await expect(tabs.getByRole('tab').last()).toBeFocused();await page.keyboard.press('ArrowRight');await expect(tabs.getByRole('tab').first()).toBeFocused();await page.keyboard.press('ArrowLeft');await expect(tabs.getByRole('tab').last()).toBeFocused();
});
test('Slurm hides others identity and nodes; summary and unknown memory stay explicit',async({page})=>{
 const data=rows();data[0].snapshot!.cluster!.jobs!.push(job('must-not-leak',false));await setup(page,data);
 await page.getByRole('button',{name:'选择服务器 slurm-b'}).click();const panel=page.getByRole('tabpanel');
 await expect(panel).not.toContainText('userB');await expect(panel).not.toContainText('must-not-leak');await expect(panel.getByText('其他用户：1 个作业 / 8 核',{exact:true})).toBeVisible();await expect(panel.getByText('其他用户：2 个作业 / 8 核',{exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'选择服务器 slurm-b'}).getByRole('img',{name:'内存：未知'})).toHaveClass(/resource-unknown/);
 await expect(page.getByRole('button',{name:'选择服务器 slurm-b'})).toContainText('与 slurm-a 共享总上限（只计一次）');
 await panel.locator('summary').filter({hasText:'节点与队列'}).click();await expect(panel).toContainText('分区 CPU：已分配 16 / 空闲 16 / 其他 0 / 总数 32');await expect(panel.getByRole('table',{name:'节点表'})).toHaveCount(0);
 await page.getByLabel('只看本人').check();await expect(panel.getByText('其他用户：',{exact:false})).toHaveCount(0);
});
test('sampling failure, hardware failure and expiry have distinct resource semantics',async({page})=>{
 const data=rows();data[3].snapshot!.ok=false;data[3].snapshot!.error='Synthetic sample failure';data[1].snapshot!.cluster!.hardware!.error='Synthetic hardware failure';data[2].snapshot!.sampled_at=new Date(now-181000).toISOString();
 await setup(page,data);
 const failed=page.getByRole('button',{name:'选择服务器 pbs-a'}),hw=page.getByRole('button',{name:'选择服务器 计算服务器 B（pbs-b）'}),stale=page.getByRole('button',{name:'选择服务器 slurm-a'});
 await expect(failed).toContainText('采样失败');await expect(failed).toContainText('上次成功');await expect(failed.getByRole('img',{name:'核数：未知'})).toBeVisible();await expect(failed).toContainText('本人：运行 未知');
 await hw.click();await expect(hw).toContainText('本人：运行 8');await expect(hw.getByRole('img',{name:'核数：未知'})).toBeVisible();await expect(page.getByRole('alert')).toContainText('Synthetic hardware failure');
 await stale.click();await expect(stale).toContainText('非最新');await expect(stale.getByRole('img',{name:'核数：本人 8，他人 8，空闲 16，共 32'})).toBeVisible();await expect(page.getByRole('tabpanel')).toContainText('数据已过期');
});
test('limits, tiers and storage appear in disclosure; single node opens by default',async({page})=>{
 const data=rows();data[3].snapshot!.cluster!.nodes=data[3].snapshot!.cluster!.nodes.slice(0,1);data[3].snapshot!.cluster!.storage_error='Synthetic storage failure';await setup(page,data);
 const panel=page.getByRole('tabpanel');await expect(panel.getByRole('region',{name:'警告',exact:true})).toContainText('2 条警告');await expect(panel.getByRole('region',{name:'警告',exact:true})).toContainText('Synthetic storage failure');await expect(panel.getByRole('table',{name:'节点表'})).toBeVisible();await expect(panel.getByRole('table',{name:'档位表'})).not.toBeVisible();
 await panel.locator('summary').filter({hasText:'限额、档位与存储'}).click();await expect(panel.getByRole('table',{name:'档位表'})).toContainText('small');await expect(panel).toContainText('单作业上限 16 核');await expect(panel).toContainText('存储占用：2 GB');await expect(panel).toContainText('查询时间：');await expect(panel).toContainText('Synthetic storage failure');
 await expect(page.locator('.server-cards')).not.toContainText('单作业上限');await expect(page.locator('.server-cards')).not.toContainText('small');
});
test('30 second interval expires only after 90 seconds; no new endpoints',async({page})=>{
 const data=rows(),reads:string[]=[];let polls=0;page.on('request',r=>{const path=new URL(r.url()).pathname;if(path.startsWith('/api/'))reads.push(path);if(path==='/api/monitor')polls++;});
 await setup(page,data);const card=page.getByRole('button',{name:'选择服务器 pbs-a'});await page.clock.setFixedTime(now+90000);await page.clock.runFor(30000);await expect(card).toContainText('新鲜');await page.clock.setFixedTime(now+91000);await page.clock.runFor(1000);await expect(card).toContainText('非最新');expect(polls).toBe(2);
 expect(reads.every(p=>p==='/api/monitor'||p==='/api/studies'||/^\/api\/studies\/[^/]+(?:\/attempts\/[^/]+\/snapshots)?$/.test(p))).toBeTruthy();
});
test('blocked browser storage falls back to all users',async({page})=>{
 await page.addInitScript(()=>{Object.defineProperty(Storage.prototype,'getItem',{value:()=>{throw new Error('Unavailable');}});Object.defineProperty(Storage.prototype,'setItem',{value:()=>{throw new Error('Unavailable');}});});await setup(page);await expect(page.getByLabel('只看本人')).not.toBeChecked();await page.getByLabel('只看本人').check();await expect(page.getByRole('table',{name:'运行中作业表'}).locator('tbody tr')).toHaveCount(1);
});
test('ordering, shared limits, inconsistent hardware and missing new fields stay explicit',()=>{
 const data=rows();data[0].snapshot!.cluster!.display_order=-2;data[1].snapshot!.cluster!.display_order=1;expect(serverModels(data,now).map(m=>m.row.name)).toEqual(['slurm-b','pbs-b','pbs-a','slurm-a']);
 data[0].snapshot!.own!.committed_cap=48;data[2].snapshot!.own!.cores_running=12;data[2].snapshot!.sampled_at=new Date(now+1000).toISOString();
 const shared=serverModels(data,now).filter(m=>m.row.name.startsWith('slurm'));expect(shared.map(m=>m.group.running)).toEqual([12,12]);expect(shared.map(m=>m.group.cap)).toEqual([48,48]);
 for(const args of [[null,16,8],[32,null,8],[32,16,null],[32,4,8],[16,32,8],[0,0,0]] as const)expect(segments(...args)).toBeNull();
 const legacy=snapshot();delete legacy.cluster!.jobs;delete legacy.cluster!.hardware;delete legacy.cluster!.job_summary;delete legacy.own!.cores_running;
 const m=serverModels([{name:'legacy',source:'named',ambiguous:false,error:null,snapshot:legacy}],now)[0];expect(m.cores).toBeNull();expect(m.running).toHaveLength(1);
});
