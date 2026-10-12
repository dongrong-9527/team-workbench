import { it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync } from 'node:fs';
import type { TestKit } from './helpers.js';
let f: TestKit;
beforeEach(async () => {
 expect(existsSync(new URL('../apps/api/src/db/mutate.ts', import.meta.url)), 'mutation implementation must exist').toBe(true);
 f = await (await import('./helpers.js')).createTestKit();
});
afterEach(async () => { if (f) await f.close(); });
it('task_01 rolls back object, event and replay response when event insert fails', async () => {
 await f.failNextEvent();
 expect((await f.api('POST','/test/mutation',{},'admin','retry')).status).toBe(500);
 expect(f.read('test_objects')).toEqual([]); expect(f.events()).toEqual([]);
 expect(f.db.prepare('SELECT * FROM idempotency').all()).toEqual([]);
 expect((await f.api('POST','/test/mutation',{},'admin','retry')).status).toBe(200);
});
it('replays once, rejects changed content, and preserves actor key scope', async () => {
 const a=await f.api('POST','/test/mutation',{},'admin','key');
 expect(a.status).toBe(200);
 expect(await f.api('POST','/test/mutation',{},'admin','key')).toEqual(a);
 expect(f.events()).toHaveLength(1);
 expect((await f.api('POST','/test/mutation',{title:'other'},'admin','key')).status).toBe(409);
 expect((await f.api('POST','/test/mutation',{title:'dev change'},'dev','key')).status).toBe(200);
 expect(f.events()).toHaveLength(2);
});
it('rejects stale versions with latest record and increments only effective changes', async () => {
 await f.api('POST','/test/mutation',{},'admin');
 const a=await f.api('POST','/test/mutation',{expectedVersion:1,title:'changed'},'admin');
 expect(a.status).toBe(200); expect(f.read('test_objects')[0].version).toBe(2);
 const b=await f.api<{latest:{version:number}}>('POST','/test/mutation',{expectedVersion:1,title:'stale'},'admin');
 expect(b.status).toBe(409); expect(b.body.latest.version).toBe(2); expect(f.events()).toHaveLength(2);
});
it('rechecks active member and authorization before replay', async () => {
 await f.api('POST','/test/mutation',{},'dev','key');
 f.db.prepare('DELETE FROM roles WHERE member_id=?').run('dev');
 expect((await f.api('POST','/test/mutation',{},'dev','key')).status).toBe(403);
 f.db.prepare('UPDATE members SET active=0 WHERE id=?').run('admin');
 expect((await f.api('POST','/test/mutation',{},'admin','key')).status).toBe(403);
 expect((await f.api('POST','/test/mutation',{},'anonymous')).status).toBe(401);
});
it('rejects async mutation callbacks and rolls back synchronous work', async () => {
 const {mutate}=await import('../apps/api/src/db/mutate.js');
 expect(()=>mutate(f.db,f.context,()=>{f.db.prepare("UPDATE members SET name='bad'").run(); return Promise.resolve('bad');})).toThrow('synchronous');
 expect(f.db.prepare('SELECT name FROM members WHERE id=?').get('admin')).toEqual({name:'admin'});
});
it('maps real two-connection write contention to 503 without partial writes', async () => {
 const {openDb}=await import('../apps/api/src/db/open.js'); const other=openDb(f.path);
 other.exec('BEGIN IMMEDIATE');
 try { expect((await f.api('POST','/test/mutation',{},'admin')).status).toBe(503); expect(f.events()).toEqual([]); expect(f.read('test_objects')).toEqual([]); }
 finally {other.exec('ROLLBACK');other.close();}
},10000);
it('enforces durable pragmas, fixed SQLite runtime, migration idempotence, immutable events and references', async () => {
 expect(f.db.pragma('journal_mode',{simple:true})).toBe('wal');
 expect(f.db.pragma('foreign_keys',{simple:true})).toBe(1);
 expect(f.db.pragma('synchronous',{simple:true})).toBe(2);
 expect(f.db.pragma('busy_timeout',{simple:true})).toBe(3000);
 const v=(f.db.prepare('SELECT sqlite_version() v').get() as {v:string}).v.split('.').map(Number);
 expect(v[0]>3 || v[0]===3 && (v[1]>51 || v[1]===51 && v[2]>=3)).toBe(true);
 const {migrate}=await import('../apps/api/src/db/migrate.js');migrate(f.db);
 expect(f.db.prepare('SELECT * FROM schema_migrations').all()).toHaveLength(1);
 await f.api('POST','/test/mutation',{},'admin');
 expect(()=>f.db.exec('DELETE FROM events')).toThrow(); expect(()=>f.db.exec("UPDATE events SET action='bad'")).toThrow();
 expect(()=>f.db.exec("INSERT INTO objects VALUES ('bad','task','missing',1,'{}')")).toThrow();
});
it('production app serves health and never registers test mutation routes', async () => {
 const {buildApp}=await import('../apps/api/src/app.js'); const app=buildApp(f.db);
 expect((await app.inject('/health')).statusCode).toBe(200);
 expect((await app.inject({method:'POST',url:'/test/mutation',payload:{}})).statusCode).toBe(404);
 await app.close();
});

