# @magna-carta/reporting — CLAUDE.md

**Purpose.** The projection layer over records other packages own: the temporal contract every
ledger-backed report is taken over, the completeness declaration every response carries, and the
trust-compliance (bar-audit) pack. It **writes nothing** — it composes no effect, holds no database
binding, reads no clock, and owns no table. Everything it produces is a re-presentation of rows some
other package already asserts.

**White paper:** _Reports_, with _Trust accounting_ and _Financial Core_ as the surrounding context —
[`docs/Magna-Carta-White-Paper.md`](../../docs/Magna-Carta-White-Paper.md).
**Invariants:** [`docs/conventions/invariants.md`](../../docs/conventions/invariants.md), plus the
local `CLAUDE.md` of [`packages/trust`](../trust/CLAUDE.md) and
[`packages/ledger`](../ledger/CLAUDE.md).

## Key files / entry points

- `src/temporal.ts` — `ReportingPeriod` (period start, period end, knowledge instant),
  `LiveOnlyPeriod`, `resolveReportingPeriod` / `resolveLiveOnlyPeriod`, `knowledgeBoundOf`,
  `dayBefore`, and the reproducibility statement a produced document carries in plain words
- `src/completeness.ts` — `ReportCompleteness`: what a report says about how much of the firm it
  covered. `complete` today; the seam an ethical-wall answer lands on without a response-shape change
- `src/reporting-validation.ts` — this package's own refusal codes. Domain refusals are **never**
  re-coded here; they propagate as the refusing package wrote them
- `src/trust-compliance/pack.ts` — `assembleTrustCompliancePack`, its options, and the pack shape
  version
- `src/trust-compliance/types.ts` — the pack's seven sections
- `src/financial/` — accounts receivable aging (as of a date), work in progress (live) and
  realization: billing's per-matter rows added into offices, clients and matters
- `src/productivity/timekeeper-productivity.ts` — minutes recorded, never money, never a target
- `src/operational/operational-volumes.ts` — each domain's own counts side by side, the live
  sections named
- `test/purity.test.ts` — the read-only fitness function
- `test/agreement.test.ts` — every decomposition equals the aggregate its owner produces
- `test/reproducibility.test.ts` — the property the whole surface exists to deliver

## Invariants that apply here

- **A report never becomes a second answer to a question that already has one.** Every quantity falls
  into exactly one of three classes. **Owned elsewhere:** the three-way proof, the client-ledger
  total, the book balance, the outstanding-item list, the stored-balance fitness check — read through
  the function or statement that owns it, never re-implemented, never rounded differently, never
  summed over a different set. **A decomposition of something owned elsewhere:** a per-client,
  per-matter breakdown of a total trust asserts; a per-entry journal behind a bank balance trust
  asserts. Each ships with an agreement test proving it sums to its aggregate, and a decomposition
  that cannot be proved equal is not shipped. **Genuinely new here:** running balances, and the
  difference between a frozen attestation and the proof at production. Neither is a quantity any
  financial package asserts.
- **Nothing is materialised.** No rollup table, no cached total, no period snapshot. If a measurement
  demands relief the first thing to reach for is the `ledger_line.effective_date` denormalization —
  written by the ledger package inside the posting batch, duplicating an immutable column of the same
  row's parent so it can never drift — and never a stored computed figure.
- **Bitemporal or live, never ambiguous.** A ledger-backed read takes a period on the effective axis
  and a knowledge instant on the knowledge axis. A read that cannot honor a knowledge instant does not
  accept the parameter at all: accepting and ignoring it would answer a question about the past with a
  figure about the present.
- **A figure that cannot be bounded is LABELLED, never quietly unbounded.** Two blocks in the pack are
  outside the reproducibility claim, and both carry their own `computedAt` and an explicit
  `boundedByKnowledgeInstant: false`: the three-way proof shown beside each attestation, and the
  outstanding items, unmatched statement lines and stored-balance checks in the exceptions section.
  Their owning reads take no knowledge instant, and bounding them here would mean writing a second
  definition of the proof and of what is outstanding — the one thing a report must never do. Anything
  added to those blocks inherits the label; anything moved out of them has to be provably bounded.
