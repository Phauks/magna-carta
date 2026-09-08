# The public intake form — design

**Status:** Design · **Date:** 2026-09-07 · **Owner:** Trevor Goldsmith
**White paper:** _Client Intake & CRM_
**Answers:** the client intake design's flags **J1** and **J11**, answered by the owner on 2026-09-07, and the
taxonomy study's **V6**.
**Reads against:** [`2026-08-15-client-intake-design.md`](2026-08-15-client-intake-design.md) (sections 4, 5 and 6
are binding and are not restated here),
[`2026-09-07-documents-forms-templates-taxonomy-study.md`](2026-09-07-documents-forms-templates-taxonomy-study.md)
**Excludes:** the portal's client forms, the lead-pipeline board, receptionist call intake, and turning an accepted
submission into a Directory entity — each named as a seam below.

**What this builds.** A firm authors a form, publishes it, and hands out its link. A stranger opens the link,
fills it in, and the firm sees the submission. That is the whole slice, and it is drawn at the narrowest thing
that is genuinely useful to a firm on its own.

---

## 1. What is already settled, and is not reopened here

Three things come from the client intake design and bind without restatement:

- **The response must not depend on the content of the submission**, and the rule is enforced by construction
  rather than by discipline: the submission path performs **no lookup against firm data**. Not duplicate
  detection, not entity resolution, not a conflicts check, not matter-type routing. Each of those is a read whose
  timing is a signal, and each is available a moment later on the staff side where the reveal is authorised.
- **A form's fields come from a bounded platform vocabulary, never from the custom-fields definition set.** The
  custom-fields engine has `contact-reference` and `matter-reference` kinds, and a public form that could bind one
  would let a stranger point a value at a Directory entity.
- **No submission becomes a Directory entity without a member.** Nothing on the anonymous path creates a person,
  an organization, a matter or an intake.

And one from the owner's answer of 2026-09-07: **the form is built widget-first.** It renders the human-verification
challenge from its first commit, because it is the only anonymous surface with no shipped client to break, and
doing so produces the browser component `/register` and the invitation-redemption screen have been blocked on.

---

## 2. The addressing problem, and why the URL carries the firm

A public form belongs to one firm, and its database is that firm's. The platform has no mechanism today for an
anonymous request to reach a per-firm database: `RouteMeta.surface: "public"` exists, but every public route
built so far is control-plane business (registration, invitation redemption) and the chokepoint resolves a firm
only from a session.

The resolution mechanism itself is not missing. `firmDatabaseFor(env.FIRM_DATABASE, firmId)` addresses a firm's
database by its id through the `FirmDatabase` Durable Object, and the queue consumers and the cron already use it
with no session at all. What is missing is only how an anonymous caller names the firm.

**The public URL carries both halves, and nothing global is stored.**

```
/enquiry/{firmId}/{formToken}
```

`/enquiry` rather than `/intake`, decided while building: the staff-side Intake desk already holds `/intake` inside
the application, and one word cannot address both a member's workspace and a stranger's form. It is also the
better word for whoever reads it — somebody arriving here is making an enquiry and has no reason to know what the
firm calls the process at its end.

`firmId` is the firm's own `frm_` handle. `formToken` is a CSPRNG token minted per form, unique within that firm.
Resolution is: address the firm's database by the id in the path, then read the form by the token in the path.

**Why not a firm-chosen vanity path.** A vanity path (`/apply/smith-law/personal-injury`) is a **global**
namespace — two firms cannot hold one path — and global uniqueness cannot be enforced from inside per-firm
databases. It would need a control-plane routing table written in the same act as the per-firm form, which is a
cross-database write needing the outbox, plus the reserved-namespace machinery the white paper names. All of that
is real, and all of it is additive: a control-plane alias resolving to the same `(firmId, formToken)` pair can be
added later without touching the form model or the submission path. Shipping the opaque URL first buys the whole
slice at none of that cost, and a link a firm pastes into an email or a website button is not read by a human
anyway.

**Why the token and not just the form id.** Both are opaque. The token is separate because it is **rotatable**: a
firm whose link has been scraped and is being flooded rotates the token and the old link stops resolving,
without destroying the form, its versions, or its submissions. A form id cannot do that — it is the identity of
the record.

