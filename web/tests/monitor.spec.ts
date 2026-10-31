import {test,expect} from '@playwright/test';
import type {Page} from '@playwright/test';
import type {ClusterRow,LinkHealth,Monitor,MonitorResponse} from '../src/jobs-data';
import {serverModels} from '../src/jobs-data';

const now=Date.parse('2026-10-31T03:00:00Z');
function snapshot(age=0,interval:number|null=30,ok=true):Monitor{
 const sampled_at=new Date(now-age*1000).toISOString();
 // An older producer supplies sampling facts only. Entry names are not link evidence.
 return {schema:'ag-monitor/1',sampled_at,interval_seconds:interval,ok,
  error:ok?null:'Synthetic sampling failure',last_ok_at:ok?sampled_at:null,
  own:{cores_in_use:0,core_cap:8,jobs:[]},
  cluster:{cores_total:null,cores_used:null,nodes:[],queues:[]},warnings:[]};
}
function row(name:string,data:Monitor|null=snapshot(),error:string|null=null):ClusterRow{
 return {name,source:'named',ambiguous:false,snapshot:data,error};
}
type PairedEntry=[name:string,relay:'relay'|null,status:'success'|'failed',age?:number];
function paired(status:LinkHealth['status'],entries:PairedEntry[]):MonitorResponse{
 const ordered=[...entries].sort((a,b)=>a[0].localeCompare(b[0]));
 const clusters=ordered.map(([name,,state,age=0])=>row(name,snapshot(age,30,state==='success')));
 return {clusters,link_health:{schema:'ag-link-health/1',observed_at:now/1000,status,
  entries:ordered.map<LinkHealth['entries'][number]>(([name,relay_group,state,age=0],i)=>({name,relay_group,
   sampled_at:clusters[i].snapshot!.sampled_at,age_seconds:age,interval_seconds:30,
   status:state,reason:state==='success'?null:'sample_failed'}))}};
}
function relayOutage(){
 return paired('relay_outage',[
  ['nonrelay-a',null,'success',10],['relay-a','relay','failed',20],['relay-b','relay','failed',30],
 ]);
}
async function setup(page:Page,rows:ClusterRow[],studiesAvailable=true,metadata:Omit<MonitorResponse,'clusters'>={}){
 const requests:{method:string;path:string}[]=[];
 page.on('request',request=>{
  const path=new URL(request.url()).pathname;
  if(path.startsWith('/api/'))requests.push({method:request.method(),path});
 });
 await page.clock.install({time:now-1000});
 await page.clock.pauseAt(now);
 await page.route('**/api/monitor',route=>route.fulfill({json:{...metadata,clusters:rows}}));
 await page.route('**/api/studies',route=>studiesAvailable
  ?route.fulfill({json:{studies:[],issues:[]}})
  :route.fulfill({status:503,json:{detail:'Synthetic local records unavailable'}}));
 await page.goto('/#/servers');
 await expect(page.locator('.server-card')).toHaveCount(rows.length);
 return requests;
}
async function noInferredOutage(page:Page){
 await expect(page.locator('.link-health .StatusBadge, .server-card-status .StatusBadge').filter({hasText:/链路中断|本机断网/})).toHaveCount(0);
}
const summary=(page:Page)=>page.getByRole('region',{name:'链路状态',exact:true});
const card=(page:Page,name:string)=>page.getByRole('button',{name:`选择服务器 ${name}`,exact:true});
async function unknownSummary(page:Page){
 await expect(summary(page).locator('.StatusBadge')).toContainText('链路状态未知');
 await expect(summary(page).locator('.StatusBadge')).not.toContainText('链路正常');
 await noInferredOutage(page);
}

for(const error of [null,'Synthetic snapshot unavailable'])test(`T217C missing snapshot stays unknown (${error===null?'missing':'unreadable'})`,async({page})=>{
 await setup(page,[row('relay-a',null,error)]);
 const card=page.getByRole('button',{name:'选择服务器 relay-a'});
 await expect(card.locator('.server-card-status')).toContainText('未知');
 await expect(card).toContainText('尚无采样');
 await expect(card).not.toContainText('采样失败');
 await expect(card).not.toContainText('新鲜');
 await expect(card.getByRole('img',{name:'核数：未知',exact:true})).toBeVisible();
 await expect(page.getByRole('tabpanel')).not.toContainText('采样失败');
 await unknownSummary(page);
});

