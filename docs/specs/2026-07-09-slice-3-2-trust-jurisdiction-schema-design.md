# Slice 3.2 — Trust jurisdiction-profile schema (design)

Status: design, approved 2026-07-09. Supersedes nothing; implements the jurisdiction layer of
slice 3.2 (ADR-0009: jurisdiction-configurable engine, rule numbers never hard-coded).

The ledger substrate already exists (ADR-0072: append-only double-entry, per-client subledgers,
no-negative bounds CHECK, linked reversals). This design covers the **compliance and jurisdiction
layer** that sits on top of it: how per-jurisdiction trust-accounting rules are typed, shipped,
and resolved into requirements a firm must satisfy.

It is grounded in a verified research corpus of 56 US jurisdictions x 16 fields (896 cells):
HIGH 688 · MEDIUM 23 · LOW 0 · NOT_ADDRESSED 185 · GAP 0.

## Why this shape

The corpus analysis produced three findings that drive every decision below.

**A silence and an absence of research are opposites.** The corpus originally used one token for
"the rule is silent, so resolve to the baseline" and "the requirement exists in a companion rule
we never captured". South Carolina's IOLTA field carried the second while labelled the first;
resolving it to the ABA baseline would tell a South Carolina firm that IOLTA participation is
optional, which Rule 412(b)(1) contradicts verbatim. The distinction is now a type, and the
engine refuses to resolve the unresearched case.

**Baseline resolution is asymmetric.** A wrong silence in the `rigor` bucket over-complies and is
safe. In `restriction` it under-restricts. In `data` it asserts a wrong fact. Half the discovered
gaps were in `data`.

**A type is a claim, and a wrong claim is silent.** Prose can be misleading; a wrong boolean is
actionable. So a field earns a machine-readable value only when code must compute on it. Adding a
type later is additive and safe; removing a wrong one after firms rely on it is not.

## Architecture

Three layers, one direction of flow. Nothing downstream writes back.

```
docs/research/trust-rules/            (magna-carta-research-archive — its own git repo)
  extract/US-*.json           56 per-jurisdiction research files   <- humans and agents edit here
  pipeline/*.py               idempotent; proven fixed point
  profiles.json               prose + provenance; the research source of truth
        |
        |  scripts/build-data.mts    (build:data / verify:data)
        v
packages/trust-jurisdictions/         (compiled reference data — identical for every firm)
  src/types.ts                        the contract
  src/data/US-NV.generated.ts         56 modules, one per jurisdiction, each reviewable
  src/registry.generated.ts           jurisdictionCode -> profile map (generated; not a barrel)
  src/resolve.ts                      baseline + overlay resolution
        |
        |  resolveTrustRequirements(profile, firmSettings)
        v
per-firm database (FirmDatabase Durable Object)    (firm-scoped choices, not rules)
  trust_jurisdiction_settings         which restrictions this firm opted into
  trust_account -> location           which office state binds the account
```

**The seam: rules are shared reference data; choices are firm-scoped.** A rule correction is a
package release, not a migration against every tenant. A firm enabling a restriction is a row in
its own database and never touches reference data.

The package holds no per-firm state and no ledger logic. It answers "what does South Carolina
require", not "what does this firm owe". Trust subledgers, the no-negative floor, and the
reconciliation run live in the slice's ledger code and consume this package. Nevada's profile is
therefore assertable without standing up a firm.

**The jurisdiction is derived, not chosen.** RPC 1.15 forces the trust account's bank into the
office's state, so the key comes from the account's bound Location. A multi-office firm gets one
profile per office. That binding is per-firm state, which is why it lives on the Durable Object
side.

### Why one module per jurisdiction

Bundle size does not decide this: the whole dataset is ~274 KB of JSON, ~50 KB gzipped, against a
Workers limit of 3 MB gzipped. Dynamic `import()` would not shrink it (every module still ships;
only parse is deferred), and tree-shaking cannot help because the jurisdiction is chosen at
runtime from the firm's Location.

Reviewability decides it. This data is legal advice a lawyer must attest to, and all 56
jurisdictions are enabled. A per-jurisdiction module is a natural unit of review, with somewhere
to hang `attorneyReview`. States amend RPC 1.15 continually (Alabama's amendment took effect
2025-02-15); a per-file layout makes each amendment a one-file diff with usable `git blame`, in
the file that determines whether a firm is committing an ethics violation. It also matches how the
research is produced — per-jurisdiction files, written in parallel — and this repo runs many
worktrees, where a monolithic data file is a merge-conflict magnet.

This diverges from `@magna-carta/wellbeing-resources`, which ships one `data.generated.ts` and
drops provenance at the generator boundary. The divergence is deliberate: there, provenance is
research metadata; here, "why does this requirement apply to me" is a product surface.

## The type model

