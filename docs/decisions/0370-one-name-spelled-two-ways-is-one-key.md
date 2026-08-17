---
number: 370
slug: one-name-spelled-two-ways-is-one-key
status: Proposed
date: 2026-08-16
area: Conflicts
summary: "Two derived match keys join `normalized_display` on `directory_name`: `normalized_match_key` canonicalizes connector words and legal-entity spellings while KEEPING the legal form, so `Smith & Jones LLP` and `Smith and Jones, L.L.P.` are one name at tier 2; `normalized_match_key_bare` removes the form, so `Smith & Jones LLC` meets them at tier 3. Both are nullable columns derived INSIDE `insertNameStatement` from the row's own normalized display, so none of the eight name-writing paths can omit one, with a resumable budgeted backfill on the daily cron and a fitness probe reporting the outstanding count. BEIDER-MORSE IS NOT SHIPPED, and the reason is measured rather than argued: the only maintained pure-TypeScript implementation (`bmpm` 0.1.1, MIT, zero runtime dependencies — golden rule 14 was never triggered) compiles its rule tables into regular expressions at module load, and inside workerd that costs 20,377 ms on the first request that touches it. Node does the same work in 16 ms, so this is a workerd property, not a library defect, and 20 seconds exceeds the Workers CPU limit outright: the channel cannot run in a request handler at all, on the write side or the read side. The recall it would buy is real and was measured before it was cut — over a thirty-pair cross-origin surname corpus it reaches seven pairs Double Metaphone structurally cannot — so it stays the named follow-on, now with a numeric flip condition rather than a hopeful one: an encoder whose rule tables cost workerd single-digit milliseconds, which in practice means the Rust/WASM port the deepening design already nominated."
---

**Two keys shipped, one encoder refused, and the refusal is a number.**

**Context.** The shipped matcher compares names four ways: blind-index identifier equality, an exact
`normalized_display` probe, Double Metaphone, and FTS5 trigram overlap. `normalizeName` is a frozen
contract — its output is stored across every firm and backs the FTS5 external-content index — so the
gaps it leaves have to close beside it rather than in it. The deepening design named two.

## What shipped: the match keys

The organization gap is spelling. `Smith & Jones LLP` normalizes to `smith jones llp`; `Smith and
Jones, L.L.P.` normalizes to `smith and jones l l p`. Those are one firm written twice and the strings
are not equal, so the pair reaches a reviewer only through trigram overlap, buried under every other
name in the corpus sharing a three-character window — the "reports nothing useful" failure in a
different costume.

`normalized_match_key` and `normalized_match_key_bare` are nullable columns added by
`ALTER TABLE ADD COLUMN`, each with its own index; `normalized_display` is untouched, so merge,
entry-time duplicate detection and the shipped tier-2 semantics do not move. The first canonicalizes
connector words and legal-entity spellings and **keeps** the legal form, so an equality means one name
written two ways — scored **tier 2**, the same rung as an exact name, because that is what it is. The
second removes the form entirely, so `Smith & Jones LLP` and `Smith & Jones LLC` meet — scored **tier
3**, because one firm re-formed and two unrelated legal persons look identical from there and choosing
between them is a lawyer's job. Neither widens `CHECK (evidence_tier BETWEEN 1 AND 4)`; the new
signals map into the existing rungs and name themselves in `matched_fields_json`.

Both keys are derived **inside `insertNameStatement`** from the row's own `normalized_display` rather
than passed in by callers. Eight write paths insert a name row, and a key a caller has to remember to
compute is a key some caller eventually does not compute — which is a name silently missing from a
blocking channel a check will nonetheless report as having run. A firm's existing corpus is filled by
`runNameIndexBackfillPass` on the daily cron: a bounded slice per firm, resumable with no stored
cursor because the selection predicate *is* the outstanding work, idempotent under overlap with a live
write, and audited by `findNamesMissingDerivedMatchingData`.

## What did not ship: Beider-Morse, and why

