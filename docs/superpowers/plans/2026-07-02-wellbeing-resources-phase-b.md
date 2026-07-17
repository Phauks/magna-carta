# Wellbeing Resources — Phase B Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `@magna-carta/wellbeing-resources` — a typed, tested package that ships the verified Phase-A corpus (56 jurisdictions + national safety net) as compiled reference data, with accessors and a coverage manifest, so the product can surface per-jurisdiction lawyer mental-health resources.

**Architecture:** The validated research corpus `docs/research/wellbeing-resources/profiles.json` is the single source of truth. A generator (`scripts/build-data.mts`) **projects** each research resource into the shipped model (dropping research-only provenance `confidence`/`sourceUrl`/`sourceTier`, folding the 3 "no program" NA placeholders into a `nationalFallbackOnly` jurisdiction flag) and emits `src/data.generated.ts`, typed against `src/types.ts` so bad data fails `pnpm check`. Hand-authored `registry.ts` (accessors) and `manifest.ts` (coverage) sit on top; tests port the corpus invariants to the shipped model. This mirrors `government-links`' shape (types → registry → accessors → manifest → coverage mockup) but generates the data table instead of hand-authoring per-state files — justified by the clean upstream corpus `government-links` never had.

**Tech Stack:** TypeScript (ESM, `.ts` extension imports), Vitest (node pool, via `vp test`), `tsx` for the generator, Oxc for fmt/lint/typecheck (`vp check`). No runtime dependencies — the package is self-contained reference data.

## Global Constraints

- **Package name spelled out in full:** `@magna-carta/wellbeing-resources` (golden rule 12). Type/function names spelled out: `WellbeingResource`, `nationalResources()` — never abbreviations. External terms `fips`, `code`, `url`, `email` are allowed.
- **No barrel file.** `oxc/no-barrel-file` is an **error** in the `lint` block of the root `vite.config.ts`. Do NOT create `src/index.ts`; expose modules through the `package.json` `exports` map, exactly like `government-links`.
- **No process-refs in source.** Source, tests, and generated files carry no `ADR-NNNN`, "spec", "Phase N", "slice N·M", etc. (golden rule 13). Explain reasoning inline or cite a file path. The package `CLAUDE.md` may reference `docs/conventions/` and the research corpus **by path**.
- **Generated file is never hand-edited.** `src/data.generated.ts` carries an `@generated` header; changes flow through the research corpus + `pnpm --filter @magna-carta/wellbeing-resources run build:data`.
- **Generated TS must pass `vp check`** (fmt + lint + typecheck). The serializer emits Oxc/Prettier-shaped output (2-space, double-quoted strings, unquoted identifier keys, trailing commas). If a residual format diff appears, format the file in place with the repo formatter's write mode and re-commit.
- **Provenance discipline (carried from the corpus):** the national safety net (988, SAMHSA, ABA CoLAP) is unconditionally present; `availability: "aroundTheClock"` only where a source stated it; `verifiedOn` is ISO `YYYY-MM-DD`.
- **Docs same commit (golden rule 5):** the final task updates `ROADMAP.md`, the package's `STATUS.md` row, a `changelog.d/` fragment, a `docs/decisions/pending/` fragment, and the `docs/active-work/` note. Never hand-edit `CHANGELOG.md` or the Decision-Log register on a branch.
- **Work happens in the worktree** `C:/dev/magna-carta-worktrees/wellbeing-resources` on branch `wellbeing-resources` (the main working dir is contended). All paths below are repo-relative to that worktree root.

## Model Confirmation (corpus analysis — the Phase B checkpoint)

Audited all 81 resources / 96 phones / 56 jurisdictions in `profiles.json`:

