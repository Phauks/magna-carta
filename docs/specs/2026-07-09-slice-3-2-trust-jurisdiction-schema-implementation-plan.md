# Trust Jurisdiction-Profile Schema Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `@magna-carta/trust-jurisdictions` — typed, provenance-bearing trust-accounting rules for 56 US jurisdictions, plus a resolver that can never silently apply a rule the corpus never verified.

**Architecture:** A research corpus (prose + verbatim quotes + an authored typed overlay) is vendored into the repo and generated into 56 per-jurisdiction TypeScript modules, one per attorney-reviewable unit. A resolver applies bucket-specific baseline semantics: `rigor` may resolve silently, `restriction` resolves off only on a recorded silence, `data` resolves to a corrected baseline, and `GAP` throws. Firm-scoped choices never live here.

**Tech Stack:** TypeScript (strict), Vitest via `vp test`, `tsx` for generator scripts, Python 3 for the corpus pipeline, Oxc (`vp fmt`, `vp check`).

**Design:** [`2026-07-09-slice-3-2-trust-jurisdiction-schema-design.md`](2026-07-09-slice-3-2-trust-jurisdiction-schema-design.md)

## Global Constraints

- **No emojis** anywhere — code, docs, commit messages.
- **Fully write out names.** `resolveTrustRequirements`, not `resolveTrustReqs`. `jurisdictionCode`, not `code`. `confidence`, not `conf`. The corpus JSON keeps its short keys (`v`, `conf`, `cite`); the generator renames them on the way out.
- **No process references in source, tests, config, or consumer-facing strings.** No `ADR-NNNN`, no "spec", no "slice 0·N", no "Phase N". State the reasoning inline or cite a concrete file path. Enforced by `pnpm run lint:process-refs`. The one exception is a forward-looking schedule reference ("the provenance backfill promotes this guard to a hard failure").
- **Money is minor units.** `amountMinor`, `deMinimisMinor`. Never a float.
- **Reuse before building.** `@magna-carta/wellbeing-resources` is the template for a generated reference-data package. Read it before writing a new pattern.
- **Every generated file carries a `@generated` header** naming the script and the corpus path.
- **Documentation lands in the same commit** as the code. Changelog and ADR go in as fragments (`changelog.d/<slug>.md`, `docs/decisions/pending/<slug>.md`), never by hand-editing `CHANGELOG.md` or the Decision Log. Status goes in `status.d/<slice>.md`.
- **Quality gate:** `pnpm check` (runs `vp check` — fmt, lint, typecheck — plus `svelte-check`). A task is not done until it passes.
- **Python pipeline:** run from `docs/research/trust-rules/profiles/`, with `PYTHONIOENCODING=utf-8` on Windows (the dataset carries `Σ`, `§`, and Spanish accents). Every pipeline run must remain a **fixed point**: running it twice produces byte-identical `profiles.json`.
- **Never hand-edit** `profiles.json`, `viewer.html`, or any `*.generated.ts`. Edit `extract/`, `typed/`, or the scripts.

---

## File Structure

**Corpus (vendored into this repo in Task 1):**

| Path                                                            | Responsibility                                                            |
| --------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `docs/research/trust-rules/.gitignore`                          | Ignore `sources/**/*.pdf` only                                            |
| `docs/research/trust-rules/profiles/profiles.json`              | Generated dataset: prose + provenance (source of truth for the generator) |
| `docs/research/trust-rules/profiles/extract/US-*.json`          | 56 per-jurisdiction research files (Task 2)                               |
| `docs/research/trust-rules/profiles/typed/US-*.json`            | 56 authored typed-value overlays (Tasks 4–5)                              |
| `docs/research/trust-rules/profiles/pipeline/validate_typed.py` | Confidence and typed-value must agree (Task 4)                            |

**Package:**

| Path                                                      | Responsibility                                               |
| --------------------------------------------------------- | ------------------------------------------------------------ |
| `packages/trust-jurisdictions/src/types.ts`               | The contract. No logic.                                      |
| `packages/trust-jurisdictions/src/baseline.ts`            | The ABA baseline and the corrected `unclaimedFunds` baseline |
| `packages/trust-jurisdictions/src/resolve.ts`             | Bucket-specific resolution + firm overlay                    |
| `packages/trust-jurisdictions/src/data/US-*.generated.ts` | 56 profiles, one module each                                 |
| `packages/trust-jurisdictions/src/registry.generated.ts`  | `jurisdictionCode -> JurisdictionProfile` map                |
| `packages/trust-jurisdictions/scripts/build-data.mts`     | Validate + emit. Refuses to guess.                           |

---

### Task 1: Branch, worktree, and vendoring the corpus

The corpus lives in `C:\dev\magna-carta-research-archive`, a separate git repo. A generator cannot read across repos, and Cloudflare Workers Builds would never see it. Vendor it, following `wellbeing-resources` exactly: track everything, ignore only the PDFs (63.8 MB stay in the archive, which remains the archival home of the original bytes; ~18 MB comes across).

**Files:**

- Create: `docs/research/trust-rules/.gitignore`
- Create: `docs/research/trust-rules/**` (copied from the archive, minus `sources/**/*.pdf` and `_tmp_*`)
- Create: `docs/active-work/slice-3-2-trust-jurisdictions.md`

**Interfaces:**

- Produces: `docs/research/trust-rules/profiles/profiles.json`, consumed by every later task.

- [ ] **Step 1: Create the worktree**

The repo runs many worktrees; do not work on an unrelated branch.

```bash
cd C:/dev/magna-carta
vp run worktrees                     # see what else is in flight before touching shared files
git worktree add C:/dev/magna-carta-worktrees/slice-3-2-trust-jurisdictions -b slice-3-2-trust-jurisdictions main
cd C:/dev/magna-carta-worktrees/slice-3-2-trust-jurisdictions
```

- [ ] **Step 2: Copy the corpus, excluding PDFs and scratch files**

```bash
mkdir -p docs/research/trust-rules
cd C:/dev/magna-carta-research-archive/docs/research/trust-rules
find . -type f ! -name '*.pdf' ! -name '_tmp_*' ! -path './.git/*' \
  -exec cp --parents {} C:/dev/magna-carta-worktrees/slice-3-2-trust-jurisdictions/docs/research/trust-rules/ \;
```

- [ ] **Step 3: Write the gitignore**

Create `docs/research/trust-rules/.gitignore`:

```gitignore
# Captured source documents are large; keep the .txt extractions and manifest in git,
# ignore heavy binaries. The original bytes live in the research archive.
sources/**/*.pdf
_tmp_*
```

- [ ] **Step 4: Verify the pipeline still runs and is a fixed point**

The scripts derive their paths from `__file__`, so they work at the new location unchanged.

```bash
cd docs/research/trust-rules/profiles
export PYTHONIOENCODING=utf-8
python pipeline/apply_upgrades.py && python pipeline/collect_med_upgrades.py \
  && python pipeline/resolve_gaps.py && python pipeline/clean_na_labels.py \
  && python pipeline/merge_profiles.py && python build_viewer.py
sha256sum profiles.json
# run the whole chain a second time; the hash must be identical
```

Expected: `field confidence: HIGH=688 MEDIUM=23 LOW=0`, and the two hashes match.

- [ ] **Step 5: Write the active-work note**

Create `docs/active-work/slice-3-2-trust-jurisdictions.md`:

```markdown
# slice-3-2-trust-jurisdictions

**Scope:** the trust jurisdiction-profile schema — vendored research corpus, the
`@magna-carta/trust-jurisdictions` package, and the resolver. No ledger or per-firm code.

**Files expected to touch:**

- `docs/research/trust-rules/**` (new; vendored)
- `packages/trust-jurisdictions/**` (new)
- `docs/specs/2026-07-09-slice-3-2-trust-jurisdiction-schema-*.md`
- fragments: `changelog.d/`, `docs/decisions/pending/`, `status.d/`
```

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore(trust-rules): vendor the trust-accounting research corpus

A generator cannot read across repos and the cloud build would never see it.
Track the corpus and ignore only the PDFs, whose original bytes stay in the
research archive. The pipeline derives its paths from __file__ and runs
unchanged at the new location; verified a full run is still a fixed point."
```

---

### Task 2: Split `extract/` into 56 per-jurisdiction files

The four batch files are an artifact of the original research batching and are where parallel research collides. `merge_profiles.py` and the two upgrade collectors all hardcode the same `BATCHES` list.

**Files:**

- Create: `docs/research/trust-rules/profiles/extract/US-*.json` (56)
- Delete: `docs/research/trust-rules/profiles/extract/batch-*.json` (4)
- Create: `docs/research/trust-rules/profiles/pipeline/batches.py`
- Modify: `pipeline/merge_profiles.py`, `pipeline/apply_upgrades.py`, `pipeline/collect_med_upgrades.py`, `pipeline/resolve_gaps.py`, `pipeline/clean_na_labels.py`, `pipeline/reclassify_na.py`

**Interfaces:**

- Produces: `pipeline/batches.py` exporting `extract_files() -> list[str]` and `load_all() -> dict[str, dict]`, used by every pipeline script.

- [ ] **Step 1: Write the shared loader**

Create `docs/research/trust-rules/profiles/pipeline/batches.py`:

```python
"""One home for locating the per-jurisdiction extract files.

The corpus was originally four batch files named for alphabetical spans. That grouping
carried no meaning and made every parallel research pass collide on the same four files.
One file per jurisdiction is the unit research is actually produced in.
"""
import glob, json, os

EXTRACT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "extract")


def extract_files() -> list[str]:
    """Every per-jurisdiction extract file, in stable jurisdiction order."""
    return sorted(glob.glob(os.path.join(EXTRACT, "US-*.json")))


def load_all() -> dict[str, dict]:
    """jurisdictionCode -> profile dict, loaded from the per-jurisdiction files."""
    return {
        os.path.splitext(os.path.basename(path))[0]: json.load(open(path, encoding="utf-8"))
        for path in extract_files()
    }


def save(code: str, profile: dict) -> None:
    """Write one jurisdiction back, preserving the corpus's indent and unicode."""
    path = os.path.join(EXTRACT, f"{code}.json")
    json.dump(profile, open(path, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
```

- [ ] **Step 2: Write the one-time splitter and run it**

Create `docs/research/trust-rules/profiles/pipeline/split_extract.py`:

```python
"""One-time migration: four batch files -> one file per jurisdiction. Idempotent; safe to re-run."""
import json, os, glob

EXTRACT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "extract")
BATCHES = ["batch-al-in.json", "batch-ia-nv.json", "batch-nh-tn.json", "batch-tx-territories.json"]

written = 0
for name in BATCHES:
    path = os.path.join(EXTRACT, name)
    if not os.path.exists(path):
        continue
    for profile in json.load(open(path, encoding="utf-8")):
        out = os.path.join(EXTRACT, f"{profile['code']}.json")
        json.dump(profile, open(out, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
        written += 1
    os.remove(path)
print(f"wrote {written} per-jurisdiction files; {len(glob.glob(os.path.join(EXTRACT, 'US-*.json')))} total")
```

Run it:

```bash
cd docs/research/trust-rules/profiles && PYTHONIOENCODING=utf-8 python pipeline/split_extract.py
```

Expected: `wrote 55 per-jurisdiction files; 55 total` (Nevada lives in the base `profiles.json`, not in a batch).

- [ ] **Step 3: Point every pipeline script at the loader**

In each of `merge_profiles.py`, `apply_upgrades.py`, `collect_med_upgrades.py`, `resolve_gaps.py`, `clean_na_labels.py`, `reclassify_na.py`: delete the `BATCHES = [...]` constant and the `arrs[fn]` load/save loops, and use `batches.load_all()` / `batches.save(code, profile)` instead. Each script already keys work by `code`; the change is mechanical.

For example, in `clean_na_labels.py`, replace the body of `main()`'s file loop:

```python
    from . import batches  # if run as a module; otherwise: import batches
    profiles = batches.load_all()
    for code, prof in profiles.items():
        for key, cell in prof["values"].items():
            ...  # unchanged
    for code, prof in profiles.items():
        batches.save(code, prof)
```

- [ ] **Step 4: Verify the pipeline is unchanged and still a fixed point**

```bash
cd docs/research/trust-rules/profiles && export PYTHONIOENCODING=utf-8
sha256sum profiles.json > /tmp/before.sha
python pipeline/apply_upgrades.py && python pipeline/collect_med_upgrades.py \
  && python pipeline/resolve_gaps.py && python pipeline/clean_na_labels.py \
  && python pipeline/merge_profiles.py
sha256sum -c /tmp/before.sha
```

Expected: `profiles.json: OK`. The split must not change one byte of the dataset.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor(trust-rules): one extract file per jurisdiction

The four batch files were named for alphabetical spans that carried no meaning
and made every parallel research pass collide on the same four files. Research is
produced one jurisdiction at a time; store it that way. Verified profiles.json is
byte-identical after the split."
```

---

### Task 3: Package scaffold and the type contract

**Files:**

- Create: `packages/trust-jurisdictions/package.json`
- Create: `packages/trust-jurisdictions/tsconfig.json`
- Create: `packages/trust-jurisdictions/vitest.config.ts`
- Create: `packages/trust-jurisdictions/src/types.ts`
- Create: `packages/trust-jurisdictions/test/types.test.ts`
- Modify: `packages/trust-jurisdictions/tsconfig.build.json` (generated by `tooling/tsconfig-refs`)

**Interfaces:**

- Produces: everything in `src/types.ts` — `Confidence`, `MediumKind`, `SourceTier`, `Provenance`, `TypedField<T>`, `ProseField`, `RecordsRetention`, `Reconciliation`, `ProhibitedMethod`, `InterestOnLawyerTrustAccount`, `InterestThreshold`, `UnclaimedFundsDestination`, `UnclaimedFunds`, `OverdraftProgram`, `AnnualCompliance`, `ProcessorFees`, `GoodFunds`, `DisputedFreeze`, `JurisdictionProfile`.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "@magna-carta/trust-jurisdictions",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "sideEffects": false,
  "exports": {
    "./types": "./src/types.ts",
    "./registry": "./src/registry.generated.ts",
    "./resolve": "./src/resolve.ts",
    "./baseline": "./src/baseline.ts"
  },
  "scripts": {
    "test": "vp test run",
    "build:data": "tsx scripts/build-data.mts",
    "verify:data": "tsx scripts/build-data.mts --check"
  },
  "devDependencies": {
    "@magna-carta/tsconfig": "workspace:*",
    "@types/node": "catalog:",
    "tsx": "^4.22.4",
    "vitest": "catalog:"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json` and `vitest.config.ts`**

`tsconfig.json`:

```json
{
  "extends": "../tsconfig/base.json",
  "compilerOptions": {
    "lib": ["ES2022"],
    "types": ["node"],
    "allowImportingTsExtensions": true,
    "noEmit": true
  },
  "include": ["src/**/*.ts", "test/**/*.ts", "scripts/**/*.mts"]
}
```

`vitest.config.ts`:

```typescript
import { defineConfig } from "vite-plus";

// Pure package: default node pool, no Cloudflare Workers runtime.
// root is pinned here so the repo-root `vp test` resolves this project's tests from this package.
export default defineConfig({
  root: import.meta.dirname,
});
```

- [ ] **Step 3: Write `src/types.ts`**

Copy the type model verbatim from the design document's "The type model" section. Note the two comments that must survive review, because they encode why the types are shaped this way:

```typescript
// A field the engine branches on. `value` exists only on HIGH | MEDIUM: a silence has no value
// to read, and a GAP has none to trust. Reading a value the corpus never asserted is therefore a
// type error rather than a runtime bug.
export type TypedField<T> =
  | {
      readonly confidence: "HIGH" | "MEDIUM";
      readonly value: T;
      readonly mediumKind?: MediumKind;
      readonly prose: string;
      readonly provenance: Provenance;
    }
  | {
      readonly confidence: "NOT_ADDRESSED";
      readonly prose: string;
      readonly provenance: Provenance;
    }
  | { readonly confidence: "GAP"; readonly prose: string; readonly provenance: Provenance };