The person gap is origin. Double Metaphone encodes English pronunciation, and no English pronunciation
rule turns a Polish `w` into a `v`, so `Nowak`/`Novak`, `Kowalczyk`/`Kovalchik` and `Wojcik`/`Voychik`
are structurally unreachable for it. The design adopted Beider-Morse for exactly that population, and
the recall was measured before anything was cut: over a thirty-pair corpus of real transliteration
variants Beider-Morse joins **seven pairs Double Metaphone cannot** — the three above plus
`Krzyzanowski`/`Kzhizhanovski`, `Dvorak`/`Dvorzhak`, `Kaczmarek`/`Kachmarek` and
`Wisniewski`/`Vishnevski` — while Double Metaphone joins pairs Beider-Morse does not, so the two are
complementary and the union is the point.

**Golden rule 14 was never triggered.** The ecosystem was surveyed first. Exactly one maintained
JavaScript implementation exists on the public registry: `bmpm` 0.1.1, **MIT, pure TypeScript, zero
runtime dependencies** — no native module, no compiled-to-WASM C, nothing outside the memory-safe set.
The alternatives were Apache Commons Codec (Java, unreachable from this stack), a pure-Rust crate
compiled to WASM (viable, and named by the design itself as the measured follow-on), and hand-porting
several thousand rules (not credible). So there was no C/C++ dependency to consent to.

**It failed on a different axis, and the number is the whole decision.** `bmpm` builds its rule
tables at module load: importing it compiles the entire Beider-Morse rule set — nineteen languages,
both accuracy modes — into regular expressions before any name has been encoded. In Node that costs
about 16 ms. Inside workerd it costs **20,377 ms**, measured on the first
`POST /api/v1/directory/persons` in the worker test pool with the channel wired to the write path.
That is not a slow first request; it is past the Workers CPU limit, and the request never completes.

Three ways round it were tried or considered and none survives:

- **A lazy dynamic import** defers the compile to first use. Workers do not permit dynamic module
  loading at runtime, and the request hung rather than completing — worse than the static import.
- **Moving the compile off the request path** fixes the write side (the backfill sweep could fill
  phonemes on the cron) but not the read side: a check computes the SUBJECT's phonemes to probe with,
  and a manual check is a request. Reading the subject's stored phonemes instead of computing them
  would make the channel silently dead for any entity the sweep had not reached — which is exactly the
  failure mode this slice exists to avoid.
- **Shipping the table empty** was refused for the same reason the nickname catalogue is registered
  rather than half-built: a table nothing writes and nothing queries is not a seam, it is clutter that
  reads like coverage.

So the channel is not built, the `directory_name_beider_morse_code` table is not created, and the
dependency is not taken. **The flip condition is now a number instead of a hope:** an encoder whose
rule tables cost workerd single-digit milliseconds. In practice that means the Rust/WASM port the
design already nominated — where the rule tables compile at build time and the WASM module carries
them as data rather than as JavaScript regular expressions — or running the encoder in a Container
off the request path entirely. Either is a slice of its own, and the recall numbers above are what
justifies scheduling it.

**One claim in the design is also false and is corrected here.** The deepening design says the
Beider-Morse seam "is already paid for" because `directory_name_phonetic_code.scheme` carries an open
`length > 0` CHECK, making it "additive rows plus a one-time backfill — no schema change". The open
CHECK is real, but the table's PRIMARY KEY is `(name_id, scheme)`: it holds at most **one code per
name per scheme**. That fits Soundex (one code) and Double Metaphone (two codes, two schemes) and
nothing whose output is a variable set of tens. Whenever the encoder does land it will need a table
keyed by the CODE, not another scheme value — the rule is now written into the schema beside the
table so the next reader does not have to rediscover it.

**Consequences.** Recall rises on the organization axis and the rise is measured rather than argued:
over the load profile's match-key probes the match key joins pairs the exact-name probe does not and
the bare key joins the cross-form pair, each asserted in the load-profile smoke test so a channel
going dead fails the build rather than reporting a zero. The traversal cost is three additional
statements over a forty-entity closure — constant in the closure size rather than proportional to it,
because both probes are set-valued like the shipped ones. The person axis is unchanged, and the gap
is now documented with the recall it would close and the number that stops it.
