# Review — campaign 2, automation / email / extraction

**Date:** 2026-08-06 · **Branch:** `claude/review-campaign-2-automation` · **Base:** `origin/main` at
`1d107608` · **Kind:** adversarial read-only review. No source was changed and no test suite was run.

**Scope.** Code merged since the first review campaign, in three areas:

- `packages/document-assembly/` — the expression language and its aggregates, custom-field bindings,
  directory role sources, protected-value bindings, letterhead image emission, and the
  subject-by-facet catalog registry.
- The email add-in client API (`apps/api-worker/src/http/routes/email/email-add-in.ts`),
  `packages/email-filing/src/auto-file-rules.ts` and its statements, and the DKIM verifier
  (`packages/email-filing/src/dkim.ts`).
- Composite text extraction — the worker adapter (`apps/api-worker/src/search/text-extraction.ts`), the
  assembly point in `packages/search/src/extraction.ts`, the `crates/pdf-core` textextract seam read
  as source, and the re-extraction sweep.

**Counts.** 3 high · 7 medium · 6 low. Every finding below was traced to the code and the failure
scenario walked by hand; where a claim could not be confirmed it is in the coverage list at the end
rather than stated as a defect.

**Headline.** The expression language's `addDays` helper is the one date helper with no
calendar-range guard, and an out-of-range date it produces is neither refused nor rendered — it
becomes an empty string in the document and it compares backwards against every in-range date.

---

## Standing observation — what is live and what is not

Two things materially change how the severities below should be read, and both were confirmed rather
than assumed:

- **The ethical wall is an identity filter today.** `filterAccessibleMatters`
  (`apps/api-worker/src/emails/matter-access.ts:9-15`) returns its input unchanged; the comment says
  enforcement is a later phase. Every wall finding here is therefore a defect in the _shape of the
  seam_ — invisible now, live the day the filter starts narrowing.
- **The auto-file rule engine is unwired.** `resolveAutoFileDecision` is exported from
  `packages/email-filing/src/index.ts:40` and called from nothing outside its own test. No route
  creates a rule, the capture consumer (`apps/api-worker/src/background/emails/capture-consumer.ts`) never consults
  one, and no code writes an `email_auto_file_decision` row — the migration
  (`20260805T220000_auto-file-rules`) and the statements exist with no producer. So the auto-file and
  DKIM-gating findings are latent: they describe what will happen at the moment the consumer wiring
  lands, which is the cheapest moment to fix them.

---

## High

### H1 — `addDays` has no calendar-range guard; the result renders blank and compares backwards

**Fixed in #PR.** `addDays` shares the calendar-range guard its siblings apply; an out-of-range result is a `magnitude` refusal. `renderExpressionValue` returns undefined rather than `""`, and both call sites record an absence instead of tallying a clean substitution. `orderOf`'s date arm refuses an operand that is not a calendar date, closing the comparison path. Boundary asserted exactly on both ends and property-tested over generated offsets (`packages/document-assembly/test/expression-evaluate.test.ts`).

**`packages/document-assembly/src/expression/evaluate.ts:737-745`**

`addMonths` and `addYears` both check the result before returning it:

```ts
const moved = addCalendarMonths(parts, name === "addMonths" ? whole : whole * 12);
if (!Number.isSafeInteger(moved.year) || moved.year < 1 || moved.year > 9999) {
  return refused("magnitude", "that date falls outside the years this language works in.");
}
```

`addDays` returns three lines earlier and skips it entirely:

```ts
if (name === "addDays") {
  const moved = civilFromDays(daysFromCivil(parts.year, parts.month, parts.day) + whole);
  return valued({ kind: "date", isoDate: isoDateOf(moved.year, moved.month, moved.day) });
}
```

Nothing upstream bounds the operand. The lexer accepts any safe integer
(`lex.ts:227-236`), the checker types it `number`, and `integer` accepts it, so
`{{= addDays(matter.openedOn, 4000000) }}` is a legal registered template. `isoDateOf` then produces
`"12977-09-14"` — or `"-4713-01-01"` for a large negative count, since `String(-4713).padStart(4,"0")`
is a no-op on a five-character string.

Two consequences, both silent:

1. **The computed field renders as an empty string.** `renderComputedField`
   (`assemble.ts:653-659`) tallies the expression `resolved`, increments `state.substitutions`, then
   calls `renderExpressionValue`, which calls `formatMergeValue`. That reaches
   `parseCalendarDate` (`format.ts:196`), whose `^(\d{4})-(\d{2})-(\d{2})$` does not match a
   five-digit or signed year, so it returns `undefined` and `renderExpressionValue`
   (`assemble.ts:684`) collapses it to `""`. No absence is recorded, no marker is drawn, no reason is
   surfaced, and the assembly reports a clean substitution. This is exactly the failure the package's
   own absence model is built to make impossible — "a blank where a value should be, filed without
   anyone noticing".