```

`TypedField` has no `LOW` case by construction: a tentative value must never drive a compliance gate.

- [ ] **Step 4: Write the failing type test**

Create `test/types.test.ts`. This asserts the union does its job — that a silence cannot carry a value.

```typescript
import { describe, expect, it } from "vitest";
import type { Reconciliation, TypedField } from "../src/types.ts";

describe("TypedField", () => {
  it("narrows to a value only on HIGH or MEDIUM", () => {
    const silent: TypedField<Reconciliation> = {
      confidence: "NOT_ADDRESSED",
      prose: "Three-way reconciliation not addressed in RPC 1.15 -> resolves to baseline",
      provenance: { citation: "RPC 1.15", sourceTier: "primaryOfficial" },
    };
    // @ts-expect-error a NOT_ADDRESSED field has no `value` to read
    expect(silent.value).toBeUndefined();
  });

  it("carries a value on HIGH", () => {
    const asserted: TypedField<Reconciliation> = {
      confidence: "HIGH",
      value: { required: true, cadence: "monthly", threeWay: true },
      prose: "Monthly three-way reconciliation required",
      provenance: {
        citation: "SCR 217(4)(a)",
        quote:
          "A reconciliation of the check register balance, the subsidiary ledger trial balance total, and the bank statement balance performed on a monthly basis.",
        sourceTier: "primaryOfficial",
      },
    };
    expect(asserted.confidence === "HIGH" && asserted.value.threeWay).toBe(true);
  });
});
```

- [ ] **Step 5: Run the test to verify it fails**

```bash
pnpm --filter @magna-carta/trust-jurisdictions test
```

Expected: FAIL — `Cannot find module '../src/types.ts'` until Step 3's file exists; once it does, the `@ts-expect-error` must be _satisfied_ (the property genuinely does not exist).

- [ ] **Step 6: Register the package and regenerate the type-check graph**

Missing this step is the most common cause of a package silently escaping the type-check gate.

```bash
vp install
node tooling/tsconfig-refs/index.mjs      # regenerates tsconfig.build.json + references
pnpm check
```

Expected: PASS. `pnpm check` runs `tsc -b` over the generated reference graph; a package absent from it is never type-checked.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(trust-jurisdictions): the jurisdiction-profile type contract

TypedField<T> puts `value` only on HIGH | MEDIUM, so reading a value the corpus
never asserted is a type error. There is no LOW case: a tentative value must
never drive a compliance gate."
```

---

### Task 4: The typed overlay — schema, validator, and two hand-authored jurisdictions

The generator must never parse prose into a type; that is the mechanism that mislabelled the corpus in the first place. Typed values are **authored** and **validated**.

**Files:**

- Create: `docs/research/trust-rules/profiles/typed/US-NV.json`
- Create: `docs/research/trust-rules/profiles/typed/US-SC.json`
- Create: `docs/research/trust-rules/profiles/pipeline/validate_typed.py`
- Create: `docs/research/trust-rules/profiles/typed/README.md`

**Interfaces:**

- Consumes: `profiles.json` (Task 1).
- Produces: `profiles/typed/US-*.json`, shape `{"jurisdictionCode": str, "typed": {<field>: <typed value>}}`; and `validate_typed.py`, which exits non-zero on any disagreement.

- [ ] **Step 1: Write the overlay for Nevada**

Every value here is transcribed from prose already in `profiles.json` — never invented. Create `typed/US-NV.json`:

```json
{
  "jurisdictionCode": "US-NV",
  "typed": {
    "retentionYears": { "kind": "years", "years": 7 },
    "reconciliation": { "required": true, "cadence": "monthly", "threeWay": true },
    "prohibitedMethods": ["cashWithdrawal", "checkPayableToCash", "automatedTellerMachine"],
    "goodFunds": { "required": true },
    "disputedFreeze": { "required": true },
    "iolta": {
      "mandatory": true,
      "recipient": "Nevada Bar Foundation",
      "remitCadence": "monthly",
      "comparabilityRateFloor": "0.70%"
    },
    "interestThreshold": { "kind": "lawyerJudgment" },
    "unclaimedFunds": {
      "destination": "clientProtectionFund",
      "dormancy": "P5Y",
      "diligenceRequired": true,
      "reclaimable": false
    },
    "overdraftProgram": {
      "required": true,
      "notifyBody": "State Bar of Nevada Bar Counsel",
      "reportWithinBankingDays": 5
    },
    "processorFees": { "mayChargeClientPrincipal": false },
    "annualCompliance": { "required": true, "cadence": "annual" }
  }
}
```

- [ ] **Step 2: Write the overlay for South Carolina**

South Carolina is the jurisdiction whose mislabel motivated the `GAP` class. `processorFees` is `NOT_ADDRESSED` and therefore must have **no** typed value.

```json
{
  "jurisdictionCode": "US-SC",
  "typed": {
    "retentionYears": { "kind": "years", "years": 6 },
    "reconciliation": { "required": true, "cadence": "monthly", "threeWay": true },
    "prohibitedMethods": [],
    "goodFunds": { "required": true },
    "disputedFreeze": { "required": true },
    "iolta": {
      "mandatory": true,
      "recipient": "South Carolina Bar Foundation",
      "remitCadence": "monthly"
    },
    "interestThreshold": { "kind": "lawyerJudgment" },
    "overdraftProgram": { "required": true, "notifyBody": "Office of Disciplinary Counsel" },
    "annualCompliance": {
      "required": true,
      "cadence": "annual",
      "instrument": "Rule 410 license-fee statement"
    }
  }
}
```

`processorFees` and `unclaimedFunds` are `NOT_ADDRESSED` for South Carolina, so they are absent here. `goodFunds` **is** `HIGH` ("may not disburse commingled trust funds unless deposited and collected") and must be present — omitting it is the mistake `validate_typed.py` exists to catch.

**One content problem to resolve, not paper over.** South Carolina's `prohibitedMethods` prose is _"Lawyer shall not use/pledge entrusted property to obtain credit or personal benefit; no disbursing uncollected funds"_. Neither clause bans a withdrawal **method** — the first is a misuse prohibition and the second belongs to `goodFunds`. The empty array above records "no method ban", which is what the rule actually says. Open a corpus fix so the misfiled prose moves to its right field; do not encode a method ban that does not exist. This is the same class of error as Puerto Rico's `prohibitedMethods` carrying a commingling rule.

- [ ] **Step 3: Write the failing validator**

Create `pipeline/validate_typed.py`:

