export function config(env: NodeJS.ProcessEnv = process.env) {
  const port = Number(env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("Invalid PORT");
  return {
    host: env.HOST ?? "127.0.0.1",
    port,
    databasePath: env.DATABASE_PATH ?? "workbench.db",
    attachmentDirectory: env.ATTACHMENT_PATH ?? "data/attachments",
    attachments: {
      directory: env.ATTACHMENT_PATH ?? "data/attachments",
      ...Object.fromEntries(
        Object.entries({
          maxBytes: "ATTACHMENT_MAX_BYTES",
          maxPixels: "ATTACHMENT_MAX_PIXELS",
          maxPerObject: "ATTACHMENT_MAX_PER_OBJECT",
          maxTotalBytes: "ATTACHMENT_MAX_TOTAL_BYTES",
          maxConcurrent: "ATTACHMENT_MAX_CONCURRENT",
        })
          .filter(([, key]) => env[key] !== undefined)
          .map(([name, key]) => [name, Number(env[key])]),
      ),
    },
  };
}