```typescript
export type Confidence = "HIGH" | "MEDIUM" | "LOW" | "NOT_ADDRESSED" | "GAP";

// Why a MEDIUM is medium. Two of these are terminal: no further research promotes them.
export type MediumKind =
  | "secondarySource"   // a handbook/ethics opinion carries it; black-letter is quiet -> liftable
  | "judgmentStandard"  // the rule delegates the call to the lawyer -> permanent
  | "noEnumeration";    // the rule says "complete records" and declines to list -> permanent

export type SourceTier = "primaryOfficial" | "corroborated" | "secondary" | "byReference";

export interface Provenance {
  readonly citation: string;
  readonly quote?: string;      // verbatim; absent only when the rule is silent
  readonly sourceUrl?: string;
  readonly sourceTier: SourceTier;
}

// `value` exists only on HIGH | MEDIUM. A silence has no value to read, and the compiler
// enforces it: the US-SC.iolta bug is unrepresentable rather than merely fixed.
export type TypedField<T> =
  | { readonly confidence: "HIGH" | "MEDIUM"; readonly value: T;
      readonly mediumKind?: MediumKind; readonly prose: string; readonly provenance: Provenance }
  | { readonly confidence: "NOT_ADDRESSED"; readonly prose: string; readonly provenance: Provenance }
  | { readonly confidence: "GAP"; readonly prose: string; readonly provenance: Provenance };

export interface ProseField {
  readonly confidence: Confidence;
  readonly prose: string;
  readonly mediumKind?: MediumKind;
  readonly provenance: Provenance;
}
```

`NOT_ADDRESSED` replaces the corpus's `NA` token. "N/A" reads as *not applicable*, which is the one
thing it never means: the field is applicable, and the rule is silent about it.

### The eleven typed values

```typescript
export type RecordsRetention =
  | { readonly kind: "years"; readonly years: number }   // 5-8 across the corpus
  | { readonly kind: "byReference" };                    // AS, MP adopt the ABA Model Rule

export interface Reconciliation {
  readonly required: boolean;
  readonly cadence: "monthly" | "quarterly";
  readonly threeWay: boolean;   // bank = journal = sum of client ledgers
}

// The whole restriction bucket. Counts are jurisdictions imposing each ban.
export type ProhibitedMethod =
  | "cashWithdrawal"                                  // 15
  | "automatedTellerMachine"                          // 19
  | "debitCard"                                       //  2
  | "checkPayableToCash"                              // 21
  | "overdraftProtection"                             //  4
  | "electronicTransferWithoutWrittenAuthorization";  // 10

export interface InterestOnLawyerTrustAccount {
  readonly mandatory: boolean;               // Guam: false — no program exists
  readonly recipient: string;                // "Nevada Bar Foundation"
  readonly remitCadence?: "monthly" | "quarterly";
  readonly comparabilityRateFloor?: string;  // "0.70%", "75% Fed Funds or 1.00%"
}

// One name, two kinds of rule. Maryland states a number; Maine delegates to judgment.
export type InterestThreshold =
  | { readonly kind: "netInterestTest"; readonly amountMinor: number; readonly currency: "USD" }
  | { readonly kind: "lawyerJudgment" };

export type UnclaimedFundsDestination =
  | "escheatToStateTreasurer"    // 20 researched + the 26 that reach it by baseline
  | "barFoundation"              // IN, PA, RI, WV
  | "clientProtectionFund"       // NV, DE, NY, WY
  | "accessToJusticeFoundation"  // AR
  | "clerkOfCourt";              // NJ

export interface UnclaimedFunds {
  readonly destination: UnclaimedFundsDestination;
  readonly dormancy: string;         // ISO 8601 duration: "P7Y" (CT), "P4M" (WV)
  readonly diligenceRequired: boolean;
  readonly reclaimable: boolean;     // IN, AR: refundable if the owner appears
  readonly deMinimisMinor?: number;  // DE: under $1.00; NY: under $1,000 without a court order
}

export interface OverdraftProgram {
  readonly required: boolean;        // Texas: false — no program exists
  readonly notifyBody?: string;      // "Office of Disciplinary Counsel"
  readonly reportWithinBankingDays?: number;
}

// Vermont is required but BIENNIAL. A boolean would erase the finding.
export interface AnnualCompliance {
  readonly required: boolean;
  readonly cadence: "annual" | "biennial";
  readonly instrument?: string;      // "licensing statement", "Rule 410 fee statement"
}

export interface ProcessorFees { readonly mayChargeClientPrincipal: boolean; }
export interface GoodFunds { readonly required: boolean; }
export interface DisputedFreeze { readonly required: boolean; }
```

Money is always minor units (`amountMinor`, `deMinimisMinor`), matching `@magna-carta/money`.
Never a float.

### The profile