2. **A comparison against it answers backwards.** `orderOf` compares dates as raw ISO strings
   (`evaluate.ts:463-468`). `"12977-09-14" < "2030-01-01"` is true lexicographically, so
   `{{#if addDays(matter.openedOn, 4000000) > matter.dueOn}}` evaluates `false` and the clause is
   dropped. A missing clause is invisible, which is the asymmetry `assemble.ts:423-437` documents as
   load-bearing.

**Scenario.** A paralegal writing a limitation-period clause types a millisecond count or a stray
zero into a day offset. The template registers, the assembly succeeds, the deadline paragraph prints
with a blank where the date should be — or, in the conditional form, the whole paragraph is absent —
and the engine reports no absence and no failure.

**Fix shape.** Move the range check above the `addDays` early return so all three helpers share it,
and make the out-of-range case a `magnitude` refusal. Separately, `renderExpressionValue`'s
`?? ""` (`assemble.ts:684`) should not be able to swallow a rendering failure on an expression whose
static check passed — a value the formatter refuses at that point is an engine invariant break and
should record an absence with a reason, not an empty string.

### H2 — the re-extraction sweep starves behind its own permanent candidates

**Fixed in #PR.** The candidate query takes a `(committed_at, id)` keyset cursor, and the sweep advances it past every candidate examined rather than only the repaired ones; the per-firm cap counts messages produced, with a separate scan ceiling bounding one pass. Beside it the coordinator bounds re-attempts per document per engine generation (`SEARCH_INDEX_MAXIMUM_ATTEMPTS_PER_GENERATION`), resetting when a deploy changes which engines are bound so a deferred backlog drains rather than being written off. No migration — the counter lives in Durable Object storage. Convergence proven by fixture: a catalogue whose entire head is permanently failed still reaches its tail.

**`apps/api-worker/src/background/search/reextraction-sweep.ts:64`, `packages/file-manager/src/queries.ts`
(`listVersionsMissingFromSearchIndexStatement`), `apps/api-worker/src/search/index-coordinator.ts:27-39`**

The sweep's stated safety property is convergence: "The candidate query returns only documents with
no live split, so a document repaired by the last pass is not a candidate for the next one." That
holds only for the success path.

The candidate query is `... AND NOT EXISTS (SELECT 1 FROM index_split ...) ORDER BY v.committed_at
LIMIT ?1`. Two terminal outcomes leave no split row:

- `markFailed` — the consumer's `unextractable` branch (`index-consumer.ts:98-101`) and its
  "source bytes not found" branch (`index-consumer.ts:82-85`).
- `markDeferred` — the `engine-not-implemented` branch (`index-consumer.ts:93-96`), which is the
  _ordinary_ state wherever `OCR_SERVICE` or the index engine is unbound. `resolveTextExtractionPort`
  (`text-extraction.ts:214-216`) returns the deferred port whenever `OCR_SERVICE` is absent, and that
  port defers every PDF with a scanned page.

Both remain candidates forever. Because the ordering is `committed_at` ascending and the coordinator
explicitly restarts a `deferred` or `failed` job (`index-coordinator.ts:30-39` — it re-sends the queue
message), a firm whose oldest 1000 committed versions are scans or unreadable files will re-enqueue
**the same 1000 versions every day, forever, and never reach the 1001st**. The pass that exists to
drain a back catalogue cannot drain past its own head.

**Scenario.** A firm loads a decade of scanned correspondence, then turns indexing on. `OCR_SERVICE`
is not bound (the documented default). Every daily cron re-enqueues the same oldest 1000 scans: 1000
Durable Object `start()` calls, 1000 queue messages, 1000 full R2 GETs, 1000 whole-document buffers
into Worker memory, 1000 PDF parses — all to re-derive the same `deferred`. Meanwhile a born-digital
contract committed yesterday, which the native half could read today, is never enqueued.

**Fix shape.** Make the candidate set exclude versions whose coordinator already reported a terminal
state for this engine generation — either a `search_index_attempt` marker written in the same batch
as the failure, or an `attempted_at` / `attempt_generation` column on the catalog that the query
filters on and that a deploy bumps when an engine is newly bound. Failing that, order the candidate
query by something that rotates (`RANDOM()`, or `committed_at` with a per-run offset) so a permanent
head cannot monopolise the cap — but that is a mitigation, not the fix, since the daily churn
remains.

### H3 — a DKIM `pass` is accepted without requiring `From` in the signed header set

**Fixed in #PR.** Verified against RFC 6376 section 5.4 ("The From header field MUST be signed (that is, included in the 'h=' tag of the resulting DKIM-Signature header field)") before changing verdict semantics. A signature whose `h=` omits `from` is now `fromNotSigned` / `fail`, refused before a DNS lookup is spent on it, and the result records `signedHeaderNames` so a downstream gate need not re-parse. **The named follow-up resolves as aligned rather than as a further gap:** the capture record stores the LAST `From` instance (pinned in `crates/email-core/src/eml.rs`) and `buildSignedHeaderInput` validates the last instance per section 5.4.2, so a pass vouches for the same sender a person is shown. Both sides are now pinned by test.

**`packages/email-filing/src/dkim.ts:263-269`**

