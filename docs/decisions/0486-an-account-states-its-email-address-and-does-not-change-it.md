---
number: 486
slug: an-account-states-its-email-address-and-does-not-change-it
status: Accepted
date: 2026-09-18
area: Account
summary: "Account · Profile states the address the account signs in with and offers no way to change it. The address is not a profile field: it is the account's sign-in identity, the unique key on the control-plane user row, and the key the joining surface resolves a person by — a pending registration, an invitation and the queued member-provision message are all addressed to it. So a change is a mailbox-possession proof, a ruling on everything still addressed to the old address, and a window in which the person can sign in with neither; each of those is designable and none of them is a field. The row is engraved rather than shown as a disabled box beside a Soon badge, because a person comes to this page to learn which address their account is, and a dead control would claim the work was nearly finished."
---

**An account's email address is stated on Profile and is not changed from there. The reason it is not a field is that it is not a profile fact — it is the account's identity, and three other things are addressed by it.**

**Context:** The Identity plate carried an Email row as a disabled input beside a Soon badge, alongside an Avatar row in the same shape. The owner's pass over Account Settings asked for the address to be shown "even if we don't have functionality to change it yet", and added: "perhaps we won't add that functionality, as changing emails could cause a lot of issues. investigate."

The investigation found three distinct costs, only the first of which is the obvious one.

The address is the **sign-in identity**. It is `UNIQUE` on the control-plane `user` row and it is what `/sign-in/email` takes. Changing it without proving control of the new mailbox would let somebody point an account at an address they do not hold, and every later password reset would be mailed there.

The address is the **joining key**, which is the part that is invisible from the account surface. `GET /api/v1/me` resolves a firmless person's joining state by their address (`readJoiningState`), an invitation is matched to a person by address (`routes/invitations.ts` normalises and matches on it), a self-serve registration is held against one, and the firm-provision path inserts the owner against `UNIQUE(user.email)` and treats a collision as its own resume fence. A person who changes their address while any of those is outstanding is a person whose invitation now names nobody — and nothing in the product would tell them, because the invitation still exists and still looks fine.

And a change has a **window**. Between the request and the proof of the new mailbox, an account has one address it no longer wants and one it has not yet established. Better Auth's `changeEmail` handles that window with a verification round trip; what it cannot decide is what happens to the pending records above, because they are this platform's, not the library's.

None of that makes a change hard. It makes it a piece of work with a design — which is exactly what the Soon badge was quietly promising was nearly done.

**Decision:** Profile's Identity plate **states the address** and offers no control. It is rendered through `SettingsRow`'s read-only posture — the engraved value, the same device a member sees for any fact they may read and not change — rather than as a disabled input, because a disabled control reads as broken and invites fiddling while a stated value reads as what it is. The address comes from the session bootstrap the page already reads for the picture's fallback initials, so the row costs no request of its own.

The Avatar row that sat beside it is gone, replaced by the built Photo plate; the Email row is now the only thing on the plate, and the reasoning above lives in the page's own header where the next person to look at that row will find it.

**What a change would have to carry, when it is built:** a verification of the new mailbox before anything moves; a rule for a pending registration or invitation addressed to the old address (the honest options are to re-address it or to refuse the change while one is outstanding, and re-addressing is the one that does not strand somebody); an `email.changed` row on the auth audit, which is the trail an account takes its identity from; and a decision about whether existing sessions survive it. The password change built alongside this ruling is the worked example of the shape — a sensitive act, performed in place, that ends the sessions it invalidates.

**Considered and rejected:** **Leaving the disabled box and the Soon badge.** A Soon badge is a promise, and a badge on a row nobody intends to build soon teaches a reader that the badge means less than it does; the seam guard now asserts that Profile claims no Soon badge at all. **Offering the change through Better Auth's `changeEmail` as it stands.** The library's verification round trip is sound and answers none of the joining-key question, so shipping it would move the failure from "cannot change my address" to "changed my address and lost my invitation" — a worse failure, and a silent one. **Showing the address with a "Request a change" affordance.** That affordance is the settings surface's device for a firm setting an administrator owns; an account's own address is owned by nobody else, so the request would have no recipient.
