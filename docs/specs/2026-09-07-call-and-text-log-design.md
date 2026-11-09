# The call and text log — Messaging as a surface

**Status:** Design (owner ruling recorded; not yet a plan) · **Date:** 2026-09-07 · **Owner:** Trevor Goldsmith
**White paper:** _Communications layer_ · _Client intake / CRM_ (receptionist call intake) · _Directory_
**Decisions:** ADR-0047 (messaging and telephony behind plugin ports, Telnyx launch adapter, in-house transcription)
**Reads against:** `apps/web/src/lib/navigation/destinations.ts`, `apps/web/src/lib/matters/sections.ts`, `roadmap.d/communications.md`, `roadmap.d/portal.md`

---

## 1. The ruling, and the four things that were called Messaging

The sidebar has carried a Messaging row since the destination registry was written, and nothing in
the tree agreed about what it meant. The row's id is `communications` — the whole three-channel
layer. Its label is **Messaging** — one channel. Its description is "Client and portal messages" —
two channels, one of which is neither of the other two. And the matter section wearing the same
label describes something else again: "Secure messages exchanged with the client through the
portal," which is the client portal's `comment`/`message` grant capability, a different subsystem
with a different audience.

**The owner settled it on 2026-09-07: Messaging is calls and texts.** Voice and SMS/MMS — the two
channels ADR-0047 already decided and neither of which has a line of code. What the surface is for
is **logging what occurs**, with the calls and texts routed through the carrier that carries them so
the logging happens by itself rather than by discipline, and with **recording and transcription** on
top of the voice half.

That resolves the collision by narrowing, and it leaves two things needing a home elsewhere:
portal secure messaging (`portal.capabilities.messaging`) and email. Section 7 says where each goes.

## 2. Why email is not in this row

The strongest case for folding email in is real and should be stated before it is refused. Captured
mail that routes to no matter lands unrouted today — `apps/api-worker/src/background/emails/capture-consumer.ts`
says so in as many words: "a firm catch-all (or an unknown token) lands unrouted — the message is
captured to the firm with no matter link, for staff to route." **There is no screen anywhere in the
product where a member can see those.** Mail is being captured into a place nobody can look at, and
a cross-channel inbox would have given it a home for free. The `communications.matter-logging`
ledger node also names one unified cross-channel log, which reads like an argument for one row.

It still loses, for two reasons.

**Email already has a home the platform deliberately does not replace.** The entire email posture is
_file from the mailbox into the matter_ — the add-in's Save-and-File pane, the forward/CC capture
address, the auto-file rules. Nobody is meant to read their mail in Magna Carta; they read it in
Outlook or Gmail and file it here. A sidebar row that opens a mail list competes with the client the
member already has open and loses on every axis that matters to them.

**Calls and texts have no other home, which is a different job entirely.** There is no Gmail for the
firm's SMS number, and a phone call leaves no artifact at all unless the platform makes one. For
email the verb is _route and file something that already exists_; for calls and texts the verb is
_converse, and cause a record to exist_. Putting both behind one label would make the row's own verb
incoherent, and the screen would have to be two screens wearing a shared header.

The unrouted-mail gap is a real gap and this spec does not close it. It belongs with matter routing,
not here; it is recorded as open question **Q5**.

Where the three channels genuinely do converge is a **Directory contact**, not a sidebar row: "what
have we ever said to this person" is a question about the person. The page-archetypes spec already
reserves a Communications tab on the contact record for exactly that, and it is the right place for
a cross-channel read to appear first.

## 3. The record: one log, three producers

The durable thing is the **log**. The carrier is a producer of rows into it, and transcription is an
enrichment of a row — neither is the feature, and building as if they were is what would make the
surface wait on a vendor.

One per-firm record, `communication`, holding what is true of every call and every text:

| Concern          | Shape                                                                                                                         |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Channel          | `voice` \| `sms` \| `mms` — one closed set, CHECK'd                                                                           |
| Direction        | `inbound` \| `outbound`                                                                                                       |
| Counterparty     | The external number, plus a nullable Directory entity link when the number resolves to one                                    |
| Member           | The firm member on the firm's end, nullable for an inbound call nobody answered                                               |
| Matter           | Nullable, and **an unnumbered matter counts** — see section 3.1. A row with no matter at all is the routing work of section 5 |
| When             | Occurred-at instant, plus duration in seconds for voice                                                                       |
| Body             | The message text for SMS; null for voice, whose content is the recording and its transcript                                   |
| Attachments      | MMS parts and voice recordings, in per-firm R2 — never in D1, per the golden rule                                             |
| Producer         | `member` \| `carrier` — how the row came to exist, so a hand-logged call is never mistaken for an observed one                |
| Carrier identity | The adapter's own message/call id, nullable, unique per firm — the idempotency key for redelivered webhooks                   |