```python
"""Confidence and the presence of a typed value must agree.

A HIGH or MEDIUM typed field asserts a requirement, so it must carry an authored value.
A NOT_ADDRESSED field is a finding of silence and must carry none -- otherwise a silence
would ship a value the rule never stated. A GAP must not exist at all.

This is the guard that keeps the generator from ever guessing: it validates authored data
rather than parsing prose into a category.
"""
import json, os, sys, glob

PROF = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TYPED_DIR = os.path.join(PROF, "typed")

TYPED_FIELDS = [
    "retentionYears", "reconciliation", "prohibitedMethods", "goodFunds", "disputedFreeze",
    "iolta", "interestThreshold", "unclaimedFunds", "overdraftProgram", "processorFees",
    "annualCompliance",
]
ASSERTED = {"HIGH", "MEDIUM"}


def main() -> int:
    profiles = json.load(open(os.path.join(PROF, "profiles.json"), encoding="utf-8"))["profiles"]
    overlays = {}
    for path in sorted(glob.glob(os.path.join(TYPED_DIR, "US-*.json"))):
        doc = json.load(open(path, encoding="utf-8"))
        overlays[doc["jurisdictionCode"]] = doc.get("typed", {})

    problems = []
    for code, profile in sorted(profiles.items()):
        typed = overlays.get(code)
        if typed is None:
            problems.append(f"{code}: no typed/ overlay file")
            continue
        for field in TYPED_FIELDS:
            confidence = profile["values"][field]["conf"]
            has_value = field in typed
            if confidence == "GAP":
                problems.append(f"{code}.{field}: GAP must be researched, never shipped")
            elif confidence in ASSERTED and not has_value:
                problems.append(f"{code}.{field}: {confidence} asserts a requirement but no typed value")
            elif confidence not in ASSERTED and has_value:
                problems.append(f"{code}.{field}: {confidence} is a silence but carries a typed value")
        for field in typed:
            if field not in TYPED_FIELDS:
                problems.append(f"{code}.{field}: not a typed field")

    for problem in problems:
        print("  !!", problem)
    covered = len(overlays)
    print(f"\n{covered}/56 overlays; {len(problems)} problems")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 4: Run it to verify it fails**

```bash
cd docs/research/trust-rules/profiles && PYTHONIOENCODING=utf-8 python pipeline/validate_typed.py
```

Expected: exit 1, listing `no typed/ overlay file` for the 54 jurisdictions not yet authored, and **zero** problems for `US-NV` and `US-SC`. If either of those two reports a problem, the hand-authored overlay disagrees with the dataset — fix the overlay, not the validator.

- [ ] **Step 5: Author `mediumKind` for the 23 MEDIUM cells**

No cell in the corpus carries `mediumKind` today (0 of 896), yet the validator and generator both require it on every `MEDIUM`. Without it a permanent judgment-standard is indistinguishable from a research backlog item, and someone will spend a week trying to promote a rule that delegates the call to the lawyer by design.

Create `docs/research/trust-rules/profiles/medium_kind.json`. The classification is settled — 13 `secondarySource`, 6 `judgmentStandard`, 4 `noEnumeration`:

```json
{
  "US-ID.requiredRecords": "noEnumeration",
  "US-NE.requiredRecords": "noEnumeration",
  "US-OK.requiredRecords": "noEnumeration",
  "US-WV.requiredRecords": "noEnumeration",

  "US-KY.processorFees": "judgmentStandard",
  "US-LA.processorFees": "judgmentStandard",
  "US-VA.processorFees": "judgmentStandard",
  "US-ME.interestThreshold": "judgmentStandard",
  "US-NJ.interestThreshold": "judgmentStandard",
  "US-RI.interestThreshold": "judgmentStandard",

  "US-AL.unclaimedFunds": "secondarySource",
  "US-IL.processorFees": "secondarySource",
  "US-KS.processorFees": "secondarySource",
  "US-KY.reconciliation": "secondarySource",
  "US-NE.reconciliation": "secondarySource",
  "US-NE.processorFees": "secondarySource",
  "US-NE.goodFunds": "secondarySource",
  "US-NC.processorFees": "secondarySource",
  "US-ND.requiredRecords": "secondarySource",
  "US-OK.annualCompliance": "secondarySource",
  "US-VA.annualCompliance": "secondarySource",
  "US-WI.reconciliation": "secondarySource",
  "US-VI.annualCompliance": "secondarySource"
}
```

Create `pipeline/apply_medium_kind.py` to stamp it onto the extract cells:

```python
"""Stamp mediumKind onto every MEDIUM cell.

A MEDIUM is medium for one of three reasons, and two of them are terminal. `secondarySource`
means a handbook or ethics opinion carries the value while the black-letter is quiet -- more
research promotes it. `judgmentStandard` means the rule delegates the call to the lawyer
("nominal or short-term ... in the sound judgment of the lawyer"); no research promotes that.
`noEnumeration` means the rule says "complete records" and declines to list them; the refusal
IS the finding. Without this distinction the permanent ones generate research tickets forever.
"""
import json, os, sys
import batches

PROF = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
KINDS = json.load(open(os.path.join(PROF, "medium_kind.json"), encoding="utf-8"))
VALID = {"secondarySource", "judgmentStandard", "noEnumeration"}

profiles = batches.load_all()
stamped, missing = 0, []
for code, prof in profiles.items():
    for field, cell in prof["values"].items():
        if cell.get("conf") != "MEDIUM":
            cell.pop("mediumKind", None)
            continue
        kind = KINDS.get(f"{code}.{field}")
        if kind not in VALID:
            missing.append(f"{code}.{field}")
            continue
        cell["mediumKind"] = kind
        stamped += 1
    batches.save(code, prof)

for m in missing:
    print("  !! no mediumKind for", m)
print(f"stamped {stamped} MEDIUM cells; {len(missing)} missing")
sys.exit(1 if missing else 0)
```

Run it, then re-run `merge_profiles.py`. Insert `apply_medium_kind.py` into the pipeline **after** `collect_med_upgrades.py` and before `merge_profiles.py`. Note Nevada lives in the base `profiles.json` rather than in `extract/`; it has no MEDIUM cells, so it needs no stamp.

Expected: `stamped 23 MEDIUM cells; 0 missing`. Verify the pipeline remains a fixed point.

- [ ] **Step 6: Document the overlay format**

Create `typed/README.md`:

```markdown
# Typed overlay

One file per jurisdiction. Each value is **transcribed** from that field's prose and verbatim
quote in `../profiles.json` — never inferred, never guessed from a rule number.

A field appears here if and only if its confidence in `profiles.json` is `HIGH` or `MEDIUM`.
A `NOT_ADDRESSED` field is a finding of silence: it resolves to its bucket's baseline and must
carry no value. A `GAP` must be researched before it can ship.

Run `python pipeline/validate_typed.py` after any edit. It fails on any disagreement.
```

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(trust-rules): authored typed overlay with a confidence-agreement guard

The generator must never reduce 56 free-text rules to types with a regex; that is
what mislabelled the corpus. Typed values are transcribed from the prose and its
verbatim quote, and validate_typed.py fails when confidence and the presence of a
value disagree. Nevada and South Carolina authored by hand as the seed."
```

---

### Task 5: Author the remaining 54 typed overlays

443 of 616 typed cells need a value (mean 7.9 per jurisdiction); the other 173 are `NOT_ADDRESSED` and must have none. This is transcription, not research: every value already exists as verified prose with a quote.

**Files:**

- Create: `docs/research/trust-rules/profiles/typed/US-*.json` (the remaining 54)

**Interfaces:**

- Consumes: `profiles.json`, `validate_typed.py` (Task 4).
- Produces: a complete `typed/` directory; `validate_typed.py` exits 0.

- [ ] **Step 1: Dispatch one subagent per batch of jurisdictions**

Give each subagent strict file ownership (only its own `typed/US-XX.json` files) and this contract:

> For each assigned jurisdiction, read its entry in `docs/research/trust-rules/profiles/profiles.json`.
> For each of the 11 typed fields, if `conf` is `HIGH` or `MEDIUM`, transcribe the prose `v` into the
> typed shape from `packages/trust-jurisdictions/src/types.ts`. If `conf` is `NA`, omit the field entirely.
> **Transcribe only.** If the prose does not state a value the type requires (e.g. a `dormancy` period),
> do not invent one — report the field and leave the jurisdiction's file out. Never consult outside sources.
> Write only `typed/US-XX.json` for your assigned codes.

- [ ] **Step 2: Run the validator**

```bash
cd docs/research/trust-rules/profiles && PYTHONIOENCODING=utf-8 python pipeline/validate_typed.py
```

Expected: `56/56 overlays; 0 problems`, exit 0.

- [ ] **Step 3: Reconcile anything a subagent reported as untranscribable**

A field whose prose cannot fill its type is a genuine finding, and there are exactly two honest resolutions. Either the type is too demanding (e.g. `dormancy` should be optional because some states impose diligence with no fixed period) — in which case relax the type in `src/types.ts` and say why in a comment. Or the prose is thinner than its `HIGH` confidence claims — in which case the confidence is wrong, and the cell needs research, not a guess. **Do not fabricate a value to satisfy a type.**

- [ ] **Step 4: Spot-check three jurisdictions against the dataset**

```bash
cd docs/research/trust-rules/profiles && PYTHONIOENCODING=utf-8 python -c "
import json
for code in ['US-TX', 'US-GU', 'US-VT']:
    typed = json.load(open(f'typed/{code}.json', encoding='utf-8'))['typed']
    print(code, 'overdraftProgram=', json.dumps(typed.get('overdraftProgram')),
          'iolta=', json.dumps(typed.get('iolta')),
          'annualCompliance=', json.dumps(typed.get('annualCompliance')))
"
```

