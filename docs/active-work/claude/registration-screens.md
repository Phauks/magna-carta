---
branch: claude/registration-screens
worktree: .claude/worktrees/registration-screens
area: the registration and invitation-redemption screens, over the routes that already exist
status: building
touches: apps/web/src/lib/auth/, apps/web/src/routes/register/, apps/web/src/routes/login/+page.svelte, apps/web/src/routes/developer-console/sign-in-screens/, apps/web/test/, docs/user/features/joining-magna-carta.md, docs/user/features/README.md, changelog.d/, status.d/0-7b-auth-ui-deferred-surfaces.md
---

# claude/registration-screens — the screens over the joining routes

**Scope.** The UI half of joining the platform. The routes landed without any screens
(`POST /api/v1/registrations`, `POST /api/v1/registrations/confirmations`,
`POST /api/v1/invitations/redemptions`), and nothing in the app called them, so a visitor could not
reach registration at all. This stream builds the screens: the three-way role fork, the
found-a-firm form, invitation redemption, the check-your-email state both doors end at, and the
confirmation screen the emailed token is spent on.

**Adds no `/api/v1` route.** Everything below calls a route that already answers. Where a screen
wants something the server cannot do, the gap is declared in
`apps/web/src/lib/auth/joining-availability.ts` and the control is absent rather than inert — the
same rule `apps/web/src/lib/auth/unbuilt-capabilities.ts` sets for the sign-in surface.

**The enumeration property is the constraint that shapes redemption.** The invitation row holds one
digest over code, surname and date of birth together, so the handler cannot know which of the three
was wrong. The screen therefore has ONE refusal and no per-field error, and must stay that way.

## Files this stream expects to touch

- `apps/web/src/lib/auth/joining-api.ts`, `joining-availability.ts`, `invitation-code.ts`,
  `sent-stamp.ts` (new)
- `apps/web/src/lib/auth/screens/register-screen.svelte`, `found-firm-screen.svelte`,
  `register-details-screen.svelte`, `redeem-invitation-screen.svelte`, `check-email-screen.svelte`,
  `confirm-registration-screen.svelte` (new)
- `apps/web/src/routes/register/**` (new), `apps/web/src/routes/login/+page.svelte` (one prop:
  the Register link now goes somewhere)
- `apps/web/src/lib/auth/unbuilt-capabilities.ts` (the `registration-screens` entry is deleted —
  the screens exist) and the developer console's screen-state page, which follows it
- `apps/web/test/invitation-code.test.ts`, `joining-api.test.ts`, `joining-messages.test.ts`,
  `sent-stamp.test.ts` (new)
- `docs/user/features/joining-magna-carta.md`, `docs/user/features/README.md`,
  `changelog.d/registration-screens.md`, `status.d/0-7b-auth-ui-deferred-surfaces.md`

## Overlap to watch

`docs/user/features/README.md` is a shared index — this stream edits one line of it (the joining
entry loses its "screens pending" qualifier). `status.d/0-7b-auth-ui-deferred-surfaces.md` is the
slice fragment `claude/auth-routes` last wrote; that stream has merged.
