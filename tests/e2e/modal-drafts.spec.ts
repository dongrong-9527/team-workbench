import { test, expect } from "./fixtures.js";
import { login } from "./helpers.js";
import { api, requirement } from "./audit-helpers.js";

test("failed local draft storage reports failure and return cannot silently lose the form",async({page})=>{
  await login(page,"product");await page.goto("/projects/p1");await page.getByRole("button",{name:"新建任务",exact:true}).click();
  const editor=page.getByRole("dialog",{name:"新建任务",exact:true});
  await editor.getByLabel("完成标准",{exact:true}).fill("仅在本页的未完成草稿");
  await page.evaluate(()=>{(window as any).originalDraftSetItem=Storage.prototype.setItem;Storage.prototype.setItem=function(){throw new DOMException("Synthetic quota","QuotaExceededError");};});
  await editor.getByRole("button",{name:"保存为草稿",exact:true}).click();
  await expect(editor.getByText("草稿保存失败，内容仍在当前页面，请勿直接离开。",{exact:true})).toBeVisible();
  await editor.getByRole("button",{name:"返回",exact:true}).click();
  const warning=page.getByRole("dialog",{name:"本地暂存失败",exact:true});await expect(warning).toBeVisible();
  await warning.getByRole("button",{name:"继续填写",exact:true}).click();await expect(editor).toBeVisible();
  await page.evaluate(()=>{Storage.prototype.setItem=(window as any).originalDraftSetItem;});
  await editor.getByRole("button",{name:"保存为草稿",exact:true}).click();
  await expect(editor.getByText("草稿已保存在当前浏览器，尚未提交业务数据。",{exact:true})).toBeVisible();
});

