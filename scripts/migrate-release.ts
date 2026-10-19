import { openDb } from "../apps/api/src/db/open.js";
import { migrate } from "../apps/api/src/db/migrate.js";
if (process.env.MAINTENANCE_CONFIRMED !== "yes" || !process.env.DATABASE_PATH)
  throw Error("Explicit maintenance confirmation and DATABASE_PATH required");
const db = openDb(process.env.DATABASE_PATH);
try {
  migrate(db);
} finally {
  db.close();
}
