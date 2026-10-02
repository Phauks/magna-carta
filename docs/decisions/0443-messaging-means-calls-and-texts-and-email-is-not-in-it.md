---
number: 443
slug: messaging-means-calls-and-texts-and-email-is-not-in-it
status: Accepted
date: 2026-09-07
area: Communications layer
summary: "The product's Messaging surface means voice and SMS/MMS and deliberately excludes email, resolving a name that had carried four different scopes at once — a destination id naming the whole three-channel Communications layer, a label naming one channel, a description naming two, and a matter section under the same word describing the client portal's message grant. The refusal of email is argued rather than assumed: mail already lives in the firm's own mailbox and is FILED onto a matter from there through the add-in, the capture address and the auto-file rules, so its verb is route-what-already-exists, where a call leaves no trace at all unless the platform makes one and the verb is cause-a-record-to-exist. One surface carrying both verbs would have to be two screens under a shared header. The place the channels do genuinely converge is a Directory contact, which is a contact-scoped surface rather than a sidebar row. Two things are displaced and named rather than dropped: portal secure messaging loses the matter section it had been reserving, and the unrouted email capture queue — mail that routes to no matter, which is written today and readable nowhere — remains without a home."
---

**Messaging is calls and texts. Email is refused from it, and the refusal is the decision.**

**Context:** the sidebar had carried a Messaging row since the destination registry was written, and
nothing in the tree agreed about what it meant. Its id was `communications` — the whole three-channel
layer. Its label was Messaging — one channel. Its description said "Client and portal messages" — two
channels, one of which was neither of the others. And the matter section wearing the same label
described the client portal's `comment`/`message` grant, a fourth thing again.

**The case for folding email in is real and is recorded before it is refused.** Captured mail that
routes to no matter lands unrouted today — the capture consumer says so outright — and no screen
anywhere in the product shows those. Mail is being captured into a place nobody can look at, and a
cross-channel inbox would have given it a home for free.

It loses anyway, twice.

**Email already has a home the platform deliberately does not replace.** The whole email posture is
*file from the mailbox into the matter*: the add-in's Save-and-File pane, the forward/CC capture
address, the auto-file rules. Nobody is meant to read their mail in this product; they read it in the
client they already have open and file it here. A surface that opens a mail list competes with that
client and loses on every axis that matters to the person using it.

**Calls and texts have no other home, which makes it a different job.** There is no mailbox for the
firm's SMS number, and a phone call leaves no artifact at all unless the platform makes one. The
verbs differ — *route what exists* against *cause a record to exist* — and a surface carrying both
would have to be two screens wearing a shared header.

**Where the channels do converge is a person, not a sidebar row.** "What have we ever said to this
client" is a question about the contact, and the page-archetypes spec already reserves a
Communications tab on the contact record for exactly that. That is where a cross-channel read should
appear first.

**What this displaces, named rather than dropped.** Portal secure messaging loses the matter section
it had been reserving and needs its own home. The unrouted email queue is unaddressed by this
decision and remains the one part of the cross-channel argument that survives it.
