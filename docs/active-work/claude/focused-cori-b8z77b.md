---
worktree: /home/user/magna-carta (remote session)
area: file-manager round-nine review corrections (mockup + app parity) + login/registration readiness
status: building
touches: docs/conventions/file-manager-rulings.md, tooling/file-manager-rulings/, apps/web/src/lib/file-manager/, apps/web/src/lib/auth/, apps/web/src/lib/matters/, apps/web/src/lib/members/, apps/web/src/lib/settings/, apps/web/src/lib/components/, apps/web/src/routes/(app)/matters/, apps/api-worker/src, apps/api-worker/openapi/openapi.json, packages/api-client/, packages/access-control/src/registry.ts, packages/data-access/src/member-statements.ts, packages/database/drizzle/per-firm/, tooling/lint-list-pagination/, docs/deploy-queue.md, changelog.d/, docs/user/features/
---

Applying the owner's ninth round of file-manager corrections: The Docket mockup revised and
republished (safety flag in Details, extension-based type column, zebra-stripe setting, in-header
column filters, column pinning, undo/redo for moves, a History view, folder moves in the tree, an
upload-destination modal, inline rename in Preview, blank unset document type, preview overflow and
image preview), the ruling ledger and harness extended for the new round, and the small parity
subset ported to the in-app screen. Concurrent streams should stay out of the ruling ledger, the
harness, and apps/web/src/lib/file-manager/ until this lands.

**Added 2026-08-29 — the matters list screen.** The matters landing was a hardcoded empty state with
a `disabled` "New matter" button and no query behind it, while the matters API had been complete for
months. It now reads the firm's own listing onto `DataTable.Grid` with a declarative column model,
and opens matters through the real create endpoint. Owned files: `apps/web/src/lib/matters/`
(matter-status.ts, matters-api.ts, matter-columns.ts, new-matter-dialog.svelte,
vocabulary-picker.svelte, and the one-line register change in matter-header.svelte),
`apps/web/src/routes/(app)/matters/+page.svelte`, `apps/web/test/matter-columns.test.ts`, and the
user guide `docs/user/features/opening-and-finding-matters.md`. Concurrent streams should stay out
of `apps/web/src/lib/matters/` until this lands.

**Added 2026-08-29 — a password at registration, and mail that fails out loud.** Registration now
collects the password, and confirming the emailed token commits the `user` row and its credential
`account` row in one batch, so a person can sign in the moment their account exists. That closes the
production failure where every joining path created an account with no credential and leaned on a
mailed reset link to make one — an account nobody could reach if the mail never arrived, whose only
symptom was Better Auth logging `Credential account not found` at sign-in. Alongside it, an outbound
send that fails is no longer an unhandled throw: registration answers a retryable `503`
(`mail-undeliverable`) carrying an Error ID and keeps the row it committed, and every send Better
Auth makes is guarded at the port, where the library's own swallowing of send failures can still be
counted (`email.delivery_failed`). Owned files: `apps/api-worker/src/joining-credentials.ts`,
`email-delivery.ts`, `routes/registrations.ts`, `firm-provisioner.ts`, `firm-provision-consumer.ts`,
`auth.ts`, `app.ts`, `contracts/problem-types.ts`, the control-plane migration
`20260829T160000_registration-credential.sql` + `control-plane-schema.ts`, `packages/telemetry/src/
metrics.ts`, the OpenAPI snapshot + `packages/api-client`, and on the web side
`apps/web/src/lib/auth/password-rule.ts`, `screens/account-ready-screen.svelte`,
`screens/register-account-screen.svelte`, `screens/register-details-screen.svelte`,
`lib/auth/joining-api.ts` and `routes/register/**`. Concurrent streams should stay out of the
joining routes and `apps/web/src/routes/register/` until this lands.

**Added 2026-08-29 — the firm's roster, and the column that needed it.** `GET /api/v1/members`
answers who is on the firm (display name, status, roles held, whether a professional profile
exists), on its own capability `firm:readMembers` seeded to every default role including Read-only.
Un-paged and recorded as such under `BOUNDED_BY_CONSTRUCTION`. The web app's mock roster is gone —
`$lib/members/firm-roster.svelte.ts` is the one shared read — and the matters list carries a
Responsible Attorney column resolved against it, empty rather than a raw handle where the roster
cannot name the member. Two sign-in repairs rode along: Better Auth now trusts the origin a request
actually arrived at as well as the configured `APP_BASE_URL` (declaring that variable had silently
made production the only origin sign-in would accept, breaking `wrangler dev` and every test that
signs in), and the dev seed converges an existing account's credential instead of skipping it.
Owned files: `apps/api-worker/src/routes/members.ts`, `routes/dev-seed.ts`, `auth.ts`,
`per-firm-migrations.ts`, `packages/data-access/src/member-statements.ts`,
`packages/access-control/src/registry.ts`, the per-firm migration
`20260829T120000_seed-read-members-permission.sql`, `tooling/lint-list-pagination/`,
`apps/web/src/lib/members/**`, `apps/web/src/lib/settings/settings-permissions.ts`,
`apps/web/src/lib/settings/components/request-change-dialog.svelte`,
`apps/web/src/lib/components/recipient-picker.svelte`, `bug-report-dialog.svelte`,
`apps/web/src/lib/matters/matter-columns.ts`, and `apps/web/src/routes/(app)/matters/+page.svelte`.
