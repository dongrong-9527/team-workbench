# 团队协作工作台

A single-process Fastify API, SQLite database and Vue static client. Requires Node 24.21.0.

```sh
npm ci
npm test
npm run typecheck
npm run build
```

Configure `HOST`, `PORT`, `DATABASE_PATH` and `APP_ORIGIN` as process environment variables (see `.env.example`), then run `npm start`. `APP_ORIGIN` is the exact browser origin, including scheme and port. The service is intended for a same-origin HTTPS reverse proxy; session cookies always use Secure, HttpOnly and SameSite=Lax. The current Vue client is a foundation scaffold.

To create the first administrator, build first and run the following in a local interactive terminal against an empty database:

```sh
node apps/api/dist/apps/api/src/cli/bootstrap-admin.js
```

The CLI asks for login, display name and a hidden password; it accepts no arguments or environment passwords. Further accounts are administrator-created and activated with a one-use ticket. Activation/reset tickets expire after 24 hours. Hand them to their owner securely; raw tickets are returned only on initial issuance. Retrying an issuance command with the same key returns metadata only. If the initial `POST /api/members` response is lost, replay the original create key and body to recover safe member ID/version metadata; the original raw ticket is not redisclosed. Then issue `POST /api/members/:id/reset` with a new `Idempotency-Key` and the current `expectedVersion`, including for a never-activated account. A stale version returns safe latest member/version metadata; use that current version with a fresh key. Issuing a new ticket invalidates the prior ticket. Have the owner submit the new reset token to `POST /api/auth/reset` with `newPassword`.

Passwords contain 12–128 Unicode characters, with whitespace preserved. Asynchronous scrypt uses N=131072, r=8, p=1; two jobs may run and four may wait, with overload returning 429. Sessions expire after 30 minutes idle or 12 hours absolute. Logout revokes its session; reset issuance, deactivation and successful password changes revoke all of the member's sessions. Login rejects unknown, unactivated, disabled and incorrect-password accounts with the same response. Five failed login attempts per account/IP or ticket attempts per endpoint/IP within 15 minutes return 429.

Every write requires the configured Origin. Authenticated writes also require the session-bound `X-CSRF-Token` returned by login or `GET /api/auth/session`, plus an `Idempotency-Key`. The session endpoint recovers the same CSRF token across tabs. Member reset/deactivate actions require `expectedVersion`. Current identity and permissions are checked inside the mutation transaction before replay. Password-change command bindings use the secret session token as an HMAC key; successful changes revoke the key's session, so retries need a fresh login. Secrets are excluded from events and persisted command responses. Request logging is disabled.

Project API: authenticated members can use `GET /api/projects` and `GET /api/projects/:id`. Administrators create projects with `POST /api/projects` (`name`, optional `description`), change roles with `PUT /api/projects/:id/roles` (`memberId`, `roles`, `leads`, `expectedVersion`), and archive or restore with `POST /api/projects/:id/archive` or `/restore` (`expectedVersion`). Roles are `product`, `frontend`, `backend`, and `test`; each lead must also hold that role. Project versions cover role and archive changes. Archived projects preserve reads and reject business writes. An administrator's identical archive retry returns its original response without another event; a new archive command on an archived project conflicts. Current session and permissions are checked before replay.

Shared action policy uses the stored task `kind` as functional scope for `frontend`, `backend`, and `test`; Bug and `other` task services must persist a valid `role` scope. Missing scope denies scoped claim, execution and lead management. `ownerId` controls execution, `acceptorId` controls designated product acceptance, and `authorId`/`participantIds` identify contribution ownership/participation. `manageReport` on a project authorizes draft creation; object-level editing requires `creatorId`. Future workflow services must validate status, assignment eligibility, contribution authorship, acceptance independence and report ownership before mutation, in addition to this policy. Scope and ownership fields must be derived from stored records, never caller overrides.

Task API: active members can read `GET /api/tasks` and `GET /api/tasks/:id`.
`POST /api/tasks` accepts projectId, title, kind (frontend/backend/test/other),
definitionOfDone and priority, plus optional requirementId, ownerId and reviewerId.
The other kind requires an explicit frontend/backend/test role. Tasks default to
required; product alone may exclude one with required:false and exclusionReason.
Empty definitionOfDone is allowed for a pending draft and must be refined before
execution. Product or the matching functional lead creates/refines tasks, assigns
owners and designates reviewers. Tasks with frontend/backend functional scope,
including explicitly scoped other tasks, require a test-role reviewer.
Test-scoped tasks require product or the matching functional lead to review.

