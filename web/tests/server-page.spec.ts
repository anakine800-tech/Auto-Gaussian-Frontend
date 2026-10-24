import {test,expect} from '@playwright/test';
import type {Page} from '@playwright/test';
import type {ClusterRow,Job,Monitor} from '../src/jobs-data';
import {serverModels,segments} from '../src/jobs-data';
import {ageText} from '../src/server-cards';
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
 const button=page.getByRole('button',{name:'立即重新采样'});await button.click();await expect(page.getByRole('tabpanel')).toContainText('已请求，等待采样');
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
 ['already_queued',null,'已在等待，结果见下一份快照'],['in_progress',null,'正在采样，结果见下一份快照'],
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
 const oldReads=otherReads.length;await page.getByRole('button',{name:'立即重新采样'}).click();await expect(page.getByRole('tabpanel')).toContainText('已请求');
 await page.clock.runFor(2999);expect(reads).toBe(1);await page.clock.runFor(1);await expect.poll(()=>reads).toBe(2);
 expect(otherReads.length).toBe(oldReads);
 if(changed){
  data[1].snapshot!.sampled_at=new Date(now+1000).toISOString();await page.clock.runFor(3000);await expect.poll(()=>reads).toBe(3);
  // A different entry's sample cannot end this entry's fast polling.
  data[0].snapshot!.sampled_at=new Date(now+2000).toISOString();await page.clock.runFor(3000);await expect.poll(()=>reads).toBe(4);
 }else{
  for(let i=0;i<39;i++){await page.clock.runFor(3000);await expect.poll(()=>reads).toBe(i+3);}
 }
 await expect(page.locator('.jobs-heading')).toContainText('每 30 秒读取');
 const before=reads;await page.clock.runFor(29999);expect(reads).toBe(before);await page.clock.runFor(1);await expect.poll(()=>reads).toBe(before+1);
});
for(const [width,height] of [[1440,860],[1280,720],[390,844]])test(`T128 review screenshots ${width}x${height}`,async({page})=>{
 await page.setViewportSize({width,height});await setupRetry(page);await page.evaluate(()=>document.fonts.ready);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
 await expect(page.locator('.server-card button')).toHaveCount(0);
 const dir='../tests/monitor-fixtures/t128';mkdirSync(dir,{recursive:true});
 if(width===1440)writeFileSync('../tests/monitor-fixtures/t128-synthetic.json',JSON.stringify({clusters:retryRows()},null,2)+'\n');
 await page.screenshot({path:`${dir}/servers-${width}x${height}.png`});
 await page.getByRole('button',{name:'选择服务器 paused'}).click();await page.getByRole('button',{name:'立即重新采样'}).click();
 const dialog=page.getByRole('dialog',{name:'确认重新采样'});await expect(dialog.getByRole('button',{name:'确认重试'})).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
 await page.screenshot({path:`${dir}/confirmation-${width}x${height}.png`});
 await dialog.getByRole('button',{name:'取消',exact:true}).click();await expect(dialog).not.toBeVisible();
});
