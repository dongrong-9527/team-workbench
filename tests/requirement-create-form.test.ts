import {it,expect} from "vitest";
import {createForm} from "../apps/web/src/forms.js";
import {state} from "../apps/web/src/state.js";
function spec(product=true){state.projects=[{id:"p1",myRoles:[{role:product?"product":"backend",lead:true}]}] as any;state.members=[];return createForm("requirement","p1");}
const full={title:"合成范围",priority:"medium",role:"backend",description:"完整说明",sourceDescription:"人工来源",sourceUrl:"",acceptorId:"product",criteria:[{id:"stable",text:"完成要求",required:true}],sourceStatus:"checked"};
it("keeps draft minimum while formal command binds ready and explicit source without a client timestamp",()=>{
 const s=spec();expect(s.body({...s.initial,title:"最低草稿",sourceDescription:"来源"})).toMatchObject({description:"",criteria:[]});
 const body=s.body(full,"ready");expect(body).toMatchObject({intent:"ready",source:{status:"checked"},criteria:[{id:"stable"}]});expect(body.source).not.toHaveProperty("checkedAt");
});
it("rejects incomplete full submissions while preserving unable-source semantics",()=>{
 const s=spec();for(const patch of [{description:" "},{criteria:[]},{acceptorId:""},{sourceStatus:""},{sourceStatus:"unable",sourceReason:" "}])expect(()=>s.body({...full,...patch},"ready")).toThrow();
 expect(s.body({...full,sourceStatus:"unable",sourceReason:"权限不足无法读取"},"ready").source).toMatchObject({status:"unable",reason:"权限不足无法读取"});
});
it("does not offer or synthesize product submission for a functional lead",()=>{
 const s=spec(false);expect(s.requirementEditor?.canSubmitReady).toBe(false);expect(()=>s.body(full,"ready")).toThrow();expect(s.body(full)).not.toHaveProperty("acceptorId");
});
