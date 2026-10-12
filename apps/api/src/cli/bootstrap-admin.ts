import type { Database } from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { pathToFileURL } from "node:url";
import { Writable } from "node:stream";
import { hashPassword } from "../auth/password.js";
import { loginName, securityTransaction, text } from "../auth/guards.js";
import { memberEvent } from "../members/service.js";
import { openDb } from "../db/open.js";
import { migrate } from "../db/migrate.js";
import { config } from "../config.js";

export async function bootstrapAdmin(
  db: Database,
  input: {
    login: string;
    displayName: string;
    password: string;
    isTTY: boolean;
  },
): Promise<string> {
  if (!input.isTTY)
    throw new Error("Bootstrap requires a local interactive terminal");
  const login = loginName(input.login);
  const name = text(input.displayName, 1, 100);
  if (db.prepare("SELECT 1 FROM members LIMIT 1").get())
    throw new Error("Bootstrap requires an empty database");
  const hash = await hashPassword(input.password);
  return securityTransaction(db, () => {
    if (db.prepare("SELECT 1 FROM members LIMIT 1").get())
      throw new Error("Bootstrap requires an empty database");
    const id = randomUUID();
    db.prepare(
      "INSERT INTO members (id,name,is_admin,login,password_hash) VALUES (?,?,1,?,?)",
    ).run(id, name, login, hash);
    memberEvent(db, id, id, "bootstrap", null);
    return id;
  });
}

async function main(): Promise<void> {
  if (
    !process.stdin.isTTY ||
    !process.stdout.isTTY ||
    process.argv.length !== 2
  )
    throw new Error(
      "Bootstrap requires a local interactive terminal and accepts no arguments",
    );
  let muted = false;
  const output = new Writable({
    write(chunk, _encoding, callback) {
      if (!muted) process.stdout.write(chunk);
      callback();
    },
  });
  // Readline terminal mode uses raw input: the operating system does not echo the password.
  const terminal = createInterface({
    input: process.stdin,
    output,
    terminal: true,
  });
  try {
    const login = await terminal.question("Login: ");
    const displayName = await terminal.question("Display name: ");
    process.stdout.write("Password (12–128 characters, hidden): ");
    muted = true;
    const password = await terminal.question("");
    process.stdout.write("\nConfirm password (hidden): ");
    const confirm = await terminal.question("");
    muted = false;
    process.stdout.write("\n");
    if (password !== confirm) throw new Error("Passwords do not match");
    const db = openDb(config().databasePath);
    try {
      migrate(db);
      await bootstrapAdmin(db, { login, displayName, password, isTTY: true });
      process.stdout.write("Administrator created.\n");
    } finally {
      db.close();
    }
  } finally {
    terminal.close();
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch(() => {
    process.stderr.write(
      "Bootstrap failed: interactive terminal, valid input, matching passwords and an empty database are required.\n",
    );
    process.exitCode = 1;
  });
}
