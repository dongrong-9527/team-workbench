import { beforeEach, afterEach, it, expect } from "vitest";
import { createTestKit, type TestKit, type Actor } from "./helpers.js";
let f: TestKit;
beforeEach(async () => { f = await createTestKit(); });
afterEach(async () => { await f.close(); });
const draft = {projectId:"p1",title:"Synthetic executable creation",source:{description:"Manual source"},description:"",criteria:[],priority:"medium",role:"backend"};
const ready = {...draft,intent:"ready",description:"Complete scope",acceptorId:"product",criteria:[{id:"c1",text:"Required criterion",required:true}],source:{description:"Manual source",status:"checked"}};
const tables=["objects","requirement_revisions","requirement_scopes","events","idempotency"];
function counts(){return tables.map(table=>(f.db.prepare(`SELECT COUNT(*) n FROM ${table}`).get() as any).n);}
it("old clients and explicit draft keep minimal server-draft validation", async()=>{
 for(const body of [draft,{...draft,intent:"draft"}]){
  const r=await f.api<any>("POST","/api/requirements",body,"product");
  expect(r.status).toBe(200);expect(r.body).toMatchObject({state:"draft",scopeConfirmed:false,description:"",criteria:[]});
 }
});
it("ready creation records one final initial scope and compatible created audit with server source time",async()=>{
 const before=Date.now();
 const r=await f.api<any>("POST","/api/requirements",{...ready,source:{...ready.source,checkedAt:"2000-01-01T00:00:00.000Z"}},"product","atomic-ready");
 expect(r.status).toBe(200);expect(r.body).toMatchObject({state:"ready",scopeConfirmed:true,version:1,revision:1,evidenceReady:false});
 expect(Date.parse(r.body.source.checkedAt)).toBeGreaterThanOrEqual(before);expect(Date.parse(r.body.source.checkedAt)).toBeLessThanOrEqual(Date.now());
 expect(r.body).not.toHaveProperty("intent");
 const scopes=f.db.prepare("SELECT snapshot FROM requirement_scopes WHERE requirement_id=?").all(r.body.id) as any[];
 expect(scopes).toHaveLength(1);expect(JSON.parse(scopes[0].snapshot)).toMatchObject({state:"ready",scopeConfirmed:true,version:1});
 const revisions=f.db.prepare("SELECT snapshot FROM requirement_revisions WHERE requirement_id=?").all(r.body.id) as any[];
 expect(revisions).toHaveLength(1);expect(JSON.parse(revisions[0].snapshot).state).toBe("ready");
 const events=f.events("requirement",r.body.id);expect(events).toHaveLength(1);expect(events[0]).toMatchObject({action:"created",actorId:"product"});
 const row=f.db.prepare("SELECT after_snapshot FROM events WHERE target_id=?").get(r.body.id) as any;
 expect(JSON.parse(row.after_snapshot)).toMatchObject({state:"ready",creationIntent:"ready",source:{status:"checked",checkedAt:r.body.source.checkedAt}});
});
it("unable source with a nonblank reason remains a legal ready declaration",async()=>{
 const r=await f.api<any>("POST","/api/requirements",{...ready,source:{description:"Manual source",status:"unable",reason:"Restricted source access"}},"product");
 expect(r.status).toBe(200);expect(r.body).toMatchObject({state:"ready",source:{status:"unable",reason:"Restricted source access"}});expect(r.body.source.checkedAt).toBeUndefined();
});
for(const [name,patch,status] of [
 ["missing source decision",{source:{description:"Manual source"}},422],
 ["blank inability reason",{source:{description:"Manual source",status:"unable",reason:"  "}},400],
 ["blank detailed scope",{description:" \n "},422],
 ["no required criteria",{criteria:[]},422],
 ["only excluded criteria",{criteria:[{id:"c1",text:"Optional",required:false,exclusionReason:"Out of scope"}]},422],
 ["no acceptor",{acceptorId:undefined},422],
 ["nonproduct acceptor",{acceptorId:"dev"},422],
 ["duplicate criterion IDs",{criteria:[{id:"c1",text:"A"},{id:"c1",text:"B"}]},400],
 ["invalid intent",{intent:"active"},400],
] as const) it(`rejects ${name} without leaving a draft or audit`,async()=>{
 const old=counts();const r=await f.api("POST","/api/requirements",{...ready,...patch},"product");expect(r.status).toBe(status);expect(counts()).toEqual(old);
});
for(const actor of ["dev","tester","admin"] as Actor[]) it(`only project product may create ready: ${actor}`,async()=>{
 f.db.prepare("DELETE FROM roles WHERE member_id='admin'").run();
 f.db.prepare("UPDATE roles SET lead=1 WHERE member_id='dev'").run();
 const {acceptorId,...body}=ready;const old=counts();const r=await f.api("POST","/api/requirements",body,actor);expect(r.status).toBe(403);expect(counts()).toEqual(old);
});
it("archiving or disabling the designated acceptor prevents ready creation",async()=>{
 f.db.prepare("UPDATE members SET active=0 WHERE id='admin'").run();
 let old=counts();expect((await f.api("POST","/api/requirements",{...ready,acceptorId:"admin"},"product")).status).toBe(422);expect(counts()).toEqual(old);
 f.db.prepare("UPDATE projects SET archived=1,version=version+1 WHERE id='p1'").run();old=counts();expect((await f.api("POST","/api/requirements",ready,"product")).status).toBe(409);expect(counts()).toEqual(old);
});
it("event failure rolls back ready object, both snapshots and idempotency before a same-key retry",async()=>{
 await f.failNextEvent();const old=counts();const failed=await f.api("POST","/api/requirements",ready,"product","failed-ready");expect(failed.status).toBe(500);expect(counts()).toEqual(old);
 const r=await f.api<any>("POST","/api/requirements",ready,"product","failed-ready");expect(r.status).toBe(200);expect(r.body.state).toBe("ready");
});
it("same-key ready replay stays one creation and cannot be switched to draft; current authorization is rechecked",async()=>{
 const a=await f.api<any>("POST","/api/requirements",ready,"product","replay-ready");expect(a.status).toBe(200);const old=counts();
 const b=await f.api<any>("POST","/api/requirements",ready,"product","replay-ready");expect(b.body).toEqual(a.body);expect(counts()).toEqual(old);
 expect((await f.api("POST","/api/requirements",{...ready,intent:"draft"},"product","replay-ready")).status).toBe(409);expect(counts()).toEqual(old);
 f.db.prepare("DELETE FROM roles WHERE member_id='product'").run();expect((await f.api("POST","/api/requirements",ready,"product","replay-ready")).status).toBe(403);expect(counts()).toEqual(old);
});
