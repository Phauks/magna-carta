---
category: Changed
audience: public
---

**The account door asks for an address and a password, and confirming mints the session.** The owner's 2026-09-09 pass over the deployed sign-in surface, recorded in `docs/conventions/design-corrections.md`.

`register-account-screen.svelte` drops the first and last name fields — `name` is now optional on `POST /api/v1/registrations` and the address is filed as `registration.display_name` where none is given, never a guess split out of the address — and gains a verify-password field gating the submit.

The confirmation handler in `routes/session/registrations.ts` now hands back a session: it inserts the `user` row unverified and calls Better Auth's own verify-email endpoint with a freshly minted token, under the new `emailVerification.autoSignInAfterVerification`, forwarding that endpoint's `Set-Cookie` onto its own 200. `next` gains a third value, `signedIn`, so the contract snapshot and the generated client move with it. A mint that does not happen flips `email_verified` directly and answers `signIn` — the credential is already committed, so the front door opens first try, and the account is never left in the one state `requireEmailVerification` refuses. Reasoning: `docs/decisions/pending/confirming-a-registration-is-a-sign-in.md`.

Around them: the persistent-session prop is `rememberMe` and reads "Remember Me"; `AuthPanel`'s `backLabel` names the destination rather than prefixing "Back to"; `check-email-screen.svelte` and `confirm-registration-screen.svelte` take that control instead of a foot button and nothing respectively; `reset-password-request-screen.svelte` loses its meta line; and `joining-choice-screen.svelte` loses its `name` prop with the greeting that used it.

## Public

**Registering now asks for an email address and a password, and opening the confirmation email signs you in.**

The name fields are gone from the registration form. A name is part of your profile rather than part of getting in, and asking for it put two more boxes between you and the account you came for; until you set one, your account carries your address. The password is typed twice, because a reveal control has to be thought of and pressed, and a password mistyped the same way twice used to cost a trip through Reset Password before a first sign-in.

Confirming no longer ends at the front door. The confirmation code only ever reaches your mailbox, so proving you have it is proof enough: confirming signs you in and lands you on the welcome screen. Your password is untouched and still signs you in anywhere else, and if for any reason the sign-in does not come with it, the screen offers **Sign In** and the password you chose works on the first try.

The same round changed the wording around them. The tick box on the sign-in screen reads **Remember Me**. Every back control shows an arrow and names where it goes — **Sign In**, **Your Code** — instead of reading "Back to sign in". Check Your Email and the confirmation-code screen carry that control at the top of the card like every other screen. Reset Password lost the sentence explaining its one button, and the button reads **Reset Password**. And the welcome screen no longer greets you by name a second after you arrive.
