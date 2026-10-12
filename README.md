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

The CLI asks for login, display name and a hidden password; it accepts no arguments or environment passwords. Further accounts are administrator-created and activated with a one-use ticket. Activation/reset tickets expire after 24 hours. Hand them to their owner securely; raw tickets are returned only on initial issuance. Retrying an issuance command with the same key returns metadata only. A lost response requires a fresh command key and the current member version, which invalidates the previous ticket.

Passwords contain 12–128 Unicode characters, with whitespace preserved. Asynchronous scrypt uses N=131072, r=8, p=1; two jobs may run and four may wait, with overload returning 429. Sessions expire after 30 minutes idle or 12 hours absolute. Logout revokes its session; reset issuance, deactivation and successful password changes revoke all of the member's sessions. Login rejects unknown, unactivated, disabled and incorrect-password accounts with the same response. Five failed login attempts per account/IP or ticket attempts per endpoint/IP within 15 minutes return 429.

Every write requires the configured Origin. Authenticated writes also require the session-bound `X-CSRF-Token` returned by login or `GET /api/auth/session`, plus an `Idempotency-Key`. The session endpoint recovers the same CSRF token across tabs. Member reset/deactivate actions require `expectedVersion`. Current identity and permissions are checked inside the mutation transaction before replay. Password-change command bindings use the secret session token as an HMAC key; successful changes revoke the key's session, so retries need a fresh login. Secrets are excluded from events and persisted command responses. Request logging is disabled.
