# Requirement Editor and Collapsible Filters Implementation Plan

> **For agentic workers:** Task1/2 use superpowers:executing-plans inline; Task3 is an independent file-isolated domain delegated under superpowers:dispatching-parallel-agents, with browser windows coordinated serially. One independent whole-change reviewer remains at the end. Steps use checkbox tracking. User already approved the complete design and said 开始修改, so no repeated plan/execution/deployment approval.

**Goal:** Deliver the confirmed requirement layout, optional prose expectation, reliable post-save image handoff, and staged collapsed filters without changing business rules or deploying.

**Architecture:** Extend the existing JSON Requirement with optional metadata, preserving versioned mutations and immutable history. Keep ActionForm's containers and generic field renderer; add requirement-only presentation and a separate tested image-delivery state machine. Use a shared controlled FilterPanel, route-backed atomic applied conditions and separate temporary edits; retain each existing server/local filtering scope.

**Tech Stack:** Node24.21.0, Vue3/TypeScript, Ant Design Vue4.2.6, Fastify5, SQLite, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-28-requirement-editor-filters-design.md`

## Global Constraints

- Original cloud checkout/feature branch/PR1 only; base ffea65e/appd59886a. No Mac, server, deployment, main merge, real data, credentials or security configuration changes.
- Preserve permission, source/required criteria, stable IDs, refine/revise, acceptance independence, optimistic versions, idempotency, immutable audit, draft isolation and existing project/ticket UI.
- Expected completion is optional `expectedCompletion?: string`, max2,000UTF16, narrative validation; no date parsing, deadlines, reminders or new business state.
- Only private synthetic screenshot/fixture evidence; original reference image never public. Native image not materialized after supported initial+one retry (DNS); no claim to original pixel inspection.
- Save object first; image failures never repeat successful create/edit/upload. No binary/Blob URL persistence; explicit discard/unknown-result recovery.
- Filter changes apply only on 确定; 重置 is temporary; 收起 discards pending edits. Preserve original paging/local-search/scope semantics and separate navigation/range/queue operations.

## Review Focus

- Unknown create response across refresh/identity change versus editable form/new-key duplication; tests in Task2 pin durable pending-command and saved-object receipts.
- Upload replay after outside object-version change versus definite409 adoption; Task2 checks stable file/key/version for unknown outcomes and fresh key only after explicit409 adoption.
- Hidden required fields/criteria IDs/nonproduct fields/editorial restrictions; Task1+2 check closed-details validation and editorial metadata without bypassing behavioral checks.
- Single route application mixed with pending requests/back/global or explicit project scope; Task3 checks no intermediate query, first-page reset and late-response isolation.
- Local keyword filtering on paged MyWork/Members versus server search/chooser scope; Task3 records requests and loaded-page bounds, including default counts and scope-switch discard.

---

### Task 1: Optional expected-completion metadata and compatibility

**Files:** Modify `packages/contracts/src/index.ts`, `apps/api/src/requirements/routes.ts`, `apps/api/src/requirements/service.ts`, `apps/web/src/forms.ts`, `apps/web/src/components/ObjectDetail.vue`, `apps/web/src/components/HistoryList.vue`, `README.md`; create `tests/requirement-expectation.test.ts`. Add no SQL migration unless actual persistence analysis disproves JSON compatibility.

**Interfaces:** Produces `Requirement.expectedCompletion?: string`, accepted on create/refine/revise; omitted preserves existing value, empty clears. Preserve scope/history serialization and existing functional revision behavior. Frontend fields use same key and bounds. Task2 consumes this field/factory.

- [ ] Write RED API tests for create/get/list/history/restart, absent/empty/unicode/whitespace/2,000+1/control/XSS text, stale version, identical replay and conflicting reuse, archive/roles; test editorial metadata preserves revision and cannot edit forbidden behavior fields.
- [ ] Run `npm test -- tests/requirement-expectation.test.ts`; expected failures unknown property/field not retained, not environment errors.
- [ ] Implement optional field and validation in exact allowlists/patches; existing JSON/scope format retained. Factory initial/body/field bounds and safe detail/history text display; no date controls.
- [ ] GREEN focused tests plus existing requirements/narrative/history/form tests; run types. Expected all pass, no relaxation of previous guards.
- [ ] Verify an old-shape database is readable after idempotent migrate, no rewritten historical snapshots; prepare a private baseline ffea65e API build for actual rollback read/update preservation on the same synthetic database after the new field is written. Record unsupported old-UI field editing and no-DDL conclusion from current evidence.
- [ ] Commit this independently testable metadata change and its spec/plan. Record exact command/results in this plan's private ledger.

### Task 2: Requirement presentation and reliable image handoff

**Files:** Modify `apps/web/src/components/ActionForm.vue`, `apps/web/src/forms.ts`, existing creation/action callers only if required; create `apps/web/src/requirementImages.ts`, `apps/web/src/components/RequirementImagePicker.vue`, `tests/requirement-images.test.ts`, `tests/e2e/requirement-editor.spec.ts`. Reuse attachment endpoints/policy; change backend attachments only for a reproduced defect, not convenience.

**Interfaces:** Add optional `FormSpec.requirementEditor:{mode:'create'|'refine'|'revise';id?:string}` and submit label. `RequirementImageDelivery` exposes entries `{id,file,preview,key,boundVersion,status,error}`, safe pending/saved receipt, `add/remove/uploadFailed/adoptConflictedVersion/dispose`; transport input `{id,version,file,key}`. Files never enter values/storage. No binary state in persisted receipt.

- [ ] RED pure state-machine tests: input limits/rejections, sequential sends, successful entries skipped, partial failures retained, unknown upload retried with identical key/version, definite409 explicit adoption, stale completion after dispose/actor change, preview URL cleanup. Add RED browser layout/save/clear/required-details/keyboard/attachment delivery tests before UI edits.
- [ ] Implement small tested delivery module and picker, then integrate with existing ActionForm send/persist/cancel/route lifecycle. Reuse generic field rendering with requirement-only upper/main/meta/details groups; keep hidden details mounted, expand/locate on validation failure. SourceDescription stays original source field, no duplicate textarea.
- [ ] After ordinary command acknowledgment freeze object receipt and original submit; then upload sequentially. Persist pending create fingerprint/key before sending; unknown outcome locks original command for retry; acknowledged partial result resumes images only. On reload receipt points to saved object and explicitly states files lost. Successful completion clears the receipt and emits the original saved result once.
- [ ] Add true image paste/drop/select, thumbnails and existing attachments; all invalid/skipped items explicitly reported. Destructive clear/leave confirmations protect file loss; upload busy prevents submit/leave/clear. Read immutable creator or show read error; don't invent creator.
- [ ] Preserve refine/revise fields/permissions/impact checks and ordinary draft/cancel semantics. New create label 保存草稿, edit 保存修改, Ctrl/Cmd+S uses same validation/send. Update only affected legacy test helpers/selectors for changed text/collapsed supplementary details.
- [ ] GREEN module/form/browser tests with real API, simulated partial/unknown/409/revoked role, page refresh/route/unmount, disabled/double-click/cancel and mobile. Capture/inspect synthetic screenshots. Commit independently.

### Task 3: Shared staged filter panel and page integrations

**Files:** Create `apps/web/src/components/FilterPanel.vue`, `apps/web/src/composables/listFilters.ts`, `tests/list-filters.test.ts`, `tests/e2e/collapsible-filters.spec.ts`; modify `Projects.vue`, `MyWork.vue`, `Members.vue`, `App.vue` and affected real browser tests/helpers. Do not modify backend search/query contracts.

**Interfaces:** `FilterPanel` takes `modelValue`, `defaults`, `scopeKey`, `label`; emits one `apply(next)` and exposes `openPanel()`. Slot receives a deep cloned `draft`; internal count is nondefault applied scalar conditions. Collapse/reset never emit apply. Route helpers decode/encode front-only filter keys; preserve existing q semantics and unrelated route context.

- [ ] RED component-state tests for open/init/edit/reset/collapse/reopen/count/scope change; RED real-browser request assertions for each page: no request while draft editing/reset/collapse, exactly one applied first-page read, applied-only pagination, route back, deep link and late responses.
- [ ] Implement shared staged panel and scalar route codec with validated defaults. Keep all filter content mounted only when needed for ordinary controls; no business form reuse. Scope change discards draft without applying.
- [ ] Projects: directory local keyword/archive; work lists server kind/state/owner/blocked/q, atomic route update and original tab/queue behavior. MyWork: preserve local loaded-record keyword and server fields; progress chooser keeps original server q. Members: preserve local loaded-member search and active request filter; authorization project switch/refresh stay outside.
- [ ] App: replace inline global keyword buffer with navigation-only global-search button, entering original global scope and opening the existing project work panel. One keyword/apply state, no hidden second search or new API. Sidebar navigation project search and report generation unchanged.
- [ ] Update legacy business tests to explicitly open/apply/reset panels; do not auto-open all panels on login or mask default-closed assertions. Add phone/desktop, each role, default query/count, cleared search/status, duplicate confirm/cancel and current-scope tests.
- [ ] GREEN focused tests and inspect synthetic desktop/mobile/pending/empty/error/permission UI; commit independently.

## Final verification and delivery

- [ ] Fresh-context independent whole-change code/spec/security review, read-only, then fix all round findings with RED→GREEN (including safe local minor per user); record actual limits/rulings. No deployment.
- [ ] Final `npm test`, `npm run typecheck`, `npm run build`, full `npm run e2e -- tests/e2e`, plus current old-db/rollback compatibility evidence and diagnostics. No historical counts as proof.
- [ ] Freeze final application commit; update only four existing Linux-delivery source/label pins; run `node --test scripts/ci/artifact.test.mjs` (15 gates). Push original branch/draft PR normally, exact HEAD both push+PR CI success.
- [ ] Fixed-source Linux candidate actual file audit/unpack/native/production/idempotency smoke and upload/download byte+SHA256 roundtrip. Record app/head/CI/artifact/expiry/hashes. Save private handoff with actual JSON/API/schema and rollback results, original-image limit and user visual-acceptance distinction; parent receives candidate, no deploy.