```typescript
export interface JurisdictionProfile {
  readonly jurisdictionCode: string;   // "US-NV"
  readonly name: string;
  readonly sourceDocument: {
    readonly title: string; readonly publisher: string;
    readonly year: string; readonly url: string;
  };

  // Nullable, and on the profile rather than the field: this is why each jurisdiction is
  // its own module. Nevada can ship reviewed while Guam has not been.
  readonly attorneyReview: { readonly reviewedBy: string; readonly reviewedOn: string } | null;

  readonly typed: {
    readonly recordsRetention: TypedField<RecordsRetention>;
    readonly reconciliation: TypedField<Reconciliation>;
    readonly prohibitedMethods: TypedField<readonly ProhibitedMethod[]>;
    readonly goodFunds: TypedField<GoodFunds>;
    readonly disputedFreeze: TypedField<DisputedFreeze>;
    readonly interestOnLawyerTrustAccount: TypedField<InterestOnLawyerTrustAccount>;
    readonly interestThreshold: TypedField<InterestThreshold>;
    readonly unclaimedFunds: TypedField<UnclaimedFunds>;
    readonly overdraftProgram: TypedField<OverdraftProgram>;
    readonly processorFees: TypedField<ProcessorFees>;
    readonly annualCompliance: TypedField<AnnualCompliance>;
  };

  // Enforced as Tier-1 invariants regardless of value; carried for citation, never branched on.
  readonly invariant: {
    readonly segregation: ProseField;
    readonly advancesInTrust: ProseField;
    readonly firmFundsForCharges: ProseField;
  };

  readonly prose: { readonly requiredRecords: ProseField };
}
```

`requiredRecords` stays prose: 55 distinct values across 56 jurisdictions, and ID/NE/OK/WV
deliberately decline to enumerate. That refusal is the verified finding. Nothing computes on it;
it renders as a checklist.

`segregation`, `advancesInTrust`, and `firmFundsForCharges` stay prose because they are Tier-1
rigor invariants — enforced for every firm regardless of jurisdiction. Slice 3.2 is the structural
owner of *fees-never-touch-trust*. Typing them would be actively harmful: a typed
`segregation: false` invites someone to branch on it.

## Resolution semantics

```typescript
export interface ResolvedRequirement<T> {
  readonly value: T;
  readonly binding: boolean;        // false => advisory; render, never gate
  readonly confidence: Confidence;
  readonly mediumKind?: MediumKind;
  readonly source: "jurisdiction" | "baseline" | "invariant";
  readonly provenance: Provenance;  // always present
}
```

Resolution is not one operation. The buckets fail in different directions:

1. **`GAP` is a hard refusal.** `resolve()` throws — not a warning, not a fallback. Because the
   generator also rejects `GAP` at build time, a `GAP` can only reach runtime through a hand-edit
   of generated data.

2. **`rigor` may resolve silently.** The app enforces the strictest observed value regardless of
   what a state permits, so a wrong silence merely over-complies. Retention default is
   **indefinite**; the state number is a **purge-floor, never a deletion trigger**. Floors span
   5-8 years, so a single global 8-year floor satisfies all 56.

3. **`restriction` resolves to OFF only on an explicit `NOT_ADDRESSED`.** A wrong silence here
   under-restricts — it hands a Louisiana lawyer an ATM card the rule forbids. Absence is not
   representable in `TypedField`, so silence must be a recorded finding.

4. **`data` resolves to the ABA baseline, with one correction.** A wrong silence asserts a wrong
   fact. And the baseline was itself wrong for `unclaimedFunds`: the ABA Model Rule is silent, so
   "resolve to ABA" resolved to nothing. Its baseline is `escheatToStateTreasurer` — what 20 of 30
   researched jurisdictions do, and what CT (7-year) and IA (3-year) were confirmed to do from
   their statutes verbatim. That converts 26 open research tasks into one baseline rule plus ten
   exceptions.

**Binding vs advisory** follows from `mediumKind`:

```typescript
// A judgmentStandard is the rule delegating the call to the lawyer. The engine must not
// pretend to make it: surface the standard, ask. Nothing else is advisory.
const binding = !(field.confidence === "MEDIUM" && field.mediumKind === "judgmentStandard");
```

Rhode Island's `interestThreshold` renders as "nominal or short-term, in your judgment" with its
citation and never silently routes client funds. Maryland's `$50` test is binding and does. Same
field, different behavior, driven by the type.

**The firm overlay** touches only the restriction bucket, and only in the safe direction:

- profile imposes a ban -> always banned; a firm cannot opt out of the law.
- profile silent -> off by default; the firm **may** opt in.
- `rigor` and `data` -> firm settings have no say.

A firm may be stricter than its jurisdiction, never looser. A settings bug therefore cannot create
an ethics violation.

## Generation and guards

