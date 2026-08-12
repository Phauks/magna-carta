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
branch: claude/registration-screens
active-work: docs/active-work/claude/registration-screens.md
next: The two-factor enrolment screens, reset-password as one progressively-disclosed screen, a confirmation email that carries a link rather than a bare token, the Terms of Service and Privacy Policy pages the registration acknowledgements point at, and — still unbuilt server-side — passkeys, the one-time sign-in link, firm identity providers, workspace selection and the second-factor channel choice
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
included. Recovery codes are `MC`-prefixed.

Registration and invitation redemption now have their screens too, at `/register` and below: the
three-way choice, the found-a-firm pair, redemption behind ONE refusal that names none of the three
facts, the check-your-email state both doors end at, and the screen the emailed token is spent on.
Two joining steps land short of where a visitor would expect and say so rather than pretending
otherwise — the confirmation mail carries a bare token with no link to follow, and the Terms of
Service and Privacy Policy the two acknowledgements point at are not published, so that consent is a
browser-side gate recorded nowhere.