- **The package writes nothing, and it is checkable.** `test/purity.test.ts` scans these sources for
  an `INSERT`/`UPDATE`/`DELETE`/`REPLACE`, for effect-batch or commit machinery, for a domain composer
  import, and for an aggregate of its own over the ledger. It also asserts it has sources to check.
  The one write in the whole surface belongs to the caller and is deliberately outside this package.
- **A section that came back short is a REFUSAL, not a short section.** Every per-row read asks for one
  row past its ceiling so a full list can be told from a truncated one, and hitting the ceiling refuses
  by name with the remedy — produce the period in shorter parts. A client ledger missing entries
  presented as complete is worse than no document, because a reader has no way to tell.
- **A correction stands beside what it corrects.** Reversals, credit notes and write-offs are printed
  as their own entries with the entry they name; nothing is netted away. The fact that something was
  corrected is part of what the reader needs.
- **Captions are not figures.** Every ledger and every line carries the record's own identifier beside
  the name. A client renamed later re-renders under a different name, and a merge resolves two handles
  to one client; the pack records the handles as they stood rather than collapsing them, and the
  reproducibility statement says out loud that the names are only as they stood.
- **Clock injection.** No wall-clock reads. `computedAt` is passed in, on the same terms as every other
  domain package here.

## Dependencies & contracts

- Depends on `@magna-carta/trust` (the account tree, the three-way proof, the bitemporal select
  builders), `@magna-carta/ledger` (the stored-balance fitness query and the calendar-date check),
  `@magna-carta/data-access` (the `SqlDatabase` shape only), and `@magna-carta/identifiers`.
- **New SQL over trust or billing tables belongs in THAT package**, inside its schema-name-sync net
  and beside the invariants it must respect. This package holds no SQL of its own by design; it
  composes those builders into report shapes. The purity scan's non-vacuity floor is that these
  sources really do call them.
- The route layer (`apps/api-worker/src/http/routes/billing/reports.ts`) supplies the firm-scoped database, the clock,
  and the jurisdiction port. Nothing here resolves any of the three.

## Gotchas

- **The pack's `proofAtProduction` is deliberately live, and the reproducibility test knows it.**
  `computeTrustThreeWayProof` computes over everything recorded and takes no knowledge instant. A pack
  taken at a past instant therefore carries one live block, and `test/reproducibility.test.ts` strips
  exactly that block plus the exceptions' `atProduction` block before comparing two runs. Widening what
  the test strips is how the reproducibility claim quietly stops being true — narrow it instead.
- **A reconciliation closed after the knowledge instant reads as OPEN**, with no attestation. The
  select gates each frozen column on `closed_at <= ?`, not on the stored status, because a pack taken
  at a Tuesday must not print an attestation the firm made on the Wednesday.
- **`selectTrustClientLedgerTotalAsOfStatement` filters on the effective axis alone**, by design, and
  this slice does not move it. The agreement tests therefore take their knowledge instant past
  everything recorded, which is the only condition under which the bitemporal read and the settled
  statement are answering the same question. That is the honest form of the claim, not a workaround.
- **A hold has no effective date.** `trust_hold` carries `placed_at` only, so "in force" is a question
  about the knowledge axis alone — the field is named `holdsInForceAtKnowledgeInstant` for that reason,
  and it must not be renamed to imply a period boundary the row does not carry.
- **Every jurisdiction refuses today.** Every encoded jurisdiction ships unreviewed, and nothing in the
  worker binds a rules corpus, so a governing-rule citation is unavailable on every account. The pack's
  default states the refusal on the cover in the corpus's own words and produces the rest; the
  `onJurisdictionUnavailable: "refuse"` arm is the seam for the owner deciding otherwise. Refusing by
  default would mean the surface can never produce anything until an attorney review lands.