`buildSignedHeaderInput` walks whatever the `h=` tag lists and requires nothing of it:

```ts
for (const entry of signedHeaders.split(":")) {
  const wanted = entry.trim().toLowerCase();
  if (wanted === "") continue;
  const field = remaining.get(wanted)?.shift();
  if (field === undefined) continue; // listed but absent — contributes nothing, per the RFC
  input += canonicalizeHeader(field, canonicalization);
}
```

RFC 6376 §5.4 makes `From` mandatory in `h=` precisely so a verdict is a statement about the sender.
This verifier will return `{ verdict: "pass", signingDomain: d }` for a signature whose `h=` is
`subject:date` and which therefore binds nothing about who sent the message.

The verdict is informational today, as `dkim.ts:11-17` says. It stops being informational the moment
the auto-file wiring lands: `dkimSuppression` (`auto-file-rules.ts:285-292`) treats
`verdict === "pass"` plus `verifiedDomain === ruleDomain` as proof that a `correspondentMatter` rule
may file unattended, and the comment above it states the whole reason — "a rule that files on an
unauthenticated `From` is a mechanism for a stranger to insert a document into a matter file".

**Scenario.** A domain runs a signer that omits `from` from `h=` (a misconfigured appliance, or a
list that re-signs with a narrow header set). An attacker takes any message that domain signed —
a public list post is enough — rewrites the `From:` to `partner@thatdomain.example`, and re-sends
it to the firm's capture address. Body hash matches (body unchanged), signature verifies (the header
set it covers is unchanged), `d=` equals the rule's domain, and a `correspondentMatter` rule files
the attacker's message onto the matter as authenticated correspondence.

**Fix shape.** In `verifyOneSignature`, after parsing `h=`, refuse a signature whose lowercased entry
list does not contain `from` — `at("malformedSignature")` is the honest code, since a signature that
omits it is not a well-formed DKIM signature. Consider also recording, on the verification result,
which headers were covered, so a downstream gate can require more than `From` without re-parsing.

---

## Medium

### M1 — the number of DKIM signatures verified is unbounded, and each costs a DNS lookup

**Fixed in #PR.** At most three signatures are examined per message and at most three DNS lookups are spent, budgeted across the message rather than per signature; the body-hash digest is memoized per `(canonicalization, l=)`, so two signatures agreeing on both hash the body once.

**`packages/email-filing/src/dkim.ts:97-108`, `:169`, `:184`**

`verifyDkim` iterates every `dkim-signature` header and calls `verifyOneSignature` on each. The body
hash is checked first (`:169`) and is described as settling the question "without spending a lookup
on it" — but `bh` is a plain SHA-256 of the canonicalized body and is computable by anyone who has
the body. A sender who wants lookups only has to compute the correct `bh` once and attach it to a
thousand `DKIM-Signature` headers with distinct `d=`/`s=` values.

Each surviving signature is one `crypto.subtle.digest` over the whole body plus one
`lookupKeyRecords` call — a DNS-over-HTTPS request to `DKIM_RESOLVER_URL` with a name drawn from the
message. That is both a per-message CPU/latency amplifier inside the capture queue consumer and an
outbound request amplifier pointed at the resolver, with the queried name partly attacker-chosen.

**Fix shape.** Cap the signature count at a small number (three is generous for real mail) before the
loop, returning the first outcome and recording the rest as unexamined; and cap the DNS lookups per
message independently, since a message can also repeat one selector. Hoisting the body-hash digest
out of the per-signature loop when `c=`/`l=` match is a cheap secondary win.

### M2 — the `l=` body-length tag is honoured with no cap and no "partially signed" marker

**Fixed in #PR.** `bodyFullyCovered` is recorded on the verification result, and `dkimSuppression`'s `correspondentMatter` arm treats a partially-covered pass as `senderNotAuthenticated` — the report's preferred option, which keeps the informational verdict honest while closing the gate.

**`packages/email-filing/src/dkim.ts:166-167`, `:297-307`, `:380-384`**

`parseLengthLimit` accepts any non-negative safe integer, and `canonicalizeBody` slices the canonical
body to it. This is faithful to the RFC and is what lets a list-footer message verify — but it means
a `pass` can cover as little as the first byte of the body, and the verification result carries no
indication of how much was covered. The known consequence is the append attack: bytes past `l=` are
unsigned, so anyone holding a legitimately signed message from a domain can append arbitrary content
and the signature still verifies.

Combined with H3's gate, a `correspondentMatter` rule would file the appended message as
authenticated, and the appended part is precisely the part an attacker wrote.

**Fix shape.** Record the covered length alongside the verdict, and either refuse a signature whose
`l=` covers less than the whole canonical body (recorded as its own reason so the distinction stays
readable), or make a partially-covered `pass` insufficient for `dkimSuppression`'s
`correspondentMatter` arm — the latter keeps the informational verdict honest while closing the
gate.

### M3 — the wall filter runs after database-side truncation for two of the four signals

