---
category: Added
---

The **sign-in screens as they were designed**, moved out of a standalone mockup and into the product,
plus the developer page that replaces the mockup as the place to review them.

**Sign in is now one screen.** Email and password sit together. The old first step collected only an
address, and it existed so the server could decide what to show next — but anything it could reveal
(a firm name, "this account signs in elsewhere", "no such account") is exactly what would let a
stranger confirm which addresses belong to a firm, so the second screen could only ever show the
same neutral form. One screen is one round trip, one password-manager fill, and one fewer place to
leak. The same reasoning is why an address is never resolved as it loses focus: whether a firm signs
in through its own identity provider is worked out when the credential is submitted, not before.

**Entering a recovery code works.** It was a card explaining that the screen did not exist yet; it is
now the real entry, over the codes the two-factor plugin already issues, reached from the code screen
and living on the same URL as the rest of sign-in — a separate address for the second step would
announce to anyone reading a browser history which accounts carry one.

**A code field now matches whatever issued the code.** An authenticator and a spoken telephone code
are both six digits, so those entries stay numeric and raise a keypad. A texted or emailed code is
eight characters and can contain letters, and a numeric-only field silently ate every one of them —
which reads, to the person holding a perfectly good code, as the code being wrong.

**Every screen has a quiet way back**, above the heading rather than buried under the button, so the
heading lands in the same place whether or not there is anywhere to return to.

**What the server cannot do yet is stated rather than mimed.** Passkeys, one-time email links, firm
identity providers, human verification, choosing between second factors, workspace selection and
registration are all designed and all rendered — but none has a route behind it, so none appears on
the live sign-in surface. A button that does nothing is worse than an absent one. Each gap is
recorded once, in one place, with what is actually missing on the server side.

**The developer console gained a screen-state page** listing every signed-out screen in every state
it can take — including the ones that are awkward to reach on purpose, like a lockout, a fifth failed
attempt, or a passkey prompt someone cancelled. It renders the real components through the real
design system, so it cannot drift from the product the way a hand-styled mockup does, and every
specimen says whether the product can reach it today.

Registration, invitation redemption, the two-factor enrolment screens, recovery-code issuance and the
reset-password screen are designed but not built here; the screen-state page names them.