Expected, and these three are the corpus's most easily-lost findings:

- **Texas** `overdraftProgram` is `{"required": false}`. A "no program exists" finding is `HIGH` and carries a value; it is not a silence.
- **Guam** `iolta` is `{"mandatory": false, ...}`. Same shape of finding.
- **Vermont** `annualCompliance` is **absent**, because the field is `NOT_ADDRESSED`: Vermont imposes no _annual_ certification, and its biennial licensing statement lives outside the RPC. A transcriber who writes `{"required": true, "cadence": "biennial"}` here has invented a duty the rule does not impose. The biennial fact survives in the prose and citation, which is where it belongs.

The Texas/Guam pair against Vermont is the distinction worth internalizing: **"the rule says there is no program" is a value; "the rule says nothing" is a silence.**

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(trust-rules): typed overlays for all 56 jurisdictions

443 typed values transcribed from verified prose; the 173 NOT_ADDRESSED cells
carry none. validate_typed.py green."
```

---

### Task 6: The generator

**Files:**

- Create: `packages/trust-jurisdictions/scripts/build-data.mts`
- Create: `docs/research/trust-rules/profiles/attorney-review.json` (initially `{}`)
- Create: `packages/trust-jurisdictions/src/data/US-*.generated.ts` (56, generated)
- Create: `packages/trust-jurisdictions/src/registry.generated.ts` (generated)
- Create: `packages/trust-jurisdictions/test/generator.test.ts`

**Interfaces:**

- Consumes: `profiles.json`, `typed/US-*.json`, `src/types.ts`.
- Produces: `src/registry.generated.ts` exporting `PROFILES: ReadonlyMap<string, JurisdictionProfile>` and `profileFor(jurisdictionCode: string): JurisdictionProfile | undefined`.

- [ ] **Step 1: Write the failing generator test**

Create `test/generator.test.ts`. Test the pure render/validate functions, not the filesystem.

```typescript
import { describe, expect, it } from "vitest";
import { validateCell } from "../scripts/build-data.mts";

const provenance = { cite: "RPC 1.15", quote: "...", tier: "primary-official" };