**Fixed in #PR.** Both database-truncating paths over-fetch a bounded multiple and then filter: the typed-query signal requests `limit * WALL_FILTER_OVERFETCH_MULTIPLE` before the wall filter, and `readRecentFilingTargets` does the same before slicing back to `targetLimit`.

**`apps/api-worker/src/http/routes/email/email-add-in.ts:393`, `:459`**

The route states its invariant plainly at `:47-52` and again at `:399-400`: "a matter the member
cannot see contributes no suggestion, no reason, and no count", and "the wall filter runs BEFORE the
ranking, not after it". That holds for signals 1 to 3, whose gathers return everything that matched.
It does not hold for two paths:

- **Signal 4, the typed query.** `listMatters(firm.firmDatabase, { search: query, pageSize: limit })`
  returns the firm's top `limit` matches _before_ the filter at `:401-407` is applied. A walled
  matter that matches the query occupies one of those slots. With `limit` at its default of 5, five
  walled matches silently reduce the member's own search-term suggestions to zero.
- **`GET /emails/filing-context`.** `readRecentFilingTargets(..., targetLimit)` at `:459` truncates
  before `accessibleMatterIds` at `:462`, so `recentMatters` can come back short — the comment at
  `:460-461` anticipates the withdrawal case but not the truncation interaction.

Both are invisible today because the filter is the identity function (see the standing observation).
The day it narrows, a walled matter consumes a slot and a count, which is the property the module
committed to not having.

**Fix shape.** Over-fetch and then filter, or push the accessible-matter predicate into the query.
For the search signal specifically, request `limit` matches _after_ filtering — fetch a bounded
multiple, filter, then take `limit` — and assert the property in a test that stubs
`filterAccessibleMatters` to drop a matter.

### M4 — `resolveDirectoryEntities` issues one query per participant address

**Fixed in #PR.** `findEntitiesByEmailAddresses` resolves the whole participant set in one `IN` query, capped at `MAXIMUM_BATCHED_EMAIL_LOOKUPS`, with the merge/soft-delete resolution memoized across the batch. Tested to agree with the single-address form on merges, removals, and soft-deleted owners.

**`apps/api-worker/src/background/emails/capture-consumer.ts:111-119`**

```ts
resolveDirectoryEntities: async (addresses) => {
  const resolved = new Map<string, string>();
  for (const address of addresses) {
    const matches = await findEntitiesByEmailAddress(firmDatabase, address);
    ...
  }
}
```

One serial round trip per address, against the per-firm Durable Object database. The address set
comes from the parsed message's `from`/`to`/`cc`/`bcc` (`packages/email-filing/src/capture.ts:215`),
so it is bounded by the message and not by anything the platform chose — a message with two hundred
recipients is two hundred sequential queries inside one queue consumer invocation.

This is the same N+1 that `packages/document-assembly/src/resolve.ts:48-57` names as the shape to
avoid, and that `email-add-in.ts:336-341` is careful to avoid on the read path. The email-address
index is already the thing being seeked; the query wants an `IN` list.

**Fix shape.** Add a batched `findEntitiesByEmailAddresses(database, addresses)` returning a map,
with the address list bound and capped the way `normalizedParticipants`
(`email-add-in.ts:306-317`) already caps its own.

### M5 — engine-reported page indexes are not deduplicated, so one page can become two passages

**Fixed in #PR.** `extractedFromPages` keeps exactly one page per index — preferring the reading that has lines, then `native` over `ocr` on a tie — and drops a negative index rather than turning it into page 0. `RecognitionSchema`'s `pageIndex` is now `nonnegative()`.

**`apps/api-worker/src/search/text-extraction.ts:129-136`, `packages/search/src/extraction.ts:102`,
`:111-123`**

`RecognitionSchema` (`text-extraction.ts:39-46`) validates the shape of the recognition response but
says nothing about uniqueness or range of `pageIndex`. `recognizedPages` filters to the wanted set
and maps straight through. `passagesFromPages` then mints `chunkId: \`page-${page.pageIndex}\``.

If the engine reports the same `pageIndex` twice — a retry inside the container, a page split across
two result records, a bug — the result is two `Passage` objects sharing one `chunkId` handed to
`ports.index.index`, and two `PageProvenance` rows for one page. Worse for the reporting claim at
`extraction.ts:24-29`: if one duplicate carries lines and the other does not, the provenance list
holds `{page: 7, hasText: true}` and `{page: 7, hasText: false}` at once, so the corpus report the
provenance exists to serve has two answers for one page. `z.number().int()` also admits a negative
index, which becomes `page: 0` in a passage (`extraction.ts:102` adds one).

**Fix shape.** In `extractedFromPages`, key the ordered list by `pageIndex` and keep exactly one page
per index — preferring the entry that has lines, and preferring `native` over `ocr` on a tie, since
the native layer is the exact text. Tighten `RecognitionSchema`'s `pageIndex` to `nonnegative()`
while you are there.

### M6 — an unvalidated ISO string from a `date` custom field enters the expression scope

**Fixed in #PR.** `dateOrTextValue` returns a text merge value for a stored string that is not a calendar date, so the key's type is what the checker sees and a comparison against a date is refused at registration; `orderOf`'s date arm additionally refuses rather than comparing when either operand does not parse.

