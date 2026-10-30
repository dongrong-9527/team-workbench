# Requirement Create Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans inline. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Save server drafts or atomically create a ready requirement from the existing Modal.

**Architecture:** Optional create intent defaults to draft. Share the existing executable checks within a single mutate transaction; UI commands bind intent and reuse the original requirement image delivery controller.

**Tech Stack:** Node24.21.0, Vue3/TypeScript, Ant Design Vue4.2.6, Fastify5/SQLite.

**Spec:** docs/superpowers/specs/2026-10-30-requirement-create-actions-design.md

## Global Constraints
- Original cloud checkout/branch only, no Mac, deployment or main merge; synthetic tests only.
- Draft minimum checks unchanged; ready only project product, no default source confirmation; checked server time, unable reason legal.
- One creation transaction/key, no fake refine history or fallback draft; image failure does not roll back ready.
- Preserve permissions/archive/version/idempotency/audit, Modal/drafts/filters; no SQL migration or dependencies.

## Review Focus
- Unknown ready creation restored after reload and rejected retry cannot become a new draft or duplicate (Task2).
- Failure after object insertion rolls back object, snapshots, events and key together (Task1).
- Restored ordinary source choice and edited content cannot silently assert checked (Task2).
- Old clients remain draft; paired rollback rejects new intent safely and preserves stored ready data (Task1/final).
- Image failure says ready remains executable, retry never creates another requirement (Task2).

### Task1: Atomic create contract and shared ready checks
**Files:** contracts index.ts; requirements routes.ts/service.ts; tests/requirement-create-ready.test.ts; README.md.
**Interfaces:** RequirementCreateIntent='draft'|'ready'; createRequirement input accepts optional intent, omitted=draft. Shared assertExecutableRequirement(db, candidate, tasks) enforces existing checks; old makeReady calls it without new permissions. Ready source checkedAt generated server-side. created audit remains compatible with creationIntent metadata, final revision/scope snapshot is ready.
- [x] Write API RED for ready success/audit/timestamp/replay, unable reason, invalid/unauthorized/archive gates and transaction rollback; legacy omitted-intent draft.
- [x] Run focused RED; implement shared gate and one transaction without nested mutate or transient durable states.
- [x] Run all unit/API and types GREEN, document contract and commit.

### Task2: Dual action Modal and recovery/image status
**Files:** forms.ts, ActionForm.vue, HistoryList.vue, composable requirementEditor.ts; tests/e2e/requirement-create-actions.spec.ts and form policy tests.
**Interfaces:** requirementEditor.canSubmitReady flag from actual product role; body(values,intent?) includes chosen create intent. UI formal action validates full input and opens details on error. send(intent?) reuses pending original body, busy/unknown blocks both actions. Source choice defaults/reset to unselected on ordinary restore/substantive edits. Receipt retains acknowledged state for correct image handoff and verifies current state after restore.
- [x] Write real browser RED: minimum draft, full ready/permissions/unselected source, edit-reset, invalid retains image without create, unknown replay/reload/403 same key, partial image delivery and duplicate clicks, desktop/390px.
- [x] Implement minimal UI and accurate status; keep existing draft and editor behavior.
- [x] Run focused and related image/Modal/workflow browsers, unit/API/types/build GREEN and commit.

### Task3: Review and fixed candidate
- [ ] Fresh independent whole-change review against baseline4d682c71; fix meaningful findings RED→GREEN.
- [ ] Final all unit/API, types/build, complete browser and15 packaging gates; inspect synthetic desktop/390px actual pixels and diagnostics.
- [ ] Fixed app SHA, four delivery pins, push original draftPR, exactHEAD push/PR CI success; Linux audit/native/smoke/roundtrip with hashes/expiry.
- [ ] Handoff includes user-step flow, new contract/rollback limitations and evidence; no deployment.