**What the path does leak, stated plainly.** Anyone holding the link knows the firm's internal handle. That
handle is not a secret (it appears in no confidential context and grants nothing without a session), and the
alternative — an opaque token resolving through a global table — costs the control-plane table this section
exists to avoid. It is recorded here so the trade is not rediscovered as a defect.

---

## 3. The model

Four tables in the per-firm database.

### `intake_form` — the thing a firm authors and hands out

| Column                 | Meaning                                                                                        |
| ---------------------- | ---------------------------------------------------------------------------------------------- |
| `id`                   | `intakeForm_` handle                                                                           |
| `name`                 | What the firm calls it internally ("Personal injury enquiry")                                  |
| `title`                | What the visitor sees at the top of the form                                                   |
| `introduction`         | Optional prose above the fields                                                                |
| `confirmation_message` | What the visitor is told after submitting. Constrained by section 5                            |
| `public_token`         | The URL's second segment. Unique per firm; rotatable                                           |
| `status`               | `draft` \| `published` \| `closed`                                                             |
| `published_version_id` | The version the public route serves. Null while `draft`                                        |
| `submission_budget`    | Optional per-form ceiling on accepted submissions per day; null means the platform limit alone |

`status` is the whole access model. `draft` and `closed` are unreachable from the public route, and both answer
exactly as a wrong token does — see section 5.

### `intake_form_version` — what a submission was actually asked

A published form is **frozen**. Editing a published form's questions creates a new version and moves
`published_version_id`; it never rewrites the old one. This is the same reasoning as
`document_template_version` and the billing arrangement version: a firm that changes its questions must still be
able to read what an old submission was asked.

| Column                                 | Meaning                                                            |
| -------------------------------------- | ------------------------------------------------------------------ |
| `id`                                   | `intakeFormVersion_` handle                                        |
| `form_id`                              | Its form                                                           |
| `version_number`                       | Monotonic within the form, starting at 1                           |
| `published_at`, `published_by_user_id` | Who published it and when. Both null while it is the working draft |

Exactly one version per form may be unpublished at a time — the working draft. Fields are edited on it freely;
publishing stamps it and starts a new draft only when the next edit arrives.

### `intake_form_field` — one question

| Column            | Meaning                                                                                        |
| ----------------- | ---------------------------------------------------------------------------------------------- |
| `id`              | `intakeFormField_` handle                                                                      |
| `form_version_id` | Its version. Fields belong to a version, never to a form                                       |
| `position`        | Order on the page                                                                              |
| `kind`            | The bounded vocabulary below, held in a CHECK                                                  |
| `label`           | The question as the visitor reads it                                                           |
| `help_text`       | Optional, under the field. Never a placeholder — the placeholder rule is a standing correction |
| `required`        | Whether the submission is refused without it                                                   |
| `options_json`    | The choices, for `choice` only. Null otherwise, enforced by CHECK                              |

**The bounded vocabulary — seven kinds, held in a CHECK so an eighth is a reviewed migration:**

| Kind                 | What it collects                                                            |
| -------------------- | --------------------------------------------------------------------------- |
| `person-name`        | The visitor's name, in the parts the Directory holds rather than one string |
| `organization-name`  | A company or organization's name                                            |
| `email`              | An email address                                                            |
| `telephone`          | A telephone number, stored as typed                                         |
| `postal-address`     | A street address                                                            |
| `matter-description` | The free-text account of what happened. The field every intake form has     |
| `choice`             | A firm-defined picklist over `options_json`                                 |
| `question`           | A firm-defined free-text question                                           |

That is eight, and the count is the point: the vocabulary is closed, it is the platform's, and a firm extends its
form by adding a `question` or a `choice` rather than by reaching into the custom-fields engine.

### `intake_form_submission` — what arrived

| Column                                            | Meaning                                                       |
| ------------------------------------------------- | ------------------------------------------------------------- |
| `id`                                              | `intakeFormSubmission_` handle                                |
| `form_version_id`                                 | The version it arrived through. **The reason versions exist** |
| `submitted_at`                                    | When                                                          |
| `answers_json`                                    | The answers, keyed by field id                                |
| `triage_state`                                    | `new` \| `accepted` \| `declined` \| `spam`                   |
| `triaged_at`, `triaged_by_user_id`, `triage_note` | The member's decision, or null while `new`                    |