Three producers write it, in the order they can be built:

1. **A member, by hand.** "I called Mrs. Pemberton, twelve minutes, here is what was said." Needs no
   carrier, no account and no registration, and is the thing every practice-management product has.
   This is what makes the surface real before Telnyx exists.
2. **The carrier, automatically.** The messaging and telephony ports of ADR-0047: an inbound or
   outbound SMS, an MMS, a call's start, end, direction and duration, each arriving as a signed
   webhook and written as the same row. This is the owner's "route it through the actual services so
   it automatically gets logged."
3. **Enrichment.** A call recording to per-firm R2, transcribed on Cloudflare Workers AI, attached to
   the row it belongs to. ADR-0047 already refused the carrier's hosted transcription for the reason
   that governs here — privileged audio must not egress — so the transcript is produced in-house on
   the `packages/inference` substrate that is already shipped.

The consequence worth naming: **the record model and both screens are buildable now and are blocked
on nothing.** A2P 10DLC and toll-free registration are weeks of procurement lead time by ADR-0047's
own account, and they gate producer 2 only.

### 3.1 The anchor is a matter with a status, not a matter with a number

The owner's ruling of 2026-09-07, in answer to whether a text may exist off a matter: **it may be on
an intake or a consultation, it does not need a number, but it needs a status of some kind.**

The matter shell already models this exactly, and nothing new is required to honour it.
`packages/database/src/per-firm-schema.ts` gives `matter.status` a five-value lifecycle —
`intake` → `consultation` → `open` → `hold` → `closed` — and leaves `matter_number` **null until
`open` draws it**, with a consultation instead carrying a tentative `consultation_number` from the
moment it is created, precisely because "a consultation is a real thing a firm has to be able to
name." An intake and a consultation are therefore first-class anchors that happen to be unnumbered.

Three consequences, each of them a thing that would otherwise be got wrong:

- **There is no unattached outbound send, and there is no need for one.** A member can text a
  prospect before a file exists — they text the prospect's intake. The hole the question pointed at
  closes by widening what counts as an anchor, not by letting a conversation float.
- **The matter picker on the routing control must not filter to `status = 'open'`.** An intake and a
  consultation are the two anchors a first inbound text is most likely to belong to, and a picker
  offering only numbered matters would make the common case unroutable.
- **A conversation shows its anchor's status.** Someone texting needs to know they are talking to an
  intake rather than an open case — the obligations differ, and so does what may safely be said. The
  status belongs on the conversation, not only on the matter screen.

A row with **no** matter at all stays possible, because an inbound text from an unrecognised number
genuinely has no anchor until somebody gives it one. That is the queue of section 5, and the act it
waits for is one of the three anchors above.

## 4. The three surfaces

| Surface                                  | Scope                                                                                                         | The question it answers                                                   |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `/communications` (the sidebar row)      | Every call and text the firm has made or taken, across matters — **including the ones attached to no matter** | "What has come in, what do I owe an answer on, and where does it belong?" |
| The matter's Messaging section           | This matter's calls and texts only, in matter order                                                           | "What has this case said, and to whom?"                                   |
| A Directory contact's Communications tab | This person's calls and texts across every matter                                                             | "What have we ever said to this person?"                                  |

One implementation. The conversation list and the record window are one component in the design
system used by all three; the matter section is the same read pre-filtered, and the global screen
adds the routing column and the scope control. Building the matter section as a second screen is the
mistake the standing direction against duplicate implementations exists to prevent.

## 5. How access differs between the global row and the matter section

**The global row holds the unassigned and the cross-matter; the matter section holds the assigned
and the case-bound.** Everything else follows from that sentence.

**The routing act exists only globally.** An inbound text from a number the firm has never seen
belongs to no matter — it is the exact analogue of the unrouted email capture, and it needs the same
human act. Filing a conversation onto a matter is what moves it out of the queue and into the case.
Once filed, the matter owns it and the global screen stops carrying it as work, though it stays
findable there. Inside a matter the reverse act exists — unlink, as `emails.unlink` already does for
mail — but routing from scratch does not, because the matter is already known.

**The gate is where the two surfaces genuinely differ, and it is the part that must not be got
wrong.** A matter section inherits the matter's own access: a walled matter shows no rows, no counts
and no reason. The global screen has no single matter to gate on, so:

- **Routed rows** are narrowed to matters the member may see, _before_ anything is hydrated. There is
  a precedent to reuse rather than reinvent — the email add-in's matter suggestion already does
  exactly this, so that a walled matter contributes no suggestion, no reason and no count.
