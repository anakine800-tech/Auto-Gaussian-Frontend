import {test,expect} from '@playwright/test';
import {parseCSV} from '../src/data-table-view';
import {reportCategory,reportGroups} from '../src/analysis-summary';

const report=(name:string)=>'/#/s/butane-demo/analysis/file/reading/'+name;
test('CSV subset preserves quotes, commas, physical newlines and row limits',()=>{
 expect(parseCSV('a,b\r\n"x,y","a""b"\r\n"line\r\nnext",2\r\n')).toEqual({headers:['a','b'],rows:[['x,y','a"b'],['line\r\nnext','2']],truncated:false});
 expect(parseCSV('a,b\n"x\ny",2\nwrong')).toMatchObject({error:4});
 expect(parseCSV('a,b\n"x"trailing,2')).toMatchObject({error:2});
 expect(parseCSV('a\n"unfinished\n')).toMatchObject({error:3});
 const text='a\n'+Array.from({length:5001},(_,i)=>i).join('\n');
 expect(parseCSV(text).rows).toHaveLength(5000);expect(parseCSV(text).truncated).toBe(true);
 expect(parseCSV('a\n'+Array.from({length:5000},(_,i)=>i).join('\n')).truncated).toBe(false);
});
test('classification uses schema, explicit declaration and type without filename guesses',()=>{
 expect(reportCategory({name:'formal-energy.json'}).kind).toBe('other');
 expect(reportCategory({name:'x.md',kind:'energy',category_basis:'按报告声明'})).toEqual({kind:'energy',basis:'按报告声明'});
 expect(reportCategory({name:'x.json',kind:'formal',schema:'ag-thermo/1'})).toEqual({kind:'thermo',basis:'按 schema'});
 expect(reportCategory({name:'figure.SVG'})).toEqual({kind:'figure',basis:'按文件类型'});
 const schemas:Record<string,string>={'ag-ensemble/1':'ensemble','ag-irc-review/1':'irc','ag-thermo/1':'thermo','ag-profile/1':'thermo','ag-channel-coverage/1':'coverage','ag-nci/1':'nci'};
 for(const [schema,kind] of Object.entries(schemas))expect(reportCategory({name:'report.json',schema,kind:'formal'})).toEqual({kind,basis:'按 schema'});
 for(const name of ['labels.json','labels.md','channel-suggestions.csv'])expect(reportCategory({name:'ts-labels/synthetic/'+name})).toEqual({kind:'ts',basis:'按 TS 标签目录'});
 for(const name of ['labels.json','other/labels.json','ts-labels/synthetic/other.json'])expect(reportCategory({name}).kind).toBe('other');
 expect(reportGroups.slice(5,10)).toEqual([['thermo','热化学 / 能量剖面'],['coverage','通道覆盖'],['ts','TS 标签'],['nci','NCI'],['stage-review','阶段审阅']]);
});
for(const [width,height] of [[1440,860],[1280,720],[390,844]])test(`report table, exact Attempt preview and responsive layout ${width}`,async({page},info)=>{
 await page.setViewportSize({width,height});const errors:string[]=[],writes:string[]=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(!['GET','HEAD'].includes(r.method()))writes.push(r.method());});
 await page.goto(report('overview.md'));
 const table=page.getByRole('table',{name:'报告表格'}),score=table.getByRole('columnheader').filter({hasText:'score'});
 await expect(table.getByRole('row')).toHaveCount(4);await expect(score).toHaveAttribute('aria-sort','none');
 await score.getByRole('button').click();await expect(score).toHaveAttribute('aria-sort','ascending');
 await expect(table.getByRole('row').nth(1)).toContainText('anti-extra');await expect(table.getByRole('row').nth(2)).toContainText('gauche');
 await score.getByRole('button').click();await expect(score).toHaveAttribute('aria-sort','descending');await expect(table.getByRole('row').nth(1)).toContainText('anti');
 await expect(table.getByRole('link',{name:'anti-extra',exact:true})).toHaveCount(0);
 await table.getByRole('link',{name:'anti',exact:true}).click();
 const preview=page.getByRole('complementary',{name:'报告结构预览'});await expect(preview.getByTestId('molecule-scene')).toBeVisible();
 await expect(preview.getByRole('link',{name:'打开 Attempt anti',exact:true})).toHaveAttribute('href','#/s/butane-demo/a/anti');
 await expect(page.getByRole('navigation',{name:'报告目录'})).toContainText('按报告声明');
 await expect(page.getByRole('region',{name:'NCI列表'})).toContainText('nci-demo.json');
 await expect(page.getByRole('region',{name:'通道覆盖列表'})).toContainText('coverage-demo.json');
 await expect(page.getByRole('region',{name:'热化学 / 能量剖面列表'})).toContainText('profile-demo.json');
 await expect(page.getByRole('heading',{name:/^正式结论 /})).toHaveCount(0);await expect(page.locator('body')).not.toContainText('暂无可识别报告');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
 if(width===390)await page.locator('.report-body').evaluate(el=>window.scrollTo(0,el.getBoundingClientRect().top+window.scrollY-150));else await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:info.outputPath(`report-${width}x${height}.png`)});
 await page.goto(report('wide.json'));await expect(page.getByRole('table').getByRole('columnheader')).toHaveCount(30);
 await expect(page.getByRole('status')).toContainText('超过 30 列');expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
 expect(await page.locator('.report-table-scroll').evaluate(el=>el.scrollWidth>el.clientWidth)).toBe(true);
 expect(errors).toEqual([]);expect(writes).toEqual([]);
});
test('local document links resolve against source and refuse escape or protocols',async({page})=>{
 await page.goto(report('overview.md'));const body=page.getByRole('article',{name:'报告正文'});
 for(const name of ['越界链接','绝对链接','脚本链接'])await expect(body.getByRole('link',{name,exact:true})).toHaveCount(0);
 await expect(body.getByText('越界链接',{exact:true})).toHaveAttribute('title','链接越出本 study');
 await expect(body.getByRole('link',{name:'外部文档'})).toHaveAttribute('target','_blank');await expect(body.getByRole('link',{name:'外部文档'})).toHaveAttribute('rel','noopener noreferrer');
 await expect(body.getByRole('link',{name:'同目录 CSV'})).toHaveAttribute('href',/#\/s\/butane-demo\/analysis\/file\/reading\/quoted.csv$/);
 await expect(body.getByRole('link',{name:'上级报告'})).toHaveAttribute('href',/#\/s\/butane-demo\/analysis\/thermo\/profile-demo.json$/);
 await expect(body.getByRole('link',{name:'Attempt',exact:true})).toHaveAttribute('href','#/s/butane-demo/a/anti');
 await expect(body.getByRole('link',{name:'结构文件'})).toHaveAttribute('href','#/s/butane-demo/files/analyses/representatives.xyz');
 await body.getByRole('link',{name:'普通文件'}).click();await expect(page).toHaveURL(/butane-demo\/file\/notes\//);await expect(page.locator('pre')).toHaveText('只读本地文件示例');
 await page.reload();await expect(page.locator('pre')).toHaveText('只读本地文件示例');await page.goBack();
 await page.goto('/#/s/butane-demo/files/document');await page.getByRole('link',{name:'本地报告',exact:true}).click();await expect(page.getByRole('table',{name:'报告表格'})).toBeVisible();
});
test('CSV and all JSON shapes render without treating unknown schemas as syntax errors',async({page})=>{
 await page.goto(report('quoted.csv'));const table=page.getByRole('table');await expect(table).toContainText('quoted, comma');await expect(table).toContainText('two\nlines');
 await page.goto(report('objects.json'));await expect(page.getByRole('columnheader')).toHaveText(['Attempt','score','extra']);await expect(page.locator('.report-body').getByRole('alert')).toHaveCount(0);
 await page.goto(report('scalars.json'));await expect(page.locator('.json-list>li')).toHaveText(['1','"text"','true','null']);
 await page.goto(report('object.json'));await page.locator('.json-view summary').click();await expect(page.locator('.json-view')).toContainText('Synthetic object');await page.getByRole('button',{name:'格式化原文',exact:true}).click();await expect(page.locator('pre')).toContainText('"nested"');
 for(const [name,text] of [['scalar.json','42'],['null.json','null']]){await page.goto(report(name));await expect(page.locator('.report-body pre')).toHaveText(text);await expect(page.locator('.report-body').getByRole('alert')).toHaveCount(0);}
 await page.goto(report('bad.json'));await expect(page.locator('.report-body').getByRole('alert')).toContainText('解析失败：第 2 行第 13 列');
 await page.goto(report('bad.csv'));await expect(page.locator('.report-body').getByRole('alert')).toContainText('CSV 解析失败：第 3 行');await expect(page.locator('.report-body pre')).toContainText('unterminated');
 await page.goto(report('large.csv'));await expect(page.locator('.report-body').getByRole('status')).toContainText('超过 5000 行');await expect(page.getByRole('table').getByRole('row')).toHaveCount(5001);
});
test('local images and sandboxed HTML/SVG cannot run scripts',async({page,request})=>{
 const executed:string[]=[];page.on('request',r=>{if(r.url().includes('should-not-run'))executed.push(r.url());});
 await page.goto(report('overview.md'));const picture=page.getByRole('img',{name:'合成示意图'});await picture.scrollIntoViewIfNeeded();await expect.poll(()=>picture.evaluate((img:HTMLImageElement)=>img.naturalWidth)).toBeGreaterThan(0);
 await expect(page.getByText('缺失图片（无法加载：文件不存在）',{exact:true})).toBeVisible();await expect(page.locator('.markdown script,.markdown iframe')).toHaveCount(0);
 await page.goto(report('diagram.svg'));await expect(page.locator('.report-body>img')).toHaveCount(1);await expect(page.locator('.report-body svg,.report-body iframe,.report-body object')).toHaveCount(0);
 await page.goto(report('demo.html'));const frame=page.locator('iframe');await expect(frame).toHaveAttribute('sandbox','');await expect(page.frameLocator('iframe').getByRole('heading',{name:'Synthetic HTML report'})).toBeVisible();
 expect(await page.frameLocator('iframe').locator('body').getAttribute('data-executed')).toBeNull();expect(await page.evaluate(()=>Reflect.get(window,'reportInjected'))).toBeUndefined();
 const response=await request.get('/api/studies/butane-demo/files/analyses/reading/demo.html');expect(response.headers()['content-security-policy']).toBe("sandbox; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; frame-ancestors 'self'");
 expect(executed).toEqual([]);
});
