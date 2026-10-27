import { test, expect } from './fixtures.js';
import { login, action, submit, selectOption } from './helpers.js';
let projectId = '', requirementUrl = '', taskUrl = '', bugUrl = '';
test.describe.configure({mode:'serial'});
test.use({baseURL:'https://127.0.0.1:4175'});
test('bootstrap administrator can enter a new project and configure its explicit roles', async ({page}, testInfo) => {
  await login(page, 'bootstrap');
  await page.goto('/projects');
  await action(page,'新建项目');
  await page.getByLabel('项目名称',{exact:true}).fill('初次协作项目');
  await page.getByLabel('项目简介',{exact:true}).fill('初始简介');
  await submit(page,'确认新建项目');
  await expect(page).toHaveURL(/\/projects\/[^/]+$/);
  await expect(page.getByText('当前项目尚未授予你业务角色',{exact:false})).toBeVisible();
  await expect(page.getByRole('button',{name:'新建需求',exact:true})).toHaveCount(0);
  // Re-enter an existing project after a full page load: guidance is not a create notice.
  await page.goto('/projects');
  await page.getByRole('link',{name:'初次协作项目 ↗',exact:true}).click();
  await expect(page.getByText('当前项目尚未授予你业务角色',{exact:false})).toBeVisible();
  await expect(page.getByRole('link',{name:'管理本项目成员与角色',exact:true})).toBeVisible();
  for (const name of ['新建需求','新建任务','新建 Bug'])
    await expect(page.getByRole('button',{name,exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'刷新列表',exact:true})).toBeEnabled();
  const initialRoles = await page.evaluate(async () => (await (await fetch('/api/projects' + location.pathname.slice('/projects'.length) + '/overview')).json()).myRoles);
  expect(initialRoles).toEqual([]);
  await page.screenshot({path:testInfo.outputPath('first-use-desktop.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});
  await expect(page.getByRole('link',{name:'管理本项目成员与角色',exact:true})).toBeVisible();
  await page.screenshot({path:testInfo.outputPath('first-use-mobile.png'),fullPage:true});
  await page.setViewportSize({width:1440,height:1000});
  await action(page,'编辑项目');
  await page.getByLabel('项目名称',{exact:true}).fill('初次协作项目已编辑');
  await page.getByLabel('项目简介',{exact:true}).fill('可维护的项目简介');
  await submit(page,'确认编辑项目');
  await expect(page.getByText('可维护的项目简介',{exact:true}).first()).toBeVisible();
  projectId = page.url().split('/').at(-1)!;
  await page.getByRole('link',{name:'管理本项目成员与角色',exact:true}).click();
  await expect(page).toHaveURL(new RegExp('/members\\?projectId='+projectId));
  await expect(page.getByRole('link',{name:'返回项目 · 初次协作项目已编辑',exact:true})).toBeVisible();
});
test('bootstrap member activation and explicit project grants use visible forms', async ({page,browser,observeContext}) => {
  await login(page,'bootstrap');
  await page.goto('/members?projectId='+projectId);
  await action(page,'创建成员');
  await page.getByLabel('登录账号（小写英文或数字）',{exact:true}).fill('firstdev');
  await page.getByLabel('显示名',{exact:true}).fill('初次开发成员');
  await page.getByRole('dialog',{name:'创建成员',exact:true}).getByRole('button',{name:'确认创建成员',exact:true}).click();
  await expect(page.getByRole('dialog',{name:'激活码 · 仅本次显示',exact:true})).toBeVisible();
  const token = await page.getByLabel('一次性票据',{exact:true}).inputValue();
  await page.getByRole('button',{name:'关闭查看',exact:true}).click();
  const other = await browser.newContext({baseURL:'https://127.0.0.1:4175',ignoreHTTPSErrors:true});
  await observeContext(other);
  const member = await other.newPage();
  try {
    await member.goto('/activate');
    await member.getByLabel('激活码',{exact:true}).fill(token);
    await member.getByLabel('新密码',{exact:true}).fill('Synthetic-demo-2026!');
    await member.getByLabel('确认密码',{exact:true}).fill('Synthetic-demo-2026!');
    await member.getByRole('button',{name:'激活账号',exact:true}).click();
    await expect(member.getByRole('status')).toContainText('设置成功');
    await login(member,'firstdev');
    await member.goto('/members?projectId='+projectId);
    await expect(member.getByRole('button',{name:'授权',exact:true})).toHaveCount(0);
  } finally { await other.close(); }
  for (const [name,roles] of [['初始管理员',['产品']],['初次开发成员',['后端']]] as const) {
    await page.getByRole('row').filter({hasText:name}).getByRole('button',{name:'授权',exact:true}).click();
    for (const role of roles) await page.getByRole('dialog').locator('#field-roles').getByLabel(role,{exact:true}).check();
    await submit(page,'确认调整项目授权');
  }
  await page.getByRole('link',{name:'返回项目 · 初次协作项目已编辑',exact:true}).click();
  await expect(page.getByRole('button',{name:'新建需求',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'新建任务',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'新建 Bug',exact:true})).toBeVisible();
});
test('bootstrap requirement refinement and task assignment are reachable from project', async ({page}) => {
  await login(page,'bootstrap');
  await page.goto('/projects/'+projectId);
  await action(page,'新建需求');
  await page.getByLabel('标题',{exact:true}).fill('首次需求');
  await page.getByLabel('来源说明',{exact:true}).fill('合成首次协作');
  await page.getByLabel('需求细化说明',{exact:true}).fill('交付可验证功能');
  await selectOption(page,'产品验收人',{value:'',label:'初始管理员'});
  await page.getByRole('button',{name:'添加条目',exact:true}).click();
  await page.getByLabel('条目说明',{exact:true}).fill('功能可验证');
  await submit(page,'确认新建需求');
  await expect(page).toHaveURL(/\/requirement\//);
  requirementUrl = page.url();
  await action(page,'细化内容');
  await submit(page,'确认细化内容');
  await action(page,'确认可执行');
  await submit(page,'确认确认可执行');
  for (const assigned of [true,false]) {
    await page.goto('/projects/'+projectId);
    await action(page,'新建任务');
    await page.getByLabel('标题',{exact:true}).fill(assigned?'首次分配任务':'首次认领任务');
    await page.getByLabel('完成标准',{exact:true}).fill('完成合成验证');
    await page.getByLabel('关联需求编号',{exact:true}).fill(requirementUrl.split('/').at(-1)!);
    await submit(page,'确认新建任务');
    await expect(page).toHaveURL(/\/task\//);
    if (assigned) {
      await action(page,'分配');
      await selectOption(page,'新的主负责人',{value:'',label:'初次开发成员'});
      await page.getByLabel('操作原因',{exact:true}).fill('明确首次负责人');
      await page.getByLabel('交接说明',{exact:true}).fill('按完成标准执行');
      await submit(page,'确认分配');
      await expect(page.getByText('初次开发成员',{exact:true}).first()).toBeVisible();
    } else taskUrl = page.url();
  }
});
test('bootstrap Bug confirmation and assignment precede member claim', async ({page}) => {
  await login(page,'bootstrap');
  for (const assigned of [true,false]) {
    await page.goto('/projects/'+projectId);
    await action(page,'新建 Bug');
    for (const [label,value] of [['标题',assigned?'首次分配缺陷':'首次认领缺陷'],['预期行为','显示提示'],['实际行为','没有提示'],['复现步骤','提交空值'],['复现环境','合成环境']])
      await page.getByLabel(label!,{exact:true}).fill(value!);
    await submit(page,'确认新建Bug');
    await expect(page).toHaveURL(/\/bug\//);
    await expect(page.getByRole('button',{name:'认领',exact:true})).toHaveCount(0);
    await expect(page.getByText('新登记的 Bug 须先由项目产品或测试确认，再由对应修复角色认领。',{exact:true})).toBeVisible();
    await action(page,'确认 Bug');
    await page.getByLabel('操作原因',{exact:true}).fill('合成复现已确认');
    await submit(page,'确认确认 Bug');
    if (assigned) {
      await action(page,'分配');
      await selectOption(page,'新的主负责人',{value:'',label:'初次开发成员'});
      await page.getByLabel('操作原因',{exact:true}).fill('明确首次负责人');
      await page.getByLabel('交接说明',{exact:true}).fill('按完成标准执行');
      await submit(page,'确认分配');
    } else bugUrl = page.url();
  }
});
test('bootstrap developer claims task and confirmed Bug, cannot self accept, archived project stays read only', async ({page}) => {
  await login(page,'firstdev');
  for (const url of [taskUrl,bugUrl]) {
    await page.goto(url);
    await action(page,'认领');
    await submit(page,'确认认领');
    await action(page,'开始处理');
    await submit(page,'确认开始处理');
  }
  await page.goto(requirementUrl);
  await expect(page.getByRole('button',{name:'产品验收',exact:true})).toHaveCount(0);
  await login(page,'bootstrap');
  await page.goto('/projects/'+projectId);
  await action(page,'归档项目');
  await submit(page,'确认归档项目');
  await expect(page.getByRole('button',{name:'编辑项目',exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'新建任务',exact:true})).toHaveCount(0);
  await page.getByRole('link',{name:'管理本项目成员与角色',exact:true}).click();
  for (const button of await page.getByRole('button',{name:'授权',exact:true}).all()) await expect(button).toBeDisabled();
  await login(page,'firstdev');
  await page.goto(taskUrl);
  await expect(page.getByText('项目已归档，当前保留只读历史。',{exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'提交检查',exact:true})).toHaveCount(0);
});
test('bootstrap role management rejects missing or invalid project selection and keeps global scope separate', async ({page}) => {
  await login(page,'bootstrap');
  const roleMutations: string[] = [];
  page.on('request', request => {
    if (request.method() === 'PUT' && new URL(request.url()).pathname.endsWith('/roles'))
      roleMutations.push(new URL(request.url()).pathname);
  });
  await page.goto('/members?projectId=missing-project');
  await expect(page.getByText('请先选择有效项目，再调整项目角色。',{exact:true})).toBeVisible();
  for (const button of await page.getByRole('button',{name:'授权',exact:true}).all()) await expect(button).toBeDisabled();
  await page.goto('/members?projectId=');
  await expect(page.getByText('请先选择有效项目，再调整项目角色。',{exact:true})).toBeVisible();
  await page.goto('/projects?view=all');
  await action(page,'新建项目');
  await page.getByLabel('项目名称',{exact:true}).fill('另一协作项目');
  await submit(page,'确认新建项目');
  await expect(page).toHaveURL(/\/projects\/[^/]+$/);
  await selectOption(page,'全局项目筛选',{value:'',label:'另一协作项目'});
  // SPA navigation retains the conflicting global selection while changing the route project.
  await page.getByRole('link',{name:'查看全部项目',exact:true}).click();
  await page.getByRole('button',{name:'全部项目',exact:true}).click();
  await page.getByRole('link',{name:'初次协作项目已编辑 ↗',exact:true}).click();
  await page.getByRole('link',{name:'管理本项目成员与角色',exact:true}).click();
  await expect(page.getByRole('link',{name:'返回项目 · 初次协作项目已编辑',exact:true})).toBeVisible();
  await page.reload();
  await expect(page.getByRole('link',{name:'返回项目 · 初次协作项目已编辑',exact:true})).toBeVisible();
  await page.getByRole('link',{name:'返回项目 · 初次协作项目已编辑',exact:true}).click();
  await page.getByRole('link',{name:'查看全部项目',exact:true}).click();
  await expect(page.getByRole('link',{name:'初次协作项目已编辑 ↗',exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'全部项目',exact:true}).click();
  await expect(page.getByRole('link',{name:'初次协作项目已编辑 ↗',exact:true})).toBeVisible();
  for (const query of ['projectId', 'projectId=missing-a&projectId=missing-b']) {
    await page.goto('/members?' + query);
    for (const reload of [false, true]) {
      if (reload) await page.reload();
      await expect(page.getByText('请先选择有效项目，再调整项目角色。',{exact:true})).toBeVisible();
      const grants = page.getByRole('button',{name:'授权',exact:true});
      await expect(grants).toHaveCount(2);
      for (const button of await grants.all()) await expect(button).toBeDisabled();
      await expect(page.getByRole('dialog')).toHaveCount(0);
    }
  }
  expect(roleMutations).toEqual([]);
});
