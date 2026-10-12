import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import type {Database} from 'better-sqlite3';
import type {Event,Ref} from '../packages/contracts/src/index.js';
import {openDb} from '../apps/api/src/db/open.js';
import {migrate} from '../apps/api/src/db/migrate.js';
import {mutate,changeObject,DomainError,type MutationContext} from '../apps/api/src/db/mutate.js';
import {buildApp} from '../apps/api/src/app.js';
export type Actor='anonymous'|'admin'|'product'|'dev'|'dev2'|'tester';
export type Method='GET'|'POST'|'PUT'|'PATCH';
export interface TestTables {test_objects:{id:string;kind:string;project_id:string;version:number;current:string}}
// Later modules add their real input fixtures here rather than placeholder business models.
export interface FixtureMap {core:{projectId:string;objectId:string}}
export interface TestKit {
 db:Database;path:string;context:MutationContext;baseUrl:string;
 api<T=Record<string,unknown>>(method:Method,path:string,body?:unknown,actor?:Actor,key?:string):Promise<{status:number;body:T}>;
 read<K extends keyof TestTables>(table:K):TestTables[K][];
 events(kind?:Ref['kind']|'member',id?:string):Event[];
 seed<K extends keyof FixtureMap>(name:K):FixtureMap[K];fresh(name:string):string;failNextEvent():Promise<void>;close():Promise<void>;
}
export async function createTestKit():Promise<TestKit> {
 const dir=mkdtempSync(join(tmpdir(),'workbench-'));const path=join(dir,'test.db');const db=openDb(path);migrate(db);
 for(const actor of ['admin','product','dev','dev2','tester']) db.prepare('INSERT INTO members (id,name,is_admin) VALUES (?,?,?)').run(actor,actor,actor==='admin'?1:0);
 db.exec("INSERT INTO projects (id,name) VALUES ('p1','Project One'),('p2','Project Two')");
 for(const [member,role] of [['admin','product'],['product','product'],['dev','backend'],['dev2','frontend'],['tester','test']]) db.prepare('INSERT INTO roles VALUES (?,?,?)').run('p1',member,role);
 const authorize=(connection:Database)=>{
  if(!connection.prepare('SELECT 1 FROM roles WHERE member_id=? AND project_id=?').get(activeActor,'p1')) throw new DomainError(403,'Permission denied');
 };
 let activeActor='admin';
 const context:MutationContext={actorId:'admin',requestId:'direct',route:'/direct',bodyHash:'direct',authorize};
 const app=buildApp(db);
 app.addHook('onResponse',async()=>{db.exec('DROP TRIGGER IF EXISTS temp.fail_event');});
 // Test identity adapter only: real active-member and database-role checks remain in mutate.
 // Session/CSRF middleware is introduced by task 2; this adapter never enters the production app.
 app.post('/test/mutation',request=>{
  const actor=String(request.headers['x-test-actor']??'anonymous');if(actor==='anonymous')throw new DomainError(401,'Authentication required');
  activeActor=actor;
  const body=request.body as {title?:string;expectedVersion?:number};
  const ctx:MutationContext={actorId:actor,requestId:String(request.headers['idempotency-key']),route:'/test/mutation',bodyHash:createHash('sha256').update(JSON.stringify(body)).digest('hex'),expectedVersion:body.expectedVersion,authorize};
  return mutate(db,ctx,()=>{
   const current={title:body.title??'Initial'};
   if(db.prepare('SELECT 1 FROM objects WHERE id=?').get('t1')) {
    changeObject(db,ctx,'t1',current,'updated');
   } else {
    db.prepare("INSERT INTO objects VALUES ('t1','task','p1',1,?)").run(JSON.stringify(current));
    db.prepare("INSERT INTO events (time,action,actor_id,target_kind,target_id,after_snapshot) VALUES (?,'created',?,'task','t1',?)").run(new Date().toISOString(),actor,JSON.stringify(current));
   }
   return {id:'t1',version:(db.prepare('SELECT version FROM objects WHERE id=?').get('t1') as {version:number}).version};
  });
 });
 await app.listen({host:'127.0.0.1',port:0});
 return {db,path,context,baseUrl:app.listeningOrigin,
 async api<T>(method:Method,url:string,body:unknown={},actor:Actor='admin',key:string=randomUUID()) {
  // Task 1 default is fixed version 1; explicit supplied versions are never changed or fetched.
  const payload=typeof body==='object'&&body!==null?{expectedVersion:1,...body}:body;
  const response=await app.inject({method,url,payload:JSON.stringify(payload),headers:{'content-type':'application/json','x-test-actor':actor,'idempotency-key':key}});
  return {status:response.statusCode,body:response.json<T>()};
 },
 read(table) {if(table!=='test_objects')throw new Error('Unknown table');return db.prepare('SELECT * FROM objects ORDER BY id').all() as TestTables[typeof table][];},
 events(kind,id) {
  const rows=db.prepare('SELECT * FROM events WHERE (? IS NULL OR target_kind=?) AND (? IS NULL OR target_id=?) ORDER BY seq').all(kind??null,kind??null,id??null,id??null) as {seq:number;time:string;action:string;actor_id:string;target_kind:Event['target']['kind'];target_id:string;before_snapshot:string|null;after_snapshot:string|null}[];
  return rows.map(row=>({seq:row.seq,time:row.time,action:row.action,actorId:row.actor_id,target:{kind:row.target_kind,id:row.target_id},before:row.before_snapshot===null?null:JSON.parse(row.before_snapshot),after:row.after_snapshot===null?null:JSON.parse(row.after_snapshot)}));
 },
 seed(name){if(name!=='core')throw new Error('Unknown fixture');return {projectId:'p1',objectId:'t1'};},fresh(name){return `${name}-${randomUUID()}`;},
 async failNextEvent(){db.exec("CREATE TEMP TRIGGER fail_event BEFORE INSERT ON events BEGIN SELECT RAISE(ABORT,'injected event failure'); END;");},
 async close(){await app.close();db.close();rmSync(dir,{recursive:true,force:true});}
 };
}