`POST /api/tasks/:id/actions` requires the unchanged expectedVersion and an
Idempotency-Key. Actions: claim (does not start), start, submit, checkPass,
checkFail, assign, transfer, requestTransfer, reopen, cancel, block, unblock,
setDependencies, refine, designateReviewer, setRequired and approveParallel.
Submit evidence is `{done,selfCheck,environment}`; check evidence is
`{result,environment}`. Assign/transfer require ownerId, reason and handoff;
ownerId:null requires resetToPending:true. Transfer otherwise retains state.
Executors can request transfer with reason/handoff. Block requires reason and
assistance; unblock requires reason and retains state. Dependencies are explicit
same-project dependencyIds; unfinished predecessors require a matching current
functional lead's approveParallel action with reason. Approval is bound to task
execution fields and dependency versions and expires when they change or that
lead loses authority. setRequired requires product and a reason; exclusions keep
that reason. Reopening required completed work regresses its requirement in the
same transaction. Work and check evidence are immutable and preserve original
contributors and display names; check records mark actual developer self-tests.

Bug and canonical test API:

- `POST /api/bugs` registers an unconfirmed project issue with title, explicit functional `role` (frontend/backend/test), expected/actual/reproduction/environment, independent severity and priority. Incomplete reproduction text is permitted while unconfirmed. Optional requirement/task links must agree and belong to the project. Assigning an initial owner requires product or matching lead authority.
- `POST /api/bugs/:id/actions` uses `expectedVersion` and `Idempotency-Key`. Confirmation/rejection/reopen require current test or product authority; repair claim/start/submit require matching scope and actual ownership. Reject reasons are `duplicate`, `not_defect`, `unable` plus explanation; duplicates reference a distinct same-project Bug. Reopen requires reason and explicit `ownerId` (null leaves ready/unassigned). Management assign/transfer requires reason/handoff; null ownership requires `resetToReady:true` and preserves unconfirmed state until the normal confirmation action. Block requires reason/assistance, unblock reason. Reporter supplementation uses `refine` while unconfirmed. `submit.evidence` contains fix, impact, selfCheck, environment and nonblank targetVersion. Verification uses `test` below, not a caller-owned status or selfTest flag.
- `POST /api/tests` takes expectedVersion plus `{target:{kind,id}, revision?, targetVersion, environment, checks:[{checkId,result:'pass'|'fail'|'untested',note?}], reusedFromId?,reuseReason?,bugId?}`. Requirement revision is mandatory for linked targets and absent for independent targets. Actor, actual time, event sequence, original names, ownership, check definitions and selfTest are server-derived immutable evidence. Direct tests enforce the same current designated reviewer, scope, state and submitted build as action routes. Failure on completed work reopens it atomically. Partial evidence remains pending; omitted checks never pass. The caller may associate a same-project existing Bug rather than creating a duplicate defect.
- `GET /api/bugs`, `/api/bugs/:id`, `/api/tests` (optional kind/id) and `/api/tests/coverage?kind=...&id=...&revision=...&targetVersion=...` serve active members. Coverage uses the latest event sequence per exact target/revision/build/check, and checks current definitions. Older passes cannot override newer fail/untested; another target or build cannot supply coverage. Coverage is test evidence only, not product acceptance.
- Independent Bugs default to required check ID `reproduction` (expected behavior); tasks default to `completion` (definitionOfDone). Product-only `defineChecks` on Bug/task sets a nonempty explicit checklist `{id,text,required?,exclusionReason?}[]`, with required default true. Requirement criteria likewise default true; exclusions require product authority and a nonblank persisted reason. Changed definitions invalidate previous coverage. Reuse requires the same target/build/environment, actual source check/result, explicit tester reason, unchanged definitions and no affected check across every intervening requirement revision/scope; superseded contradictory source results reject.
- Task submission may add `evidence.targetVersion`; canonical `checkPass`/`checkFail` supply `test`. Tasks with an explicit checklist or submitted targetVersion reject coarse-only checks. Existing legacy submissions/check routes remain compatible and their immutable `task_checks` history is preserved; they never create canonical criterion evidence. Acceptance must use canonical coverage explicitly. No old row is rewritten or inferred as a canonical pass. Task 7 will implement the complete acceptance gate and waiver-aware reconciliation; those endpoints are not present yet.
- Bug repair under a cancelled requirement remains a project issue and preserves historical participation links. If cancellation detaches its linked task, the retained Bug source pair remains usable only when immutable prior Bug creation and server cancellation/detachment events prove that relationship; new or arbitrary mismatched pairs reject. Repair never revives the cancelled requirement. Claim/assignment do not count as repair; successful start and submission append actual repair occurrences. Verification is an independent record, including when the repairer has test authority.
