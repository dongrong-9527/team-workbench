import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { DomainError } from "../db/mutate.js";

export const SCRYPT = Object.freeze({
  N: 131072,
  r: 8,
  p: 1,
  maxmem: 192 * 1024 * 1024,
});
export const HASH_CONCURRENCY = 2;
export const HASH_QUEUE_LIMIT = 4;
let running = 0;
const waiting: Array<() => void> = [];

export function validatePassword(
  password: unknown,
): asserts password is string {
  if (
    typeof password !== "string" ||
    Buffer.from(password).toString("utf8") !== password ||
    Array.from(password).length < 12 ||
    Array.from(password).length > 128
  ) {
    throw new DomainError(400, "Password must contain 12–128 characters");
  }
}

async function derive(password: string, salt: Buffer): Promise<Buffer> {
  if (running >= HASH_CONCURRENCY) {
    if (waiting.length >= HASH_QUEUE_LIMIT)
      throw new DomainError(429, "Password service busy; retry later");
    await new Promise<void>((resolve) => waiting.push(resolve));
  } else {
    running++;
  }
  try {
    return await new Promise<Buffer>((resolve, reject) => {
      scrypt(password, salt, 64, SCRYPT, (error, key) =>
        error ? reject(error) : resolve(key),
      );
    });
  } finally {
    const next = waiting.shift();
    if (next) next();
    else running--;
  }
}

export async function hashPassword(password: string): Promise<string> {
  validatePassword(password);
  const salt = randomBytes(16);
  const key = await derive(password, salt);
  return `scrypt$131072$8$1$${salt.toString("hex")}$${key.toString("hex")}`;
}

export async function verifyPassword(
  password: string,
  encoded: string,
): Promise<boolean> {
  validatePassword(password);
  // Accept only the deployed, bounded cost. Never derive using untrusted encoded parameters.
  const match = /^scrypt\$131072\$8\$1\$([a-f0-9]{32})\$([a-f0-9]{128})$/.exec(
    encoded,
  );
  if (!match) return false;
  return timingSafeEqual(
    await derive(password, Buffer.from(match[1]!, "hex")),
    Buffer.from(match[2]!, "hex"),
  );
}

export const DUMMY_HASH = `scrypt$131072$8$1$${"00".repeat(16)}$${"00".repeat(64)}`;
