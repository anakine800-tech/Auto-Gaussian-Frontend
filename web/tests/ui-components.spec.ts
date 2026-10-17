import {test,expect} from '@playwright/test';
import {mkdtemp,writeFile,rm,readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {build} from 'vite';

test('shared components support keyboard columns, source links, disclosure memory and modal focus',async({page})=>{
 const dir=await mkdtemp(join(tmpdir(),'t94-ui-'));
 try{
  const source=join(dir,'entry.tsx');
  await writeFile(source,`import React,{useState} from ${JSON.stringify(resolve('node_modules/react/index.js'))};
import {createRoot} from ${JSON.stringify(resolve('node_modules/react-dom/client.js'))};
import {Panel,KpiTile,FactGrid,DataTable,Collapsible,ActionBar,Drawer,EmptyState,ErrorNotice,StatusBadge,statusTone} from ${JSON.stringify(resolve('src/ui/index.tsx'))};
function Harness(){const [open,setOpen]=useState(false),[located,setLocated]=useState(false);return <Panel title="组件验证"><KpiTile label="合成计数" value={3}/><FactGrid facts={[{label:'合成能量',value:'−76',onLocate:()=>setLocated(true)}]}/>{located&&<p role="status">已定位合成来源</p>}<DataTable label="合成表" rows={Array.from({length:40},(_,id)=>({id}))} rowKey={r=>r.id} columns={[{key:'id',label:'编号',render:r=>r.id},{key:'source',label:'来源',optional:true,render:()=> '合成'}]}/><Collapsible page="test" block="notes" title="记忆区块" defaultOpen><p>详情</p></Collapsible><ActionBar danger={<button>危险动作占位</button>}><button onClick={()=>setOpen(true)}>打开抽屉</button></ActionBar><Drawer open={open} onClose={()=>setOpen(false)} title="合成抽屉"><label>名称<input autoFocus/></label><button onClick={()=>setOpen(false)}>完成</button></Drawer><EmptyState>暂无数据</EmptyState><ErrorNotice>合成错误</ErrorNotice>{['running','queued','finished','unconverged','mismatch','unknown','stale','tool_checks_passed'].map(s=><StatusBadge key={s} tone={statusTone(s)}>{s}</StatusBadge>)}</Panel>};createRoot(document.getElementById('root')).render(<Harness/>);`);
  const bundle=await build({configFile:false,logLevel:'silent',define:{'process.env.NODE_ENV':JSON.stringify('production')},resolve:{alias:{'react/jsx-runtime':resolve('node_modules/react/jsx-runtime.js')}},build:{write:false,lib:{entry:source,name:'UIHarness',formats:['iife']},minify:false}});
  const output=Array.isArray(bundle)?bundle[0].output:('output'in bundle?bundle.output:[]);const code=output.find(v=>v.type==='chunk');if(!code||code.type!=='chunk')throw Error('Missing UI bundle');
  const css=(await Promise.all(['src/ui/tokens.css','src/style.css','src/ui/shell.css'].map(p=>readFile(p,'utf8')))).join('\n');
  await page.route('**/t94-ui',r=>r.fulfill({contentType:'text/html; charset=utf-8',body:'<meta charset="utf-8"><link rel="stylesheet" href="/t94-ui.css"><div id="root"></div><script src="/t94-ui.js"></script>'}));
  await page.route('**/t94-ui.js',r=>r.fulfill({contentType:'application/javascript',body:code.code}));await page.route('**/t94-ui.css',r=>r.fulfill({contentType:'text/css',body:css}));
  await page.goto('/t94-ui');await page.getByRole('button',{name:'定位合成能量来源'}).click();await expect(page.getByRole('status')).toHaveText('已定位合成来源');
  const table=page.getByRole('table',{name:'合成表'});await expect(table.getByRole('columnheader',{name:'来源'})).toHaveCount(0);
  await page.getByText('显示列',{exact:true}).click();await page.getByLabel('来源',{exact:true}).focus();await page.keyboard.press('Space');await expect(table.getByRole('columnheader',{name:'来源'})).toBeVisible();
  await table.locator('..').evaluate(e=>e.scrollTop=300);const box=await table.getByRole('columnheader').first().boundingBox(),scrollBox=await table.locator('..').boundingBox();expect(box!.y).toBeCloseTo(scrollBox!.y+1,0);
  const disclosure=page.locator('.Collapsible');await page.getByText('记忆区块',{exact:true}).focus();await page.keyboard.press('Enter');await expect(disclosure).not.toHaveAttribute('open');await page.reload();await expect(disclosure).not.toHaveAttribute('open');
  const trigger=page.getByRole('button',{name:'打开抽屉'});await trigger.click();await expect(page.getByRole('dialog',{name:'合成抽屉'})).toBeVisible();await expect(page.getByRole('button',{name:'关闭抽屉'})).toBeFocused();await page.keyboard.press('Tab');await expect(page.getByRole('textbox',{name:'名称'})).toBeFocused();
  await page.keyboard.press('Tab');await expect(page.getByRole('button',{name:'完成',exact:true})).toBeFocused();await trigger.focus();await expect(trigger).not.toBeFocused();await expect(page.getByRole('button',{name:'完成',exact:true})).toBeFocused();await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).not.toBeVisible();await expect(trigger).toBeFocused();
  for(const [state,tone] of [['running','info'],['queued','info'],['finished','ok'],['unconverged','bad'],['mismatch','bad'],['unknown','warn'],['stale','warn'],['tool_checks_passed','warn']])await expect(page.getByText(state,{exact:true})).toHaveClass(new RegExp('tone-'+tone));
  await page.evaluate(()=>localStorage.setItem('ag-ui:collapse:test:notes','corrupted'));await page.reload();await expect(disclosure).toHaveAttribute('open');
 }finally{await rm(dir,{recursive:true,force:true});}
});
