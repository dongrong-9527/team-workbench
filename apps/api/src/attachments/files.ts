import { constants } from "node:fs";
import { lstat, mkdir, open, realpath } from "node:fs/promises";
import { resolve, parse, join } from "node:path";
import { createHash } from "node:crypto";
// Reject symlinks in every component; private directories must be service-owned.
export async function safeDirectory(
  path: string,
  create = false,
): Promise<string> {
  const absolute = resolve(path);
  let current = parse(absolute).root;
  for (const part of absolute
    .slice(current.length)
    .split("/")
    .filter(Boolean)) {
    current = join(current, part);
    if (create)
      await mkdir(current, { mode: 0o700 }).catch(
        (e: NodeJS.ErrnoException) => {
          if (e.code !== "EEXIST") throw e;
        },
      );
    const s = await lstat(current);
    if (!s.isDirectory() || s.isSymbolicLink())
      throw new Error("Unsafe directory");
  }
  return realpath(absolute);
}
export function storagePath(directory: string, key: string): string {
  if (!/^[a-f0-9]{64}$/.test(key)) throw new Error("Invalid storage key");
  return join(directory, key);
}
export async function syncDirectory(directory: string): Promise<void> {
  const f = await open(directory, constants.O_RDONLY);
  try {
    await f.sync();
  } finally {
    await f.close();
  }
}
export async function hashFile(
  path: string,
): Promise<{ sha256: string; size: number }> {
  const f = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    if (!(await f.stat()).isFile()) throw new Error("Not a regular file");
    const hash = createHash("sha256");
    let size = 0;
    for await (const chunk of f.createReadStream({ autoClose: false })) {
      hash.update(chunk);
      size += chunk.length;
    }
    return { sha256: hash.digest("hex"), size };
  } finally {
    await f.close();
  }
}
