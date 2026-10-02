---
number: 452
slug: confirming-a-registration-is-a-sign-in
status: Proposed
date: 2026-09-09
area: Authentication
summary: "Spending a registration's emailed confirmation token now mints a session on the confirmation response, so a person who confirms lands inside the product rather than back at the front door. The proof is not weakened by this and is arguably strengthened: the token travels by email and nowhere else, so spending it demonstrates possession of the mailbox — the same possession proof a mailed sign-in link rests on, and a stronger one than the password the very next screen would have asked for. The session is minted through Better Auth's own verify-email endpoint with `emailVerification.autoSignInAfterVerification` enabled, rather than by writing a session row and signing a cookie by hand, so the session row, the cookie format, the cookie cache and the login.success audit stay whatever the installed library does across an upgrade. The one structural consequence is that the confirmation batch inserts the `user` row UNVERIFIED and the verify-email call performs the flip, because that endpoint declines to mint a session for an address already marked verified; a mint that does not happen falls back to flipping the column directly and answering `signIn`, so the account is never left in the one state it cannot sign in from. Registration correspondingly stops asking for a name — `name` is optional on the request and the address is filed as the display name — and the password is typed twice on the form."
---

**A person who has just proved they hold the mailbox should not then be asked for something weaker.**

**Context:** Registration collects a password, holds it hashed against a pending registration row, and
commits the credential when the emailed confirmation token is spent. That already removed a second mail
and a password-reset round trip from the path to a first sign-in. What it left behind was a screen —
"Your Account Is Ready" — whose entire content was an instruction to go to the front door and type the
password that had been typed four minutes earlier, on a form that had just been superseded by a
stronger proof.

The proof ordering is the point. The confirmation token is generated server-side, hashed into the
registration row, and delivered to one place: the address being registered. Nothing else carries it.
So a request that presents it demonstrates control of that mailbox — which is precisely what a
password-reset link, a magic link, and email verification all rest on, and which is a stronger claim
than a password, since a password can be guessed, reused, or phished from a form. Asking for the
password immediately afterwards buys no security and costs somebody their first minute.

**Decision:** The confirmation endpoint hands back a session. On the account door, when the token
spends successfully and the registration carried a chosen password, the handler mints a session and
Set-Cookies it on its own 200; the response's `next` becomes `signedIn` and the web surface navigates
straight to the joining screen.

Three rules bind it.

**The session comes from the library, not from us.** It is minted by calling Better Auth's own
verify-email endpoint with a freshly created verification token, under
`emailVerification.autoSignInAfterVerification`. That endpoint is the library's supported "the mailbox
answered, let them in" path, so the session row, the signed cookie, the cookie cache and the
login.success audit hook are whatever the installed version currently does — including across an
upgrade that changes any of them. Writing a session row and signing a cookie by hand would have been
fewer moving parts and a standing bet against every future release.

**Which is why the account is inserted unverified.** That endpoint returns without a session for an
address already marked verified, so the previous behaviour — writing `email_verified = 1` in the batch
that creates the user — would have silently cost the session it exists to produce. The flip now belongs
to the act that also hands out the session, which is the more honest ordering anyway: spending the
token IS the verification.

**A mint that does not happen is never a locked-out account.** If the call throws or returns no cookie,
the handler flips `email_verified` directly and answers `signIn`. The credential is already committed,
so the front door opens on the first try. Leaving the column at 0 would have been the worst outcome
available: `requireEmailVerification` would refuse the very password that registration had just set,
which is the locked-out-forever failure the credential-at-registration design was built to remove.

**Consequences.** The confirmation response's `next` gains a third value, so the contract snapshot and
the generated client move with it. Registration's `name` becomes optional and the address is filed as
the display name where none is given — the account door no longer asks for a name at all, and a name is
never split out of an address. The two superseded doors (`foundFirm`, invitation redemption) are
unchanged: their accounts are created by a queue consumer or by a mailed activation link, neither of
which is a request anybody is standing in front of.