for(const [name,relayOk,nonrelayOk] of [
 ['successful snapshots',true,true],
 ['one failed entry',false,true],
 ['all failed entries',false,false],
] as const)test(`T217C old producer ${name} does not establish a link verdict`,async({page})=>{
 await setup(page,[row('relay-a',snapshot(0,30,relayOk)),row('nonrelay-a',snapshot(0,30,nonrelayOk))]);
 const relay=page.getByRole('button',{name:'选择服务器 relay-a'});
 const nonrelay=page.getByRole('button',{name:'选择服务器 nonrelay-a'});
 await expect(relay.locator('.server-card-status')).toContainText(relayOk?'新鲜':'采样失败');
 await expect(nonrelay.locator('.server-card-status')).toContainText(nonrelayOk?'新鲜':'采样失败');
 await expect(relay.locator('time')).toHaveAttribute('datetime',snapshot().sampled_at);
 await expect(nonrelay.locator('time')).toHaveAttribute('datetime',snapshot().sampled_at);
 await unknownSummary(page);
});

test('T217C each entry retains its own sampling age and live age clock',async({page})=>{
 await setup(page,[row('relay-a',snapshot(10)),row('nonrelay-a',snapshot(65))]);
 const relay=page.getByRole('button',{name:'选择服务器 relay-a'}).locator('.server-age');
 const nonrelay=page.getByRole('button',{name:'选择服务器 nonrelay-a'}).locator('.server-age');
 await expect(relay).toContainText('距今 10 秒');
 await expect(nonrelay).toContainText('距今 1 分 5 秒');
 await page.clock.runFor(1000);
 await expect(relay).toContainText('距今 11 秒');
 await expect(nonrelay).toContainText('距今 1 分 6 秒');
});

for(const [interval,boundary,label] of [[30,90,'continuous'],[null,600,'single']] as const){
 test(`T217C ${label} sampling expires one second after its existing boundary`,async({page})=>{
  await setup(page,[row('relay-a',snapshot(boundary,interval))]);
  const card=page.getByRole('button',{name:'选择服务器 relay-a'});
  await expect(card.locator('.server-card-status')).toContainText('新鲜');
  await expect(page.getByRole('tabpanel')).not.toContainText('数据已过期');
  await page.clock.runFor(1000);
  await expect(card.locator('.server-card-status')).toContainText('非最新');
  await expect(card.locator('.server-card-status')).not.toContainText('新鲜');
  await expect(page.getByRole('tabpanel')).toContainText('数据已过期');
  await noInferredOutage(page);
 });
 test(`T217C ${label} model freshness retains the exact boundary`,()=>{
  const data=[row('relay-a',snapshot(0,interval))];
  expect(serverModels(data,now+boundary*1000)[0]).toMatchObject({stale:false,old:false});
  expect(serverModels(data,now+(boundary+1)*1000)[0]).toMatchObject({stale:true,old:true});
 });
}

test('T217C server monitoring stays read-only without study or autonomy link queries',async({page})=>{
 const requests=await setup(page,[row('relay-a',snapshot(0,30,false)),row('nonrelay-a')],false);
 await expect(page.getByText('Synthetic local records unavailable').first()).toBeVisible();
 await noInferredOutage(page);
 const response=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/monitor');
 await page.clock.runFor(30000);await response;
 await expect.poll(()=>requests.filter(r=>r.path==='/api/monitor').length).toBe(2);
 expect(requests.every(r=>r.method==='GET')).toBeTruthy();
 expect([...new Set(requests.map(r=>r.path))].sort()).toEqual(['/api/monitor','/api/studies']);
 await expect(page.getByRole('button',{name:'立即重新采样'})).toHaveCount(0);
 await noInferredOutage(page);
});

test('T217C healthy backend verdict preserves normal entry cards',async({page})=>{
 const data=paired('healthy',[['nonrelay-a',null,'success',5],['relay-a','relay','success',25]]);
 await setup(page,data.clusters,true,data);
 await expect(summary(page).locator('.StatusBadge')).toContainText('链路正常');
 await expect(summary(page)).toContainText('判定时间：');
 for(const name of ['relay-a','nonrelay-a'])await expect(card(page,name).locator('.server-card-status')).toContainText('新鲜');
 await noInferredOutage(page);
});