`answers_json` is keyed by **field id**, not by label: a version's labels are frozen, but keying by id means a
submission renders correctly even if a later version reuses a label for a different question.

**No `ip_address`, no `user_agent`, no fingerprint.** The rate limiter sees the caller's address at the edge and
that is where it stays. Storing it would put an identifier for an unidentified stranger in the firm's database,
before the firm has decided whether it wants to hear from them at all, and nothing in triage needs it.

---

## 4. The two anonymous routes

Both carry `surface: "public"`, `authenticated: false`, `permission: null`, `rateLimit: "auth"` — the tightest
bucket the platform has, and the registration route's exact posture, for the same reason.

### `GET /api/v1/public/intake-forms/{firmId}/{formToken}`

Returns the published version's title, introduction and fields, so the page can render. Reads the firm's
database — the form, and nothing else.

### `POST /api/v1/public/intake-forms/{firmId}/{formToken}/submissions`

Writes one row and returns `202`. Before it writes: the human-verification gate, then validation of the answers
against the version's own fields (required present, lengths inside their ceilings, a `choice` answer among its
options). All of that is local computation over the form already read; none of it is a second database read, and
none of it varies in time with what the visitor typed.

**The disclosure rule at the front door.** Every outcome that is not a refusal of the caller's own budget or
challenge answers identically: `202`, one body, one message. A name the firm already represents, a name adverse
to a current client, an unknown name, a fifth submission from the same person — one answer. And the same answer
for a **wrong token, a draft form, and a closed form**, which is the part that is easy to get wrong: a `404` for
an unknown token beside a `403` for a closed one turns the endpoint into an oracle for which forms a firm has.

> Both routes answer `404` with one body for every unresolvable case: no such firm, no such token, a form that is
> `draft`, and a form that is `closed`. The `GET` and the `POST` agree, because a discrepancy between them is the
> same oracle reached one step earlier.

The `429` the rate limiter returns is fine and is deliberately not folded into that rule: it is a fact about the
caller's own address and budget, never about the content, and the invitation-refusal reasoning already
established that a refusal may report the caller's own budget and nothing else.

**Idempotency is `optional`.** A stranger's browser mints no idempotency key, and requiring one would make the
route unusable from a plain form post. A double submission is a duplicate row, which triage sees and dismisses —
the honest cost, and much cheaper than the alternative of deduplicating by content, which is exactly the
firm-data read the disclosure rule forbids.

---

## 5. Spam control, and what is actually load-bearing

Four layers, in the order they run:

1. **The `auth` rate-limit bucket**, per address, at the chokepoint — which already owns rate limiting for
   public-surface routes, and runs **before** the challenge, so a flood is throttled before it can make this
   deployment pay for an outbound verification call.
2. **Human verification** (Turnstile, managed mode), through the existing gate. Dormant until a secret is
   provisioned, and counted while dormant.
3. **The per-form submission budget**, so a firm being flooded can throttle or close one form without touching
   its other forms or its authenticated surface.
4. **Super Bot Fight Mode** at the edge, which the platform already runs.

**None of these is what actually protects the firm.** The layer that does is section 1's third rule: no
submission becomes a Directory entity, a matter or an intake without a member deciding so. A spam run fills a
triage list, which a member clears. It cannot reach the corpus.

**The confirmation message is constrained.** It is firm-authored, and the constraint is that it must not become
the leak the status code refuses to be: "we have received your enquiry and someone will be in touch" is right,
"someone from the family law team" is not, because the team is a routing decision this form did not make. The
platform cannot enforce prose, so this is stated in the authoring surface's own help text and in the user guide
rather than pretended into a validation rule.

---

## 6. The firm's side

**Two permissions**, and they are genuinely different capabilities:

- **`intakeForms:manage`** (`resource: "firm"`) — author, publish, close and rotate. Administrative: this is the
  firm deciding what it asks strangers and where the link points.
