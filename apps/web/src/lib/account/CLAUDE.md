# The account surface — CLAUDE.md

**Purpose.** The member's own identity and credentials — their name, their photograph, the address
their account signs in with, their password, their second factor, and the devices signed in as
them. Everything here belongs to the PERSON rather than to their firm, which is what separates it
from `/settings` (work and firm preferences) and from the members administration screens (somebody
else's record).

**Where it renders.** `apps/web/src/routes/account/*`, inside the Secure Shell — no workspace
chrome, the brand mark and Close only. Its session guard (`routes/account/+layout.ts`) asks a
strictly smaller question than the `(app)` guard: having no firm yet does not bar somebody from
their own account pages, and the day they most need the devices screen is not a day to send them
somewhere else first.

## Key files / entry points

- `account-sections.ts` — the rail's canonical list. Adding a section is a registry entry plus a
  page, never a nav edit.
- `active-sessions.ts` — the reading of a session row and the sentences about it. Pure.
- `change-password.ts` — the change, and what a refusal says. Pure but for the one call.
- `member-photo-api.ts` — the picture's reads and writes, over the generated client.
- `two-factor.ts` — whether two-factor is on, the four acts (begin, confirm, remove, replace the
  recovery codes), what each refusal says, and the saved recovery-code file. Pure but for the calls.
- `components/` — the masthead (title only), the photo plate, the change-password panel, and the
  two-factor panels: add (password, then the authenticator, then the recovery codes, in one panel),
  remove, and replace the recovery codes, with `recovery-codes.svelte` shared by the two that issue
  codes.
- Beside these: `$lib/names/member-name-api.ts` and `honorific-line.ts`, which are the name's half.

## Local conventions

- **A row states no descriptor.** `SettingDefinition.description` is optional and nothing here sets
  it (owner correction, 2026-09-18): a firm SETTING earns a muted line because a firm-wide choice
  has consequences its name cannot state, and "Prefix" does not. The masthead is title-only for the
  same reason. Anything a member must be told belongs beside the control it applies to.
- **No page-level commit footer.** That is settings vocabulary. Each plate carries its own Save and
  Discard (the Name plate) or commits on interaction (the Photo plate).
- **A fact a member may read and not change is engraved**, in `SettingsRow`'s read-only posture —
  never a disabled input beside a Soon badge. The email address is the worked example.
- **A seam is badged and disabled, or it is not a seam.** There are none left — two-factor was the
  last, on 2026-09-24 — and `apps/web/test/account-seams.test.ts` now asserts the other direction: no
  account page claims a Soon badge or a control waiting on a backend. A new row that arrives as a seam
  is added there as one.
- **A multi-step act is one ActionDialog whose steps turn over in place.** A step that succeeded and
  has a next one reports `"refused"` (to the shell, only "stay standing") and advances its own `step`;
  the last reports `"done"`, which ends on Close with the result on screen. The add-two-factor panel is
  the worked case.
- **The judgement lives in a pure module, the page makes the calls.** Every surface here follows it,
  which is what lets the node pool test the part worth getting right without rendering Svelte.

## Invariants that apply here

- **Every statement binds the SESSION's own user id.** The writes take `firm:editOwnProfile`, which
  is seeded to every default role including Read-only — one's own name and face are not privileges —
  and that key is only safe to give everybody because nothing here takes a subject from a request.
- **Golden rule 4 — one error pipeline.** Failures render from the `Failure` record the seam
  assembles (`$lib/api/api-client.ts`); no surface here reports its own.
- **A picture is FIRM data.** `member_photo` lives in the per-firm database and its bytes in the
  firm's bucket; the member's NAME is control-plane. The split is recorded in
  `docs/decisions/pending/a-members-picture-belongs-to-the-firm-not-the-account.md`.

## Dependencies & contracts

- `@magna-carta/api-client` for `me`, `me.name` and `me.photo`; `$lib/auth/client.ts` (Better Auth)
  for sessions, the password change and two-factor, which are not on the OpenAPI contract.
- The server's two-factor plugin is configured in `apps/api-worker/src/auth.ts` (the issuer an
  authenticator shows, the recovery-code shape); `apps/api-worker/test/account-two-factor.test.ts`
  pins the plugin behaviour this surface depends on.
- `@magna-carta/design-system` for every control, and `$lib/settings/components/` for the shared
  plate and row geometry.

## Gotchas

- **Never call two-factor `enable` on an account that is already on.** In the pinned plugin it
  replaces the working secret and marks the new one verified with no code asked for, so the member's
  authenticator stops matching the moment it returns. The Security page offers Add only while the
  session says two-factor is off, and offers nothing until it has asked — a guess is the one answer
  that costs somebody their authenticator. The Worker test above fails if an upgrade changes this.
- **Account pages do not render under `(app)`**, so the session bootstrap they read is a real
  request rather than a cache hit from that layout's guard. `routes/account/profile/+page.ts` warms
  it at the session-stable ceiling; a page added here that reads the session should do the same.
- **The devices screen never states a "last active" time.** The row's `updatedAt` is a refresh
  stamp, not a last-seen one, and it would say "3 days ago" for a device somebody is holding.
- **A revoked session is believed for up to five minutes** (the cookie cache in
  `apps/api-worker/src/auth.ts`). That is why the password change offers to end the other sessions
  in the same act — it invalidates what the stale cookie proves rather than waiting for it to lapse
  — and why a test of "the other device is signed out" must assert on the session store rather than
  on what that device can still do.
