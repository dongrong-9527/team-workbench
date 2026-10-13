import { test, expect } from "./fixtures.js";
import {
  selectOption,
  login,
  action,
  submit,
  task,
  evidence,
  checks,
} from "./helpers.js";
test("task_10 submit checks and interrupted update retain input and retry key", async ({
  page,
}) => {
  const url = await task(page, "浏览器字段校验");
  await login(page);
  await page.goto(url);
  await action(page, "开始处理");
  await submit(page, "确认开始处理");
  await action(page, "提交检查");
  await evidence(page);
  await submit(page, "确认提交检查");
  await expect(page.getByText("待检查", { exact: true }).first()).toBeVisible();
  await action(page, "写工作更新");
  await page
    .getByLabel("今天实际做了什么", { exact: true })
    .fill("已完成字段校验");
  const keys: string[] = [];
  await page.route("**/api/updates", (route) => {
    keys.push(route.request().headers()["idempotency-key"]!);
    return route.abort();
  });
  await page.getByRole("button", { name: "保存更新", exact: true }).click();
  await expect(
    page.getByLabel("今天实际做了什么", { exact: true }),
  ).toHaveValue("已完成字段校验");
  await expect(page.getByRole("alert")).toContainText("网络");
  await page.getByRole("button", { name: "保存更新", exact: true }).click();
  await expect.poll(() => keys.length).toBe(2);
  expect(keys[0]).toBe(keys[1]);
  await page
    .getByLabel("今天实际做了什么", { exact: true })
    .fill("已完成字段校验并补充说明");
  await page.getByRole("button", { name: "保存更新", exact: true }).click();
  await expect.poll(() => keys.length).toBe(3);
  expect(keys[2]).not.toBe(keys[1]);
  await page.unroute("**/api/updates");
  await submit(page, "保存更新");
});
test("task_10 full requirement task Bug testing acceptance and behavioral revision through forms", async ({
  page,
}) => {
  test.setTimeout(120000);
  await login(page, "product");
  await page.goto("/projects/p1");
  await action(page, "新建需求");
  await page.getByLabel("标题", { exact: true }).fill("浏览器完整需求闭环");
  await page.getByLabel("来源说明", { exact: true }).fill("合成团队需求评审");
  await page
    .getByLabel("腾讯文档 / 来源链接（仅 HTTPS）")
    .fill("https://docs.qq.com/synthetic");
  await page
    .getByLabel("需求细化说明", { exact: true })
    .fill("提交表单必须正确校验");
  await selectOption(page, "产品验收人", { value: "product", label: "林产品" });
  await page
    .getByLabel("条目说明", { exact: true })
    .fill("提交无效值时给出提示");
  await submit(page, "确认新建需求");
  await expect(page).toHaveURL(/\/requirement\//);
  const reqUrl = page.url(),
    reqId = reqUrl.split("/").at(-1)!;
  await action(page, "细化内容");
  await submit(page, "确认细化内容");
  await action(page, "确认可执行");
  await submit(page, "确认确认可执行");
  await action(page, "拆分任务");
  await page.getByLabel("标题", { exact: true }).fill("需求的字段校验任务");
  await page
    .getByLabel("完成标准", { exact: true })
    .fill("完成输入校验并提供检查证据");
  await selectOption(page, "主负责人", { value: "dev", label: "陈开发" });
  await selectOption(page, "检查人", { value: "tester", label: "周测试" });
  await submit(page, "确认新建任务"); // object detail keeps requirement after split; retrieve linked task through real list
  await page.goto("/projects/p1");
  await page
    .getByRole("link", { name: "需求的字段校验任务", exact: true })
    .click();
  await expect(page).toHaveURL(/\/task\//);
  const taskUrl = page.url(),
    taskId = taskUrl.split("/").at(-1)!;
  await login(page, "dev");
  await page.goto(taskUrl);
  await action(page, "开始处理");
  await submit(page, "确认开始处理");
  await action(page, "写工作更新");
  await page
    .getByLabel("今天实际做了什么", { exact: true })
    .fill("完成输入校验与自查");
  await submit(page, "保存更新");
  await action(page, "提交检查");
  await evidence(page);
  await submit(page, "确认提交检查");
  await login(page, "tester");
  await page.goto(taskUrl);
  await action(page, "检查退回");
  await checks(page, "fail");
  await submit(page, "确认检查退回");
  await expect(page.getByText("进行中", { exact: true }).first()).toBeVisible();
  await page.goto("/projects/p1");
  await action(page, "新建 Bug");
  await page.getByLabel("标题", { exact: true }).fill("空值提交未正确提示");
  await page.getByLabel("预期行为", { exact: true }).fill("显示输入提示");
  await page.getByLabel("实际行为", { exact: true }).fill("没有提示");
  await page.getByLabel("复现步骤", { exact: true }).fill("清空字段后提交");
  await page.getByLabel("复现环境", { exact: true }).fill("集成环境");
  await page.getByLabel("关联需求编号", { exact: true }).fill(reqId);
  await page.getByLabel("关联任务编号", { exact: true }).fill(taskId);
  await submit(page, "确认新建Bug");
  await expect(page).toHaveURL(/\/bug\//);
  const bugUrl = page.url();
  await action(page, "确认 Bug");
  await page.getByLabel("操作原因", { exact: true }).fill("已稳定复现");
  await submit(page, "确认确认 Bug");
  await login(page, "dev");
  await page.goto(bugUrl);
  await action(page, "认领");
  await submit(page, "确认认领");
  await action(page, "开始处理");
  await submit(page, "确认开始处理");
  await action(page, "提交修复");
  await evidence(page, true);
  await submit(page, "确认提交修复");
  await login(page, "tester");
  await page.goto(bugUrl);
  await action(page, "验证通过");
  await checks(page);
  await submit(page, "确认验证通过");
  await expect(page.getByText("已关闭", { exact: true }).first()).toBeVisible();
  await login(page, "dev");
  await page.goto(taskUrl);
  await action(page, "提交检查");
  await evidence(page);
  await submit(page, "确认提交检查");
  await login(page, "tester");
  await page.goto(taskUrl);
  await action(page, "检查通过");
  await checks(page);
  await submit(page, "确认检查通过");
  await page.goto(reqUrl);
  await action(page, "新增测试记录");
  await checks(page);
  await submit(page, "确认新增测试记录");
  await login(page, "product");
  await page.goto(reqUrl);
  await action(page, "提交产品验收");
  await page.getByLabel("目标版本", { exact: true }).fill("build-1");
  await submit(page, "确认提交产品验收");
  await action(page, "产品验收");
  await selectOption(page, "条目结果", { value: "true", label: "通过" });
  await page.getByLabel("操作原因", { exact: true }).fill("全部验收条目通过");
  await submit(page, "确认产品验收");
  await expect(page.getByText("已验收", { exact: true }).first()).toBeVisible();
  await action(page, "确认需求修订");
  await page.getByLabel("操作原因", { exact: true }).fill("补充中文输入边界");
  await page
    .getByLabel("条目说明", { exact: true })
    .fill("无效值与中文输入均正确提示");
  await page
    .getByRole("dialog")
    .getByLabel("需求的字段校验任务", { exact: true })
    .check();
  await page
    .getByRole("dialog")
    .getByLabel("提交无效值时给出提示", { exact: true })
    .check();
  await page.getByLabel("我已核对影响范围，相关工作可能退回重新检查").check();
  await submit(page, "确认确认需求修订");
  await expect(page.getByText(/需求修订 R2/)).toBeVisible();
  await page.goto(taskUrl);
  await expect(page.getByText(/修订待处理/)).toBeVisible();
});
test("task_10 product reviewer can check non-development tasks and recorded self-test is visible", async ({
  page,
}) => {
  await login(page, "product");
  await page.goto("/projects/p1");
  await action(page, "新建任务");
  await page.getByLabel("标题", { exact: true }).fill("产品检查的测试协调任务");
  await selectOption(page, "任务类型", { value: "test", label: "测试" });
  await page.getByLabel("完成标准", { exact: true }).fill("完成测试清单核对");
  await selectOption(page, "主负责人", { value: "tester", label: "周测试" });
  await selectOption(page, "检查人", { value: "product", label: "林产品" });
  await submit(page, "确认新建任务");
  await expect(page).toHaveURL(/\/task\//);
  const url = page.url();
  await login(page, "tester");
  await page.goto(url);
  await action(page, "开始处理");
  await submit(page, "确认开始处理");
  await action(page, "提交检查");
  await evidence(page);
  await submit(page, "确认提交检查");
  await login(page, "product");
  await page.goto(url);
  await action(page, "检查通过");
  await checks(page);
  await submit(page, "确认检查通过");
  await expect(page.getByText("已完成", { exact: true }).first()).toBeVisible();
  const devUrl = await task(page, "兼任开发与测试的自测记录");
  await action(page, "指定检查人");
  await selectOption(page, "检查人", { value: "dev", label: "陈开发" });
  await submit(page, "确认指定检查人");
  await login(page, "dev");
  await page.goto(devUrl);
  await action(page, "开始处理");
  await submit(page, "确认开始处理");
  await action(page, "提交检查");
  await evidence(page);
  await submit(page, "确认提交检查");
  await action(page, "检查通过");
  await checks(page);
  await submit(page, "确认检查通过");
  await page.getByRole("button", { name: /测试证据/ }).click();
  await expect(page.getByText("自测", { exact: true })).toBeVisible();
});
test("task_10 new update drafts and correction drafts stay separate; correction conflicts adopt latest identity", async ({
  page,
  context,
}) => {
  const url = await task(page, "更新更正的草稿隔离");
  await login(page, "dev");
  await page.goto(url);
  await action(page, "写工作更新");
  await page
    .getByLabel("今天实际做了什么", { exact: true })
    .fill("第一条已保存贡献");
  await submit(page, "保存更新");
  await action(page, "写工作更新");
  await page
    .getByLabel("今天实际做了什么", { exact: true })
    .fill("第二条尚未保存的贡献");
  await page.getByRole("button", { name: "返回并保留草稿" }).click();
  await page.getByRole("button", { name: /我的工作更新/ }).click();
  await action(page, "更正此条更新");
  await expect(
    page.getByLabel("今天实际做了什么", { exact: true }),
  ).toHaveValue("第一条已保存贡献");
  const other = await context.newPage();
  await other.goto(url);
  await other.getByRole("button", { name: /我的工作更新/ }).click();
  await action(other, "更正此条更新");
  await page.getByLabel("今天实际做了什么", { exact: true }).fill("第一份更正");
  await page.getByLabel("操作原因", { exact: true }).fill("补充");
  await submit(page, "保存更新");
  await other
    .getByLabel("今天实际做了什么", { exact: true })
    .fill("并发的第二份更正");
  await other.getByLabel("操作原因", { exact: true }).fill("核对最新后补充");
  await other.getByRole("button", { name: "保存更新", exact: true }).click();
  await expect(
    other.getByRole("heading", { name: "版本冲突：请核对最新记录" }),
  ).toBeVisible();
  await other.getByRole("button", { name: "采用最新版本并重新核对" }).click();
  await expect(
    other.getByLabel("今天实际做了什么", { exact: true }),
  ).toHaveValue("并发的第二份更正");
  await submit(other, "保存更新");
  await expect(
    other.getByText("并发的第二份更正", { exact: true }).first(),
  ).toBeVisible();
  await action(page, "写工作更新");
  await expect(
    page.getByLabel("今天实际做了什么", { exact: true }),
  ).toHaveValue("第二条尚未保存的贡献");
  await other.close();
});
test("task_10 standalone objects never invent links and explicit Task Bug relationships remain visible", async ({
  page,
}) => {
  const taskUrl = await task(page, "明确关联的独立任务");
  const taskId = taskUrl.split("/").at(-1)!;
  await expect(
    page.getByRole("heading", { name: "完成标准", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", {
      name: "任务 · 优化跨项目筛选与列表可读性",
      exact: true,
    }),
  ).toHaveCount(0);
  await page.goto("/projects/p1");
  await action(page, "新建 Bug");
  await page.getByLabel("标题", { exact: true }).fill("明确关联独立任务的缺陷");
  await page.getByLabel("预期行为", { exact: true }).fill("显示提示");
  await page.getByLabel("实际行为", { exact: true }).fill("未显示");
  await page.getByLabel("复现步骤", { exact: true }).fill("清空字段提交");
  await page.getByLabel("复现环境", { exact: true }).fill("集成环境");
  await page.getByLabel("关联任务编号", { exact: true }).fill(taskId);
  await submit(page, "确认新建Bug");
  await expect(page).toHaveURL(/\/bug\//);
  const bugUrl = page.url();
  await expect(
    page.getByRole("link", { name: "任务 · 明确关联的独立任务", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", {
      name: "任务 · 优化跨项目筛选与列表可读性",
      exact: true,
    }),
  ).toHaveCount(0);
  await page.goto(taskUrl);
  await expect(
    page.getByRole("link", {
      name: "Bug · 明确关联独立任务的缺陷",
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("link", { name: "Bug · 明确关联独立任务的缺陷", exact: true })
    .click();
  await expect(page).toHaveURL(bugUrl);
});
