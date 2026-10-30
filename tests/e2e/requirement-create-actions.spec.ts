import { test, expect } from "./fixtures.js";
import { login, selectOption } from "./helpers.js";
import { api } from "./audit-helpers.js";
import sharp from "sharp";
import type { Page, Locator } from "@playwright/test";
async function open(page:Page, actor="product") { await login(page,actor);await page.goto("/projects/p1");await page.getByRole("button",{name:"新建需求",exact:true}).click();return page.getByRole("dialog",{name:"新建需求",exact:true}); }
async function complete(page:Page, modal:Locator, title:string){
 await modal.getByLabel("标题",{exact:true}).fill(title);await modal.getByLabel("来源说明",{exact:true}).fill("合成已人工核对来源");
 await modal.getByText("补充细节",{exact:true}).click();await modal.getByLabel("需求细化说明",{exact:true}).fill("合成完整执行范围");
 await selectOption(page,"产品验收人",{value:"product",label:"林产品"});await modal.getByRole("button",{name:"添加条目",exact:true}).click();await modal.getByLabel("条目说明",{exact:true}).fill("按约定完成并验证");
}
async function checked(page:Page){ await selectOption(page,"来源核对结果",{value:"checked",label:"已人工核对"}); }
const formal="提交为可执行需求";
test("minimum server draft remains independent of the new full-submit checks",async({page})=>{
 const modal=await open(page);await expect(modal.getByRole("button",{name:formal,exact:true})).toBeVisible();
 await modal.getByLabel("标题",{exact:true}).fill("合成最低草稿");await modal.getByLabel("来源说明",{exact:true}).fill("细化和核对尚未完成");
 let posts=0;page.on("request",r=>{if(r.method()==="POST"&&new URL(r.url()).pathname==="/api/requirements")posts++;});
 await modal.locator('input[type="file"]').setInputFiles({name:"invalid-stage.png",mimeType:"image/png",buffer:await sharp({create:{width:8,height:8,channels:3,background:"#6688aa"}}).png().toBuffer()});
 await modal.getByRole("button",{name:formal,exact:true}).click();await expect(modal.getByText(/请填写需求细化说明|请选择来源核对结果/)).toBeInViewport();expect(posts).toBe(0);await expect(modal.getByText("invalid-stage.png",{exact:true})).toBeVisible();
 const response=page.waitForResponse(r=>r.request().method()==="POST"&&new URL(r.url()).pathname==="/api/requirements");await modal.getByRole("button",{name:"保存草稿",exact:true}).click();const saved=await(await response).json();expect(saved.state).toBe("draft");await expect(page).toHaveURL(new RegExp("/requirement/"+saved.id+"$"));expect(posts).toBe(1);
});
for(const width of [1440,390])test(`product explicitly confirms source and creates ready on ${width}px`,async({page},info)=>{
 await page.setViewportSize({width,height:width===390?844:1000});const modal=await open(page);await complete(page,modal,"合成原子正式提交 "+width);
 await modal.getByRole("button",{name:formal,exact:true}).click();await expect(modal.getByText("请选择来源核对结果。",{exact:true})).toBeVisible();await checked(page);
 await page.screenshot({path:info.outputPath(`ready-create-${width}.png`),animations:"disabled",fullPage:false});
 const response=page.waitForResponse(r=>r.request().method()==="POST"&&new URL(r.url()).pathname==="/api/requirements");await modal.getByRole("button",{name:formal,exact:true}).click();const saved=await(await response).json();expect(saved).toMatchObject({state:"ready",scopeConfirmed:true,version:1});await expect(page).toHaveURL(new RegExp("/requirement/"+saved.id+"$"));await expect(page.getByText("待开始",{exact:true}).first()).toBeVisible();await expect(page.locator(".history")).toContainText("创建并确认可执行");
});
test("functional lead sees server draft without product submission authority",async({page})=>{
 const modal=await open(page,"dev");await expect(modal.getByRole("button",{name:formal,exact:true})).toHaveCount(0);await expect(modal.getByRole("button",{name:"保存草稿",exact:true})).toBeVisible();
});
test("editing or restoring ordinary input never restores a source confirmation",async({page})=>{
 let modal=await open(page);await complete(page,modal,"合成核对绑定");let posts=0;page.on("request",r=>{if(r.method()==="POST"&&new URL(r.url()).pathname==="/api/requirements")posts++;});await checked(page);await modal.getByLabel("标题",{exact:true}).fill("合成核对绑定已修改");await expect(modal.getByText("已人工核对",{exact:true})).toHaveCount(0);await modal.getByRole("button",{name:formal,exact:true}).click();await expect(modal.getByText("请选择来源核对结果。",{exact:true})).toBeVisible();expect(posts).toBe(0);
 await checked(page);await modal.getByRole("button",{name:"返回",exact:true}).click();await page.getByRole("button",{name:"新建需求",exact:true}).click();modal=page.getByRole("dialog",{name:"新建需求",exact:true});await modal.getByText("补充细节",{exact:true}).click();await expect(modal.getByRole("combobox",{name:"来源核对结果",exact:true})).toHaveValue("");await expect(modal.getByLabel("需求细化说明",{exact:true})).toHaveValue("合成完整执行范围");await modal.getByRole("button",{name:formal,exact:true}).click();await expect(modal.getByText("请选择来源核对结果。",{exact:true})).toBeVisible();expect(posts).toBe(0);
});
test("lost ready creation remains the same ready command through rejected retry and reload",async({page})=>{
 let modal=await open(page);await complete(page,modal,"合成未知正式提交");await checked(page);const bodies:string[]=[];const keys:string[]=[];
 await page.route("**/api/requirements",async route=>{if(route.request().method()!=="POST")return route.continue();bodies.push(route.request().postData()!);keys.push(route.request().headers()["idempotency-key"]!);if(keys.length===1){await route.fetch();return route.abort();}if(keys.length===2)return route.fulfill({status:403,contentType:"application/json",body:JSON.stringify({error:"合成权限暂拒绝"})});return route.continue();});
 await modal.getByRole("button",{name:formal,exact:true}).click();await expect(modal.getByRole("button",{name:"重试确认保存",exact:true})).toBeVisible();await expect(modal.getByRole("button",{name:"保存草稿",exact:true})).toHaveCount(0);await expect(modal.getByRole("button",{name:formal,exact:true})).toHaveCount(0);
 await modal.getByRole("button",{name:"重试确认保存",exact:true}).click();await expect(modal.getByText(/合成权限暂拒绝/)).toBeVisible();await modal.getByRole("button",{name:"返回",exact:true}).click();await page.reload();await page.getByRole("button",{name:"新建需求",exact:true}).click();modal=page.getByRole("dialog",{name:"新建需求",exact:true});await modal.getByRole("button",{name:"重试确认保存",exact:true}).click();await expect(page).toHaveURL(/\/requirement\//);
 expect(new Set(keys).size).toBe(1);expect(new Set(bodies).size).toBe(1);expect(JSON.parse(bodies[0]!).intent).toBe("ready");const items=(await api(page,"GET","/api/requirements?projectId=p1&limit=100")).items;expect(items.filter((x:any)=>x.title==="合成未知正式提交")).toHaveLength(1);
});
test("ready remains executable after image response loss and retries images without another creation",async({page})=>{
 const modal=await open(page);await complete(page,modal,"合成正式需求图片补传");const image={name:"ready-image.png",mimeType:"image/png",buffer:await sharp({create:{width:8,height:8,channels:3,background:"#6688aa"}}).png().toBuffer()};await modal.locator('input[type="file"]').setInputFiles(image);await checked(page);
 let creates=0;const keys:string[]=[];page.on("request",r=>{if(r.method()==="POST"&&new URL(r.url()).pathname==="/api/requirements")creates++;});await page.route("**/api/objects/requirement/*/attachments?*",async route=>{if(route.request().method()!=="POST")return route.continue();keys.push(route.request().headers()["idempotency-key"]!);if(keys.length===1){await route.fetch();return route.abort();}return route.continue();});
 const response=page.waitForResponse(r=>r.request().method()==="POST"&&new URL(r.url()).pathname==="/api/requirements");await modal.getByRole("button",{name:formal,exact:true}).click();const saved=await(await response).json();await expect(modal.getByText(/待开始.*图片|图片.*不会撤回/)).toBeVisible();expect((await api(page,"GET","/api/requirements/"+saved.id)).state).toBe("ready");await modal.getByRole("button",{name:"重试失败图片",exact:true}).click();await expect(page).toHaveURL(new RegExp("/requirement/"+saved.id+"$"));expect(creates).toBe(1);expect(new Set(keys).size).toBe(1);expect((await api(page,"GET",`/api/objects/requirement/${saved.id}/attachments`)).items).toHaveLength(1);
});

test("unable source requires its reason and submits without asserting checked",async({page})=>{
 const modal=await open(page);await complete(page,modal,"合成无法核对说明");await selectOption(page,"来源核对结果",{value:"unable",label:"无法核对"});
 await modal.getByRole("button",{name:formal,exact:true}).click();await expect(modal.getByText("请填写无法核对原因。",{exact:true})).toBeVisible();await modal.getByLabel("无法核对原因",{exact:true}).fill("腾讯文档权限不足，按已提供说明确认范围");
 const response=page.waitForResponse(r=>r.request().method()==="POST"&&new URL(r.url()).pathname==="/api/requirements");await modal.getByRole("button",{name:formal,exact:true}).click();const saved=await(await response).json();expect(saved.state).toBe("ready");expect(saved.source.status).toBe("unable");expect(saved.source.checkedAt).toBeUndefined();await expect(page.locator(".history")).toContainText("无法核对；原因：腾讯文档权限不足，按已提供说明确认范围");
});
test("pending formal creation blocks both actions and dismissal without duplicate requests",async({page})=>{
 const modal=await open(page);await complete(page,modal,"合成重复正式提交");await checked(page);let release!:()=>void;const gate=new Promise<void>(resolve=>release=resolve);let posts=0;
 await page.route("**/api/requirements",async route=>{if(route.request().method()!=="POST")return route.continue();posts++;await gate;return route.continue();});
 const button=modal.getByRole("button",{name:formal,exact:true});await button.evaluate((el:HTMLButtonElement)=>{el.click();el.click();});await expect(modal.getByRole("button",{name:"返回",exact:true})).toBeDisabled();await expect(modal.locator(".mutation-submit")).toHaveCount(0);await page.keyboard.press("Escape");await page.mouse.click(2,2);await expect(modal).toBeVisible();expect(posts).toBe(1);release();await expect(page).toHaveURL(/\/requirement\//);expect(posts).toBe(1);
});
for (const changed of ["expectedCompletion", "priority"]) test(`changing ${changed} invalidates the earlier manual source declaration`, async ({page})=>{
 const modal=await open(page);await complete(page,modal,"合成核对字段 "+changed);await checked(page);
 if(changed==="expectedCompletion") await modal.getByLabel("期望完成时间",{exact:true}).fill("下个版本前");
 else await selectOption(page,"优先级",{value:"high",label:"高"});
 await expect(modal.getByText("已人工核对",{exact:true})).toHaveCount(0);
 await modal.getByRole("button",{name:formal,exact:true}).click();await expect(modal.getByText("请选择来源核对结果。",{exact:true})).toBeInViewport();
});
test("restored unknown ready creation verifies current state before treating the replayed acknowledgement as usable",async({page})=>{
 let modal=await open(page);await complete(page,modal,"合成未知恢复核对当前状态");
 await modal.locator('input[type="file"]').setInputFiles({name:"lost-on-reload.png",mimeType:"image/png",buffer:await sharp({create:{width:8,height:8,channels:3,background:"#6688aa"}}).png().toBuffer()});await checked(page);
 let id="";const keys:string[]=[];
 await page.route("**/api/requirements",async route=>{if(route.request().method()!=="POST")return route.continue();keys.push(route.request().headers()["idempotency-key"]!);if(keys.length===1){const result=await route.fetch();id=(await result.json()).id;return route.abort();}return route.continue();});
 await modal.getByRole("button",{name:formal,exact:true}).click();await expect(modal.getByRole("button",{name:"重试确认保存",exact:true})).toBeVisible();
 await api(page,"POST",`/api/requirements/${id}/actions`,{action:"cancel",expectedVersion:1,reason:"合成其他产品取消",taskDisposition:[]});
 page.once("dialog",dialog=>dialog.accept());await page.reload();await page.getByRole("button",{name:"新建需求",exact:true}).click();modal=page.getByRole("dialog",{name:"新建需求",exact:true});
 let reads=0;await page.route("**/api/requirements/"+id,async route=>{if(route.request().method()!=="GET")return route.continue();reads++;if(reads===1)return route.fulfill({status:503,contentType:"application/json",body:JSON.stringify({error:"合成核对暂失败"})});return route.continue();});
 await modal.getByRole("button",{name:"重试确认保存",exact:true}).click();await expect(modal.getByRole("button",{name:"重新核对保存回执",exact:true})).toBeVisible();await expect(modal.getByRole("button",{name:"查看已保存需求",exact:true})).toBeDisabled();
 await modal.getByRole("button",{name:"重新核对保存回执",exact:true}).click();await expect(modal.getByText(/保存结果：已取消/)).toBeVisible();await expect(modal.getByRole("button",{name:"查看已保存需求",exact:true})).toBeEnabled();expect(reads).toBe(2);expect(keys).toHaveLength(2);expect(new Set(keys).size).toBe(1);
});