- **`intakeForms:readSubmissions`** (`resource: "firm"`) — read the submissions and triage them. This is
  reception's daily work, and a firm that lets a receptionist work the queue is not thereby letting them
  republish the form.

Seeded Owner/Admin for both; Attorney and Paralegal for `readSubmissions` alone.

**Three screens, under the Forms destination** the owner's taxonomy ruling reserved for exactly this:

- **`/forms`** — the firm's forms, on the list archetype: name, status, the live link, when it was last
  published, how many submissions are waiting. Create stands in the masthead.
- **`/forms/{id}`** — the builder. The form's own settings, then its fields in order, added from the vocabulary,
  reordered, edited, removed. Publish stands at the top and states what it will do.
- **`/forms/{id}/submissions`** — the queue. Each row is one submission; opening it shows the answers **beside
  the questions as they were asked**, read from the submission's own version, and the triage decision is
  recorded with an optional note.

---

## 7. What this slice deliberately does not do

**Acceptance does not create anything.** Triage records a member's decision — accepted, declined, spam — and
stops there. Turning an accepted submission into a Directory entity and an intake is the next sub-slice, and it
is separated on purpose: it is the act that reaches into the Directory, the conflicts engine and the matter
lifecycle, and every one of those has its own preconditions. What ships here is the record that a member looked
and decided, which is the fact the firm needs first and the fact the anonymous path is forbidden from producing.

**No attachments.** Whether a stranger may attach a file is the client intake design's flag **J3** and is
genuinely open: the value is real and so is the cost, since it is an anonymous write into the untrusted-ingest
and malware-scan pipeline at the firm's quarantine and storage expense. A form without attachments is useful, and
attachments are additive — a field kind, an ingest hand-off, and a triage affordance — so this waits for the
answer rather than pre-empting it.

**No pipeline board and no stages.** Flag **J8** decides the seeded stage set and nothing here needs it: a
submission's `triage_state` is a platform-owned vocabulary of four values, not a firm-renameable label, and it
carries no authority beyond describing what a member did.

**No vanity path** (section 2), **no conflicts check at submission** (section 1), **no portal** (the client's
forms need an external principal, a grant, and a capability the accepted portal capability set does not contain).

---

## 8. Owner flags this design raises

| Flag   | Question                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **P1** | **May a form be deleted, or only closed?** This design ships close-only: a form holds submissions, and submissions are the firm's record of people who asked it for help. Deleting one would take that record with it. Close is reversible, hides the form from the public route, and keeps everything. If a firm genuinely needs a form gone, that is a deletion with a reversal story, and it should be designed rather than assumed. |
| **P2** | **How long does a firm keep an untriaged submission?** Nothing here expires. A firm that publishes a form and stops reading it accumulates strangers' personal information indefinitely, which is a data-protection posture rather than a storage cost. The platform has an erasure registry; whether a retention window rides it for this table is a decision this slice does not need but the next one might.                         |
| **P3** | **Does publishing a form require anything of the firm first?** Today it does not: a firm can publish before it has a conflicts posture, an intake procedure or a matter type. That is probably right — the form only collects — but it is worth stating rather than discovering.                                                                                                                                                        |

None of the three blocks the build. Each is recorded in the feature ledger so it is asked rather than assumed.

---

## 9. What the build changed, against this design

Three things moved while this was built, and each is recorded here rather than left for a reader to notice the
disagreement.

- **The public path is `/enquiry`, not `/intake`** (section 2), because the staff-side Intake desk already holds
  `/intake` inside the application.
- **The submission's daily-budget window is UTC**, not the firm's own day. It is an abuse control rather than a
  report, and a per-firm boundary is a thing a flood can aim at.
- **The site key reaches the page from the server**, in the public form's own read, rather than being built into
  the interface. That was not in this design and it is what makes activation a runtime act: setting the secret and
  the site key on the worker turns verification on with no rebuild and no redeploy of the interface. An absent or
  empty key renders no challenge at all — never a widget against a key Cloudflare does not know.