- **Enums match the hypothesis with zero drift.** `operatorType ∈ {stateBar, nonprofit, court, vendor, national}`; `scope ∈ {statewide, metro, national}`; `availability ∈ {aroundTheClock, businessHours, unspecified}` (all three occur); `services` all within the 9-tag union.
- **Field presence:** `name, operator, operatorType, scope, url, phones, services, confidential, cost, description, verifiedOn` present on all 81 → **required** in the shipped model (except `url`, kept optional so a future phone-only resource is valid; the ≥1-contact invariant is what actually guards contactability). `email` on 37 → optional. Phone `number/label/availability` on all 96 → required; `hoursNote` on 63 → optional. `notes` **never appears** → not in the model.
- **Shipped model drops research provenance.** `confidence`, `sourceUrl`, `sourceTier` are curation signals, not product fields; the product wants the clean landing-page `url` (e.g. Iowa's live `iowalap.org`), not the Wayback `sourceUrl`. The generator drops them, keeping `verifiedOn`.
- **NA placeholders → jurisdiction flag.** The 3 `confidence: "NA"` "No dedicated lawyer-assistance program found" entries (PR/AS/MP) become `nationalFallbackOnly: true` + empty `resources` — a cleaner product shape than shipping placeholder resources. `financialAid` stays a service tag (funding programs like ALAF/Waterman/KYLAP Foundation are modeled as ordinary resources carrying that tag) — resolving the spike's open question.
- **Expected shipped counts:** 56 jurisdictions (53 covered + 3 fallback-only), 3 national resources, 75 real jurisdiction resources → **78 total** shipped resources (81 corpus − 3 NA placeholders). All `verifiedOn` = `2026-07-02`.

## File Structure

```
packages/wellbeing-resources/
  package.json            # name, exports map (./types ./registry ./manifest), scripts
  tsconfig.json           # extends ../tsconfig/base.json
  vitest.config.ts        # root pinned to package
  CLAUDE.md               # local rules: generated data, regenerate flow, invariants
  scripts/
    build-data.mts        # profiles.json -> src/data.generated.ts (single source of truth); --check verifies sync
    build-directory-data.mts  # registry -> mockups/directory-data.js (coverage map)
  src/
    types.ts              # model + enums (hand-authored contract)
    data.generated.ts     # GENERATED national + jurisdictions, typed against types.ts
    registry.ts           # accessors over the generated data
    manifest.ts           # coverage manifest derived from the data
  test/
    data.test.ts          # shipped-model invariants (ports validate.py)
    registry.test.ts      # accessors
    manifest.test.ts      # coverage counts
  mockups/
    directory.html        # coverage grid (verify/needs-fix), loads directory-data.js
    directory-data.js     # GENERATED
```

Each file has one responsibility; `data.generated.ts` is the only generated TS in `src/` and is the only file that changes when the corpus changes.

---

### Task 1: Package scaffold + typed model

**Files:**

- Create: `packages/wellbeing-resources/package.json`
- Create: `packages/wellbeing-resources/tsconfig.json`
- Create: `packages/wellbeing-resources/vitest.config.ts`
- Create: `packages/wellbeing-resources/src/types.ts`
- Test: `packages/wellbeing-resources/test/types.test.ts`

**Interfaces:**

- Produces: `OperatorType`, `ResourceScope`, `Availability`, `ServiceTag` (string-literal unions); `Phone`, `WellbeingResource`, `JurisdictionEntry`, `WellbeingDataset` interfaces — consumed by every later task.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "@magna-carta/wellbeing-resources",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "sideEffects": false,
  "exports": {
    "./types": "./src/types.ts",
    "./registry": "./src/registry.ts",
    "./manifest": "./src/manifest.ts"
  },
  "scripts": {
    "test": "vp test run",
    "build:data": "tsx scripts/build-data.mts",
    "verify:data": "tsx scripts/build-data.mts --check",
    "directory": "tsx scripts/build-directory-data.mts && start mockups/directory.html"
  },
  "devDependencies": {
    "@magna-carta/tsconfig": "workspace:*",
    "@types/node": "catalog:",
    "tsx": "^4.22.4",
    "vitest": "catalog:"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

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

- [ ] **Step 3: Create `vitest.config.ts`**

```ts
import { defineConfig } from "vite-plus";

// Pure package: default node pool, no Cloudflare Workers runtime.
// root is pinned here so the repo-root `vp test` resolves this project's tests from this package.
export default defineConfig({
  root: import.meta.dirname,
});
```

- [ ] **Step 4: Create `src/types.ts`**

```ts
// The shipped wellbeing-resources model. Ships the product-relevant subset of the research corpus
// (docs/research/wellbeing-resources/): the research-only provenance fields (confidence, sourceUrl,
// sourceTier) are dropped by the generator; verifiedOn is kept as the freshness signal a product cares
// about. Populated data lives in the generated data.generated.ts; this file is the contract.

// Who runs a resource. Bars run some directly; others are affiliated nonprofits, the courts, an
// outsourced EAP/clinical vendor, or a national program (the safety net).
export type OperatorType = "stateBar" | "nonprofit" | "court" | "vendor" | "national";

// Geographic reach. A jurisdiction can carry statewide programs plus a metro-scoped one; the national
// safety net is "national".
export type ResourceScope = "statewide" | "metro" | "national";

// When a phone line is reachable. "aroundTheClock" is set only where a source literally states 24/7 —
// never inferred; an unstated line is "unspecified".
export type Availability = "aroundTheClock" | "businessHours" | "unspecified";

// What a resource offers.
export type ServiceTag =
  | "counseling"
  | "substanceUse"
  | "mentalHealth"
  | "peerSupport"
  | "crisisLine"
  | "teletherapy"
  | "financialAid"
  | "familySupport"
  | "monitoring";

export interface Phone {
  readonly number: string; // display form, e.g. "800-343-8527"
  readonly label: string; // "Confidential helpline", "Office", "Intake"
  readonly availability: Availability;
  readonly hoursNote?: string; // free text when the hours are nuanced
}

// One mental-health / emotional-support resource available to lawyers in a jurisdiction.
export interface WellbeingResource {
  readonly name: string;
  readonly operator: string;
  readonly operatorType: OperatorType;
  readonly scope: ResourceScope;
  readonly url?: string; // landing page — may sit off the bar's own domain
  readonly email?: string;
  readonly phones: readonly Phone[];
  readonly services: readonly ServiceTag[];
  readonly confidential: string; // short qualifier, e.g. "Confidential by statute"
  readonly cost: string; // "Free" | "Some services free; fees may apply"
  readonly description: string;
  readonly verifiedOn: string; // ISO date the url/phone was last confirmed
}

// A US jurisdiction (state, DC, or territory), keyed by 2-digit FIPS and 2-letter code. A jurisdiction
// with no dedicated program has empty `resources` and `nationalFallbackOnly: true` — it resolves to the
// national safety net by design, which is an answer, not a gap.
export interface JurisdictionEntry {
  readonly fips: string; // 2 digits
  readonly code: string; // 2 uppercase letters
  readonly name: string;
  readonly resources: readonly WellbeingResource[];
  readonly nationalFallbackOnly: boolean;
}

export interface WellbeingDataset {
  readonly national: readonly WellbeingResource[];
  readonly jurisdictions: readonly JurisdictionEntry[];
}
```

- [ ] **Step 5: Create `test/types.test.ts`** (a compile-and-shape smoke test — proves the package resolves and typechecks)

```ts
import { describe, expect, it } from "vitest";
import type { WellbeingResource } from "../src/types.ts";

describe("types", () => {
  it("a WellbeingResource literal satisfies the contract", () => {
    const r: WellbeingResource = {
      name: "Example LAP",
      operator: "Example State Bar",
      operatorType: "stateBar",
      scope: "statewide",
      phones: [{ number: "555-0100", label: "Intake", availability: "unspecified" }],
      services: ["counseling", "peerSupport"],
      confidential: "Confidential",
      cost: "Free",
      description: "Example.",
      verifiedOn: "2026-07-02",
    };
    expect(r.services).toContain("counseling");
  });
});
```

- [ ] **Step 6: Install and run the test to verify the package wires up**

Run: `pnpm install && pnpm --filter @magna-carta/wellbeing-resources test`
Expected: PASS (1 test). If pnpm reports the package is not found, confirm `pnpm-workspace.yaml` globs `packages/*` (it does) and re-run `pnpm install`.

- [ ] **Step 7: Commit**

```bash
git add packages/wellbeing-resources/package.json packages/wellbeing-resources/tsconfig.json packages/wellbeing-resources/vitest.config.ts packages/wellbeing-resources/src/types.ts packages/wellbeing-resources/test/types.test.ts
git commit -m "feat(wellbeing-resources): scaffold package + typed model"
```

---

### Task 2: Data generator + generated data table

**Files:**

- Create: `packages/wellbeing-resources/scripts/build-data.mts`
- Create: `packages/wellbeing-resources/src/data.generated.ts` (written by the generator; commit the output)

**Interfaces:**

- Consumes: `WellbeingResource`, `JurisdictionEntry` from `src/types.ts`; the corpus at `docs/research/wellbeing-resources/profiles.json`.
- Produces: `NATIONAL_RESOURCES: readonly WellbeingResource[]` and `JURISDICTIONS: readonly JurisdictionEntry[]` in `src/data.generated.ts`; and `renderDataModule(profiles)` + a `--check` mode in the generator.

- [ ] **Step 1: Create `scripts/build-data.mts`**

```ts
import { readFileSync, writeFileSync } from "node:fs";

// Generates src/data.generated.ts from the validated research corpus — the single source of truth.
// It projects each research resource into the shipped model: research-only provenance (confidence,
// sourceUrl, sourceTier) is dropped; the "no program" NA placeholders (PR/AS/MP) fold into a
// jurisdiction's `nationalFallbackOnly` flag with empty resources. Run: `pnpm --filter
// @magna-carta/wellbeing-resources run build:data`. With `--check` it re-renders and fails if the
// committed file drifted from the corpus (a CI-friendly sync guard).

const PROFILES_URL = new URL(
  "../../../docs/research/wellbeing-resources/profiles.json",
  import.meta.url,
);
const OUT_URL = new URL("../src/data.generated.ts", import.meta.url);

const HEADER = `// @generated by scripts/build-data.mts from docs/research/wellbeing-resources/profiles.json.
// Do NOT edit by hand. Change the research corpus (docs/research/wellbeing-resources/extract/*.json),
// re-run its pipeline (docs/research/wellbeing-resources/pipeline), then
// \`pnpm --filter @magna-carta/wellbeing-resources run build:data\`.
`;

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

// Serialize a value as an Oxc/Prettier-shaped TS literal: 2-space indent, double-quoted strings,
// unquoted identifier keys, trailing commas on multiline. Keeps the generated file `vp check`-clean.
function toTsLiteral(value: unknown, indent: string): string {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    const inner = `${indent}  `;
    const items = value.map((v) => `${inner}${toTsLiteral(v, inner)}`).join(",\n");
    return `[\n${items},\n${indent}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj);
  if (keys.length === 0) return "{}";
  const inner = `${indent}  `;
  const props = keys
    .map((k) => {
      const key = IDENTIFIER.test(k) ? k : JSON.stringify(k);
      return `${inner}${key}: ${toTsLiteral(obj[k], inner)}`;
    })
    .join(",\n");
  return `{\n${props},\n${indent}}`;
}

interface RawPhone {
  number: string;
  label: string;
  availability: string;
  hoursNote?: string;
}
interface RawResource {
  name: string;
  operator: string;
  operatorType: string;
  scope: string;
  url?: string;
  email?: string;
  phones?: RawPhone[];
  services: string[];
  confidential: string;
  cost: string;
  description: string;
  verifiedOn: string;
  confidence?: string;
}
interface RawJurisdiction {
  fips: string;
  code: string;
  name: string;
  resources?: RawResource[];
}
interface RawProfiles {
  national: RawResource[];
  jurisdictions: Record<string, RawJurisdiction>;
}

// Project a research resource to the shipped shape, emitting optional fields only when present so the
// generated file has a clean, stable diff.
function projectResource(r: RawResource): Record<string, unknown> {
  const out: Record<string, unknown> = {
    name: r.name,
    operator: r.operator,
    operatorType: r.operatorType,
    scope: r.scope,
  };
  if (r.url) out.url = r.url;
  if (r.email) out.email = r.email;
  out.phones = (r.phones ?? []).map((p) => {
    const phone: Record<string, unknown> = {
      number: p.number,
      label: p.label,
      availability: p.availability,
    };
    if (p.hoursNote) phone.hoursNote = p.hoursNote;
    return phone;
  });
  out.services = r.services;
  out.confidential = r.confidential;
  out.cost = r.cost;
  out.description = r.description;
  out.verifiedOn = r.verifiedOn;
  return out;
}

function projectJurisdiction(j: RawJurisdiction): Record<string, unknown> {
  const real = (j.resources ?? []).filter((r) => r.confidence !== "NA");
  return {
    fips: j.fips,
    code: j.code,
    name: j.name,
    resources: real.map(projectResource),
    nationalFallbackOnly: real.length === 0,
  };
}

export function renderDataModule(profiles: RawProfiles): string {
  const national = profiles.national.map(projectResource);
  const jurisdictions = Object.values(profiles.jurisdictions)
    .map(projectJurisdiction)
    .sort((a, b) => String(a.fips).localeCompare(String(b.fips)));
  return (
    `${HEADER}import type { JurisdictionEntry, WellbeingResource } from "./types.ts";\n\n` +
    `export const NATIONAL_RESOURCES: readonly WellbeingResource[] = ${toTsLiteral(national, "")};\n\n` +
    `export const JURISDICTIONS: readonly JurisdictionEntry[] = ${toTsLiteral(jurisdictions, "")};\n`
  );
}

function main(): void {
  const profiles = JSON.parse(readFileSync(PROFILES_URL, "utf8")) as RawProfiles;
  const rendered = renderDataModule(profiles);
  if (process.argv.includes("--check")) {
    const current = readFileSync(OUT_URL, "utf8");
    if (current !== rendered) {
      console.error("data.generated.ts is out of sync with profiles.json — run build:data.");
      process.exit(1);
    }
    console.log("data.generated.ts is in sync with profiles.json.");
    return;
  }
  writeFileSync(OUT_URL, rendered);
  console.log(
    `wrote src/data.generated.ts: ${profiles.national.length} national + ${Object.keys(profiles.jurisdictions).length} jurisdictions`,
  );
}

main();
```

- [ ] **Step 2: Run the generator**

Run: `pnpm --filter @magna-carta/wellbeing-resources run build:data`
Expected: `wrote src/data.generated.ts: 3 national + 56 jurisdictions`

- [ ] **Step 3: Verify the generated file typechecks and is formatter-clean**

Run: `pnpm check`
Expected: PASS. If the formatter reports a diff on `src/data.generated.ts`, format it in place with the repo formatter's write mode (the same Oxc formatter `vp check` runs), re-run `pnpm check` to confirm clean, then re-run `pnpm --filter @magna-carta/wellbeing-resources run verify:data` and, if it now reports drift, align the serializer's output to the formatted form so `build:data` reproduces the committed bytes.
If `pnpm check` reports a **type** error inside `data.generated.ts`, the corpus contains a value outside the model unions — fix the corpus (`extract/*.json` + pipeline), not the generated file.

- [ ] **Step 4: Verify the sync guard works**

Run: `pnpm --filter @magna-carta/wellbeing-resources run verify:data`
Expected: `data.generated.ts is in sync with profiles.json.` (exit 0)

- [ ] **Step 5: Commit**

```bash
git add packages/wellbeing-resources/scripts/build-data.mts packages/wellbeing-resources/src/data.generated.ts
git commit -m "feat(wellbeing-resources): generate shipped data table from the research corpus"
```

---

### Task 3: Registry accessors

**Files:**

- Create: `packages/wellbeing-resources/src/registry.ts`
- Test: `packages/wellbeing-resources/test/registry.test.ts`

**Interfaces:**

- Consumes: `NATIONAL_RESOURCES`, `JURISDICTIONS` from `src/data.generated.ts`; `JurisdictionEntry`, `WellbeingResource` from `src/types.ts`.
- Produces: `nationalResources(): readonly WellbeingResource[]`; `wellbeingResourcesForState(key: string): JurisdictionEntry | undefined`; `allCoveredJurisdictions(): readonly JurisdictionEntry[]`; `isNationalFallbackOnly(entry: JurisdictionEntry): boolean`; re-exports `NATIONAL_RESOURCES`, `JURISDICTIONS`.

- [ ] **Step 1: Write the failing test — `test/registry.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import {
  allCoveredJurisdictions,
  isNationalFallbackOnly,
  nationalResources,
  wellbeingResourcesForState,
} from "../src/registry.ts";

describe("registry accessors", () => {
  it("nationalResources includes the 988 lifeline and is always present", () => {
    const national = nationalResources();
    expect(national.length).toBeGreaterThanOrEqual(3);
    expect(national.some((r) => r.phones.some((p) => p.number === "988"))).toBe(true);
  });

  it("looks up a jurisdiction by 2-digit FIPS, 2-letter code, and lowercase code", () => {
    const byFips = wellbeingResourcesForState("06");
    const byCode = wellbeingResourcesForState("CA");
    const byLower = wellbeingResourcesForState("ca");
    expect(byFips?.name).toBe("California");
    expect(byCode).toBe(byFips);
    expect(byLower).toBe(byFips);
    expect(byFips?.resources.length).toBeGreaterThan(0);
  });

  it("returns undefined for an unknown key", () => {
    expect(wellbeingResourcesForState("99")).toBeUndefined();
    expect(wellbeingResourcesForState("ZZ")).toBeUndefined();
  });

  it("marks a no-program territory as national-fallback-only with no resources", () => {
    const pr = wellbeingResourcesForState("PR");
    expect(pr).toBeDefined();
    expect(pr && isNationalFallbackOnly(pr)).toBe(true);
    expect(pr?.resources).toHaveLength(0);
  });

  it("marks a covered state as not fallback-only", () => {
    const ca = wellbeingResourcesForState("CA");
    expect(ca && isNationalFallbackOnly(ca)).toBe(false);
  });

  it("covers 56 jurisdictions", () => {
    expect(allCoveredJurisdictions()).toHaveLength(56);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @magna-carta/wellbeing-resources test`
Expected: FAIL — cannot resolve `../src/registry.ts`.

- [ ] **Step 3: Write `src/registry.ts`**

```ts
import { JURISDICTIONS, NATIONAL_RESOURCES } from "./data.generated.ts";
import type { JurisdictionEntry, WellbeingResource } from "./types.ts";

// The package's read surface over the generated data table. Data lives in data.generated.ts (built from
// the research corpus); this module is the stable, hand-authored API.
export { JURISDICTIONS, NATIONAL_RESOURCES };

const BY_FIPS: ReadonlyMap<string, JurisdictionEntry> = new Map(
  JURISDICTIONS.map((jurisdiction) => [jurisdiction.fips, jurisdiction]),
);
const BY_CODE: ReadonlyMap<string, JurisdictionEntry> = new Map(
  JURISDICTIONS.map((jurisdiction) => [jurisdiction.code, jurisdiction]),
);

// The national safety net (988, SAMHSA, ABA CoLAP) — returned for every jurisdiction, covered or not,
// so a lawyer anywhere gets a real answer.
export function nationalResources(): readonly WellbeingResource[] {
  return NATIONAL_RESOURCES;
}

// A jurisdiction's wellbeing entry by 2-digit FIPS or 2-letter code (case-insensitive), or undefined
// where the key is unknown (the caller falls back to nationalResources()).
export function wellbeingResourcesForState(key: string): JurisdictionEntry | undefined {
  const normalized = key.trim().toUpperCase();
  return BY_FIPS.get(normalized) ?? BY_CODE.get(normalized);
}

// Every covered jurisdiction, in FIPS order.
export function allCoveredJurisdictions(): readonly JurisdictionEntry[] {
  return JURISDICTIONS;
}

// True when the jurisdiction has no dedicated program and resolves to the national safety net.
export function isNationalFallbackOnly(entry: JurisdictionEntry): boolean {
  return entry.nationalFallbackOnly;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @magna-carta/wellbeing-resources test`
Expected: PASS (registry + types tests).

- [ ] **Step 5: Commit**

```bash
git add packages/wellbeing-resources/src/registry.ts packages/wellbeing-resources/test/registry.test.ts
git commit -m "feat(wellbeing-resources): registry accessors over the data table"
```

---

### Task 4: Shipped-model invariant suite

**Files:**

- Test: `packages/wellbeing-resources/test/data.test.ts`

**Interfaces:**

- Consumes: `NATIONAL_RESOURCES`, `JURISDICTIONS` from `src/registry.ts`. No new production code — this task proves the generated data satisfies the shipped-model invariants (the TS port of `docs/research/wellbeing-resources/pipeline/validate.py`).

- [ ] **Step 1: Write the invariant test — `test/data.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { JURISDICTIONS, NATIONAL_RESOURCES } from "../src/registry.ts";
import type { WellbeingResource } from "../src/types.ts";

const OPERATOR_TYPES = new Set(["stateBar", "nonprofit", "court", "vendor", "national"]);
const SCOPES = new Set(["statewide", "metro", "national"]);
const AVAILABILITY = new Set(["aroundTheClock", "businessHours", "unspecified"]);
const SERVICES = new Set([
  "counseling",
  "substanceUse",
  "mentalHealth",
  "peerSupport",
  "crisisLine",
  "teletherapy",
  "financialAid",
  "familySupport",
  "monitoring",
]);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function checkResource(where: string, r: WellbeingResource): void {
  expect(r.name, `${where}: name`).toBeTruthy();
  expect(r.operator, `${where}: operator`).toBeTruthy();
  expect(OPERATOR_TYPES.has(r.operatorType), `${where}: operatorType ${r.operatorType}`).toBe(true);
  expect(SCOPES.has(r.scope), `${where}: scope ${r.scope}`).toBe(true);
  // Every resource must be contactable: a url or at least one phone.
  expect(Boolean(r.url) || r.phones.length > 0, `${where}: has a contact`).toBe(true);
  for (const p of r.phones) {
    expect(p.number, `${where}: phone number`).toBeTruthy();
    expect(AVAILABILITY.has(p.availability), `${where}: availability ${p.availability}`).toBe(true);
  }
  for (const s of r.services) {
    expect(SERVICES.has(s), `${where}: service ${s}`).toBe(true);
  }
  expect(r.confidential, `${where}: confidential`).toBeTruthy();
  expect(r.cost, `${where}: cost`).toBeTruthy();
  expect(r.description, `${where}: description`).toBeTruthy();
  expect(ISO_DATE.test(r.verifiedOn), `${where}: verifiedOn ${r.verifiedOn}`).toBe(true);
}

describe("national safety net", () => {
  it("is non-empty, all operatorType national, and includes 988", () => {
    expect(NATIONAL_RESOURCES.length).toBeGreaterThan(0);
    for (const [i, r] of NATIONAL_RESOURCES.entries()) {
      expect(r.operatorType, `national[${i}]`).toBe("national");
      checkResource(`national[${i}]`, r);
    }
    expect(NATIONAL_RESOURCES.some((r) => r.phones.some((p) => p.number === "988"))).toBe(true);
  });
});

describe("jurisdictions", () => {
  it("has unique, well-formed FIPS and codes and covers all 50 states + DC", () => {
    const fips = new Set<string>();
    const codes = new Set<string>();
    for (const j of JURISDICTIONS) {
      expect(/^\d{2}$/.test(j.fips), `${j.code}: fips ${j.fips}`).toBe(true);
      expect(/^[A-Z]{2}$/.test(j.code), `${j.code}: code`).toBe(true);
      expect(fips.has(j.fips), `duplicate fips ${j.fips}`).toBe(false);
      expect(codes.has(j.code), `duplicate code ${j.code}`).toBe(false);
      expect(j.name, `${j.code}: name`).toBeTruthy();
      fips.add(j.fips);
      codes.add(j.code);
    }
    const STATES_AND_DC = [
      "AL",
      "AK",
      "AZ",
      "AR",
      "CA",
      "CO",
      "CT",
      "DE",
      "DC",
      "FL",
      "GA",
      "HI",
      "ID",
      "IL",
      "IN",
      "IA",
      "KS",
      "KY",
      "LA",
      "ME",
      "MD",
      "MA",
      "MI",
      "MN",
      "MS",
      "MO",
      "MT",
      "NE",
      "NV",
      "NH",
      "NJ",
      "NM",
      "NY",
      "NC",
      "ND",
      "OH",
      "OK",
      "OR",
      "PA",
      "RI",
      "SC",
      "SD",
      "TN",
      "TX",
      "UT",
      "VT",
      "VA",
      "WA",
      "WV",
      "WI",
      "WY",
    ];
    for (const code of STATES_AND_DC) {
      expect(codes.has(code), `missing ${code}`).toBe(true);
    }
  });

  it("nationalFallbackOnly iff resources are empty; every real resource is valid", () => {
    for (const j of JURISDICTIONS) {
      expect(j.nationalFallbackOnly, `${j.code}: fallback flag matches emptiness`).toBe(
        j.resources.length === 0,
      );
      for (const [i, r] of j.resources.entries()) {
        checkResource(`${j.code}.resources[${i}]`, r);
      }
    }
  });
});
```

- [ ] **Step 2: Run to verify it passes against the generated data**

Run: `pnpm --filter @magna-carta/wellbeing-resources test`
Expected: PASS. A failure here means the generator or corpus is wrong — fix upstream (corpus → `build:data`), not the test.

- [ ] **Step 3: Commit**

```bash
git add packages/wellbeing-resources/test/data.test.ts
git commit -m "test(wellbeing-resources): shipped-model invariant suite"
```

---

### Task 5: Coverage manifest

**Files:**

- Create: `packages/wellbeing-resources/src/manifest.ts`
- Test: `packages/wellbeing-resources/test/manifest.test.ts`

**Interfaces:**

- Consumes: `JURISDICTIONS`, `NATIONAL_RESOURCES` from `src/data.generated.ts`.
- Produces: `CoverageManifest` interface; `coverageManifest(): CoverageManifest`.

- [ ] **Step 1: Write the failing test — `test/manifest.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { coverageManifest } from "../src/manifest.ts";

describe("coverageManifest", () => {
  it("summarizes the shipped data with no drift", () => {
    const m = coverageManifest();
    expect(m.jurisdictions).toBe(56);
    expect(m.nationalFallbackOnly).toBe(3); // PR, AS, MP — no dedicated program
    expect(m.covered).toBe(53);
    expect(m.nationalResources).toBe(3);
    expect(m.totalResources).toBe(78); // 3 national + 75 real jurisdiction resources
    expect(m.newestVerifiedOn).toBe("2026-07-02");
    expect(m.oldestVerifiedOn).toBe("2026-07-02");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @magna-carta/wellbeing-resources test`
Expected: FAIL — cannot resolve `../src/manifest.ts`.

- [ ] **Step 3: Write `src/manifest.ts`**

```ts
import { JURISDICTIONS, NATIONAL_RESOURCES } from "./data.generated.ts";

// A coverage snapshot derived from the shipped data at call time, so it can never drift from the data
// table (unlike a hand-maintained manifest).
export interface CoverageManifest {
  readonly jurisdictions: number; // total covered jurisdictions (states + DC + territories)
  readonly covered: number; // with at least one dedicated resource
  readonly nationalFallbackOnly: number; // no program → resolves to the national safety net
  readonly nationalResources: number;
  readonly totalResources: number; // national + all jurisdiction resources
  readonly newestVerifiedOn: string;
  readonly oldestVerifiedOn: string;
}

export function coverageManifest(): CoverageManifest {
  const verifiedDates = [
    ...NATIONAL_RESOURCES.map((r) => r.verifiedOn),
    ...JURISDICTIONS.flatMap((j) => j.resources.map((r) => r.verifiedOn)),
  ].sort();
  const jurisdictionResourceCount = JURISDICTIONS.reduce((n, j) => n + j.resources.length, 0);
  return {
    jurisdictions: JURISDICTIONS.length,
    covered: JURISDICTIONS.filter((j) => !j.nationalFallbackOnly).length,
    nationalFallbackOnly: JURISDICTIONS.filter((j) => j.nationalFallbackOnly).length,
    nationalResources: NATIONAL_RESOURCES.length,
    totalResources: NATIONAL_RESOURCES.length + jurisdictionResourceCount,
    newestVerifiedOn: verifiedDates[verifiedDates.length - 1] ?? "",
    oldestVerifiedOn: verifiedDates[0] ?? "",
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @magna-carta/wellbeing-resources test`
Expected: PASS (all suites).

- [ ] **Step 5: Commit**

```bash
git add packages/wellbeing-resources/src/manifest.ts packages/wellbeing-resources/test/manifest.test.ts
git commit -m "feat(wellbeing-resources): coverage manifest derived from the data"
```

---

### Task 6: Coverage directory mockup

**Files:**

- Create: `packages/wellbeing-resources/scripts/build-directory-data.mts`
- Create: `packages/wellbeing-resources/mockups/directory-data.js` (written by the script; commit the output)
- Create: `packages/wellbeing-resources/mockups/directory.html`

**Interfaces:**

- Consumes: `allCoveredJurisdictions`, `nationalResources`, `coverageManifest` from the package.
- Produces: `window.WELLBEING` on `mockups/directory-data.js`; a static coverage grid that opens over `file://` (script tag, not `fetch`, which is blocked for local files — same approach as `government-links`' coverage map).

- [ ] **Step 1: Create `scripts/build-directory-data.mts`**

```ts
import { writeFileSync } from "node:fs";
import { coverageManifest } from "../src/manifest.ts";
import { allCoveredJurisdictions, nationalResources } from "../src/registry.ts";

// Builds the coverage mockup's data straight from the registry, so the clickable directory can never
// drift from the package. Emitted as a JS assignment (not JSON) so the mockup loads it via <script src>
// — fetch is blocked for file:// pages, a script tag is not.
function main(): void {
  const data = {
    manifest: coverageManifest(),
    national: nationalResources().map((r) => ({ name: r.name, url: r.url ?? "" })),
    jurisdictions: allCoveredJurisdictions().map((j) => ({
      code: j.code,
      name: j.name,
      count: j.resources.length,
      fallbackOnly: j.nationalFallbackOnly,
    })),
  };
  writeFileSync(
    new URL("../mockups/directory-data.js", import.meta.url),
    `window.WELLBEING = ${JSON.stringify(data)};\n`,
  );
  console.log(
    `wrote mockups/directory-data.js: ${data.jurisdictions.length} jurisdictions, ${data.national.length} national`,
  );
}

main();
```

- [ ] **Step 2: Create `mockups/directory.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Wellbeing Resources — coverage</title>
    <style>
      body {
        font:
          14px/1.5 system-ui,
          sans-serif;
        margin: 2rem;
        color: #1a1a1a;
      }
      h1 {
        font-size: 1.25rem;
      }
      .summary {
        color: #444;
        margin-bottom: 1rem;
      }
      .grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
        gap: 8px;
      }
      .cell {
        border: 1px solid #ddd;
        border-radius: 6px;
        padding: 8px 10px;
      }
      .cell.fallback {
        background: #fbf4e6;
        border-color: #e6d3a3;
      }
      .code {
        font-weight: 600;
      }
      .count {
        color: #555;
        font-size: 12px;
      }
      .national {
        margin-top: 1.5rem;
      }
      .national li {
        margin: 2px 0;
      }
    </style>
  </head>
  <body>
    <h1>Wellbeing Resources — coverage</h1>
    <p class="summary" id="summary"></p>
    <div class="grid" id="grid"></div>
    <div class="national">
      <h2>National safety net (always present)</h2>
      <ul id="national"></ul>
    </div>
    <script src="./directory-data.js"></script>
    <script>
      const d = window.WELLBEING;
      const m = d.manifest;
      document.getElementById("summary").textContent =
        `${m.jurisdictions} jurisdictions · ${m.covered} with a dedicated program · ` +
        `${m.nationalFallbackOnly} national-fallback-only · ${m.totalResources} resources · ` +
        `verified ${m.newestVerifiedOn}`;
      const grid = document.getElementById("grid");
      for (const j of d.jurisdictions) {
        const cell = document.createElement("div");
        cell.className = "cell" + (j.fallbackOnly ? " fallback" : "");
        cell.innerHTML =
          `<div class="code">${j.code} — ${j.name}</div>` +
          `<div class="count">${j.fallbackOnly ? "national fallback" : j.count + " resource(s)"}</div>`;
        grid.appendChild(cell);
      }
      const nat = document.getElementById("national");
      for (const r of d.national) {
        const li = document.createElement("li");
        li.textContent = r.url ? `${r.name} — ${r.url}` : r.name;
        nat.appendChild(li);
      }
    </script>
  </body>
</html>
```

- [ ] **Step 3: Run the builder**

Run: `pnpm --filter @magna-carta/wellbeing-resources run directory`
Expected: `wrote mockups/directory-data.js: 56 jurisdictions, 3 national`, then the page opens (or open `mockups/directory.html` manually). Confirm the grid shows 56 cells with PR/AS/MP shaded as national-fallback.

- [ ] **Step 4: Verify checks still pass**

Run: `pnpm check`
Expected: PASS. If the formatter flags `mockups/directory-data.js`, format it in place and re-commit (the `directory` build reproduces the formatted bytes deterministically).

- [ ] **Step 5: Commit**

```bash
git add packages/wellbeing-resources/scripts/build-directory-data.mts packages/wellbeing-resources/mockups/directory.html packages/wellbeing-resources/mockups/directory-data.js
git commit -m "feat(wellbeing-resources): coverage directory mockup built from the registry"
```

---

### Task 7: Package CLAUDE.md + docs + fragments

**Files:**

- Create: `packages/wellbeing-resources/CLAUDE.md`
- Modify: `ROADMAP.md` (mark the wellbeing-resources package built)
- Modify: `STATUS.md` (edit only the wellbeing-resources slice row)
- Create: `changelog.d/wellbeing-resources-package.md`
- Create: `docs/decisions/pending/wellbeing-resources-generated-package.md`
- Modify: `docs/active-work/wellbeing-resources.md` (update scope to reflect Phase B built)

**Interfaces:** none (documentation).

- [ ] **Step 1: Before touching cross-cutting files, sync awareness**

Run: `vp run worktrees`
Expected: prints the active-work registry and any touch-overlaps on `ROADMAP.md` / `STATUS.md`. If `main` is more than a handful of merges ahead, `git merge main` (or rebase) in the worktree before editing shared files, resolving per the append-don't-collide rules (edit only your own `STATUS.md` row; never hand-edit `CHANGELOG.md`).

- [ ] **Step 2: Create `packages/wellbeing-resources/CLAUDE.md`**

```markdown
# @magna-carta/wellbeing-resources — area rules

Per-jurisdiction lawyer mental-health / emotional-support resources (State Bar Lawyer Assistance
Programs and affiliated hotlines/peer networks/clinical vendors) plus a permanent national safety net
(988, SAMHSA, ABA CoLAP). Compiled reference data, like `@magna-carta/government-links` — no per-firm or
matter scoping.

## The data is generated — never hand-edit it

`src/data.generated.ts` is built from the research corpus `docs/research/wellbeing-resources/` (the
single source of truth). To change the data:

1. Edit `docs/research/wellbeing-resources/extract/*.json` and re-run its pipeline
   (`docs/research/wellbeing-resources/pipeline`) to rebuild `profiles.json`.
2. Run `pnpm --filter @magna-carta/wellbeing-resources run build:data`.
3. Commit the regenerated `data.generated.ts` alongside the corpus change.

`pnpm --filter @magna-carta/wellbeing-resources run verify:data` fails if the committed file has drifted
from the corpus — keep them in lockstep in the same commit.

## Model invariants

- The **national safety net is unconditionally present** (988 first); accessors return it for every
  jurisdiction, covered or not.
- The shipped model carries only product-relevant fields. Research provenance (`confidence`,
  `sourceUrl`, `sourceTier`) is dropped by the generator; `verifiedOn` (ISO date) is kept.
- A jurisdiction with no dedicated program is `nationalFallbackOnly: true` with empty `resources` — an
  answer, not a gap.
- `availability: "aroundTheClock"` only where a source stated 24/7; never inferred.

## Surface

`./types` (model), `./registry` (accessors: `wellbeingResourcesForState`, `nationalResources`,
`allCoveredJurisdictions`, `isNationalFallbackOnly`), `./manifest` (`coverageManifest`). No barrel file
(`oxc/no-barrel-file`). Coverage map: `pnpm --filter @magna-carta/wellbeing-resources run directory`.
```

- [ ] **Step 3: Create `changelog.d/wellbeing-resources-package.md`**

Match the format of an existing fragment in `changelog.d/` (open one to confirm the heading/section convention), then write:

```markdown
### Added

- **Wellbeing resources directory** — `@magna-carta/wellbeing-resources`: a typed, verified dataset of
  per-jurisdiction lawyer mental-health and emotional-support resources (State Bar Lawyer Assistance
  Programs and affiliated hotlines, peer networks, and clinical vendors) across all 50 states, DC, and
  five territories, with a permanent national safety net (988, SAMHSA, ABA CoLAP) returned for every
  jurisdiction. Data is generated from a provenance-tracked research corpus; the in-app surface lands in
  a later slice.
```

- [ ] **Step 4: Create `docs/decisions/pending/wellbeing-resources-generated-package.md`**

Match the ADR fragment format of an existing file in `docs/decisions/pending/` (open one first), then record the decision:

```markdown
# Wellbeing resources: a generated, resource-centric package

**Status:** Accepted

**Context:** Lawyer wellbeing resources vary in shape per jurisdiction (a state carries a list of
resources — bar programs, affiliated nonprofits, courts, outsourced EAP vendors — at statewide or metro
scope), so the keyed deep-link model of `@magna-carta/government-links` (`PortalSite`/`deepLink`) does
not fit. A validated research corpus with per-resource provenance already exists.

**Decision:** Ship a dedicated `@magna-carta/wellbeing-resources` package with a resource-centric model
(`WellbeingResource` / `JurisdictionEntry`). Its data table is **generated** from the research corpus
`docs/research/wellbeing-resources/profiles.json` (single source of truth) rather than hand-authored per
state — the generator projects research resources to the shipped model, dropping research-only
provenance (`confidence`, `sourceUrl`, `sourceTier`) and folding "no program" jurisdictions into a
`nationalFallbackOnly` flag. The national safety net (988, SAMHSA, ABA CoLAP) is unconditionally present.

**Consequences:** One home per fact — the corpus and the shipped data cannot drift (a `verify:data`
guard enforces it). Diverges from `government-links`' hand-authoring, justified by the upstream corpus.
The in-app UI and any public directory are deferred to a later vertical slice.
```

- [ ] **Step 5: Update `ROADMAP.md` and `STATUS.md`**

Edit the wellbeing-resources entries to reflect the package as built (data + accessors + manifest + coverage mockup; UI deferred). Follow the existing row/section format in each file; in `STATUS.md` edit only the wellbeing-resources slice row.

- [ ] **Step 6: Update `docs/active-work/wellbeing-resources.md`**

Revise the scope note: Phase A corpus complete; Phase B package built (`packages/wellbeing-resources/`); remaining deferred work is the in-app UI slice and extracting the mass-state research pattern to `docs/conventions/`.

- [ ] **Step 7: Commit**

```bash
git add packages/wellbeing-resources/CLAUDE.md ROADMAP.md STATUS.md changelog.d/wellbeing-resources-package.md docs/decisions/pending/wellbeing-resources-generated-package.md docs/active-work/wellbeing-resources.md
git commit -m "docs(wellbeing-resources): package CLAUDE.md, roadmap/status, changelog + decision fragments"
```

---

### Task 8: Full quality gate

**Files:** none (verification only).

- [ ] **Step 1: Full quality gate**

Run: `pnpm check`
Expected: PASS (fmt + lint + typecheck across the workspace, including the new package). Resolve any issue at its source; do not hand-edit generated files.

- [ ] **Step 2: Full test run**

Run: `vp test`
Expected: PASS, including `@magna-carta/wellbeing-resources` (types, registry, data invariants, manifest).

- [ ] **Step 3: Confirm data sync one more time**

Run: `pnpm --filter @magna-carta/wellbeing-resources run verify:data`
Expected: in sync (exit 0).

- [ ] **Step 4: Confirm a clean tree**

Run: `git status`
Expected: no uncommitted changes in `packages/wellbeing-resources/` or the docs touched above.

---

## Self-Review

**Spec coverage:**

- New dedicated package `@magna-carta/wellbeing-resources` reusing the authoring pattern → Tasks 1, 3, 5, 6.
- Data model finalized from the corpus (resource-centric; enums; national safety net) → Model Confirmation + Task 1.
- Data first, code second; model confirmed against the corpus before freezing → Model Confirmation section + Task 2 generator.
- Accessors `wellbeingResourcesForState` / `nationalResources` / coverage → Tasks 3, 5.
- National safety net unconditionally present → Task 3 + Task 4 invariant.
- Testing (composition, unique FIPS, national present, ≥1 contact, valid service tags, availability discipline, verifiedOn) → Task 4.
- Coverage viewer / verify workflow → Task 6.
- Docs current (ROADMAP/CHANGELOG/decision/active-work + package CLAUDE.md) → Task 7.
- Non-goals respected: no UI, no public page, no per-firm scoping, no automated link-checking — none built.

**Placeholder scan:** no TBD/TODO; every code step carries complete code; every command has an expected result.

**Type consistency:** `WellbeingResource`/`JurisdictionEntry`/`Phone` field names are identical across `types.ts`, the generator projection, `registry.ts`, `manifest.ts`, and the tests. `nationalFallbackOnly` (boolean) is used consistently. Accessor names (`wellbeingResourcesForState`, `nationalResources`, `allCoveredJurisdictions`, `isNationalFallbackOnly`, `coverageManifest`) match between definitions and tests.

```

```
