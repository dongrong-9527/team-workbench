import { describe, expect, it } from "vitest";
import { compatibleDraft } from "../apps/web/src/formDraft.js";
import { canSaveBrowserDraft, createForm, actionForm } from "../apps/web/src/forms.js";
import { state } from "../apps/web/src/state.js";

const context = { actor: "product", draftKey: "create:task:p1", path: "/api/tasks", method: "POST", projectId: "p1" };
describe("browser draft binding", () => {
  it("restores unfinished ordinary text only in the same current context", () => {
    const saved = { context, values: { title: "", definitionOfDone: "尚未填完" }, version: 2 };
    expect(compatibleDraft(saved, context)).toBe(true);
    for (const patch of [{actor:"dev"},{projectId:"p2"},{path:"/api/bugs"},{method:"PUT"},{draftKey:"create:bug:p1"}])
      expect(compatibleDraft(saved, {...context,...patch})).toBe(false);
  });
  it("keeps legacy safe text and rejects a mismatched or malformed attempted command", () => {
    expect(compatibleDraft({values:{title:"旧输入"}},context)).toBe(true);
    expect(compatibleDraft({values:[],context},context)).toBe(false);
    expect(compatibleDraft({values:{},fingerprint:JSON.stringify(["/api/bugs","POST",{projectId:"p1"}]),key:"old"},context)).toBe(false);
    expect(compatibleDraft({values:{},fingerprint:"broken",key:"old"},context)).toBe(false);
    expect(compatibleDraft({values:{},fingerprint:JSON.stringify(["/api/tasks","POST",{projectId:"p2"}]),key:"old"},context)).toBe(false);
    expect(compatibleDraft({values:{},fingerprint:JSON.stringify(["/api/tasks","POST",{projectId:"p1"}]),key:"old"},context)).toBe(true);
  });
});
describe("explicit local draft capability", () => {
  it("offers unfinished browser drafts for task and Bug creation while requirement keeps its server draft", () => {
    state.member={id:"product"} as any;state.members=[];state.projects=[{id:"p1",myRoles:[{role:"product"}],roleMembers:[]}] as any;
    expect(canSaveBrowserDraft(createForm("task","p1"))).toBe(true);
    expect(canSaveBrowserDraft(createForm("bug","p1"))).toBe(true);
    expect(canSaveBrowserDraft(createForm("requirement","p1"))).toBe(false);
  });
  it("never offers local draft actions for sensitive or zero-field confirmations", () => {
    expect(canSaveBrowserDraft({browserDraft:true,fields:[]},false)).toBe(false);
    expect(canSaveBrowserDraft({browserDraft:true,fields:[{key:"secret",label:"敏感值"}]},true)).toBe(false);
    const object={id:"t1",projectId:"p1",title:"合成任务",kind:"backend",state:"pending",version:1,checks:[],criteria:[]};
    expect(canSaveBrowserDraft(actionForm("task",object,"claim"))).toBe(false);
    expect(canSaveBrowserDraft(actionForm("task",object,"submit"))).toBe(true);
    expect(canSaveBrowserDraft(actionForm("task",object,"update"))).toBe(true);
  });
});
