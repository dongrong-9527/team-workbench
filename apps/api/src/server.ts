import { schemaReady } from "./health/routes.js";
import { buildApp } from "./app.js";
import { config } from "./config.js";
import { openDb } from "./db/open.js";
import { migrate } from "./db/migrate.js";
const settings = config();
const db = openDb(settings.databasePath);
if (process.env.NODE_ENV === "production") {
  try {
    if (!schemaReady(db))
      throw new Error("Explicit maintenance migration required");
  } catch (error) {
    db.close();
    throw error;
  }
} else migrate(db);
const app = buildApp(db, { attachments: settings.attachments });
app.addHook("onClose", () => {
  db.close();
});
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, () => {
    void app.close();
  });
try {
  await app.listen({ host: settings.host, port: settings.port });
} catch (error) {
  await app.close();
  throw error;
}
