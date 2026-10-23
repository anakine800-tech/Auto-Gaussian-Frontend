import {test,expect} from '@playwright/test';
import type {Page,APIRequestContext} from '@playwright/test';
import {duration,finishedAttempts,latestSnapshot} from '../src/jobs-data';
import type {AttemptSummary} from '../src/api';
const now=Date.parse('2026-10-17T03:00:00Z');
async function setup(page:Page,request:APIRequestContext){
 await page.clock.install({time:now});
 const d=(await (await request.get('/api/monitor')).json()).clusters[0].snapshot;
 d.sampled_at=new Date(now).toISOString();d.own={...d.own,cores_running:8,cores_queued:8,committed_cap:88};
 d.own.jobs.push({...d.own.jobs[0],job_id:'synthetic-queued',name:'Synthetic butane queue',state:'Q',attempt:'anti',walltime_used:null});
 const other=structuredClone(d);other.interval_seconds=null;other.cluster.scheduler='slurm';other.cluster.hardware_capacity_known=false;other.own.cores_running=16;other.own.cores_queued=0;other.own.committed_cap=96;
 other.own.jobs=[{...d.own.jobs[0],job_id:'synthetic-external',name:'Synthetic external job',state:'RUNNING',study:null,attempt:null,cores:16,walltime_used:'1-02:00:00',walltime_limit:'2-00:00:00'}];
 await page.route('**/api/monitor',r=>r.fulfill({json:{clusters:[{name:'default',source:'legacy',ambiguous:false,snapshot:d,error:null},{name:'batch',source:'named',ambiguous:false,snapshot:other,error:null}]}}));
 const study=await (await request.get('/api/studies/butane-demo')).json();study.attempts.find((a:{id:string})=>a.id==='prepared').state='finished';
 await page.route('**/api/studies/butane-demo',r=>r.fulfill({json:study}));
 await page.route('**/attempts/anti/snapshots',r=>r.fulfill({json:{snapshots:[{name:'capture-old',error:null,data:{created_at:'2026-10-17T01:00:00Z',progress:{last_step_number:2,last_scf_energy_hartree:'-157.0'}}},{name:'capture-new',error:null,data:{created_at:'2026-10-17T02:59:00Z',progress:{last_step_number:7,last_scf_energy_hartree:'-1.570025D+02'}}}]}}));
}
test('legacy jobs retain snapshot progress, Attempt links and local finished records',async({page,request})=>{
 await setup(page,request);await page.goto('/#/jobs');
 const queue=page.getByRole('table',{name:'排队中作业表'}),run=page.getByRole('table',{name:'运行中作业表'});
 await expect(queue).toContainText('片段末次优化步：7');await expect(queue).toContainText('-157.002500');await expect(queue).toContainText('运行中快照，不是结果');await expect(run).toContainText('尚无本地快照');
 await expect(page.getByRole('table',{name:'待取回作业表'})).toContainText('prepared');
 await page.getByRole('button',{name:'选择服务器 batch'}).click();await expect(run).toContainText('54.2%');await expect(run).toContainText('未关联本地 Attempt');
 await page.getByRole('button',{name:'选择服务器 default'}).click();await queue.getByRole('link',{name:'anti',exact:true}).click();await expect(page).toHaveURL(/#\/s\/butane-demo\/a\/anti$/);
});
test('missing monitor preserves local finished group and per-Study errors',async({page,request})=>{
 await setup(page,request);await page.route('**/api/monitor',r=>r.fulfill({status:404,json:{detail:'没有本地采样'}}));await page.route('**/api/studies/descriptor-demo',r=>r.fulfill({status:422,json:{detail:'Synthetic unreadable Study'}}));await page.goto('/#/jobs');
 await expect(page.getByRole('alert').first()).toHaveText('没有本地采样');const table=page.getByRole('table',{name:'待取回作业表'});await expect(table).toContainText('prepared');await expect(table).not.toContainText('waiting');await expect(page.getByRole('alert').last()).toContainText('descriptor-demo：Synthetic unreadable Study');
});
test('unknown time, malformed snapshots and optional job identity stay readable',async({page,request})=>{
 await setup(page,request);await page.route('**/attempts/opt-demo/snapshots',r=>r.fulfill({json:{snapshots:[{name:'bad',data:null,error:'Snapshot schema or Attempt identity does not match'}]}}));await page.goto('/#/jobs');const table=page.getByRole('table',{name:'运行中作业表'});await expect(table).toContainText('1 份记录不可读或时间缺失');await expect(page.getByRole('table',{name:'排队中作业表'})).toContainText('进度未知');
 await page.locator('.server-job-group').first().locator('.column-picker summary').click();await page.locator('.server-job-group').first().getByRole('checkbox',{name:'作业号',exact:true}).check();await expect(table).toContainText('synthetic-001');await expect(table).toContainText('demo');await expect(table).toContainText('未知');
 const d=(await (await request.get('/api/monitor')).json()).clusters[0].snapshot;d.own.jobs=[];await page.route('**/api/monitor',r=>r.fulfill({json:{clusters:[{name:'default',source:'legacy',ambiguous:false,snapshot:d,error:null}]}}));await page.reload();await expect(table.locator('tbody tr')).toHaveCount(0);
});
test('polling keeps progress attached to its Attempt when jobs change',async({page,request})=>{
 await setup(page,request);await page.goto('/#/jobs');await expect(page.getByRole('table',{name:'排队中作业表'})).toContainText('片段末次优化步：7');
 const d=(await (await request.get('/api/monitor')).json()).clusters[0].snapshot;d.own.jobs=[{...d.own.jobs[0],attempt:'anti',job_id:'synthetic-reordered',name:'Synthetic reordered job'}];
 await page.route('**/api/monitor',r=>r.fulfill({json:{clusters:[{name:'default',source:'legacy',ambiguous:false,snapshot:d,error:null}]}}));await page.clock.fastForward(30001);
 const table=page.getByRole('table',{name:'运行中作业表'});await expect(table.locator('tbody tr')).toHaveCount(1);await expect(table).toContainText('Synthetic reordered job');await expect(table).toContainText('片段末次优化步：7');await expect(table).not.toContainText('opt-demo');
});
test('T97 duration and snapshot selection never invent progress',()=>{
 expect(duration('26:01:03')).toBe(93663);expect(duration('1-02:00:00')).toBe(93600);for(const value of [null,'','01:99:00','1h','UNLIMITED','-1:00:00'])expect(duration(value)).toBeNull();
 const rows=[{name:'new',error:null,data:{created_at:'2026-01-03T00:00:00Z'}},{name:'invalid',error:null,data:{created_at:'unknown'}},{name:'old',error:null,data:{created_at:'2026-01-01T00:00:00Z'}}];expect(latestSnapshot(rows).latest?.name).toBe('new');expect(latestSnapshot(rows).unreadable).toBe(1);expect(finishedAttempts([])).toEqual([]);
 const attempt={id:'synthetic',state:'finished',manifest:{data:null,error:'Unreadable'},status:{data:{elapsed:'00:01:00'},error:null}} as AttemptSummary;expect(finishedAttempts([{study:'synthetic',attempt}])[0].cluster).toBe('—');attempt.manifest={data:{},error:null};expect(finishedAttempts([{study:'synthetic',attempt}])[0].cluster).toBe('default');
});