test("an ambiguous creation retains its valid command even if restored editable values are malformed",async({page})=>{
  await login(page,"product");await page.goto("/projects/p1");await page.getByRole("button",{name:"新建任务",exact:true}).click();
  const editor=page.getByRole("dialog",{name:"新建任务",exact:true});let lost=true;const keys:string[]=[];
  await page.route("**/api/tasks",async route=>{if(route.request().method()!=="POST")return route.continue();keys.push(route.request().headers()["idempotency-key"]!);if(lost){lost=false;await route.fetch();return route.abort();}return route.continue();});
  await editor.getByLabel("标题",{exact:true}).fill("合成原命令恢复不依赖坏的可编辑值");await editor.getByRole("button",{name:"确认新建任务",exact:true}).click();
  await expect(editor.getByRole("button",{name:"重试确认创建",exact:true})).toBeVisible();
  await editor.getByRole("button",{name:"返回",exact:true}).click();
  await page.evaluate(()=>{const key="workbench:draft:product:create:task:p1",saved=JSON.parse(localStorage.getItem(key)!);saved.values=[];localStorage.setItem(key,JSON.stringify(saved));});
  await page.getByRole("button",{name:"新建任务",exact:true}).click();
  await expect(editor.getByRole("button",{name:"重试确认创建",exact:true})).toBeVisible();
  await expect(editor.getByLabel("标题",{exact:true})).toBeDisabled();
  await editor.getByRole("button",{name:"重试确认创建",exact:true}).click();await expect(page).toHaveURL(/\/task\//);
  expect(keys).toHaveLength(2);expect(new Set(keys).size).toBe(1);
});

test("unfinished task draft saves locally without creating or validating a server object", async ({ page }) => {
  await login(page,"product");await page.goto("/projects/p1");
  await page.getByRole("button",{name:"新建任务",exact:true}).click();
  const dialog=page.getByRole("dialog",{name:"新建任务",exact:true});
  const writes:string[]=[];page.on("request",r=>{if(r.method()==="POST"&&new URL(r.url()).pathname==="/api/tasks")writes.push(r.url());});
  await dialog.getByLabel("完成标准",{exact:true}).fill("尚未填标题，先存本机");
  const save=dialog.getByRole("button",{name:"保存为草稿",exact:true});await expect(save).toBeVisible();await save.click();
  await expect(dialog.getByText("草稿已保存在当前浏览器，尚未提交业务数据。",{exact:true})).toBeVisible();
  await expect(dialog.getByLabel("标题",{exact:true})).toHaveValue("");
  await dialog.getByRole("button",{name:"返回",exact:true}).click();
  await page.getByRole("button",{name:"新建任务",exact:true}).click();
  await expect(dialog.getByLabel("完成标准",{exact:true})).toHaveValue("尚未填标题，先存本机");expect(writes).toEqual([]);
});

test("project edit returns without a standalone draft action or server mutation", async ({ page }) => {
  await login(page,"admin");await page.goto("/projects/p1");
  await page.getByRole("button",{name:"编辑项目",exact:true}).click();
  const dialog=page.getByRole("dialog",{name:"编辑项目",exact:true});
  await expect(dialog.getByRole("button",{name:"保存为草稿",exact:true})).toHaveCount(0);
  await expect(dialog.getByRole("button",{name:"保存修改",exact:true})).toBeVisible();
  await dialog.getByLabel("项目名称",{exact:true}).fill("本次没有提交的名称");
  await dialog.getByRole("button",{name:"返回",exact:true}).click();
  expect((await api(page,"GET","/api/projects/p1")).name).toBe("星河协作计划");
});

for(const kind of ["task","bug"] as const)test(`${kind} unknown create keeps one original command through return, reload, and a rejected retry`,async({page})=>{
  await login(page,"product");await page.goto("/projects/p1");
  const entry=kind==="task"?"新建任务":"新建 Bug",title=kind==="task"?"新建任务":"新建Bug";
  await page.getByRole("button",{name:entry,exact:true}).click();
  let dialog=page.getByRole("dialog",{name:title,exact:true});let attempt=0;const keys:string[]=[];
  await page.route(`**/api/${kind==="task"?"tasks":"bugs"}`,async route=>{
    if(route.request().method()!=="POST")return route.continue();keys.push(route.request().headers()["idempotency-key"]!);attempt++;
    if(attempt===1){await route.fetch();return route.abort();}
    if(attempt===2)return route.fulfill({status:403,contentType:"application/json",body:JSON.stringify({error:"合成重试临时拒绝"})});
    return route.continue();
  });
  const text="合成未知新建保护 "+kind;
  await dialog.getByLabel("标题",{exact:true}).fill(text);
  await dialog.getByRole("button",{name:kind==="task"?"确认新建任务":"确认新建Bug",exact:true}).click();
  await expect(dialog.getByRole("button",{name:"重试确认创建",exact:true})).toBeVisible();
  await expect(dialog.getByLabel("标题",{exact:true})).toBeDisabled();
  await expect(dialog.getByRole("button",{name:"保存为草稿",exact:true})).toBeDisabled();
  await dialog.getByRole("button",{name:"返回",exact:true}).click();
  await page.reload();await page.getByRole("button",{name:entry,exact:true}).click();
  dialog=page.getByRole("dialog",{name:title,exact:true});
  await expect(dialog.getByLabel("标题",{exact:true})).toHaveValue(text);
  await dialog.getByRole("button",{name:"重试确认创建",exact:true}).click();
  await expect(dialog.getByText(/合成重试临时拒绝/)).toBeVisible();
  await expect(dialog.getByLabel("标题",{exact:true})).toBeDisabled();
  await dialog.getByRole("button",{name:"重试确认创建",exact:true}).click();
  await expect(page).toHaveURL(new RegExp("/"+kind+"/"));
  expect(keys).toHaveLength(3);expect(new Set(keys).size).toBe(1);
  const items=(await api(page,"GET",`/api/${kind==="task"?"tasks":"bugs"}?projectId=p1&limit=100`)).items;
  expect(items.filter((x:any)=>x.title===text)).toHaveLength(1);
});

test("a foreign draft context cannot be restored under the current user's storage key",async({page})=>{
  await login(page,"product");await page.goto("/projects/p1");
  await page.evaluate(()=>localStorage.setItem("workbench:draft:product:create:task:p1",JSON.stringify({context:{actor:"dev",draftKey:"create:task:p1",path:"/api/tasks",method:"POST",projectId:"p1"},values:{title:"不属于当前上下文",kind:"backend",priority:"medium"}})));
  await page.getByRole("button",{name:"新建任务",exact:true}).click();
  await expect(page.getByRole("dialog").getByLabel("标题",{exact:true})).toHaveValue("");
});

test("all standalone creation entries are real masked Modals with background and safe focus return",async({page},info)=>{
  await login(page,"product");await page.goto("/projects/p1");
  for(const [entry,title] of [["新建需求","新建需求"],["新建任务","新建任务"],["新建 Bug","新建Bug"]]){
    const trigger=page.getByRole("button",{name:entry,exact:true});await trigger.click();const dialog=page.getByRole("dialog",{name:title,exact:true});
    await expect(page.locator(".ant-modal-mask")).toBeVisible();await expect(dialog).toHaveClass(/ant-modal/);
    await expect(dialog).toHaveAttribute("aria-modal","true");await expect(page.locator("#main > .page-action-form")).toHaveCount(0);
    await expect(page.locator("#main").getByRole("heading",{name:"星河协作计划",exact:true})).toBeVisible();
    await page.mouse.click(2,2);await expect(dialog).toBeVisible();
    await dialog.getByLabel("标题",{exact:true}).fill("合成真实弹框 "+entry);
    if(entry==="新建需求")await page.screenshot({path:info.outputPath("creation-modal-desktop.png"),fullPage:true});
    await page.keyboard.press("Escape");await expect(dialog).toHaveCount(0);await expect(trigger).toBeFocused();
  }
});

test("requirement split and a direct linked Bug URL use Modals and retain a safe background",async({page})=>{
  await login(page,"product");const r=await requirement(page,"合成弹框拆分来源");await page.goto(`/requirement/${r.id}`);
  await page.getByRole("button",{name:"拆分任务",exact:true}).click();
  const split=page.getByRole("dialog",{name:"新建任务",exact:true});await expect(split).toHaveClass(/ant-modal/);
  await expect(split.getByLabel("关联需求编号",{exact:true})).toHaveValue(r.id);
  await split.getByRole("button",{name:"返回",exact:true}).click();await expect(page).toHaveURL(new RegExp(`/requirement/${r.id}$`));
  await page.goto(`/projects/p1?create=bug&requirementId=${r.id}`);await page.reload();
  const bug=page.getByRole("dialog",{name:"新建Bug",exact:true});await expect(bug).toHaveClass(/ant-modal/);
  await expect(bug.getByLabel("关联需求编号",{exact:true})).toHaveValue(r.id);
  await bug.getByRole("button",{name:"返回",exact:true}).click();await expect(page).toHaveURL(/\/projects\/p1$/);
});
