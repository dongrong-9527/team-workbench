import { test, expect } from './fixtures.js';
import { login, action, submit, selectOption } from './helpers.js';

for (const failedRefresh of [false, true]) {
  test(`Bug confirmation waits for ${failedRefresh ? 'failed refresh recovery' : 'detail refresh'} before assignment`, async ({page}) => {
    await login(page,'product');
    await page.goto('/projects/p1');
    await action(page,'新建 Bug');
    for (const [label,value] of [['标题','合成刷新竞态缺陷'],['预期行为','提示'],['实际行为','未提示'],['复现步骤','提交空值'],['复现环境','合成环境']])
      await page.getByLabel(label!,{exact:true}).fill(value!);
    await submit(page,'确认新建Bug');
    await expect(page).toHaveURL(/\/bug\//);
    const id = page.url().split('/').at(-1)!;
    await expect(page.getByRole('button',{name:'刷新详情',exact:true})).toBeEnabled();
    let release!: () => void;
    let received!: () => void;
    const held = new Promise<void>(resolve => { received = resolve; });
    const path = '**/api/bugs/'+id;
    await page.route(path, async route => {
      const response = await route.fetch();
      await new Promise<void>(resolve => { release = resolve; received(); });
      if (failedRefresh) await route.fulfill({status:503,json:{error:'Synthetic refresh unavailable'}});
      else await route.fulfill({response});
    });
    try {
      await action(page,'确认 Bug');
      await page.getByLabel('操作原因',{exact:true}).fill('合成复现确认');
      await submit(page,'确认确认 Bug');
      await held;
      await expect(page.getByRole('button',{name:'分配',exact:true})).toBeDisabled();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      release();
      await page.unrouteAll({behavior:'wait'});
      if (failedRefresh) {
        await expect(page.getByRole('alert')).toContainText('Synthetic refresh unavailable');
        await expect(page.getByRole('button',{name:'分配',exact:true})).toBeDisabled();
        await page.getByRole('button',{name:'重试读取',exact:true}).click();
      }
      await action(page,'分配');
      await selectOption(page,'新的主负责人',{value:'dev',label:'陈开发'});
      await page.getByLabel('操作原因',{exact:true}).fill('明确负责人');
      await page.getByLabel('交接说明',{exact:true}).fill('按完成标准执行');
      const assigned = page.waitForResponse(r => r.url().endsWith('/api/bugs/'+id+'/actions') && r.request().postDataJSON().action === 'assign');
      await submit(page,'确认分配');
      const response = await assigned;
      expect(response.request().postDataJSON().expectedVersion).toBe(2);
      expect(response.status()).toBe(200);
      expect(await response.json()).toMatchObject({version:3,ownerId:'dev'});
      await expect(page.getByRole('heading',{name:'版本冲突：请核对最新记录'})).toHaveCount(0);
    } finally { release?.(); await page.unrouteAll({behavior:'wait'}); }
  });
}
