import type { Database } from 'better-sqlite3';
import { isDeepStrictEqual } from 'node:util';
export class DomainError extends Error {
 constructor(public statusCode:number,message:string,public latest?:unknown){super(message);}
}
export interface MutationContext { actorId:string; requestId:string; route:string; bodyHash:string; expectedVersion?:number; authorize:(db:Database)=>void }
function requireSync(value:unknown):void {
 if(value!==null && (typeof value==='object'||typeof value==='function') && typeof (value as {then?:unknown}).then==='function') throw new TypeError('Mutation callbacks must be synchronous');
}
export function mutate<T>(db:Database,ctx:MutationContext,run:()=>T):T {
 if(db.inTransaction) throw new Error('Nested mutations are not supported');
 if(!ctx.actorId || !ctx.requestId || !ctx.route || !ctx.bodyHash || typeof ctx.authorize!=='function') throw new DomainError(400,'Invalid mutation context');
 if(ctx.expectedVersion!==undefined && (!Number.isSafeInteger(ctx.expectedVersion)||ctx.expectedVersion<1)) throw new DomainError(400,'Invalid expectedVersion');
 if(run.constructor.name==='AsyncFunction'||ctx.authorize.constructor.name==='AsyncFunction') throw new TypeError('Mutation callbacks must be synchronous');
 try {
 return db.transaction(()=>{
  const member=db.prepare('SELECT active FROM members WHERE id=?').get(ctx.actorId) as {active:number}|undefined;
  if(!member || !member.active) throw new DomainError(403,'Member is inactive');
  requireSync(ctx.authorize(db));
  const old=db.prepare('SELECT route,body_hash,response FROM idempotency WHERE actor_id=? AND request_id=?').get(ctx.actorId,ctx.requestId) as {route:string;body_hash:string;response:string}|undefined;
  if(old) {
   if(old.route!==ctx.route || old.body_hash!==ctx.bodyHash) throw new DomainError(409,'Idempotency key reused');
   return JSON.parse(old.response) as T;
  }
  const result=run();requireSync(result);
  const response=JSON.stringify(result);
  if(response===undefined) throw new TypeError('Mutation result must be JSON serializable');
  db.prepare('INSERT INTO idempotency VALUES (?,?,?,?,?)').run(ctx.actorId,ctx.requestId,ctx.route,ctx.bodyHash,response);
  return JSON.parse(response) as T;
 }).immediate();
 } catch(error) {
  if((error as {code?:string}).code?.startsWith('SQLITE_BUSY')) throw new DomainError(503,'Database busy; retry later');
  throw error;
 }
}
export function changeObject(db:Database,ctx:MutationContext,id:string,current:Record<string,unknown>,action:string):void {
 if(!db.inTransaction) throw new Error('Object changes require a mutation transaction');
 const old=db.prepare('SELECT * FROM objects WHERE id=?').get(id) as {id:string;kind:string;version:number;current:string}|undefined;
 if(!old) throw new DomainError(404,'Object not found');
 if(ctx.expectedVersion===undefined) throw new DomainError(400,'expectedVersion is required');
 if(old.version!==ctx.expectedVersion) throw new DomainError(409,'Version conflict',{id:old.id,version:old.version,current:JSON.parse(old.current)});
 const after=JSON.stringify(current);
 if(isDeepStrictEqual(JSON.parse(old.current),JSON.parse(after))) return;
 const changed=db.prepare('UPDATE objects SET current=?,version=version+1 WHERE id=? AND version=?').run(after,id,ctx.expectedVersion);
 if(changed.changes!==1) throw new DomainError(409,'Version conflict');
 db.prepare('INSERT INTO events (time,action,actor_id,target_kind,target_id,before_snapshot,after_snapshot) VALUES (?,?,?,?,?,?,?)').run(new Date().toISOString(),action,ctx.actorId,old.kind,id,old.current,after);
}