- **Unrouted rows** have no matter, so no matter-based gate applies to them at all. An inbound text
  to the firm's number is addressed to the firm and belongs to nobody yet. Reading that queue is
  therefore a **permission of its own** — the natural shape is `communications:reviewUnrouted`
  alongside `communications:read` — not a fall-through to "any member of the firm may read the
  firm's inbound traffic." This is open question **Q2**.

**The create control differs by the registry's existing discipline.** The global screen's noun is
what a member starts from nothing: a text, or a logged call. The matter section's is the same act
with the matter pre-filled. Both are within the seven-character noun budget as **Call** and **Text**,
which means the header's one control has to offer a two-item menu on these sections rather than a
bare label — the Files precedent, where the control is a menu.

**Search and timeline both gain a source**, and both registries force the question to be answered
rather than forgotten. A communication is searchable text for SMS and for a voice transcript, so the
matter section's `searchSource` stops being null; and a call or a text is something that happened on
the case, so it earns a `communication` timeline source owned by the Messaging section.

## 6. Recording and transcription have a legal gate, not just a technical one

The voice half carries a hard constraint the text half does not. ADR-0047 puts call-recording
consent behind the jurisdiction-profile machinery — roughly a dozen states require all-party consent
where Nevada requires one — and that machinery is itself still in design (`trust-jurisdictions` is
the package it reuses). **Recording must not ship ahead of the gate that decides whether it is
lawful for a given call.** Text logging, manual call logging and carrier call _metadata_ logging
carry no such gate; the audio does. Sequencing the build so recording arrives last is not caution,
it is the only order that is correct.

Transcription rides behind recording and inherits its gate. The in-house posture is settled and
needs no further decision: audio stays in per-firm R2 and is transcribed on Workers AI.

## 7. What the registries must be corrected to say

Three edits, all of them descriptions rather than structure:

1. **`destinations.ts`** — the Messaging row's description becomes calls and texts, not "Client and
   portal messages." The row stays `announced` until a screen exists, per the registry's own rule
   that `shipped` flips in the same commit as the user-facing surface.
2. **`sections.ts`** — the matter Messaging section's description, `searchWaitingOn` and
   `createWaitingOn` stop describing portal messages.
3. **`roadmap.d/portal.md`** — `portal.capabilities.messaging` currently cites the matter section as
   its evidence, which will no longer be true. Portal secure messaging needs its own home; the
   portal's own surface is the candidate, and it is open question **Q4**.

The destination's **id stays `communications`** even though the row is now narrower than the
Communications layer. An id is internal, and it is the key the member's own sidebar star preferences
are stored under — renaming it would silently reset the customization of every member who had
touched that row, which is a real cost for no user-visible gain.

## 8. Build order

Each rung is useful on its own and none of them waits on the one after it.

1. **The log and the two screens, manual producer only.** The `communication` record, the firm-scoped
   data-access statements, the routes, the global screen, the matter section, the search and timeline
   sources. Members log calls by hand; texts are recorded but not sent. The Messaging row flips to
   `shipped` at maturity stage `alpha` in this commit and not before.
2. **The messaging port and the Telnyx adapter.** Outbound and inbound SMS/MMS, signed webhooks,
   delivery receipts, STOP/HELP opt-out and TCPA consent enforced in the port. Gated on A2P 10DLC
   registration, which should start now if this rung is wanted soon.
3. **The telephony port.** Call metadata logged automatically — direction, duration, who answered.
4. **Recording**, behind the jurisdiction consent gate of section 6.
5. **Transcription** on Workers AI, attached to the recorded call, and searchable.

Rungs 2 through 5 each also serve something already waiting on them: the SMS second factor, e-signature
and portal access codes, the notifications layer's SMS channel, and the receptionist call-intake flow
that turns a transcribed inbound call into a Directory prospect and an intake.

## 9. Open questions for the owner

- **Q1 — Does manual call logging carry the first rung?** This spec assumes yes: it makes the surface
  real without a carrier and it is the substrate the automatic rows write into later. The alternative
  is to build nothing until Telnyx is live, which leaves the sidebar row Soon for months.
- **Q2 — Who may read the unrouted queue?** A separate permission is proposed. The alternative is to
  treat inbound traffic to a firm number as readable by any member, which is simpler and looser.
- ~~**Q3 — Does a text send require a matter?**~~ **Answered 2026-09-07:** yes, but the anchor is a
  matter with a _status_, not a matter with a _number_ — an intake or a consultation qualifies.
  Section 3.1.
- **Q4 — Where does portal secure messaging live** now that it is not this row or this section?
- **Q5 — Where does the unrouted _email_ queue live?** Real today, unaddressed by this spec, and the
  one part of the cross-channel argument that survives the refusal in section 2.
