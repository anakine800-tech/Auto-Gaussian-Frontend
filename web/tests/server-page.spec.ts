import {test,expect} from '@playwright/test';
import type {Page} from '@playwright/test';
import type {ClusterRow,Job,Monitor} from '../src/jobs-data';
import {serverModels,segments} from '../src/jobs-data';
import {ageText,nextSampleText} from '../src/server-cards';
import {mkdirSync,writeFileSync} from 'node:fs';
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
 own:{cores_in_use:16,core_cap:16,max_cores:16,cores_running:8,cores_queued:8,committed_cap:64,max_queued_cores:32,mem_running_gb:12,mem_queued_gb:12,tiers:{simple:{cores:8,mem_gb:12}},jobs:jobs.filter(j=>j.mine)},
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
 const data=rows();data[3].snapshot!.ok=false;data[3].snapshot!.error='Synthetic sample failure';data[1].snapshot!.cluster!.hardware!.error='Synthetic hardware failure';data[1].snapshot!.cluster!.hardware!.cores_total=null;data[1].snapshot!.cluster!.hardware!.mem_total_gb=null;data[2].snapshot!.sampled_at=new Date(now-181000).toISOString();
 await setup(page,data);
 const failed=page.getByRole('button',{name:'选择服务器 pbs-a'}),hw=page.getByRole('button',{name:'选择服务器 计算服务器 B（pbs-b）'}),stale=page.getByRole('button',{name:'选择服务器 slurm-a'});
 await expect(failed).toContainText('采样失败');await expect(failed).toContainText('上次成功');await expect(failed.getByRole('img',{name:'核数：未知'})).toBeVisible();await expect(failed).toContainText('本人：运行 未知');
 await hw.click();await expect(hw).toContainText('本人：运行 8');await expect(hw.getByRole('img',{name:'核数：未知'})).toBeVisible();await expect(page.getByRole('alert')).toContainText('Synthetic hardware failure');
 await stale.click();await expect(stale).toContainText('非最新');await expect(stale.getByRole('img',{name:'核数：本人 8，他人 8，空闲 16，共 32'})).toBeVisible();await expect(page.getByRole('tabpanel')).toContainText('数据已过期');
});
test('limits, tiers and storage appear in disclosure; single node opens by default',async({page})=>{
 const data=rows();data[3].snapshot!.cluster!.nodes=data[3].snapshot!.cluster!.nodes.slice(0,1);data[3].snapshot!.cluster!.storage_error='Synthetic storage failure';await setup(page,data);
 const panel=page.getByRole('tabpanel');await expect(panel.getByRole('region',{name:'警告',exact:true})).toContainText('2 条警告');await expect(panel.getByRole('region',{name:'警告',exact:true})).toContainText('Synthetic storage failure');await expect(panel.getByRole('table',{name:'节点表'})).toBeVisible();await expect(panel.getByRole('table',{name:'档位表'})).not.toBeVisible();
 await panel.locator('summary').filter({hasText:'限额、档位与存储'}).click();await expect(panel.getByRole('table',{name:'档位表'})).toContainText('simple');await expect(panel).toContainText('单作业上限 16 核');await expect(panel).toContainText('存储占用：2 GB');await expect(panel).toContainText('查询时间：');await expect(panel).toContainText('Synthetic storage failure');
 await expect(page.locator('.server-cards')).not.toContainText('单作业上限');await expect(page.locator('.server-cards')).not.toContainText('simple');
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

function retryRows():ClusterRow[]{
 return ['default','batch','backoff','paused'].map((name,i)=>{
  const s=snapshot(i===1);s.warnings=[];s.cluster!.display_order=i;
  // Keep all test requests local; job snapshots are covered by the existing tests.
  for(const j of [...s.own!.jobs,...s.cluster!.jobs!]){j.study=null;j.attempt=null;}
  s.sampling={state:i===2?'backoff':i===3?'paused':'normal',consecutive_failures:i===2?4:i===3?1:0,current_interval_seconds:i===2?120:30,next_sample_at:i===3?null:new Date(now+120000).toISOString(),pause_reason:i===3?'auth':null,trigger:'scheduled',retry_pending:false};
  if(i===1)s.cluster!.hardware!.notes=['合成说明：异构节点总内存未知'];
  if(i>=2){s.ok=false;s.error='Synthetic sampling failure';}
  return {name,source:'named',ambiguous:false,error:null,snapshot:s};
 });
}
async function setupRetry(page:Page,data=retryRows(),actions=true){
 await page.clock.install({time:now});await page.clock.pauseAt(now+1000);
 await page.route('**/api/monitor',r=>r.fulfill({json:{clusters:data}}));
 await page.goto((actions?'http://127.0.0.1:18766':'')+'/#/servers');
 await expect(page.locator('.server-card')).toHaveCount(data.length);
 return data;
}
test('T128 scheduler inference, independent bars, notes and legacy data',()=>{
 const row:ClusterRow={name:'default',source:'named',ambiguous:false,error:null,snapshot:snapshot()};
 const model=()=>serverModels([row],now)[0],s=row.snapshot!;
 expect(model().scheduler).toBe('PBS');delete s.cluster!.scheduler;expect(model().scheduler).toBe('PBS');
 delete s.cluster!.hardware!.source;expect(model().scheduler).toBe('—');s.cluster!.hardware!.source='sinfo';expect(model().scheduler).toBe('SLURM');
 expect(model().sampling).toBeNull();expect(model().notes).toEqual([]);
 s.cluster!.hardware!.notes=['Synthetic memory limitation'];s.cluster!.hardware!.mem_total_gb=null;
 expect(model().cores).not.toBeNull();expect(model().memory).toBeNull();expect(model().warningCount).toBe(1);
 s.cluster!.hardware!.error='Synthetic AllocMem failure';expect(model().cores).not.toBeNull();expect(model().warningCount).toBe(2);
 s.cluster!.hardware!.cores_total=null;expect(model().cores).toBeNull();expect(model().memory).toBeNull();
 s.cluster!.hardware!.mem_total_gb=64;s.cluster!.hardware!.mem_allocated_gb=null;expect(model().memory).toBeNull();
 s.cluster!.hardware!.mem_allocated_gb=24;expect(model().memory).not.toBeNull();
 s.cluster!.hardware_capacity_known=false;expect(model().memory).toBeNull();
 const inferred=rows();for(const r of inferred)delete r.snapshot!.cluster!.scheduler;
 expect(serverModels(inferred,now).map(m=>m.row.name)).toEqual(['pbs-a','pbs-b','slurm-a','slurm-b']);
 for(const [seconds,text] of [[48,'48 秒'],[65,'1 分 5 秒'],[10800,'3 小时 0 分'],[93600,'1 天 2 小时']] as const)expect(ageText(seconds)).toBe(text);
});
test('T128 states, notes and errors have separate presentation',async({page})=>{
 const data=retryRows();delete data[0].snapshot!.cluster!.scheduler;
 await setupRetry(page,data,false);
 await expect(page.getByRole('button',{name:'选择服务器 default'})).toContainText('PBS');
 const batch=page.getByRole('button',{name:'选择服务器 batch'});
 await expect(batch.getByRole('img',{name:'核数：本人 8，他人 8，空闲 16，共 32'})).toBeVisible();
 await expect(batch.getByRole('img',{name:'内存：未知'})).toBeVisible();await expect(batch.locator('.hardware-note')).toHaveText('合成说明：异构节点总内存未知');
 await expect(batch).not.toContainText('条警告');
 const backoff=page.getByRole('button',{name:'选择服务器 backoff'});await expect(backoff).toContainText('退避中 · 连续失败 4 次 · 下次');await backoff.click();
 await expect(page.getByRole('tabpanel')).toContainText('退避中 · 连续失败 4 次 · 下次采样');
 await page.getByRole('button',{name:'选择服务器 paused'}).click();await expect(page.getByRole('tabpanel')).toContainText('已暂停：SSH 认证失败');
 await expect(page.getByRole('tabpanel')).toContainText('检查密钥、隧道或 known_hosts，修复后再重试');
 await expect(page.getByRole('button',{name:'立即重新采样'})).toHaveCount(0);
 data[3].snapshot!.sampling!.pause_reason='host_key';data[1].snapshot!.cluster!.hardware!.error='Synthetic AllocMem failure';await page.reload();
 await page.getByRole('button',{name:'选择服务器 paused'}).click();await expect(page.getByRole('tabpanel')).toContainText('已暂停：主机指纹变化');
 await batch.click();await expect(page.locator('.server-detail > :first-child')).toContainText('Synthetic AllocMem failure');await expect(batch).toContainText('1 条警告');
});
test('T128 retry queued uses token and exact fields; repeated clicks stay enabled',async({page})=>{
 await setupRetry(page);const payloads:unknown[]=[];
 await page.route('**/api/monitor/retry',async r=>{payloads.push(r.request().postDataJSON());expect(r.request().headers()['x-ag-token']).toBeTruthy();await r.fulfill({json:{entry:'default',result:'queued',reason:null,requested_at:iso}});});
 const button=page.getByRole('button',{name:'立即重新采样'});await button.click();await expect(page.getByRole('tabpanel')).toContainText('已登记，等待采样');
 await button.click();await expect.poll(()=>payloads.length).toBe(2);await expect(button).toBeEnabled();
 expect(payloads).toEqual([{cluster:'default',auth_fixed:false},{cluster:'default',auth_fixed:false}]);
});
for(const reason of ['auth','host_key'] as const)test(`T128 paused ${reason} needs page confirmation`,async({page})=>{
 const data=retryRows();data[0].snapshot!.sampling={...data[3].snapshot!.sampling!,pause_reason:reason};await setupRetry(page,data);
 const payloads:unknown[]=[];await page.route('**/api/monitor/retry',async r=>{payloads.push(r.request().postDataJSON());await r.fulfill({json:{entry:'default',result:'queued',reason:null,requested_at:iso}});});
 page.on('dialog',()=>{throw Error('Native confirmation is prohibited');});
 await page.getByRole('button',{name:'立即重新采样'}).click();const dialog=page.getByRole('dialog',{name:'确认重新采样'});
 await expect(dialog).toContainText(reason==='auth'?'SSH 认证失败':'主机指纹变化');await dialog.getByRole('button',{name:'取消',exact:true}).click();expect(payloads).toEqual([]);
 await page.getByRole('button',{name:'立即重新采样'}).click();await dialog.getByRole('button',{name:'确认重试'}).click();
 await expect.poll(()=>payloads.length).toBe(1);expect(payloads).toEqual([{cluster:'default',auth_fixed:true}]);await expect(dialog).not.toBeVisible();
});
for(const [result,reason,message] of [
 ['already_queued',null,'沿用既有请求，等待采样'],['in_progress',null,'已合并当前采样，等待结果'],
 ['refused','monitor_not_running','监控未运行，未登记请求'],['refused','auth_confirmation_required','需要先确认已修复认证问题'],
] as const)test(`T128 retry feedback ${result} ${reason}`,async({page})=>{
 await setupRetry(page);await page.route('**/api/monitor/retry',r=>r.fulfill({json:{entry:'default',result,reason,requested_at:null}}));
 await page.getByRole('button',{name:'立即重新采样'}).click();await expect(page.getByRole('tabpanel')).toContainText(message);
});
for(const [status,message] of [[502,'ag monitor 返回无效的重试 JSON；未自动重试'],[504,'ag monitor 重试请求超时（15 秒）；未自动重试']] as const)test(`T128 retry error ${status} is not retried`,async({page})=>{
 await setupRetry(page);let writes=0;await page.route('**/api/monitor/retry',r=>{writes++;return r.fulfill({status,json:{detail:message}});});
 await page.getByRole('button',{name:'立即重新采样'}).click();await expect(page.getByRole('tabpanel')).toContainText(message);
 await page.clock.runFor(9000);expect(writes).toBe(1);await expect(page.getByRole('button',{name:'立即重新采样'})).toBeEnabled();
});
for(const changed of [true,false])test(`T128 fast monitor polling ends on ${changed?'new sample':'120 seconds'}`,async({page})=>{
 const data=retryRows();let reads=0;const otherReads:string[]=[];
 page.on('request',r=>{const path=new URL(r.url()).pathname;if(path==='/api/monitor')reads++;else if(path.startsWith('/api/')&&r.method()==='GET')otherReads.push(path);});
 await setupRetry(page,data);await expect.poll(()=>reads).toBe(1);await expect(page.getByRole('table',{name:'待取回作业表'})).toBeVisible();
 await page.route('**/api/monitor/retry',r=>r.fulfill({json:{entry:'default',result:'queued',reason:null,requested_at:iso}}));
 const oldReads=otherReads.length;await page.getByRole('button',{name:'立即重新采样'}).click();await expect(page.getByRole('tabpanel')).toContainText('已登记');
 const advanceMonitor=async(ms:number,count:number)=>{
  // Wait for this response to render before advancing the clock again: the
  // next timeout is scheduled after fetch completes, not when it starts.
  data[1].snapshot!.cluster!.job_summary!.running_jobs=count;
  await page.clock.runFor(ms);await expect.poll(()=>reads).toBe(count);
  await expect(page.getByRole('button',{name:'选择服务器 batch'}).locator('.server-job-count')).toContainText(`运行 ${count} 个作业`);
 };
 await page.clock.runFor(2999);expect(reads).toBe(1);await advanceMonitor(1,2);
 expect(otherReads.length).toBe(oldReads);
 if(changed){
  data[1].snapshot!.sampled_at=new Date(now+1000).toISOString();await advanceMonitor(3000,3);
  // A different entry's sample cannot end this entry's fast polling.
  data[0].snapshot!.sampled_at=new Date(now+2000).toISOString();await advanceMonitor(3000,4);
 }else{
  for(let i=0;i<39;i++)await advanceMonitor(3000,i+3);
 }
 await expect(page.locator('.jobs-heading')).toContainText('每 30 秒读取');
 const before=reads;await page.clock.runFor(29999);expect(reads).toBe(before);await advanceMonitor(1,before+1);
});
for(const [width,height] of [[1440,860],[1280,720],[390,844]])test(`T128 review screenshots ${width}x${height}`,async({page},info)=>{
 await page.setViewportSize({width,height});await setupRetry(page);await page.evaluate(()=>document.fonts.ready);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
 await expect(page.locator('.server-card button')).toHaveCount(0);
 const dir=info.outputPath('t128');mkdirSync(dir,{recursive:true});
 if(width===1440)writeFileSync(info.outputPath('t128-synthetic.json'),JSON.stringify({clusters:retryRows()},null,2)+'\n');
 await page.screenshot({path:`${dir}/servers-${width}x${height}.png`});
 await page.getByRole('button',{name:'选择服务器 paused'}).click();await page.getByRole('button',{name:'立即重新采样'}).click();
 const dialog=page.getByRole('dialog',{name:'确认重新采样'});await expect(dialog.getByRole('button',{name:'确认重试'})).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
 await page.screenshot({path:`${dir}/confirmation-${width}x${height}.png`});
 await dialog.getByRole('button',{name:'取消',exact:true}).click();await expect(dialog).not.toBeVisible();
});

// T147 uses synthetic partition counts; Other must never become free CPU.
for(const [idle,other] of [[4,12],[0,16],[16,0]])test(`T147 Slurm Idle ${idle} Other ${other}`,async({page})=>{
 const data=retryRows(),h=data[1].snapshot!.cluster!.hardware!;h.cores_idle=idle;h.cores_other=other;
 await setupRetry(page,data,false);
 const cpu=page.getByRole('button',{name:'选择服务器 batch'}).getByRole('img',{name:/核数：/});
 await expect(cpu).toHaveAccessibleName(`核数：本人 8，他人 8，空闲 ${idle}${other?`，其他状态 ${other}`:''}，共 32`);
 await expect(cpu.locator('.resource-idle')).toHaveAttribute('width',String(100*idle/32));
 if(other)await expect(cpu.locator('.resource-other')).toHaveAttribute('width',String(100*other/32));
 else await expect(cpu.locator('.resource-other')).toHaveCount(0);
 await expect(page.getByLabel('资源颜色图例')).toHaveText(`深色 = 本人浅色 = 他人空白 = 空闲${other?'灰色 = 其他状态':''}斜纹 = 未知`);
});
test('T147 Slurm missing and contradictory CPU counts stay unknown',()=>{
 const data=retryRows(),h=data[1].snapshot!.cluster!.hardware!;
 const original={...h},model=()=>serverModels(data,now).find(m=>m.row.name==='batch')!;
 for(const fields of [
  {cores_idle:null},{cores_other:null},{cores_total:null},{cores_allocated:null},
  {cores_idle:4,cores_other:4},{cores_idle:20},{cores_other:-1},{cores_allocated:4,cores_idle:28},
  {cores_total:0,cores_allocated:0,cores_idle:0,cores_other:0},{cores_total:NaN},{cores_idle:Infinity},{cores_idle:15.5,cores_other:0.5},
 ]){Object.assign(h,original,fields);expect(model().cores).toBeNull();}
 Object.assign(h,original);delete (h as Partial<typeof h>).cores_idle;expect(model().cores).toBeNull();
 Object.assign(h,original);delete (h as Partial<typeof h>).cores_other;expect(model().cores).toBeNull();
});
test('T147 both resources unknown show each hardware note once',async({page})=>{
 const data=retryRows(),h=data[1].snapshot!.cluster!.hardware!;
 h.cores_idle=null;h.mem_total_gb=null;h.notes=['合成硬件说明','合成硬件说明','合成补充说明'];
 await setupRetry(page,data,false);const card=page.getByRole('button',{name:'选择服务器 batch'});
 await expect(card.getByRole('img',{name:'核数：未知'})).toBeVisible();await expect(card.getByRole('img',{name:'内存：未知'})).toBeVisible();
 await expect(card.locator('.hardware-note')).toHaveText(['合成硬件说明','合成补充说明']);
});
for(const result of ['queued','already_queued','in_progress'] as const)test(`T147 only accepted retry ${result} enables fast polling`,async({page})=>{
 let reads=0,writes=0;page.on('request',r=>{if(new URL(r.url()).pathname==='/api/monitor')reads++;});
 let release!:()=>void;const pending=new Promise<void>(resolve=>release=resolve);
 await setupRetry(page);await page.route('**/api/monitor/retry',async r=>{writes++;await pending;await r.fulfill({json:{entry:'default',result,reason:null,requested_at:iso}});});
 await page.getByRole('button',{name:'立即重新采样'}).click();await expect.poll(()=>writes).toBe(1);
 await expect(page.getByRole('tabpanel')).toContainText('正在请求…');await page.clock.runFor(9000);
 expect(reads).toBe(1);await expect(page.locator('.jobs-heading')).toContainText('每 30 秒读取');
 release();await expect(page.locator('.jobs-heading')).toContainText('每 3 秒读取');
 await page.clock.runFor(3000);await expect.poll(()=>reads).toBe(2);expect(writes).toBe(1);
});
for(const outcome of ['monitor_not_running','auth_confirmation_required','unknown_entry','502','504','network','invalid_json'])test(`T147 retry ${outcome} keeps normal polling`,async({page})=>{
 let reads=0,writes=0;page.on('request',r=>{if(new URL(r.url()).pathname==='/api/monitor')reads++;});
 await setupRetry(page);await page.route('**/api/monitor/retry',async r=>{
  writes++;
  if(outcome==='network')await r.abort('failed');
  else if(outcome==='invalid_json')await r.fulfill({body:'not JSON',contentType:'application/json'});
  else if(outcome==='502'||outcome==='504')await r.fulfill({status:Number(outcome),json:{detail:'合成请求失败或超时'}});
  else await r.fulfill({json:{entry:'default',result:'refused',reason:outcome,requested_at:null}});
 });
 await page.getByRole('button',{name:'立即重新采样'}).click();
 await expect(page.locator('.server-retry [role=status]')).not.toHaveText('正在请求…');
 await page.clock.runFor(9000);expect(reads).toBe(1);expect(writes).toBe(1);
 await expect(page.locator('.jobs-heading')).toContainText('每 30 秒读取');
 await page.clock.runFor(21000);await expect.poll(()=>reads).toBe(2);expect(writes).toBe(1);
});
test('T147 next sample labels handle expiry and invalid or missing time',()=>{
 for(const value of [null,undefined,'invalid'])expect(nextSampleText(value,now)).toBe('—');
 for(const value of [iso,new Date(now-1).toISOString()])expect(nextSampleText(value,now)).toBe('等待下一轮');
 expect(nextSampleText(new Date(now+1).toISOString(),now,()=> '未来时间')).toBe('未来时间');
});
for(const state of ['normal','backoff'] as const)test(`T147 ${state} expired schedule waits until a new future plan`,async({page})=>{
 const data=retryRows();data[0].snapshot!.sampling!.state=state;data[0].snapshot!.sampling!.next_sample_at=new Date(now+4000).toISOString();
 await setupRetry(page,data,false);const card=page.getByRole('button',{name:'选择服务器 default'}),detail=page.locator('.sampling-detail');
 await expect(card.locator('.sampling-status')).not.toContainText('等待下一轮');
 await page.clock.runFor(3000);await expect(card.locator('.sampling-status')).toContainText('等待下一轮');await expect(detail).toContainText('下次采样：等待下一轮');
 data[0].snapshot!.sampling!.next_sample_at=new Date(now+120000).toISOString();await page.clock.runFor(30000);
 await expect(card.locator('.sampling-status')).not.toContainText('等待下一轮');await expect(detail).not.toContainText('等待下一轮');
});
for(const reason of ['auth','host_key'] as const)test(`T147 ${reason} confirmation has natural Chinese spacing`,async({page})=>{
 const data=retryRows();data[0].snapshot!.sampling={...data[3].snapshot!.sampling!,pause_reason:reason};await setupRetry(page,data);
 await page.getByRole('button',{name:'立即重新采样'}).click();
 await expect(page.getByRole('dialog').locator('p')).toHaveText(`上次因${reason==='auth'?'SSH 认证失败':'主机指纹变化'}而暂停。请确认问题已修复后重新采样；失败后将继续暂停。`);
});

const trackedId='a'.repeat(32),otherId='b'.repeat(32);
function retryStatus(entry='default',id=trackedId,state:'queued'|'running'|'finished'|'discarded'='queued'):NonNullable<ClusterRow['retry_status']>{
 return {version:1,entry,request_id:id,requested_at:iso,state,reason:null,finished_at:state==='finished'?iso:null,sampled_at:state==='finished'?iso:null,ok:state==='finished'?true:null};
}
async function trackedSetup(page:Page,data=retryRows()){
 data[0].retry_tracking_supported=true;data[0].retry_status=retryStatus();
 await setupRetry(page,data);
 await page.route('**/api/monitor/retry',r=>r.fulfill({json:{entry:r.request().postDataJSON().cluster,result:'queued',reason:null,requested_at:iso,request_id:trackedId}}));
 await page.getByRole('button',{name:'立即重新采样'}).click();
 await expect(page.locator('.server-retry [role=status]')).toHaveText('已登记，等待采样');
 return data;
}
async function localPoll(page:Page,ms=3000){
 const response=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/monitor');
 await page.clock.runFor(ms);await response;
 // Wait for React to commit the response before advancing the fake clock.
 await page.waitForTimeout(10);
}
for(const ok of [true,false])test(`T151 queued running finished ${ok} uses control result not snapshot`,async({page})=>{
 const data=await trackedSetup(page),old=data[0].snapshot!.sampled_at;
 data[0].retry_status=retryStatus('default',trackedId,'running');await localPoll(page);
 await expect(page.locator('.server-retry [role=status]')).toHaveText('正在执行本次采样');
 data[0].snapshot!.sampled_at=new Date(now+8000).toISOString();await localPoll(page);
 await expect(page.locator('.jobs-heading')).toContainText('每 3 秒');
 data[0].snapshot!.sampled_at=old;data[0].retry_status={...retryStatus('default',trackedId,'finished'),ok};
 await localPoll(page);await expect(page.locator('.server-retry [role=status]')).toHaveText(ok?'本次采样完成':'本次采样失败，请查看采样错误');
 await expect(page.locator('.jobs-heading')).toContainText('每 30 秒');
});
for(const [reason,message] of [
 ['auth_confirmation_required','需先确认认证问题已修复'],['entry_removed','入口已移除'],
 ['config_changed','配置已变化，旧请求未执行'],['monitor_restarted','监控已重启，旧请求未执行'],
] as const)test(`T151 discarded ${reason} ends on next read without a new sample`,async({page})=>{
 const data=await trackedSetup(page),before=data[0].snapshot!.sampled_at;
 data[0].retry_status={...retryStatus('default',trackedId,'discarded'),reason,finished_at:iso};
 if(reason==='entry_removed'){data[0].snapshot=null;data[0].error='尚无快照';data[0].retry_tracking_supported=false;}
 await localPoll(page);await expect(page.locator('.server-retry [role=status]')).toHaveText(message);
 await expect(page.locator('.jobs-heading')).toContainText('每 30 秒');
 if(data[0].snapshot)expect(data[0].snapshot.sampled_at).toBe(before);
 await expect(page.getByRole('tabpanel')).not.toContainText(trackedId);
});
test('T151 entries and sources are independent and card messages survive switching',async({page})=>{
 const data=await trackedSetup(page);
 await page.getByRole('button',{name:'选择服务器 batch'}).click();
 await page.getByRole('button',{name:'立即重新采样'}).click();
 await expect(page.locator('.server-retry [role=status]')).toHaveText('已登记，等待采样');
 data[1].retry_status=retryStatus('batch',trackedId,'finished');
 data[0].source='legacy';data[0].retry_status=retryStatus('default',trackedId,'finished');
 await localPoll(page);await expect(page.locator('.server-retry [role=status]')).toHaveText('本次采样完成');
 await expect(page.locator('.jobs-heading')).toContainText('每 3 秒');
 data[0].source='named';data[0].retry_status=retryStatus();
 await localPoll(page);await page.getByRole('button',{name:'选择服务器 default'}).click();
 await expect(page.locator('.server-retry [role=status]')).toHaveText('已登记，等待采样');
 data[0].retry_status=retryStatus('default',trackedId,'finished');await localPoll(page);
 await expect(page.locator('.jobs-heading')).toContainText('每 30 秒');
});
test('T151 replaced id in the same second is unconfirmed',async({page})=>{
 const data=await trackedSetup(page);
 data[0].retry_status=retryStatus('default',otherId,'finished');await localPoll(page);
 await expect(page.locator('.server-retry [role=status]')).toHaveText('本次请求结果无法确认');
 await expect(page.locator('.jobs-heading')).toContainText('每 30 秒');
});
for(const unavailable of ['missing','stale','network'] as const)test(`T151 ${unavailable} times out then accepts late matching terminal on normal polling`,async({page})=>{
 const data=await trackedSetup(page);let reads=0,writes=1;
 page.on('request',r=>{if(new URL(r.url()).pathname==='/api/monitor/retry')writes++;});
 await page.route('**/api/monitor',r=>{reads++;return unavailable==='network'?r.abort():r.fulfill({json:{clusters:data}});});
 if(unavailable==='missing')data[0].retry_status=null;
 if(unavailable==='stale'){data[0].retry_status=retryStatus('default',trackedId,'finished');data[0].retry_status_error='监控心跳已陈旧，请求结果尚未确认';}
 for(let i=0;i<40;i++){
  await page.clock.runFor(3000);await expect.poll(()=>reads).toBe(i+1);
  if(unavailable==='network')await expect(page.getByText('Failed to fetch')).toBeVisible();
  else await page.waitForTimeout(10);
 }
 await expect(page.locator('.server-retry [role=status]')).toHaveText('等待超时，结果尚未确认');
 await expect(page.locator('.jobs-heading')).toContainText('每 30 秒');expect(writes).toBe(1);
 data[0].retry_status=retryStatus('default',trackedId,'finished');data[0].retry_status_error=null;
 await page.route('**/api/monitor',r=>r.fulfill({json:{clusters:data}}));await localPoll(page,30000);
 await expect(page.locator('.server-retry [role=status]')).toHaveText('本次采样完成');expect(writes).toBe(1);
});
test('T151 late old registration cannot start polling or overwrite a newer refusal after card switches',async({page})=>{
 await setupRetry(page);let release!:()=>void,calls=0;
 const pending=new Promise<void>(resolve=>{release=resolve;});
 await page.route('**/api/monitor/retry',async r=>{
  calls++;if(calls===1){await pending;await r.fulfill({json:{entry:'default',result:'queued',reason:null,requested_at:iso,request_id:trackedId}});}
  else await r.fulfill({json:{entry:'default',result:'refused',reason:'monitor_not_running',requested_at:null,request_id:null}});
 });
 await page.getByRole('button',{name:'立即重新采样'}).click();await expect.poll(()=>calls).toBe(1);
 await page.getByRole('button',{name:'选择服务器 batch'}).click();await page.getByRole('button',{name:'选择服务器 default'}).click();
 await expect(page.locator('.server-retry [role=status]')).toHaveText('正在请求…');
 await page.getByRole('button',{name:'立即重新采样'}).click();
 await expect(page.locator('.server-retry [role=status]')).toHaveText('监控未运行，未登记请求');
 const response=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/monitor/retry');release();await response;
 await page.clock.runFor(9000);await expect(page.locator('.jobs-heading')).toContainText('每 30 秒');
 await expect(page.locator('.server-retry [role=status]')).toHaveText('监控未运行，未登记请求');expect(calls).toBe(2);
});
test('T151 legacy new snapshot explicitly cannot identify the request',async({page})=>{
 const data=await setupRetry(page);await page.route('**/api/monitor/retry',r=>r.fulfill({json:{entry:'default',result:'queued',reason:null,requested_at:iso}}));
 await page.getByRole('button',{name:'立即重新采样'}).click();await expect(page.locator('.server-retry [role=status]')).toContainText('旧后端无法精确追踪');
 data[0].snapshot!.sampled_at=new Date(now+4000).toISOString();await localPoll(page);
 await expect(page.locator('.server-retry [role=status]')).toHaveText('已收到新采样，无法精确对应本次请求');
});
for(const request_id of [null,'invalid',3])test(`T151 malformed tracking id ${request_id} never polls fast`,async({page})=>{
 await setupRetry(page);let writes=0;
 await page.route('**/api/monitor/retry',r=>{writes++;return r.fulfill({json:{entry:'default',result:'queued',reason:null,requested_at:iso,request_id}});});
 await page.getByRole('button',{name:'立即重新采样'}).click();
 await expect(page.locator('.server-retry [role=status]')).toContainText('无效的重试 JSON');
 await page.clock.runFor(9000);await expect(page.locator('.jobs-heading')).toContainText('每 30 秒');expect(writes).toBe(1);
});
for(const width of [1440,390])test(`T151 synthetic terminal feedback screenshot ${width}`,async({page},info)=>{
 await page.setViewportSize({width,height:860});const data=await trackedSetup(page);
 data[0].retry_status={...retryStatus('default',trackedId,'discarded'),reason:'config_changed',finished_at:iso};
 await localPoll(page);await expect(page.locator('.server-retry [role=status]')).toHaveText('配置已变化，旧请求未执行');
 if(width===390){
  await page.locator('.server-retry').evaluate(el=>el.scrollIntoView({block:'center'}));
  await page.screenshot({path:info.outputPath(`t151-terminal-${width}.png`)});
 }
 else await page.screenshot({path:info.outputPath(`t151-terminal-${width}.png`),fullPage:true});
});