test('T217C relay outage labels affected cards and details without independent failures',async({page},info)=>{
 const data=relayOutage();
 const requests=await setup(page,data.clusters,false,data);
 await expect(summary(page).locator('.StatusBadge')).toContainText('链路中断');
 await expect(summary(page)).toContainText('判定时间：');
 for(const name of ['relay-a','relay-b']){
  const target=card(page,name);
  await expect(target.locator('.server-card-status')).toContainText('链路中断');
  await expect(target).not.toContainText('采样失败');
  await expect(target.getByRole('img',{name:'核数：未知',exact:true})).toBeVisible();
  await target.click();
  await expect(page.getByRole('tabpanel')).toContainText('链路中断');
  await expect(page.getByRole('tabpanel')).not.toContainText('采样失败');
 }
 await expect(card(page,'nonrelay-a').locator('.server-card-status')).toContainText('新鲜');
 await expect(card(page,'nonrelay-a')).not.toContainText('链路中断');
 expect(requests.every(r=>r.method==='GET'&&['/api/monitor','/api/studies'].includes(r.path))).toBeTruthy();
 await page.evaluate(()=>scrollTo({top:0,behavior:'instant'}));
 await page.screenshot({path:info.outputPath('t217c-link-desktop.png'),fullPage:true});
});

test('T217C all failed entries use the backend local outage verdict',async({page})=>{
 const data=paired('local_outage',[['nonrelay-a',null,'failed'],['relay-a','relay','failed']]);
 await setup(page,data.clusters,true,data);
 await expect(summary(page).locator('.StatusBadge')).toContainText('本机断网');
 await expect(summary(page)).toContainText('全部入口失败（按本机断网处理）');
 for(const name of ['relay-a','nonrelay-a']){
  await expect(card(page,name).locator('.server-card-status')).toContainText('本机断网');
  await expect(card(page,name)).not.toContainText('采样失败');
  await card(page,name).click();
  await expect(page.getByRole('tabpanel')).toContainText('本机断网');
  await expect(page.getByRole('tabpanel')).not.toContainText('采样失败');
 }
});

test('T217C relay attribution does not relabel an independent nonrelay failure',async({page})=>{
 const data=paired('relay_outage',[
  ['nonrelay-a',null,'success'],['nonrelay-b',null,'failed'],['relay-a','relay','failed'],
 ]);
 await setup(page,data.clusters,true,data);
 await expect(summary(page).locator('.StatusBadge')).toContainText('链路中断');
 await expect(card(page,'relay-a').locator('.server-card-status')).toContainText('链路中断');
 await expect(card(page,'nonrelay-b').locator('.server-card-status')).toContainText('采样失败');
 await expect(card(page,'nonrelay-b')).not.toContainText('链路中断');
 await card(page,'nonrelay-b').click();
 await expect(page.getByRole('tabpanel')).toContainText('采样失败');
 await expect(page.getByRole('tabpanel')).not.toContainText('链路中断');
});

test('T217C partial relay failure keeps individual sampling failure behavior',async({page})=>{
 const data=paired('cluster_failure',[
  ['nonrelay-a',null,'success'],['relay-a','relay','failed'],['relay-b','relay','success'],
 ]);
 await setup(page,data.clusters,true,data);
 await expect(summary(page).locator('.StatusBadge')).toContainText('个别集群故障');
 await expect(card(page,'relay-a').locator('.server-card-status')).toContainText('采样失败');
 await card(page,'relay-a').click();
 await expect(page.getByRole('tabpanel')).toContainText('采样失败');
 for(const name of ['relay-b','nonrelay-a'])await expect(card(page,name).locator('.server-card-status')).toContainText('新鲜');
 await noInferredOutage(page);
});

for(const reason of ['missing','stale'] as const)test(`T217C backend unknown ${reason} never becomes healthy`,async({page})=>{
 const data=paired('unknown',[['nonrelay-a',null,'success']]);
 const old=reason==='stale'?snapshot(91):null;
 data.clusters.push(row('relay-a',old));
 data.link_health!.entries.push({name:'relay-a',relay_group:'relay',sampled_at:old?.sampled_at??null,
  age_seconds:old?91:null,interval_seconds:old?30:null,status:'unknown',reason});
 await setup(page,data.clusters,true,data);
 await unknownSummary(page);
 await expect(card(page,'relay-a').locator('.server-card-status')).toContainText(old?'非最新':'未知');
 await expect(card(page,'nonrelay-a').locator('.server-card-status')).toContainText('新鲜');
});

