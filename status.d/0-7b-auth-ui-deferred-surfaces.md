---
slice: 0·7b — Auth UI + deferred surfaces
group: phase-0
order: 9
research: n/a
spec: todo
plan: todo
built: in-progress
ui: in-progress
load-profile: n/a
tested: in-progress
branch: claude/auth-routes
active-work: docs/active-work/claude/auth-routes.md
next: The registration and invitation SCREENS (their routes now exist), the two-factor enrolment screens, reset-password as one progressively-disclosed screen, and — still unbuilt server-side — passkeys, the one-time sign-in link, firm identity providers, workspace selection and the second-factor channel choice
link-spec:
link-plan:
adrs:
blocked-by:
---

Sign-in is one screen (email and password together) over Better Auth, with channel-aware code entry
and real recovery-code entry. Every state renders on the developer console's screen-state page.

The backend behind those screens now exists for three of the nine gaps the screen-state page
registered: self-serve registration with the three-way role fork, invitation redemption against a
code plus surname and date of birth behind one neutral refusal, and the shared attempt budget the
sign-in surface renders — which is wired to the live screens, the count and the lockout countdown
included. Recovery codes are `MC`-prefixed. Registration and invitation redemption have routes but
no screens yet.
