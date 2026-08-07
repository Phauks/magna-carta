# claude/sign-in-screen

**Scope.** The sign-in screen — the first owner-authorized product UI surface, built from the
owner-approved mockup (full-flow-v3). Identifier-first sign-in (email → password → authenticator
code) over the existing Better Auth backend, all in the one `/login` route with the step held in
component state so the URL never reveals which factor is in play. Adds the two auth-specific input
primitives the design system had earmarked but not built (a password field with a Show/Hide toggle,
and the segmented one-time-code control over Bits UI's PinInput), plus holding cards for the reset
and recovery side doors that the flow links to.

Backend is read-only for this stream: no route, schema, migration, or OpenAPI change. The auth
routes are Better Auth's own and are deliberately outside the OpenAPI contract, so nothing in
`apps/worker` moves.

**Files this stream expects to touch.**

- `apps/web/src/routes/login/` — `+page.svelte` (rewritten), `sign-in-messages.ts`,
  `reset-password/+page.svelte`, `recovery-code/+page.svelte`
- `apps/web/src/lib/auth/` (new) — `client.ts`, `auth-frame.svelte`, `auth-placeholder.svelte`,
  `two-factor-policy.ts`
- `apps/web/package.json` (adds `better-auth`), `apps/web/test/sign-in-messages.test.ts`,
  `apps/web/e2e/login.spec.ts`
- `apps/web/src/routes/(app)/tools/whois-lookup/+page.svelte` — one line, see below
- `packages/design-system/src/lib/components/` — `password-input/` (new),
  `verification-code-input/` (new), `input/` (control-size axis), `top-bar/` (a `Link` part)
- `packages/design-system/src/lib/styles/components.css`, `packages/design-system/package.json`,
  `packages/design-system/src/stories/` (two new stories, one touched)
- `changelog.d/sign-in-screen.md`, `status.d/0-7b-auth-ui-deferred-surfaces.md`

**Known overlaps.** `slice-0-7b-app-shell` owns the wider 0·7b surface (app shell, matter detail,
tools) and names `apps/web/**` + `packages/design-system/**` in its note. This stream stays inside
the login route, the new `lib/auth` folder, and the four design-system components listed above; the
one file it touches outside that is `tools/whois-lookup/+page.svelte`, where `Input` had been sized
with the native character-count `size` attribute that the new control-size axis shadows — swapped
for a width utility, which is what the recipe set expects anyway.

`status.d/0-7b-auth-ui-deferred-surfaces.md` is edited additively (stage flags + a note); nobody
else has declared it.
