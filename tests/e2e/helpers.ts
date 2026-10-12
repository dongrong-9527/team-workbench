import { expect, type Page } from "@playwright/test";
export async function login(page: Page, account = "dev") {
  await page.goto("/login");
  await page.getByLabel("登录账号").fill(account);
  await page.getByLabel("密码", { exact: true }).fill("Synthetic-demo-2026!");
  await page.getByRole("button", { name: "登录工作台" }).click();
  await expect(
    page.getByRole("heading", { name: "我的工作", exact: true }),
  ).toBeVisible();
}
export async function action(page: Page, name: string) {
  await page.getByRole("button", { name, exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
}
export async function submit(page: Page, name: string) {
  await page
    .getByRole("dialog")
    .getByRole("button", { name, exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
}
export async function task(
  page: Page,
  title: string,
  owner = "dev",
  project = "p1",
) {
  await login(page, "product");
  await page.goto("/projects/" + project);
  await action(page, "新建任务");
  await page.getByLabel("标题", { exact: true }).fill(title);
  await page
    .getByLabel("完成标准", { exact: true })
    .fill("完成字段校验与边界检查");
  if (owner)
    await page.getByLabel("主负责人", { exact: true }).selectOption(owner);
  await page.getByLabel("检查人", { exact: true }).selectOption("tester");
  await submit(page, "确认新建任务");
  await expect(page).toHaveURL(/\/task\//);
  return page.url();
}
export async function evidence(page: Page, bug = false) {
  for (const [label, text] of bug
    ? [
        ["修复内容", "修正遗漏校验"],
        ["影响范围", "提交接口"],
      ]
    : [["完成内容", "已完成字段校验"]])
    await page.getByLabel(label!, { exact: true }).fill(text!);
  await page.getByLabel("自查结果", { exact: true }).fill("正常与边界已验证");
  await page.getByLabel("检查环境", { exact: true }).fill("集成环境");
  await page.getByLabel("目标版本", { exact: true }).fill("build-1");
}
export async function checks(page: Page, result = "pass") {
  await page.getByLabel("目标版本", { exact: true }).fill("build-1");
  await page.getByLabel("检查环境", { exact: true }).fill("集成环境");
  await expect(
    page.getByRole("combobox", { name: "条目结果", exact: true }).first(),
  ).toBeVisible();
  for (const select of await page
    .getByRole("combobox", { name: "条目结果", exact: true })
    .all())
    await select.selectOption(result);
}
