import { describe, expect, it } from "vitest";
import { accountCodeError, accountPasswordError, accountSetupFailure, buildAccountInvitation } from "../apps/web/src/accountSetup.js";
import { validatePassword } from "../apps/api/src/auth/password.js";

describe("account setup input matches the authentication boundary", () => {
  it.each(["", "a".repeat(42), "a".repeat(44), "a".repeat(42) + "+", "a".repeat(42) + "中", "a".repeat(43) + "\n"])("rejects incomplete or non URL-safe code %#", value => {
    expect(accountCodeError(value, "激活码")).toBeTruthy();
  });
  it("accepts exactly 43 URL-safe characters", () => {
    expect(accountCodeError("A_0-" + "a".repeat(39), "密码重置码")).toBe("");
  });
  it.each(["a".repeat(11), "a".repeat(129), "😀".repeat(11), "😀".repeat(129), "a".repeat(12) + "\ud800"])("rejects out of range or malformed Unicode password %#", value => {
    expect(accountPasswordError(value)).toBeTruthy();
    expect(() => validatePassword(value)).toThrow();
  });
  it.each(["a".repeat(12), "a".repeat(128), "😀".repeat(12), "😀".repeat(128), " ".repeat(12), "  你好😀密码abcdef  ", "\ufeff" + "a".repeat(11)])("accepts exact code point boundaries and preserves whitespace %#", value => {
    expect(accountPasswordError(value)).toBe("");
    expect(() => validatePassword(value)).not.toThrow();
  });
  it("keeps invalid, expired and used code recovery indistinguishable", () => {
    expect(accountSetupFailure(401, "激活码")).toContain("无效、已过期或已使用");
    expect(accountSetupFailure(401, "激活码")).toContain("联系管理员重新签发");
    expect(accountSetupFailure(401, "密码重置码")).not.toContain("账号不存在");
    expect(accountSetupFailure(0, "激活码")).toContain("返回登录");
    expect(accountSetupFailure(429, "密码重置码")).toContain("稍后");
  });
});

describe("one-time invitation composition", () => {
  it("uses the submitted login and a credential-free fixed activation entry", () => {
    const text = buildAccountInvitation({ kind: "activate", code: "a".repeat(43), login: "synthetic.new", displayName: "合成成员", memberId: "member-1" }, "https://example.test");
    expect(text).toContain("登录账号：synthetic.new");
    expect(text).toContain("激活入口：https://example.test/activate\n");
    expect(text).toContain("激活码：" + "a".repeat(43));
    expect(text).toContain("24 小时");
    expect(text).toContain("12–128");
    expect(text).not.toMatch(/[?#]/);
  });
  it("uses safe identity when reset has no authorized login", () => {
    const text = buildAccountInvitation({ kind: "reset", code: "b".repeat(43), displayName: "合成成员", memberId: "member-2" }, "https://example.test");
    expect(text).toContain("账号标识：member-2");
    expect(text).toContain("登录账号请使用原账号");
    expect(text).toContain("重置入口：https://example.test/reset\n");
    expect(text).not.toContain("登录账号：合成成员");
  });
  it.each(["", "bad"])("never creates an invitation from missing or invalid raw code %#", code => {
    expect(buildAccountInvitation({ kind: "reset", code, memberId: "member-2", displayName: "合成成员" }, "https://example.test")).toBe("");
  });
});