describe("validateCell", () => {
  it("rejects a HIGH field with no authored typed value", () => {
    expect(() =>
      validateCell(
        "US-XX",
        "reconciliation",
        { conf: "HIGH", v: "monthly", ...provenance },
        undefined,
      ),
    ).toThrow(/HIGH asserts a requirement but no typed value/);
  });

  it("rejects a NOT_ADDRESSED field that carries a typed value", () => {
    expect(() =>
      validateCell(
        "US-XX",
        "goodFunds",
        { conf: "NA", v: "not addressed", cite: "RPC 1.15" },
        { required: true },
      ),
    ).toThrow(/silence but carries a typed value/);
  });

  it("rejects a GAP outright", () => {
    expect(() =>
      validateCell(
        "US-XX",
        "iolta",
        { conf: "GAP", v: "unresearched", cite: "Rule 412" },
        undefined,
      ),
    ).toThrow(/GAP must be researched, never shipped/);
  });

  it("rejects a LOW typed field", () => {
    expect(() =>
      validateCell("US-XX", "iolta", { conf: "LOW", v: "maybe", cite: "?" }, { mandatory: true }),
    ).toThrow(/LOW must never drive a compliance gate/);
  });

  it("rejects a MEDIUM with no mediumKind", () => {
    expect(() =>
      validateCell(
        "US-XX",
        "processorFees",
        { conf: "MEDIUM", v: "x", ...provenance },
        { mayChargeClientPrincipal: false },
      ),
    ).toThrow(/MEDIUM without a mediumKind/);
  });

  it("accepts a HIGH field with a typed value and a quote", () => {
    expect(() =>
      validateCell(
        "US-NV",
        "goodFunds",
        { conf: "HIGH", v: "required", ...provenance },
        { required: true },
      ),
    ).not.toThrow();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
pnpm --filter @magna-carta/trust-jurisdictions test generator
```

Expected: FAIL — `Cannot find module '../scripts/build-data.mts'`.

- [ ] **Step 3: Write the generator**

Create `scripts/build-data.mts`. Mirror `packages/wellbeing-resources/scripts/build-data.mts` for the `toTsLiteral` / `formatWithOxfmt` / `--check` machinery — read it first and reuse its shape rather than reinventing. New in this generator is `validateCell` and the per-jurisdiction emit.

```typescript
// @generated-by: nothing. This script is hand-authored; it GENERATES src/data/*.
// Emits one module per jurisdiction from the research corpus. It validates authored data and
// never parses prose into a type: reducing 56 free-text rules to categories with a regex is
// what mislabelled the corpus, and a wrong type silently drives a compliance gate.

const CONFIDENCE_FROM_CORPUS: Record<string, string> = {
  HIGH: "HIGH",
  MEDIUM: "MEDIUM",
  LOW: "LOW",
  NA: "NOT_ADDRESSED",
  GAP: "GAP",
};
const TIER_FROM_CORPUS: Record<string, string> = {
  "primary-official": "primaryOfficial",
  corroborated: "corroborated",
  secondary: "secondary",
  "by-reference": "byReference",
};

// The corpus abbreviates; the package spells names out in full. This map is the only place the
// two vocabularies meet. `note` and `noteCite` are research history and are never emitted.
const FIELD_FROM_CORPUS: Record<string, string> = {
  retentionYears: "recordsRetention",
  reconciliation: "reconciliation",
  prohibitedMethods: "prohibitedMethods",
  goodFunds: "goodFunds",
  disputedFreeze: "disputedFreeze",
  iolta: "interestOnLawyerTrustAccount",
  interestThreshold: "interestThreshold",
  unclaimedFunds: "unclaimedFunds",
  overdraftProgram: "overdraftProgram",
  processorFees: "processorFees",
  annualCompliance: "annualCompliance",
};
const INVARIANT_FIELDS = ["segregation", "advancesInTrust", "firmFundsForCharges"] as const;
const PROSE_FIELDS = ["requiredRecords"] as const;

// No jurisdiction has been through attorney review yet. The generator emits null and preserves
// any existing attestation on regeneration, so a review is never silently discarded when the
// corpus changes. Sign-off is recorded per jurisdiction in profiles/attorney-review.json.
function attorneyReviewFor(jurisdictionCode: string): unknown {
  return REVIEWS[jurisdictionCode] ?? null;
}

interface RawCell {
  v: string;
  conf: string;
  cite?: string;
  quote?: string;
  url?: string;
  tier?: string;
  mediumKind?: string;
}

export function validateCell(
  jurisdictionCode: string,
  field: string,
  cell: RawCell,
  typedValue: unknown,
): void {
  const where = `${jurisdictionCode}.${field}`;
  const asserted = cell.conf === "HIGH" || cell.conf === "MEDIUM";
  if (cell.conf === "GAP") throw new Error(`${where}: GAP must be researched, never shipped`);
  if (cell.conf === "LOW") throw new Error(`${where}: LOW must never drive a compliance gate`);
  if (asserted && typedValue === undefined)
    throw new Error(`${where}: ${cell.conf} asserts a requirement but no typed value`);
  if (!asserted && typedValue !== undefined)
    throw new Error(`${where}: ${cell.conf} is a silence but carries a typed value`);
  if (cell.conf === "MEDIUM" && !cell.mediumKind)
    throw new Error(
      `${where}: MEDIUM without a mediumKind — a permanent judgment standard must be distinguishable from a research backlog item`,
    );
  if (cell.conf === "MEDIUM" && !cell.quote?.trim())
    throw new Error(`${where}: MEDIUM without a verbatim quote`);
  // The same guard for HIGH becomes a hard failure once provenance is backfilled to all 896 cells.
  if (cell.conf === "HIGH" && !cell.quote?.trim())
    console.warn(`  warn ${where}: HIGH without a verbatim quote`);
}
```

`REVIEWS` is loaded from the corpus alongside the profiles; create `profiles/attorney-review.json` containing `{}` so no jurisdiction claims a review it has not had:

```typescript
const REVIEW_URL = new URL(
  "../../../docs/research/trust-rules/profiles/attorney-review.json",
  import.meta.url,
);
const REVIEWS = JSON.parse(readFileSync(REVIEW_URL, "utf8")) as Record<
  string,
  { reviewedBy: string; reviewedOn: string }
>;
```

Emit one module per jurisdiction, each with the `@generated` header:

```typescript
// @generated by scripts/build-data.mts from docs/research/trust-rules/profiles/profiles.json
// and profiles/typed/US-NV.json. Do NOT edit by hand.
import type { JurisdictionProfile } from "../types.ts";
export const US_NV: JurisdictionProfile = {
  jurisdictionCode: "US-NV",
  name: "Nevada",
  sourceDocument: {/* ... */},
  attorneyReview: null,
  typed: {/* ... */},
  invariant: {/* ... */},
  prose: {/* ... */},
};
```

And the registry:

```typescript
// @generated by scripts/build-data.mts. Do NOT edit by hand.
import { US_AK } from "./data/US-AK.generated.ts";
// ... 55 more
import type { JurisdictionProfile } from "./types.ts";

export const PROFILES: ReadonlyMap<string, JurisdictionProfile> = new Map([
  ["US-AK", US_AK],
  // ...
]);

// A jurisdiction's trust-accounting profile, or undefined when the code is unknown.
export function profileFor(jurisdictionCode: string): JurisdictionProfile | undefined {
  return PROFILES.get(jurisdictionCode.trim().toUpperCase());
}
```

- [ ] **Step 4: Run the tests, then generate**

```bash
pnpm --filter @magna-carta/trust-jurisdictions test generator     # expect PASS
pnpm --filter @magna-carta/trust-jurisdictions run build:data
```

Expected: `wrote 56 jurisdiction modules + registry`, plus `warn ...: HIGH without a verbatim quote` for the cells awaiting the provenance backfill. Zero thrown errors.

- [ ] **Step 5: Verify the drift guard**

```bash
pnpm --filter @magna-carta/trust-jurisdictions run verify:data     # expect: in sync, exit 0
# now prove it catches drift:
sed -i 's/years: 7/years: 6/' src/data/US-NV.generated.ts
pnpm --filter @magna-carta/trust-jurisdictions run verify:data     # expect: exit 1, "out of sync"
git checkout -- src/data/US-NV.generated.ts
```

- [ ] **Step 6: `pnpm check` and commit**

```bash
pnpm check
git add -A
git commit -m "feat(trust-jurisdictions): generate 56 profile modules from the corpus

The generator validates authored data and never parses prose into a type. It
refuses to emit a GAP, a LOW typed field, a MEDIUM without a mediumKind or quote,
or any disagreement between confidence and the presence of a value."
```

---

### Task 7: Baseline and resolution

**Files:**

- Create: `packages/trust-jurisdictions/src/baseline.ts`
- Create: `packages/trust-jurisdictions/src/resolve.ts`
- Create: `packages/trust-jurisdictions/test/resolve.test.ts`

**Interfaces:**

- Consumes: `src/types.ts`, `src/registry.generated.ts`.
- Produces: `resolveTrustRequirements(profile: JurisdictionProfile, firmSettings: FirmTrustSettings): ResolvedTrustRequirements`, and `GapError`.

- [ ] **Step 1: Write the failing resolver test**

Create `test/resolve.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { profileFor } from "../src/registry.generated.ts";
import { GapError, resolveTrustRequirements } from "../src/resolve.ts";

const noFirmOverrides = { additionalProhibitedMethods: [] as const };

describe("bucket asymmetry", () => {
  it("resolves a rigor silence to the strict default (over-complying is safe)", () => {
    const utah = profileFor("US-UT")!; // goodFunds is NOT_ADDRESSED
    const resolved = resolveTrustRequirements(utah, noFirmOverrides);
    expect(resolved.goodFunds.value.required).toBe(true);
    expect(resolved.goodFunds.source).toBe("baseline");
    expect(resolved.goodFunds.binding).toBe(true);
  });

  it("resolves a restriction silence to OFF (a firm is not restricted by a rule that is silent)", () => {
    const utah = profileFor("US-UT")!; // prohibitedMethods is NOT_ADDRESSED
    const resolved = resolveTrustRequirements(utah, noFirmOverrides);
    expect(resolved.prohibitedMethods.value).toEqual([]);
    expect(resolved.prohibitedMethods.source).toBe("baseline");
  });

  it("resolves an unclaimedFunds silence to escheat, not to the empty ABA baseline", () => {
    const utah = profileFor("US-UT")!; // unclaimedFunds is NOT_ADDRESSED
    const resolved = resolveTrustRequirements(utah, noFirmOverrides);
    expect(resolved.unclaimedFunds.value.destination).toBe("escheatToStateTreasurer");
  });
});

describe("GAP", () => {
  it("throws rather than resolving to baseline", () => {
    const fabricated = {
      ...profileFor("US-NV")!,
      typed: {
        ...profileFor("US-NV")!.typed,
        iolta: {
          confidence: "GAP" as const,
          prose: "unresearched",
          provenance: { citation: "Rule 412", sourceTier: "primaryOfficial" as const },
        },
      },
    };
    expect(() => resolveTrustRequirements(fabricated, noFirmOverrides)).toThrow(GapError);
  });
});

describe("judgment standards are advisory", () => {
  it("marks a lawyerJudgment interestThreshold non-binding", () => {
    const rhodeIsland = profileFor("US-RI")!;
    const resolved = resolveTrustRequirements(rhodeIsland, noFirmOverrides);
    expect(resolved.interestThreshold.binding).toBe(false);
    expect(resolved.interestThreshold.provenance.citation).toBeTruthy();
  });

  it("marks Maryland's $50 net-interest test binding", () => {
    const maryland = profileFor("US-MD")!;
    const resolved = resolveTrustRequirements(maryland, noFirmOverrides);
    expect(resolved.interestThreshold.binding).toBe(true);
    expect(resolved.interestThreshold.value).toEqual({
      kind: "netInterestTest",
      amountMinor: 5000,
      currency: "USD",
    });
  });
});

describe("firm overlay", () => {
  it("lets a firm add a restriction its jurisdiction does not impose", () => {
    const texas = profileFor("US-TX")!;
    const resolved = resolveTrustRequirements(texas, {
      additionalProhibitedMethods: ["debitCard"],
    });
    expect(resolved.prohibitedMethods.value).toContain("debitCard");
  });

  it("does not let a firm remove a restriction the jurisdiction imposes", () => {
    const louisiana = profileFor("US-LA")!; // bans ATM, debit, cash, checks-to-Cash
    const resolved = resolveTrustRequirements(louisiana, { additionalProhibitedMethods: [] });
    expect(resolved.prohibitedMethods.value).toContain("automatedTellerMachine");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
pnpm --filter @magna-carta/trust-jurisdictions test resolve
```

Expected: FAIL — `Cannot find module '../src/resolve.ts'`.

- [ ] **Step 3: Write `src/baseline.ts`**

```typescript
import type {
  GoodFunds,
  ProhibitedMethod,
  Reconciliation,
  RecordsRetention,
  UnclaimedFunds,
} from "./types.ts";

// What a field resolves to when the jurisdiction's rule is silent about it.
//
// The three buckets fail in different directions, so they carry different defaults:
//   rigor       -> the strictest observed value. A wrong silence over-complies, which is safe.
//   restriction -> off. A firm is not restricted by a rule that says nothing.
//   data        -> the ABA Model Rule value.
//
// unclaimedFunds is the one place the ABA baseline is useless: the Model Rule is silent on
// unclaimed funds, so "resolve to ABA" resolves to nothing. Unclaimed money always goes
// somewhere. 20 of the 30 researched jurisdictions escheat it to the state treasurer under
// their unclaimed-property act, and Connecticut and Iowa were confirmed to do so from the
// statutes themselves. Escheat is therefore the baseline, and the ten jurisdictions that
// remit to a bar foundation, client-protection fund, access-to-justice foundation, or the
// court clerk carry an explicit value that overrides it.
export const UNCLAIMED_FUNDS_BASELINE: UnclaimedFunds = {
  destination: "escheatToStateTreasurer",
  dormancy: "P3Y", // the most common dormancy across the researched escheat states
  diligenceRequired: true,
  reclaimable: true, // unclaimed-property acts let an owner reclaim from the state
};

// Retention default is indefinite; a jurisdiction's number is a purge-FLOOR, never a deletion
// trigger. Floors span 5-8 years across the corpus, so this satisfies all 56.
export const RECORDS_RETENTION_BASELINE: RecordsRetention = { kind: "years", years: 8 };

export const RECONCILIATION_BASELINE: Reconciliation = {
  required: true,
  cadence: "monthly",
  threeWay: true,
};
export const GOOD_FUNDS_BASELINE: GoodFunds = { required: true };
export const PROHIBITED_METHODS_BASELINE: readonly ProhibitedMethod[] = [];
```

- [ ] **Step 4: Write `src/resolve.ts`**

```typescript
import * as baseline from "./baseline.ts";
import type {
  JurisdictionProfile,
  MediumKind,
  ProhibitedMethod,
  Provenance,
  TypedField,
} from "./types.ts";

export interface FirmTrustSettings {
  // A firm may be stricter than its jurisdiction, never looser. A settings bug therefore
  // cannot create an ethics violation.
  readonly additionalProhibitedMethods: readonly ProhibitedMethod[];
}

export interface ResolvedRequirement<T> {
  readonly value: T;
  readonly binding: boolean;
  readonly confidence: string;
  readonly mediumKind?: MediumKind;
  readonly source: "jurisdiction" | "baseline" | "invariant";
  readonly provenance: Provenance;
}

// A field whose requirement lives in a companion rule the corpus never captured. It must never
// resolve: resolving it to the baseline is how a South Carolina firm would be told that IOLTA
// participation is optional when Rule 412 makes it mandatory.
export class GapError extends Error {
  constructor(
    readonly jurisdictionCode: string,
    readonly field: string,
  ) {
    super(
      `${jurisdictionCode}.${field}: requirement exists in an uncaptured companion rule; research it before resolving`,
    );
    this.name = "GapError";
  }
}

function resolveField<T>(
  jurisdictionCode: string,
  field: string,
  typed: TypedField<T>,
  fallback: T,
): ResolvedRequirement<T> {
  if (typed.confidence === "GAP") throw new GapError(jurisdictionCode, field);
  if (typed.confidence === "NOT_ADDRESSED") {
    return {
      value: fallback,
      binding: true,
      confidence: typed.confidence,
      source: "baseline",
      provenance: typed.provenance,
    };
  }
  // A judgmentStandard is the rule delegating the call to the lawyer. The engine must not
  // pretend to make it: surface the standard and ask. Nothing else is advisory.
  const binding = !(typed.confidence === "MEDIUM" && typed.mediumKind === "judgmentStandard");
  return {
    value: typed.value,
    binding,
    confidence: typed.confidence,
    mediumKind: typed.mediumKind,
    source: "jurisdiction",
    provenance: typed.provenance,
  };
}

export function resolveTrustRequirements(
  profile: JurisdictionProfile,
  firmSettings: FirmTrustSettings,
) {
  const code = profile.jurisdictionCode;
  const t = profile.typed;

  const jurisdictionMethods = resolveField(
    code,
    "prohibitedMethods",
    t.prohibitedMethods,
    baseline.PROHIBITED_METHODS_BASELINE,
  );
  const prohibitedMethods = {
    ...jurisdictionMethods,
    // union, never difference: a firm can add a ban, never lift one
    value: [
      ...new Set([...jurisdictionMethods.value, ...firmSettings.additionalProhibitedMethods]),
    ],
  };

  return {
    recordsRetention: resolveField(
      code,
      "recordsRetention",
      t.recordsRetention,
      baseline.RECORDS_RETENTION_BASELINE,
    ),
    reconciliation: resolveField(
      code,
      "reconciliation",
      t.reconciliation,
      baseline.RECONCILIATION_BASELINE,
    ),
    goodFunds: resolveField(code, "goodFunds", t.goodFunds, baseline.GOOD_FUNDS_BASELINE),
    unclaimedFunds: resolveField(
      code,
      "unclaimedFunds",
      t.unclaimedFunds,
      baseline.UNCLAIMED_FUNDS_BASELINE,
    ),
    prohibitedMethods,
    // ... remaining typed fields resolve identically
  };
}

export type ResolvedTrustRequirements = ReturnType<typeof resolveTrustRequirements>;
```

- [ ] **Step 5: Run the tests**

```bash
pnpm --filter @magna-carta/trust-jurisdictions test resolve
```

Expected: PASS, all cases.

- [ ] **Step 6: Commit**

```bash
pnpm check
git add -A
git commit -m "feat(trust-jurisdictions): bucket-aware resolution with a GAP refusal

Resolution is not one operation. A rigor silence over-complies and is safe; a
restriction silence must be a recorded finding before it turns a ban off; the
unclaimedFunds baseline is escheat, because the ABA Model Rule is silent and
unclaimed money always goes somewhere. A GAP throws. A firm may tighten a
restriction, never loosen one."
```

---

### Task 8: Property and golden tests

**Files:**

- Create: `packages/trust-jurisdictions/test/profiles.property.test.ts`
- Create: `packages/trust-jurisdictions/test/golden.test.ts`

**Interfaces:**

- Consumes: `src/registry.generated.ts`, `src/resolve.ts`.

- [ ] **Step 1: Write the property test**

```typescript
import { describe, expect, it } from "vitest";
import { PROFILES } from "../src/registry.generated.ts";

const TYPED_FIELDS = [
  "recordsRetention",
  "reconciliation",
  "prohibitedMethods",
  "goodFunds",
  "disputedFreeze",
  "interestOnLawyerTrustAccount",
  "interestThreshold",
  "unclaimedFunds",
  "overdraftProgram",
  "processorFees",
  "annualCompliance",
] as const;

describe("every profile", () => {
  it("covers all 56 jurisdictions", () => {
    expect(PROFILES.size).toBe(56);
  });

  it("never carries a value on a silence, nor omits one on an assertion", () => {
    for (const [code, profile] of PROFILES) {
      for (const field of TYPED_FIELDS) {
        const cell = profile.typed[field];
        const asserted = cell.confidence === "HIGH" || cell.confidence === "MEDIUM";
        expect(asserted, `${code}.${field}`).toBe("value" in cell);
      }
    }
  });

  it("never ships a GAP or a LOW typed field", () => {
    for (const [code, profile] of PROFILES)
      for (const field of TYPED_FIELDS)
        expect([code, field, profile.typed[field].confidence]).not.toEqual(
          expect.arrayContaining([expect.stringMatching(/^(GAP|LOW)$/)]),
        );
  });

  it("gives every MEDIUM a mediumKind and a verbatim quote", () => {
    for (const [code, profile] of PROFILES)
      for (const field of TYPED_FIELDS) {
        const cell = profile.typed[field];
        if (cell.confidence !== "MEDIUM") continue;
        expect(cell.mediumKind, `${code}.${field}`).toBeTruthy();
        expect(cell.provenance.quote?.trim(), `${code}.${field}`).toBeTruthy();
      }
  });
});
```

- [ ] **Step 2: Write the golden test**

These pin the findings a regression would silently erase.

```typescript
import { describe, expect, it } from "vitest";
import { profileFor } from "../src/registry.generated.ts";
import { resolveTrustRequirements } from "../src/resolve.ts";

const none = { additionalProhibitedMethods: [] as const };
const resolve = (code: string) => resolveTrustRequirements(profileFor(code)!, none);

describe("golden jurisdictions", () => {
  it("Nevada: 7-year retention, monthly three-way reconciliation", () => {
    const nevada = resolve("US-NV");
    expect(nevada.recordsRetention.value).toEqual({ kind: "years", years: 7 });
    expect(nevada.reconciliation.value).toEqual({
      required: true,
      cadence: "monthly",
      threeWay: true,
    });
  });

  it("South Carolina: IOLTA is mandatory, and says so under Rule 412", () => {
    const carolina = profileFor("US-SC")!.typed.interestOnLawyerTrustAccount;
    expect(carolina.confidence).toBe("HIGH");
    expect(carolina.confidence === "HIGH" && carolina.value.mandatory).toBe(true);
    expect(carolina.provenance.citation).toContain("412");
  });

  it("Texas: no trust-account overdraft-notification program exists", () => {
    const texas = profileFor("US-TX")!.typed.overdraftProgram;
    expect(texas.confidence === "HIGH" && texas.value.required).toBe(false);
  });

  it("Guam: no IOLTA program exists", () => {
    const guam = profileFor("US-GU")!.typed.interestOnLawyerTrustAccount;
    expect(guam.confidence === "HIGH" && guam.value.mandatory).toBe(false);
  });

  it("Vermont: there is NO annual certification; the biennial filing sits outside the rule", () => {
    // The finding is a silence, not a requirement: Vermont's RPC imposes no annual trust/IOLTA
    // certification. Its IOLTA account numbers are reported on a BIENNIAL licensing statement
    // under a separate administrative order. A `required: true, cadence: "annual"` here would
    // invent a duty; a bare `required: false` would lose the biennial fact. So the field is
    // NOT_ADDRESSED and the biennial filing survives in the prose and its citation.
    const vermont = profileFor("US-VT")!.typed.annualCompliance;
    expect(vermont.confidence).toBe("NOT_ADDRESSED");
    expect(vermont.prose).toMatch(/biennial/i);
    expect("value" in vermont).toBe(false);
  });

  it("Louisiana: bans ATM, debit card, cash withdrawal, and checks payable to Cash", () => {
    expect(resolve("US-LA").prohibitedMethods.value).toEqual(
      expect.arrayContaining([
        "automatedTellerMachine",
        "debitCard",
        "cashWithdrawal",
        "checkPayableToCash",
      ]),
    );
  });
});
```

- [ ] **Step 3: Run the full suite**

```bash
pnpm --filter @magna-carta/trust-jurisdictions test
pnpm check
```

Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "test(trust-jurisdictions): property and golden coverage

Golden cases pin the findings a regression would silently erase: Texas has no
overdraft program, Guam has no IOLTA, and Vermont's filing is biennial."
```

---

### Task 9: Documentation, fragments, and the area CLAUDE.md

**Files:**

- Create: `packages/trust-jurisdictions/CLAUDE.md`
- Create: `changelog.d/trust-jurisdictions-schema.md`
- Create: `docs/decisions/pending/trust-jurisdiction-profile-schema.md`
- Create: `status.d/slice-3-2.md`
- Modify: `ROADMAP.md` (the slice 3.2 line only)

- [ ] **Step 1: Write the area `CLAUDE.md`**

```markdown
# @magna-carta/trust-jurisdictions — area rules

Per-jurisdiction trust-accounting rules for 56 US jurisdictions, plus the resolver. Compiled
reference data, like `@magna-carta/wellbeing-resources` — no per-firm or matter scoping. A firm's
enabled restrictions and its trust-account/Location binding live in the per-firm database.

## The data is generated — never hand-edit it

`src/data/US-*.generated.ts` and `src/registry.generated.ts` are built from the research corpus
`docs/research/trust-rules/` (the single source of truth). To change the data:

1. Edit `docs/research/trust-rules/profiles/extract/US-XX.json` (prose + provenance) and/or
   `profiles/typed/US-XX.json` (the typed value), then re-run the pipeline.
2. Run `python pipeline/validate_typed.py` — confidence and the presence of a typed value must agree.
3. Run `pnpm --filter @magna-carta/trust-jurisdictions run build:data`.
4. Commit the regenerated modules alongside the corpus change.

`verify:data` fails if the committed files have drifted from the corpus.

## Model invariants

- **A silence and an absence of research are different things.** `NOT_ADDRESSED` means the rule is
  silent and the field resolves to its bucket's baseline — an answer. `GAP` means the requirement
  lives in a companion rule nobody captured; it never resolves, and the generator refuses to ship it.
- **Resolution is bucket-specific.** A rigor silence over-complies (safe). A restriction silence
  turns a ban off, so it must be a recorded finding. A data silence asserts a fact.
- **`unclaimedFunds` baselines to escheat**, not to the ABA Model Rule, which is silent on it.
- **Retention is a purge-floor, never a deletion trigger.** The app default is indefinite.
- **A firm may be stricter than its jurisdiction, never looser.**
- **Segregation, advances-in-trust, and firm-funds-for-charges are Tier-1 invariants** — enforced
  for every firm regardless of what a jurisdiction permits. Their per-state prose is carried for
  citation only; no code branches on it. This package is the structural owner of
  _fees never touch trust_.
- **A typed field is never `LOW`.** A tentative value must not drive a compliance gate.

## Surface

`./types` (model), `./registry` (`PROFILES`, `profileFor`), `./resolve`
(`resolveTrustRequirements`, `GapError`), `./baseline`. No barrel file (`oxc/no-barrel-file`).
```

- [ ] **Step 2: Write the changelog fragment**

`changelog.d/trust-jurisdictions-schema.md`:

```markdown
### Added

- `@magna-carta/trust-jurisdictions` — typed trust-accounting rules for 56 US jurisdictions,
  generated from a verified research corpus with per-field citations and verbatim quotes. The
  resolver applies each jurisdiction's rules over a baseline, refuses to resolve a requirement
  that has not been researched, and lets a firm tighten a restriction but never loosen one.
```

- [ ] **Step 3: Write the ADR fragment**

`docs/decisions/pending/trust-jurisdiction-profile-schema.md`:

```markdown
# Trust jurisdiction profiles are typed reference data, and a silence is not an absence

**Status:** accepted

**Context.** Trust-accounting rules vary across 56 US jurisdictions. A research corpus captured
them as prose with citations, using one token for both "the rule is silent" and "the requirement
exists in a companion rule we never captured". South Carolina's IOLTA mandate carried the second
while labelled the first; resolving it to the ABA baseline would tell a South Carolina firm that
IOLTA participation is optional.

**Decision.** Ship jurisdiction rules as compiled reference data in a package, one generated module
per jurisdiction so each can carry an attorney's sign-off. Distinguish `NOT_ADDRESSED` (a finding;
resolves to a bucket-specific baseline) from `GAP` (unresearched; never resolves — the resolver
throws and the generator refuses to emit it). Type only the fields the engine branches on: a type
is a claim, and a wrong claim is silent, whereas prose is merely misleading. Author typed values
into the corpus and validate them; never parse prose into a category. Keep firm-scoped choices out
of the package.

**Consequences.** A jurisdiction's rules are auditable end to end — every resolved requirement
carries its citation, verbatim quote, source tier, and confidence. A rule correction is a package
release rather than a migration against every tenant. Rules the corpus never verified cannot reach
a compliance decision at all. The cost is a per-field authoring step and a corpus vendored into the
repo (~18 MB; the source PDFs stay in the research archive).
```

- [ ] **Step 4: Write the status fragment and update ROADMAP**

`status.d/slice-3-2.md`: mark the jurisdiction-profile schema **built**; the ledger-side gates (good-funds on deposit, disputed-funds freeze, matter-close zero-balance, interactive three-way reconciliation) remain open.

In `ROADMAP.md`, update only the slice 3.2 line to note that the jurisdiction-profile engine has landed. Run `vp run worktrees` first — `ROADMAP.md` is a shared file.

- [ ] **Step 5: Final gate and commit**

```bash
pnpm check
vp test
git add -A
git commit -m "docs(trust-jurisdictions): area rules, changelog and decision fragments"
```

---

## What this plan deliberately does not build

- **The ledger side of slice 3.2.** Trust subledgers, the no-negative floor, the good-funds and
  disputed-freeze gates, matter-close zero-balance, and the interactive three-way reconciliation
  consume this package. They are the next plan.
- **Lifting the 13 liftable MEDIUMs.** They are `secondarySource` and resolve correctly today.
- **The provenance backfill.** 144 of 896 cells carry a quote. Until it lands, the generator's
  `HIGH`-quote guard warns rather than fails; promoting it is that work's completion criterion.
- **UI.** The "why does this requirement apply to me" surface consumes `provenance`, which this
  package now carries on every resolved requirement.
