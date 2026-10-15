export class ApiError extends Error {
  constructor(
    public code: number,
    message: string,
    public current?: Record<string, unknown>,
    public reasons?: unknown[],
  ) {
    super(message);
  }
}
let csrf = "";
export function setCsrf(token: string) {
  csrf = token;
}
const messages: Record<string, string> = {
  401: "登录已过期，请重新登录。草稿已保留。",
  403: "当前账号没有执行此操作的权限，请刷新权限后重试。",
  404: "记录不存在或已不可用。",
  409: "记录已变更，请对照最新记录后重新操作。",
  413: "图片超过文件大小或附件配额，请缩小图片后重试。",
  415: "图片无法读取，仅支持有效的 PNG、JPEG、WebP 静态图片。",
  422: "当前业务条件尚未满足，请检查填写内容与相关证据。",
  429: "操作过于频繁，请稍后重试。",
  500: "服务暂时异常，输入已保留，请稍后重试。",
  503: "数据库繁忙，输入已保留，请稍后重试。",
};
export async function request<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !(init.body instanceof FormData)) headers.set("content-type", "application/json");
  if (init.method && init.method !== "GET" && csrf)
    headers.set("x-csrf-token", csrf);
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      headers,
      credentials: "same-origin",
    });
  } catch {
    throw new ApiError(0, "网络连接失败，输入已保留；恢复连接后可重试。");
  }
  const data = await response.json().catch(() => {
    // A body can fail after successful headers (for example during navigation).
    // Never let an unread response masquerade as a successful empty payload.
    if (response.ok)
      throw new ApiError(0, "响应数据无法读取，输入已保留；请重试。");
    return {};
  });
  if (!response.ok) {
    if (response.status === 401)
      window.dispatchEvent(new Event("workbench:expired"));
    const detail =
      data.error === "ARCHIVED" ? "项目已归档，目前仅可阅读。" : data.error;
    throw new ApiError(
      response.status,
      (messages[response.status] ?? "请求未通过校验，请检查填写内容。") +
        (detail ? `（${detail}）` : ""),
      data.latest,
      data.reasons,
    );
  }
  return data as T;
}
// The command owns its key: retry the same serialized command with the same key.
export function command(storageKey?: string) {
  let last = "",
    key = "";
  if (storageKey) {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) ?? "null");
      last = saved?.last ?? "";
      key = saved?.key ?? "";
    } catch {}
  }
  return {
    async send<T>(path: string, body: unknown, method = "POST") {
      const fingerprint = JSON.stringify([path, method, body]);
      if (fingerprint !== last) {
        last = fingerprint;
        key = crypto.randomUUID();
      }
      if (storageKey)
        localStorage.setItem(storageKey, JSON.stringify({ last, key }));
      return request<T>(path, {
        method,
        body: JSON.stringify(body),
        headers: { "Idempotency-Key": key },
      });
    },
    reset() {
      last = "";
      key = "";
      if (storageKey) localStorage.removeItem(storageKey);
    },
  };
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}
export async function allPages<T>(
  path: string,
  valid: () => boolean = () => true,
): Promise<T[]> {
  let result: T[] = [];
  let cursor: string | null = null;
  do {
    const p: Page<T> = await request(
      path +
        (path.includes("?") ? "&" : "?") +
        "limit=100" +
        (cursor ? "&cursor=" + encodeURIComponent(cursor) : ""),
    );
    if (!valid()) return [];
    result.push(...p.items);
    cursor = p.nextCursor;
  } while (cursor);
  return result;
}

export async function allSeqPages<T>(
  path: string,
  valid: () => boolean = () => true,
): Promise<T[]> {
  let result: T[] = [],
    after = 0,
    cutoff: number | undefined;
  do {
    const p: { items: T[]; nextAfterSeq: number | null; cutoffSeq: number } =
      await request(
        path +
          (path.includes("?") ? "&" : "?") +
          "limit=100&afterSeq=" +
          after +
          (cutoff === undefined ? "" : "&cutoffSeq=" + cutoff),
      );
    if (!valid()) return [];
    result.push(...p.items);
    cutoff = p.cutoffSeq;
    if (p.nextAfterSeq === null) return result;
    after = p.nextAfterSeq;
  } while (true);
}