**`packages/document-assembly/src/custom-field-bindings.ts:250-254`, `:273-275`;
`packages/document-assembly/src/expression/evaluate.ts:463-468`**

`mergeValueForCustomField` returns `{ kind: "date", isoDate: stored }` for any non-empty
`value_date`, and `expressionValueOf` (`assemble.ts:206-207`) passes it into the evaluator
unchanged. The per-firm schema declares `value_date` as a bare `text` column with no CHECK
(`packages/database/drizzle/per-firm/20260908T000000_baseline.sql:92`).

Every other date the evaluator can see is validated: a literal by the parser
(`parse.ts:144-152`), an instant by `formatMergeValue(value, "iso", …)`. This one is not. And date
ordering is a raw string comparison:

```ts
if (left.kind === "date" && right.kind === "date") {
  return {
    kind: "ordered",
    comparison: left.isoDate === right.isoDate ? 0 : left.isoDate < right.isoDate ? -1 : 1,
  };
}
```

So a stored `"03/14/2026"` compares as less than `"2026-01-01"` and a condition silently takes the
wrong branch. The arithmetic helpers refuse it (`parseIsoDate` at `evaluate.ts:193-199` returns
`undefined` and `addDays`/`daysBetween` produce a named refusal), and rendering refuses it too — only
the comparison path answers, and answers wrongly.

**Fix shape.** Validate the shape at the boundary that constructs the value, not at every consumer:
have `dateOrTextValue` (`custom-field-bindings.ts:273`) return a `text` merge value for a stored
string that is not a calendar date, so the key resolves as text and a comparison against a date is a
registration-time type error rather than a runtime lie. `orderOf`'s date arm should additionally
refuse rather than compare when either operand does not parse — that is the same
belt-and-braces the currency arm already applies.

### M7 — the index consumer buffers whole documents into Worker memory

**Fixed in #PR.** `enqueueVersionForIndexing` gates on the version's `size_bytes` and records anything past an explicit extraction ceiling as `deferred` naming that ceiling, so the decision is a recorded state rather than an out-of-memory that reads like an unreadable document.

**`apps/api-worker/src/background/search/index-consumer.ts:87`, `apps/api-worker/src/search/text-extraction.ts:108`**

```ts
const bytes = new Uint8Array(await source.arrayBuffer());
```

