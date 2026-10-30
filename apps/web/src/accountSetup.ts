export type AccountCodeKind = "activate" | "reset";

export function accountCodeError(value: string, label: string): string {
  return value.length === 43 && /^[A-Za-z0-9_-]{43}$/.test(value)
    ? ""
    : `请粘贴管理员提供的 43 位${label}，仅含英文字母、数字、下划线或短横线。`;
}

export function accountPasswordError(value: string): string {
  const length = Array.from(value).length;
  return length >= 12 && length <= 128 &&
    new TextDecoder("utf-8", { ignoreBOM: true }).decode(new TextEncoder().encode(value)) === value
    ? ""
    : "密码须为 12–128 个 Unicode 字符，请检查长度及字符是否完整。";
}

// Never use raw server detail to distinguish an account or ticket's state.
export function accountSetupFailure(status: number, label: string): string {
  if (status === 401)
    return `${label}无效、已过期或已使用。请核对管理员说明及对应入口；仍无法使用时，请联系管理员重新签发。`;
  if (status === 429) return "尝试过于频繁或密码服务繁忙，请稍后再试。";
  if (status === 400)
    return `提交内容未通过校验，请检查${label}格式、密码长度及确认密码后重试。`;
  if (status === 0)
    return "网络或响应读取失败，暂时无法确认是否设置成功。可先返回登录尝试新密码；若仍无法完成，请联系管理员重新签发。输入仅暂留本页，离开后需重新填写。";
  return "服务暂时无法完成设置，请稍后重试；仍失败时，请联系管理员协助。输入仅暂留本页，离开后需重新填写。";
}

export interface AccountInvitation {
  kind: AccountCodeKind;
  code: string;
  memberId: string;
  displayName: string;
  login?: string;
}

export function buildAccountInvitation(value: AccountInvitation, origin: string): string {
  const label = value.kind === "activate" ? "激活码" : "密码重置码";
  if (accountCodeError(value.code, label)) return "";
  const action = value.kind === "activate" ? "激活账号" : "重置密码";
  return [
    `团队协作工作台 · ${action}`,
    `成员：${value.displayName}`,
    ...(value.login ? [`登录账号：${value.login}`] : [
      `账号标识：${value.memberId}`,
      "登录账号请使用原账号；不记得时请向管理员核对，显示名和账号标识不是登录账号。",
    ]),
    `${value.kind === "activate" ? "激活" : "重置"}入口：${origin}/${value.kind}`,
    `${label}：${value.code}`,
    "有效期：自管理员本次签发起 24 小时，仅可使用一次；重新签发会使旧码失效。",
    `请本人打开对应入口，将上面的 43 位${label}粘贴到同名字段（不是登录账号），设置并确认 12–128 个 Unicode 字符的新密码，然后返回登录。激活码与密码重置码不能互用。`,
    "请通过可信渠道交给本人，勿公开转发。若无效、过期或已使用，请联系管理员重新签发。",
  ].join("\n");
}
