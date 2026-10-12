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
