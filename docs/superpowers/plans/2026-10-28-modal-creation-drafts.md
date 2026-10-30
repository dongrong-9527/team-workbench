# Modal Creation and Drafts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans inline. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every creation entry a real Modal and expose safe browser draft actions separately from return and business save.

**Architecture:** Keep FormSpec factories and ActionForm; separate content identity from presentation. Add a small pure draft-context helper and explicit draft capability. Extend original-command locking to task/Bug creation; preserve requirement image lifecycle.

**Tech Stack:** Node24.21.0, Vue3/TypeScript, Ant Design Vue4.2.6, existing Fastify/SQLite API (unchanged).

**Spec:** docs/superpowers/specs/2026-10-28-modal-creation-drafts-design.md

## Global Constraints

- Original cloud checkout/feature branch only; no Mac, server deployment, main merge, credentials or production writes.
- Serverdraft only for new requirements; browser drafts never invoke business body/request; incomplete fields allowed.
- Retain existing auto-recovery, permissions, versions, idempotency, expectedCompletion, filters and staged images.
- No binary/password/one-time code persistence. Unknown creation retries retain original command/key across return/restore/rejection.
- Original screenshot consumer DNS limitation stays recorded; no further retrieval attempts.

## Review Focus

- Legacy or malformed local entries with a different actor/project/path must not restore into current context (Task1).
- Storage quota during return must not silently discard unsaved input (Task1).
- Lost successful creation followed by rejected retry, return, reload and local-draft action must never create twice (Task1).
- Nested image/clear confirmation Esc/focus must affect only the top Modal (Task2).
- Direct linked Bug URL and mobile long-form footer must retain a usable background and close destination (Task2).

### Task 1: Explicit draft capability and original-command protection

**Files:** forms.ts, pages/Projects.vue, components/ObjectDetail.vue, components/ActionForm.vue; new formDraft.ts; tests/form-drafts.test.ts and tests/e2e/modal-drafts.spec.ts; adapt form-cancel.test.ts.

**Interfaces:** FormSpec.browserDraft?:boolean; cancelLabel is 取消|返回. DraftContext={actor,draftKey,path,method,projectId?}; compatibleDraft(saved,context) validates new envelope and legacy matching command path. ActionForm uses current context when restoring and persists it alongside existing values/version/fingerprint/key. Browser draft action only calls local persistence.

- [x] Write failing policy/context tests plus browser incomplete-draft/no-write/short-form and unknown task/Bug replay tests.
- [x] Run focused unit/browser RED and inspect actual causes.
- [x] Implement minimal capability, copy, context binding, explicit local-save feedback and storage-failure close guard. Keep idempotency metadata independent from editable drafts.
- [x] Lock task/Bug unknown creation to original command; preserve ambiguity through rejected retries/return/reload.
- [x] Run focused tests GREEN and types; commit Task1 after relevant proof.

### Task 2: Real creation Modal and preserved layout

**Files:** components/ActionForm.vue; tests/e2e/modal-drafts.spec.ts; adapt existing creation presentation tests and old long-button selectors only.

**Interfaces:** Existing createForm paths determine creation identity; real Modal overrides page/Drawer only for those paths. pageFormKind still describes content where needed; evidence pages remain inline. Uses Task1 return and context protection.

- [x] Write/run browser RED for standalone3types, requirement split, linked Bug, backdrop, close/Esc/focus, nested confirmation, narrow-screen scroll.
- [x] Use real AModal, separate content/container flags, bounded scroll and fixed actions; background remains current page. Preserve layout/controller behaviors and safe route fallback.
- [x] Run focused browser GREEN and inspect synthetic desktop/mobile screenshots; adapt relevant old intentional page/Drawer assertions.
- [x] Commit after types/build and relevant integration checks.

### Task 3: Whole-change review, regression and candidate

- [x] Fresh independent whole-change reviewer reads spec and baseline6640f28 diff; fix meaningful findings with actual RED→GREEN.
- [ ] Run final npm test, typecheck/build, full e2e; inspect full aggregate (not last case number) and browser diagnostics. All failures reported and resolved.
- [ ] Fixed application commit, update only four delivery pins, run15 packaging gates, push original draftPR; exactHEAD push/PR CI complete.
- [ ] Verify candidate source/config SHA, actual audit/native/production smoke and upload/download equality/checksums; hand off artifact expiry and rollback evidence. Do not deploy.

Self-review: Task1 capability/context/lock shared with Task2 close and footer; keep field/command semantics stable. No backend or database task is required. User expressly approved direct execution and existing cloud method; no repeated plan approval gate.