it('SQL refuses dangling event targets and nonincrementing object versions', async () => {
 expect(()=>f.db.prepare("INSERT INTO events(time,action,actor_id,target_kind,target_id) VALUES (?,'bad','admin','task','missing')").run(new Date().toISOString())).toThrow();
 await f.api('POST','/test/mutation',{},'admin');
 expect(()=>f.db.exec("UPDATE objects SET version=99 WHERE id='t1'")).toThrow();
 expect(()=>f.db.exec("UPDATE objects SET current='[]' WHERE id='t1'")).toThrow();
});
it('no-op updates create no event or version increment', async () => {
 await f.api('POST','/test/mutation',{},'admin');
 expect((await f.api('POST','/test/mutation',{},'admin')).status).toBe(200);
 expect(f.read('test_objects')[0].version).toBe(1);expect(f.events()).toHaveLength(1);
});
it('authorization callback and route binding run before replay and callback execution', async () => {
 const {mutate,DomainError}=await import('../apps/api/src/db/mutate.js');
 const c={...f.context,requestId:'binding'};
 expect(mutate(f.db,c,()=>({value:1}))).toEqual({value:1});
 expect(()=>mutate(f.db,{...c,route:'/changed'},()=>({value:2}))).toThrow('Idempotency');
 expect(()=>mutate(f.db,{...c,authorize:()=>{throw new DomainError(403,'revoked');}},()=>({value:2}))).toThrow('revoked');
 expect(()=>mutate(f.db,{...c,requestId:'async',authorize:async()=>{}},()=>({value:2}))).toThrow('synchronous');
});
it('migration failure leaves no partial schema and succeeds after cause is removed', async () => {
 const {openDb}=await import('../apps/api/src/db/open.js');const {migrate}=await import('../apps/api/src/db/migrate.js');
 const db=openDb(f.path+'.migration');
 try {
  db.exec('CREATE TABLE members (id TEXT)');expect(()=>migrate(db)).toThrow();
  expect(db.prepare("SELECT name FROM sqlite_master WHERE name='projects' OR name='schema_migrations'").all()).toEqual([]);
  db.exec('DROP TABLE members');migrate(db);expect(db.prepare('SELECT * FROM schema_migrations').all()).toHaveLength(1);
 } finally {db.close();}
});
it('reordered JSON object properties are a no-op while array order remains significant', async () => {
 const {mutate,changeObject}=await import('../apps/api/src/db/mutate.js');
 const current={a:1,b:2,nested:{x:'one',y:'two'},items:[{first:1,second:2},'tail']};
 f.db.prepare("INSERT INTO objects VALUES ('t1','task','p1',1,?)").run(JSON.stringify(current));
 const reordered={items:[{second:2,first:1},'tail'],nested:{y:'two',x:'one'},b:2,a:1};
 mutate(f.db,{...f.context,expectedVersion:1},()=>{
  changeObject(f.db,{...f.context,expectedVersion:1},'t1',reordered,'updated');return {ok:true};
 });
 expect(f.read('test_objects')[0].version).toBe(1);
 expect(f.read('test_objects')[0].current).toBe(JSON.stringify(current));
 expect(f.events()).toEqual([]);
 const changed={...reordered,items:['tail',{second:2,first:1}]};
 mutate(f.db,{...f.context,requestId:'array-change',expectedVersion:1},()=>{
  changeObject(f.db,{...f.context,expectedVersion:1},'t1',changed,'updated');return {ok:true};
 });
 expect(f.read('test_objects')[0].version).toBe(2);
 expect(JSON.parse(f.read('test_objects')[0].current)).toEqual(changed);
 expect(f.events()).toHaveLength(1);
});
