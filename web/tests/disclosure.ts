import type {Page} from '@playwright/test';
export async function openSection(page:Page,title:string){
 const summary=page.locator('.attempt-detail > .Collapsible > summary').filter({hasText:new RegExp('^'+title+'$')});
 await summary.waitFor();
 if(!await summary.evaluate(node=>(node.parentElement as HTMLDetailsElement).open))await summary.click();
}