for(const variant of ['missing field','null field','reported error'] as const)test(`T217C ${variant} leaves existing snapshots readable without a link verdict`,async({page})=>{
 const data=paired('healthy',[['nonrelay-a',null,'success'],['relay-a','relay','success']]);
 if(variant==='missing field')delete data.link_health;
 else if(variant==='null field')data.link_health=null;
 else data.link_health_error='Synthetic link summary unavailable';
 await setup(page,data.clusters,true,data);
 await unknownSummary(page);
 for(const name of ['relay-a','nonrelay-a'])await expect(card(page,name).locator('.server-card-status')).toContainText('新鲜');
});

for(const variant of ['ambiguous source','sample time mismatch','missing snapshot','entry name mismatch'] as const)test(`T217C ${variant} prevents applying an outage attribution`,async({page})=>{
 const data=relayOutage(),target=data.clusters.find(r=>r.name==='relay-a')!;
 if(variant==='ambiguous source')target.ambiguous=true;
 else if(variant==='sample time mismatch')target.snapshot!.sampled_at=new Date(now-21000).toISOString();
 else if(variant==='missing snapshot')target.snapshot=null;
 else data.link_health!.entries.find(e=>e.name==='relay-a')!.name='relay-c';
 await setup(page,data.clusters,true,data);
 await unknownSummary(page);
 const targetCard=card(page,target.ambiguous?'relay-a · named':'relay-a');
 await expect(targetCard.locator('.server-card-status')).not.toContainText('链路中断');
 await targetCard.click();
 await expect(page.getByRole('tabpanel')).not.toContainText('链路中断');
});

for(const status of ['healthy','relay_outage'] as const)test(`T217C ${status} expires at 91 seconds without another backend verdict`,async({page})=>{
 const data=paired(status,[['nonrelay-a',null,'success',90],['relay-a','relay',status==='healthy'?'success':'failed',90]]);
 await setup(page,data.clusters,true,data);
 await expect(summary(page).locator('.StatusBadge')).toContainText(status==='healthy'?'链路正常':'链路中断');
 await page.clock.runFor(1000);
 await unknownSummary(page);
 await card(page,'relay-a').click();
 await expect(page.getByRole('tabpanel')).toContainText('数据已过期');
 await expect(page.getByRole('tabpanel')).not.toContainText('链路中断');
});

test('T217C HTTP read failure keeps the last verdict time but withdraws its healthy label',async({page})=>{
 const data=paired('healthy',[['nonrelay-a',null,'success'],['relay-a','relay','success']]);
 await setup(page,data.clusters,true,data);
 await expect(summary(page).locator('.StatusBadge')).toContainText('链路正常');
 const observed=summary(page).getByText(/^判定时间：/),stamp=await observed.textContent();
 expect(stamp).toBeTruthy();expect(stamp).not.toContain('未知');
 await page.route('**/api/monitor',route=>route.fulfill({status:503,json:{detail:'Synthetic monitor read unavailable'}}));
 const response=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/monitor');
 await page.clock.runFor(30000);await response;
 await expect(page.getByText('Synthetic monitor read unavailable')).toBeVisible();
 await unknownSummary(page);
 await expect(observed).toHaveText(stamp!);
 await expect(page.locator('.server-card')).toHaveCount(2);
});

test('T217C link evidence keeps each entry age independent',async({page})=>{
 const data=paired('healthy',[['nonrelay-a',null,'success',10],['relay-a','relay','success',65]]);
 await setup(page,data.clusters,true,data);
 await expect(card(page,'nonrelay-a').locator('.server-age')).toContainText('距今 10 秒');
 await expect(card(page,'relay-a').locator('.server-age')).toContainText('距今 1 分 5 秒');
 await expect(summary(page).locator('.StatusBadge')).toContainText('链路正常');
 await page.clock.runFor(1000);
 await expect(card(page,'nonrelay-a').locator('.server-age')).toContainText('距今 11 秒');
 await expect(card(page,'relay-a').locator('.server-age')).toContainText('距今 1 分 6 秒');
});

test('T217C narrow relay outage view stays within the viewport and makes no writes',async({page},info)=>{
 await page.setViewportSize({width:390,height:844});
 const data=relayOutage(),requests=await setup(page,data.clusters,true,data);
 await expect(summary(page).locator('.StatusBadge')).toContainText('链路中断');
 await card(page,'relay-a').click();
 await expect(page.getByRole('tabpanel')).toContainText('链路中断');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
 expect(requests.every(r=>r.method==='GET'&&['/api/monitor','/api/studies'].includes(r.path))).toBeTruthy();
 await page.evaluate(()=>scrollTo({top:0,behavior:'instant'}));
 await page.screenshot({path:info.outputPath('t217c-link-mobile.png'),fullPage:true});
});
