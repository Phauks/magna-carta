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
branch: main
active-work: docs/active-work/claude/laughing-newton-96fujl.md
next: The step-up re-authentication the account surface is designed around (Better Auth's own freshness dial gates a listing and none of the writes, so it is not that mechanism), a Turnstile widget on the joining forms so the human-verification gate can be switched on (the server half exists; the owner's dashboard step is queued in docs/deploy-queue.md), the two-factor enrolment screens, reset-password as one progressively-disclosed screen, a confirmation email that carries a link rather than a bare token, the Terms of Service and Privacy Policy pages the registration acknowledgements point at, and — still unbuilt server-side — passkeys, the one-time sign-in link, firm identity providers, workspace selection and the second-factor channel choice
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

The two anonymous writes behind those screens now have a human-verification gate in front of them —
a real server-side Turnstile check where there had only been an unticked runbook box and a
placeholder row in the sign-in mock-up. It ships dormant: no widget exists, so no secret is
provisioned, so both endpoints serve exactly as before and every unprotected pass is counted rather
than assumed away. Turning it on needs two things that are not server work — the owner creating the
widget, and a client that renders the challenge and mints a token.

Registration and invitation redemption now have their screens too, at `/register` and below: the
three-way choice, the found-a-firm pair, redemption behind ONE refusal that names none of the three
facts, the check-your-email state both doors end at, and the screen the emailed token is spent on.
Two joining steps land short of where a visitor would expect and say so rather than pretending
otherwise — the confirmation mail carries a bare token with no link to follow, and the Terms of
Service and Privacy Policy the two acknowledgements point at are not published, so that consent is a
browser-side gate recorded nowhere.

Signing out is built at both ends, which closes the last control that was inert only because
authentication had not shipped. The profile menu's `Sign out` ends the session server-first, drops
what the session left in the browser, and leaves by a document load rather than a route change so
the tab's memory of a firm's data does not survive into whoever sits down next; a sign-out the
server did not confirm reports that the session is still open instead of navigating away on an
unanswered request.

`Account → Active Sessions` is a new section beside Profile and Security — the first account surface
that is a live list rather than a seam — over Better Auth's own list and revoke routes: a row per
device with the one being read on marked and left without a button, per-device sign-out, and
`Sign out everywhere else`. It states the five-minute revocation lag rather than leaving it to be
discovered, and refuses to state a "last used" time the record cannot support. Two findings came out
of building it: the library's session-freshness default would have 403ed the listing for any session
older than a day (the exact one the screen exists to manage), so `freshAge` is off with the
reasoning recorded at the config; and the audit trail's new `logout` / `session.revoked` events are
decided by the ENDPOINT a session was deleted under, because expiry sweeps and the two-factor
session rotation delete rows through the same hook and neither is somebody leaving.