And one thing this design named that the build did NOT need: a per-firm uniqueness constraint on the public token
is a plain `UNIQUE` index, because the token lives in the firm's own database and there is no cross-firm namespace
to police. The decision that there is no global table is [`an-anonymous-caller-reaches-one-firm-by-the-id-in-its-own-url`](../decisions/pending/an-anonymous-caller-reaches-one-firm-by-the-id-in-its-own-url.md).

---

## 10. Acceptance — the firm verifies before anything becomes a record

**Added 2026-09-08**, on the owner's framing: _"forms are really supposed to act as vectors for clients to input
information, after which it can be verified by those at the law firm."_ That word — verified — decides the shape
of this act, and it rules out the obvious reading.

### The obvious reading, and why it is wrong

Accepting a submission could create a Directory person from the name the visitor typed and an intake from their
description. It would work, and it would be a mistake, because **the Directory is effectively permanent**. It is
soft-delete only, and a merged-away alias deliberately stays in the corpus so it still surfaces a conflicts hit.
Anything an anonymous stranger can write into it is in the conflicts corpus forever. A stranger who typed
`jonh smith` in a hurry, or their company's trading name rather than its legal one, would be in the firm's
permanent record under that spelling — and the firm would find out when a conflicts check missed.

So the values a stranger typed are **untrusted input to be checked by a person**, not data to be copied.

### The shape, which the platform already has

This is the matter plan's propose-and-confirm, and deliberately the same shape rather than a new one:

```
GET  .../acceptance-proposal   reads the submission, maps its answers onto the record a member would
                               create, and COMMITS NOTHING
POST .../acceptance            takes what the member confirmed — corrected, filled in, overridden —
                               and writes only that
```

The proposal is a pure read. It never writes, it never reserves, and a proposal nobody accepts leaves the
database exactly as it found it. What it hands back is a draft a member edits: the name split into the parts the
Directory holds, the contact points, and a matter title seeded from the enquiry. Every one of those is editable
before it is committed, because **every one of them was typed by somebody the firm has not met**.

### What acceptance writes, in one batch

A Directory entity — a person or an organization, the member's choice, because a form cannot know which it is
being filled in by. The intake, through the same `createMatter` the desk's New Intake already uses, with
`status: "intake"` and the new entity as `clientEntityId`, so the client's party link is written in the same
batch and no matter is ever readable without its client. And the submission gains the two handles.

`intake_form_submission` therefore grows three columns:

| Column               | Meaning                                                                                                       |
| -------------------- | ------------------------------------------------------------------------------------------------------------- |
| `source`             | `public_form` \| `staff_entered`. Open catalog per the intake design; `telephony` is reserved for call intake |
| `accepted_entity_id` | The Directory entity acceptance created. Null until then, and never changed after                             |
| `accepted_matter_id` | The intake acceptance created. Same                                                                           |

Both handles are **provenance, not a live link**. Editing the entity afterwards does not reach back into the
submission, and the submission's answers are never rewritten to match a correction — the record of what somebody
actually typed is the point of keeping it.

### Four rules, each with a specific failure behind it

- **Acceptance is idempotent on the submission.** A submission that already names an entity cannot be accepted
  again; the second attempt is refused rather than creating a second person. A double-click must not put two
  Rowan Ashcrofts in a permanent corpus.
- **The member is named, and it is their act.** The audit row's actor is the member, never the stranger — this is
  the first moment a person enters the firm's record and the platform should be able to say who put them there.
- **Nothing automated ever calls this.** No queue consumer, no cron, no rule. The design's rule stands: the first
  thing that writes a person into the permanent corpus is a person.
- **A submission may still not carry a protected identifier**, and acceptance does not become a back door to one.
  The form vocabulary has no kind that maps to a `protectedField`, so there is no shape a proposal could carry.

### What this does not do

It does not run a conflicts check as part of acceptance. The check belongs where it already is — the preliminary
check the New Matter window runs the moment an entity exists — and folding it in here would put a check's result
inside a create's transaction, where a refusal cannot be reported without also deciding what happened to the
entity. Flag **J5** (may a decline be recorded before a check completes) is about the decline path and is
untouched by this.

It does not merge into an existing Directory record. A stranger whose name matches somebody the firm already
holds is a duplicate-detection question with its own surface, and guessing at it here would be the platform
asserting a relationship between a firm and somebody who filled in a web form.
