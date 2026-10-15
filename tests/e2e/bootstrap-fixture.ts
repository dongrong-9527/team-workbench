import { join } from 'node:path';
import assert from 'node:assert/strict';
import { openDb } from '../../apps/api/src/db/open.js';
import { migrate } from '../../apps/api/src/db/migrate.js';
import { bootstrapAdmin } from '../../apps/api/src/cli/bootstrap-admin.js';
import { buildApp } from '../../apps/api/src/app.js';
export async function startBootstrapFixture(dir: string) {
  const db = openDb(join(dir, 'bootstrap.db'));
  migrate(db);
  for (const table of ['members', 'projects', 'roles'])
    assert.equal((db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as {n:number}).n, 0);
  await bootstrapAdmin(db, {login:'bootstrap',displayName:'初始管理员',password:'Synthetic-demo-2026!',isTTY:true});
  assert.equal((db.prepare('SELECT count(*) AS n FROM members').get() as {n:number}).n, 1);
  for (const table of ['projects', 'roles'])
    assert.equal((db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as {n:number}).n, 0);
  const app = buildApp(db, {origin:'https://127.0.0.1:4175',attachments:{directory:join(dir,'bootstrap-attachments')}});
  await app.listen({host:'127.0.0.1',port:4176});
  return {close:async () => { await app.close(); db.close(); }};
}
