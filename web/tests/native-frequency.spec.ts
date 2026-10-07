import {test,expect} from '@playwright/test';
const token='browser-test-only-'+'0'.repeat(32);
const fact=(value:unknown,unit:string|null=null)=>({availability:'available',value,unit,source:'synthetic-test',reason:null});
for(const parsed of [true,false]){
 test(`frequency count ${parsed?'zero is retained':'unknown is not zero'}`,async({page})=>{
  await page.route('**/api/v1/native/sources/freq/attempts/freq-attempt',route=>route.fulfill({json:{schema:'auto-g16-native-query/1',kind:'attempt',data:{
   source_id:'freq',project_id:'synthetic-project',workflow_run_id:'run',task_id:'task',attempt_id:'freq-attempt',
   generation:fact('V31'),program:fact('gaussian'),bound_plan:fact({id:'plan'}),input:fact([]),artifacts:fact([]),
   axes:{execution:fact('completed'),validation:fact({classification:parsed?'VALIDATED_TWO_STAGE_MINIMUM':'INCOMPLETE'})},
   facts:{energy:fact(-158,'hartree'),frequencies:fact([], 'cm^-1')},availability:'available',reason:null,record_inventory:[],history:[],
   provenance:{parsed_result:{parser_version:'1.2.0',frequency_unit:'cm^-1',frequency_count:parsed?36:null,
    imaginary_frequency_count:parsed?0:null,zero_frequency_count:parsed?1:null,optimization_attempt_id:'opt-attempt',frequency_attempt_id:'freq-attempt'}}
  }}}));
  await page.goto('/#/native/freq/attempts/freq-attempt');
  await page.getByLabel('只读访问令牌').fill(token);await page.getByRole('button',{name:'连接数据源'}).click();
  const summary=page.locator('.native-frequency-summary');
  await expect(summary).toContainText('cm^-1');await expect(summary).toContainText('opt-attempt → Freq Attempt：freq-attempt');
  if(parsed){await expect(summary).toContainText('模式数：36 · 负频：0 · 零频：1');}
  else{await expect(summary).toContainText('负频：未知 / unavailable');await expect(summary).not.toContainText('负频：0');}
  await expect(summary).toContainText('不代表人工科学验收或热力学验收');
 });
}
