// Synthetic fixture lives only in a temporary directory, outside the archive.
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

const [rootArg, output] = process.argv.slice(2);
const root = resolve(rootArg);
const load = (path) => import(pathToFileURL(join(root, 'apps/api/dist', path)).href);
const { verifyRuntime } = await load('scripts/verify-runtime.js');
const manifest = JSON.parse(await readFile(join(root, 'release-manifest.json'), 'utf8'));
assert.deepEqual(await verifyRuntime(manifest, root), { ok: true, failures: [] });
const { openDb } = await load('apps/api/src/db/open.js');
const { migrate } = await load('apps/api/src/db/migrate.js');
const { hashPassword } = await load('apps/api/src/auth/password.js');
const directory = await mkdtemp(join(tmpdir(), 'candidate-smoke-'));
const databasePath = join(directory, 'synthetic.sqlite');
let db;
let server;
const started = Date.now();
try {
  db = openDb(databasePath); migrate(db);
  const login = `ci-${randomBytes(8).toString('hex')}`;
  const password = randomBytes(32).toString('base64url');
  const actor = randomUUID(), project = randomUUID();
  db.prepare('INSERT INTO members(id,name,is_admin,login,password_hash) VALUES(?,?,?,?,?)').run(actor, 'CI synthetic member', 1, login, await hashPassword(password));
  db.prepare('INSERT INTO projects(id,name) VALUES(?,?)').run(project, 'CI synthetic project');
  db.prepare("INSERT INTO roles(project_id,member_id,role,lead) VALUES(?,?,'product',1)").run(project, actor);
  const origin = 'http://127.0.0.1:39173';
  server = spawn(join(root, 'runtime/node'), [join(root, 'apps/api/dist/apps/api/src/server.js')], {
    env: { ...process.env, NODE_ENV: 'production', HOST: '127.0.0.1', PORT: '39173', APP_ORIGIN: origin, DATABASE_PATH: databasePath, ATTACHMENT_PATH: join(directory, 'attachments'), RELEASE_VERSION: manifest.version },
    // Do not capture request, credential, server or database content in logs.
    stdio: 'ignore',
  });
  const stopped = once(server, 'exit');
  const request = async (path, options = {}, expected = 200) => {
    const response = await fetch(origin + path, { ...options, signal: AbortSignal.timeout(5000) });
    assert.equal(response.status, expected, `HTTP status for ${path.split('/').slice(0, 4).join('/')}`);
    return response;
  };
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (server.exitCode !== null) throw Error('Production server exited before readiness');
    try { await request('/api/health/ready'); ready = true; break; } catch { await new Promise((done) => setTimeout(done, 100)); }
  }
  assert.ok(ready, 'Production startup health');
  await request('/api/health/live');
  await request('/api/admin/runtime', {}, 401);
  const response = await request('/api/auth/login', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ login, password }) });
  const cookie = response.headers.get('set-cookie')?.split(';')[0];
  const { csrfToken } = await response.json();
  assert.ok(cookie && csrfToken, 'Authenticated session');
  const headers = { origin, cookie, 'x-csrf-token': csrfToken, 'content-type': 'application/json', 'idempotency-key': randomUUID() };
  await request('/api/tasks', { headers });
  const options = { method: 'POST', headers, body: JSON.stringify({ projectId: project, title: 'CI synthetic task', kind: 'backend', definitionOfDone: 'Verify artifact startup and idempotent write', priority: 'low' }) };
  const created = await (await request('/api/tasks', options)).json();
  const replay = await (await request('/api/tasks', options)).json();
  assert.equal(replay.id, created.id);
  assert.equal((await (await request(`/api/tasks/${created.id}`, { headers })).json()).id, created.id);
  const runtime = await (await request('/api/admin/runtime', { headers })).json();
  assert.equal(runtime.version, manifest.version);
  assert.equal(runtime.sqliteVersion, manifest.sqliteVersion);
  const createdEvents = db.prepare("SELECT count(*) n FROM events WHERE action='created' AND target_id=?").get(created.id).n;
  const idempotencyRows = db.prepare('SELECT count(*) n FROM idempotency').get().n;
  assert.equal(createdEvents, 1); assert.equal(idempotencyRows, 1);
  server.kill('SIGTERM');
  const timeout = setTimeout(() => server.kill('SIGKILL'), 5000);
  const [code] = await stopped; clearTimeout(timeout);
  assert.equal(code, 0, 'Graceful production shutdown');
  await writeFile(output, JSON.stringify({ ok: true, createdEvents, idempotencyRows, durationMs: Date.now() - started }) + '\n');
} finally {
  if (server && server.exitCode === null) { server.kill('SIGKILL'); await once(server, 'exit'); }
  db?.close();
  await rm(directory, { recursive: true, force: true });
}