**The generator validates; it never parses prose.** Reducing 56 free-text rules to types with a
regex is precisely the mechanism that produced the original mislabels — a script quietly
compressing prose into a category. Instead the typed value is **authored into the corpus** at
`profiles/typed/US-*.json`, transcribed from the prose and its verbatim quote by whoever did the
research, and reviewed like any other finding. 443 of 616 typed cells need a value; the remaining
173 are `NOT_ADDRESSED` and must not have one.

`scripts/build-data.mts` reads `profiles.json` plus the typed overlay and emits the 56 modules and
the registry. It refuses to emit rather than guess. Five hard failures:

- **A `HIGH`/`MEDIUM` typed field with no authored value**, or a `NOT_ADDRESSED`/`GAP` field that
  has one. Confidence and the presence of a value must agree, because `TypedField<T>` makes
  disagreement unrepresentable downstream.
- **`GAP` present.** Never shipped; the build names the jurisdictions that owe research.
- **`LOW` in a typed field.** `TypedField` has no `LOW` case by construction: a tentative value
  must never drive a compliance gate. The corpus holds zero `LOW` today; if one reappears, the
  build stops rather than widening the type. `LOW` remains legal on a `ProseField`.
- **`MEDIUM` without a `mediumKind`.** Otherwise a permanent judgment-standard is
  indistinguishable from a research backlog item.
- **`MEDIUM` without a verbatim `quote`.** An asserted requirement must show its source. The same
  guard for `HIGH` ships **warning-only** and becomes a hard failure once provenance is backfilled
  to all 896 cells (see below) — today `quote` exists on only 144 of them, nearly all `MEDIUM`.

`verify:data` runs the generator with `--check` and fails when the committed output has drifted
from the corpus, keeping a rule change and its generated data in one commit — the guard
`wellbeing-resources` already uses.

## Testing

- **Unit** — `resolve()` bucket asymmetry: a `GAP` throws; a `restriction` silence yields off; a
  `rigor` silence yields strict; a firm may tighten a restriction but never loosen one.
- **Property, across all 56 profiles** — every typed field either carries a value or a confidence
  that forbids one; every `MEDIUM` carries a `mediumKind` and a verbatim quote; no `binding: true`
  field is a `judgmentStandard`; no typed field is `LOW`. The same assertion for `HIGH` quotes is
  written now and skipped until the provenance backfill lands, so it starts passing on its own.
- **Golden** — pin the hand-researched jurisdictions, because a regression there is silent:
  Nevada (7 years, monthly three-way), South Carolina (IOLTA mandatory under Rule 412),
  Texas (no overdraft program), Guam (no IOLTA), Vermont (biennial, not annual),
  Maryland (`$50` net-interest test), Louisiana (ATM/debit/cash/checks-to-Cash all banned).

## Corpus work this design depends on

- **Vendor the corpus into the main repo** at `docs/research/trust-rules/`. It currently lives in
  `magna-carta-research-archive`, a separate repo; a generator cannot read across repos and
  Cloudflare Workers Builds would never see it. Follow the `wellbeing-resources` precedent exactly:
  track the corpus, and `.gitignore` only `sources/**/*.pdf`, keeping the `.txt` extractions and
  `manifest.yaml`. That is ~18 MB (63.8 MB of PDFs stay behind in the archive, which remains the
  archival home of the original bytes).
- Author `profiles/typed/US-*.json` — 443 typed values transcribed from the prose and quotes
  already verified. A pipeline stage validates that every `HIGH`/`MEDIUM` typed field has exactly
  one, and no `NOT_ADDRESSED` field has any.
- Split `extract/` from four batch files into 56 per-jurisdiction files. The batch grouping is an
  artifact of the original research batching and is the layer where parallel research collides.
  The pipeline's `BATCHES` constant becomes a glob; it stays idempotent.
- Backfill provenance to all 896 cells. `quote` exists on 144 and `sourceTier` on 149 — only where
  a research wave touched them. Until this lands the generator's `HIGH`-quote guard is
  warning-only; promoting it to a hard failure is the completion criterion for this work.

## Deferred, deliberately

- **Lifting the 13 liftable MEDIUMs.** They are `secondarySource`; more research promotes them.
  Not a blocker: they resolve and cite correctly today.
- **The 10 permanent MEDIUMs.** `judgmentStandard` (6) and `noEnumeration` (4) are terminal by
  law. `mediumKind` exists so they stop generating research tickets.
- **A corpus query layer.** Questions like "which jurisdictions enumerate a bank-charges ledger"
  belong in a reporting surface over the research JSON, not in the engine that gates client money.

## Consequences

- A jurisdiction's rules are auditable end to end: a resolved requirement carries its citation,
  verbatim quote, source tier, and confidence to the UI, which is the "why did this requirement
  come from" map.
- A silence can never masquerade as a researched value, and an unresearched field can never
  resolve at all.
- Trust rules become releasable independently of tenant migrations.