The worker's own local rules state "Bulk bytes never buffer in the Worker. Streaming only"
(`apps/api-worker/CLAUDE.md`). Here the full source object is materialised, then handed to the WASM PDF
engine (which copies it into linear memory) and, on the recognition path, used whole as a `fetch`
body. That is at least two live copies of an object whose ceiling is the firm's inspectable-size cap
— which `email-add-in.ts:515` shows can be far above a Worker's memory budget — and no size gate
exists on the enqueue side (`apps/api-worker/src/search/enqueue-index.ts` checks only the indexing
switch and the version's cleanliness).

The failure mode is an OOM inside the queue consumer, which surfaces as a retry and then a
dead-letter — indistinguishable, from the coordinator's `markFailed`, from a genuinely unreadable
document. Compounding H2, such a version then becomes a permanent sweep candidate.

**Fix shape.** Gate on `file_version.size_bytes` at `enqueueVersionForIndexing`, marking anything
over an explicit extraction ceiling as `deferred` with a reason that names the ceiling, so the
decision is a recorded state rather than an OOM. The comment at `text-extraction.ts:69-73` already
anticipates moving extraction into a Container; the size gate is the cheap thing to add before that.

---

## Low

### L1 — DKIM key-record and expiry checks are incomplete

**Fixed in #PR.** A record carrying `t=y` yields `keyTesting` / `unverified` (RFC 6376 section 3.6.1); the RSA modulus length is read back off the imported key and refused below 1024 bits as `keyTooWeak` (RFC 8301); a non-numeric `x=` is `malformedSignature` rather than a silently unapplied expiry.

**`packages/email-filing/src/dkim.ts:406-417`, `:151-160`**

`selectKeyRecord` reads `p=` and `k=` and ignores everything else in the record. Three omissions:

- **`t=y`** marks a signer in testing mode; RFC 6376 §3.6.1 says a verifier must not treat such a
  message differently from an unsigned one. Today it yields a full `pass`.
- **RSA key size** is unchecked. RFC 8301 requires rejecting RSA keys under 1024 bits;
  `crypto.subtle.importKey` will happily import a 512-bit SPKI.
- **`x=`** silently skips its check when the tag is non-numeric: `Number("abc")` is `NaN`,
  `Number.isFinite(NaN)` is false, and the expiry is simply not applied.

None is exploitable on its own against a well-behaved signer, but each is a case where the verifier
vouches for more than the cryptography said.

**Fix shape.** Skip a record carrying `t=y` (or degrade its outcome to `unverified` with a new
reason); read the modulus length from the imported RSA key and refuse under 1024 bits; treat a
non-numeric `x=` as `malformedSignature` rather than as absent.

### L2 — a conflict hold is reported last, so a staged filing may never say a conflict held it

**Fixed in #PR.** `demotionReason` still reports strongest-first for the machine-readable field, and the conflict-hold sentence is appended to `reasons` whenever `conflictHold` is true, regardless of which demotion won the ladder — without repeating it when the hold is itself the demotion.

**`packages/email-filing/src/auto-file-rules.ts:494-505`**

The demotion ladder is `rulePosture` → `firmPolicyDirectFilingOff` → breaker → `conflictHold`. The
comment above it says the reader "wants the true answer to 'why is this staged'". But a message held
by the filing-time conflict/wall hook on a rule whose posture was already `stage` is reported as
"This rule places the message on the matter and leaves the filing to a person" and never mentions the
conflict at all. The outcome is correct (`stage` either way); the explanation is not, and the
explanation is the whole product of this function.

**Fix shape.** Keep the single `demotionReason` for the machine-readable field, but append the
conflict-hold sentence to `reasons` whenever `conflictHold` is true, regardless of which demotion
won the ladder.

### L3 — the circuit breaker is read-then-act with no atomicity

**Fixed in #PR.** `AUTO_FILE_ACTIVITY_WINDOW_LIMIT` is exported as the value a caller must pass, derived from the threshold so a limit that would disable the breaker cannot be chosen by accident, and the read's contract is documented where the limit is consumed. The overshoot is now stated explicitly as "the window plus one queue batch" rather than as a hard ceiling.

**`packages/data-access/src/email-auto-file-statements.ts:416-434`,
`packages/email-filing/src/auto-file-rules.ts:480-486`**

`firesInWindow` is derived from a bounded index walk before the decision, and the decision row is
written after. Concurrent captures of the same rule all read the same pre-increment count, so N
concurrent messages at count 24 all decide `file` and the window ends at 24 + N. The comment at
`:407-409` is right that a maintained counter would be two contended hot-path writes — but the
overshoot should be stated, and the burst case is exactly the mailing-list scenario the bound exists
for. `firesInWindow` is also capped by `windowLimit`, so a caller that passes a `windowLimit` below
`AUTO_FILE_MAX_FIRES_PER_WINDOW` disables the breaker entirely; no caller exists yet to check.

**Fix shape.** When the wiring lands, assert `windowLimit > AUTO_FILE_MAX_FIRES_PER_WINDOW` at the
call site, and accept the overshoot explicitly by documenting the bound as "the window plus one
queue batch" rather than as a hard ceiling.

### L4 — malformed matter ids in the deciding evidence are dropped rather than refused

**Fixed in #PR.** A non-string or empty entry in either the thread or subject matter-id list is `incompleteEvidence`, matching how a malformed rule is handled. Tested against the case the guardrail exists for: the same evidence with both ids well-formed is `ambiguousEvidence`, which dropping the malformed one would have collapsed into a firing.

**`packages/email-filing/src/auto-file-rules.ts:376-379`**

```ts
for (const matterId of threadMatterIds)
  if (isNonEmptyString(matterId)) decidingMatterIds.add(matterId);
```

A malformed rule is `incompleteEvidence` (`:336`), but a malformed thread or subject matter id is
skipped. That is the wrong direction for the ambiguity guardrail: if a thread genuinely resolves to
two matters and one arrives malformed, the deciding set has size one and the rule fires — the exact
case guardrail 1 exists to refuse. The module's own principle is stated at `:218-219`: "Anything else
is unevaluable, not permission."

**Fix shape.** Treat a non-string or empty entry in either list as `incompleteEvidence`, matching how
a malformed rule is handled.

### L5 — per-page provenance is computed and discarded

**Fixed in #PR** as the report's second option — documented, not persisted. The `pages` field is stated in the module as a forward seam with no store and no reader, so a reader does not assume the corpus report is already possible. Persisting a per-page provenance summary needs a column on the split row and belongs with the change that adds it.

**`apps/api-worker/src/background/search/index-consumer.ts:120-126`**

`extraction.pages` is produced by `extractedFromPages` and never read: `ports.index.index` receives
only `passages`, and `replaceDocumentSplitStatements` records document count, size, and schema
generation. So the `native` / `ocr` distinction that `packages/search/src/extraction.ts:24-29`
describes as the thing "a consumer that has to report on its corpus … must" have has no store and no
reader. The seam is right; nothing is on the other end of it yet.

**Fix shape.** Either persist a per-page provenance summary on the split row (counts by provenance
are enough for the exception report and cost one column), or state in the module that the field is a
forward seam so a reader does not assume the report is already possible.

### L6 — the campaign's new document-assembly paths are absent from the load-profile harness

**Fixed in #PR.** A second probe manifest carries a repeating block over a collection, an aggregate over its items, and every protected key the dictionary offers; the new `assembly.merge-context-expressions` measurement resolves it with a stub protected reader, so the read plan and the serial decrypt count appear in the harness at a real firm's size.

**`packages/fixtures/src/load-profile/document-automation-generate.ts:152-154`,
`packages/fixtures/src/load-profile/document-automation-measurements.ts:129-146`**

The probe manifest is built by `manifestFor`, which leaves the block and computed-field lists empty
by design — "the expression constructs are exercised by the package's own tests". The
`assembly.merge-context` measurement consequently never exercises the expression key set, which is
the thing that makes the batching claim non-trivial: `resolve.ts:129-131` states that expression
keys join the read plan precisely so "an expression must never be the reason a read happens late",
and nothing measures it. The same measurement supplies no `readProtectedIdentifier`, so the serial
per-key decrypt loop (`protected-bindings.ts:259-283`) — one permission check, one audit write and
one AES-GCM decrypt per protected key, deliberately not batched — is never measured either, though
`protected-generate.ts` exists to volume it.

**Fix shape.** Add a second probe manifest carrying a repeating block over a role collection, an
aggregate, and the protected keys, and a measurement that resolves it with a stub protected reader.
The point is not the microsecond number; it is that the read plan and the decrypt count show up in
the harness at the size a real firm produces.

---

## What was checked and found sound

Recorded so the negative results are as legible as the findings.

- **The expression sandbox's structural claims hold.** The grammar has no member-access, indexing,
  call-by-name, or assignment production (`parse.ts:11-34` is accurate to the code); a call node
  carries a signature resolved against a frozen `Map` at parse time (`catalog.ts:243-252`), so no
  name reaches a dynamic dispatch; scopes are `Map`s layered by copying (`check.ts:39-44`), so no
  lookup can reach a prototype; a merge key is one lexical atom (`lex.ts:60-77`), which is what makes
  `__proto__.constructor` uninteresting. Arity is enforced at parse (`parse.ts:555-563`, both
  minimum and maximum) as well as minimum-only at check, so the unguarded `argumentNodes[n] as
  ExpressionNode` casts in `evaluateCall` (`evaluate.ts:623-637`) are in fact unreachable.
- **Termination and the budgets.** Every recursive walk is bounded: parser recursion by
  `PARSER_RECURSION_LIMIT` and separately by the node-counted tree depth; `treeDepthOf` recursion is
  bounded by the same; evaluation charges a step per node and per list element against a budget
  shared across the whole document (`evaluate.ts:261-270`); `concat` charges output before returning;
  repeats charge `expandedBlocks` per iteration before expanding (`assemble.ts:504-512`); aggregates
  charge per element and cap at `itemsPerRepeat` (`evaluate.ts:823-830`). I could not construct an
  unbounded loop or an unbounded allocation.
- **Money arithmetic stays inside the stated helpers.** Every intermediate is checked with
  `Number.isSafeInteger` before the operation, so the money package's own throw is unreachable;
  rounding goes through `roundLedger` and splitting through `allocate`; `sum` folds through the same
  `addOrSubtract` the `+` operator uses; there is no money literal and no cross-currency arithmetic.
  The `divideRounded` sticky adjustment (`evaluate.ts:915-923`) is correct for both signs — I walked
  the tie and near-tie cases by hand.
- **Assembly re-checks expressions from the document's source** against the firm's _current_
  dictionary (`assemble.ts:406`, `:451`, `:625`), which is what makes archived-custom-field drift a
  named failure. I looked specifically for a registration check the assembly path skips and found one
  candidate — the `:format` legality of a loop-scoped placeholder, which registration validates at
  `normalize.ts:617-628` against the binding's type and assembly does not re-check
  (`assemble.ts:579-582`). It is not exploitable: the dictionary declares list item fields as `text`
  (`catalog/facets.ts:123-134`) and resolution produces text for them (`resolve.ts:295-303`,
  `directory-role-bindings.ts:121-127`), so registration already refuses `:lastFirst` on an item
  field and the two agree. Recorded here rather than as a finding because the agreement is a property
  of two tables that could drift.
- **Protected values.** `protected-bindings.ts` holds no ciphertext column, derives no key, and
  decrypts nothing; the only plaintext source is the injected reader. The refusal is caught by
  identity (`ProtectedReadForbiddenError`) and anything else propagates (`:273`), so a broken decrypt
  is not silently an absence. Reasons name the field and the permission and never the value
  (`:214-216`), the subject rides the party read already happening (`resolve.ts:283-286`), an
  ambiguous client decrypts nothing (`:197-209`), and the refusal short-circuit is serial _by
  design_ so a refused member commits one audit row rather than one per key (`:256-263`) — I checked
  that the short-circuit cannot skip an audit row for a decrypt that did happen, because the
  chokepoint owns the audit and this module only stops asking. `absenceReasons` are pruned for keys
  that resolved (`resolve.ts:387-389`), so a reason never describes an absence that did not happen. I
  found no second read path and no log line carrying a decrypted value.
- **Redaction.** `AssemblyResult` carries keys and counts and never values (`assemble.ts:96-113`);
  `ExpressionTally` carries no expression text; auto-file reasons are rendered from closed phrasing
  tables with no interpolation (`auto-file-rules.ts:164-190`); the auto-file audit metadata is
  identifiers and enums and explicitly excludes the match value
  (`email-auto-file-statements.ts:112-118`); the capture idempotency body is identifiers and enums
  (`capture-consumer.ts:174-182`). The one interpolation I checked closely,
  `matter-suggestion.ts:85-102`, carries `detail` values built at `email-add-in.ts:359`, `:371`,
  `:384`, `:395` — a timestamp, a matter number, a correspondent address plus role, and the member's
  own query. All are legitimate for the pane; none is body content.
- **Cross-firm scoping.** Every read on the three add-in routes goes through `firm.firmDatabase` from
  the chokepoint context, never a path or body value; the capture status route's 404-versus-pending
  asymmetry is argued at `email-add-in.ts:544-552` and the argument holds (the job id is
  unguessable, so the only reader who sees the 404 already knew the job existed).
- **Auto-file guardrail composition.** Working through the combinations: ambiguity is computed
  structurally over rules plus thread plus subject and refuses before any rule is chosen
  (`:374-382`); a human `filed` or `unlinked` link on the target blocks refiling and a human `filed`
  link on any other matter blocks too (`:301-318`); the firm ceiling is checked independently of the
  rule's posture so no member can opt the firm in (`:494-498`); an unanswerable
  `creatorRetainsMatterAccess` fails closed without recommending a suspension (`:421-428`); the
  target must be `open` and not `systemOwned` (`:456-471`). I could not find a composition reaching
  `outcome: "file"` past any of those. The `stage` default is genuinely the default — every
  early return is `noRule`, and `file` requires the demotion ladder to be entirely null.
- **The OOXML guarded readers.** Every zip read in the assembly path goes through `readPackage`; the
  image reader sniffs magic bytes rather than trusting a declared type, caps bytes before parsing,
  and the JPEG segment walk is bounded by the buffer with a length sanity check
  (`ooxml/image.ts:91-124`) — I looked for a loop that could stall on a malformed marker run and
  found the `0xff` padding skip advances, so it terminates. `packageIntegrityViolations` reads the
  emitted package rather than the text.
- **`crates/pdf-core/src/textextract.rs` read as source.** The `needs_recognition` gate weighs text
  coverage against raster coverage rather than testing for glyph presence, which is the Bates-stamp
  case it is written for; ties go to recognising, which is the safe direction; invisible glyphs are
  excluded from the coverage measure but included when reading the layer, which is the property that
  keeps this product's own searchable PDFs extractable. The two coverages come from one observation
  pass, so the gate the extractor applies and the gate the container applies cannot diverge. I did
  not run `cargo`, so the arithmetic in `share`, the line grouping tolerances, and the word-gap
  heuristics are reviewed by reading only.

## Coverage — what this review did not establish

- **No test suite, no `cargo`, no `tsc`.** Sibling builder worktrees own the CPU. Only
  `pnpm run lint:process-refs` was run. Every finding is from reading the code and walking the
  scenario by hand; none was reproduced against a running system.
- **The Rust half is read, not executed.** `textextract.rs` and its callers in `lib.rs` were read for
  logic. Numeric behaviour under real PDFs — coverage thresholds against actual page geometry, the
  `f32` clamping in `share`, the line-tolerance constant against real leading — is unverified.
- **`packages/document-assembly/src/normalize.ts` was read only in the regions relevant to format
  legality and scope construction.** The run-splitting, MERGEFIELD conversion, and macro-strip
  passes were not reviewed; `macros.ts` is described as security-boundary code and was out of the
  stated scope.
- **The catalog registry** (`src/catalog/subjects.ts`, `generate.ts`, `groups.ts`, `revision.ts`,
  `entry.ts`) was read for the facet/subject cross product and the `itemFields` declarations that M6
  and the format-legality note depend on. I did not audit the generated key set against
  `test/fixtures/shipped-keys.json`, which is the mechanism that makes key permanence a property.
- **The `email_matter_link` state machine and the unlink route** were read only through
  `readAutoFileRuleActivity`'s reversal query. Whether an unlink reliably records
  `auto_file_rule_id` — which that query depends on — was not traced to the writer.
- **`packages/email-filing/src/capture.ts`, `thread.ts`, `dedup.ts`, `message-format.ts`** were
  consulted for the participant-address set and the DKIM call site only. In particular I did not
  establish which `From` header the capture record stores when a message carries more than one; if it
  is not the same instance `buildSignedHeaderInput` signs (`dkim.ts:254-260` takes the last, per the
  RFC's bottom-up rule), that is a further spoofing gap on top of H3 and is worth one hour of
  someone's time.
- **Idempotency was checked at the capture consumer and the index consumer.** The three add-in routes
  declare `idempotency: "optional"` and are reads, so there is nothing to converge; I did not audit
  the chokepoint's handling of that declaration.
- **The load-profile plan-quality probes** (`DOCUMENT_AUTOMATION_PLAN_SCAN_ALLOWLIST` is empty, which
  is the strong position) were read but not executed, so no `EXPLAIN QUERY PLAN` output backs the
  N+1 finding in M4 — that one is from the code shape, which is unambiguous.
