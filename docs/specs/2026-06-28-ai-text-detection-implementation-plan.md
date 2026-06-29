# AI-Text Detection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the vendor-agnostic core of an AI-text detection capability — a pure `@magna-carta/ai-detection` package on the integration ports-and-adapters framework, surfaced as a Tools-area utility — with no concrete vendor wired.

**Architecture:** A pure domain package defines our `AiTextDetectionPort` and a `DetectionReport` that structurally encodes "signal, not proof" (a coarse likelihood band + reliability + structured caveats, never a bare boolean). A vendor-agnostic normalizer turns any vendor's raw score into that report. The `ai-detection` integration category is registered with a single deferred adapter that returns `not-connected`, so the package is whole and testable with zero vendor present. The tool appears in the Tools catalog with `backing: { kind: "integration", category: "ai-detection" }`.

**Tech Stack:** TypeScript (ESM, `.ts` extension imports), Vitest via `vp test`, `@magna-carta/integrations` (Dispatch / problem / manifest / port), `@magna-carta/identifiers` (FirmId), `@magna-carta/access-control` (permission registry), `@magna-carta/tools` (catalog).

## Global Constraints

- **Pure package** — `@magna-carta/ai-detection` imports only relative modules and the allowed workspace type packages (`@magna-carta/integrations/*`, `@magna-carta/identifiers/types`). No D1, no Hono, no `env`, no Svelte, no network, no vendor SDK. Enforced by a purity fitness test.
- **Signal, not proof** — the result type must not be able to express a bare boolean verdict; `inconclusive` is a first-class band; reliability/caveats are computed by our normalizer from input characteristics, independent of any vendor's claimed confidence.
- **Typed Dispatch, never throw** — every port operation returns `Dispatch<T>` from `@magna-carta/integrations/dispatch`.
- **No `Date.now()` in the pure core** — timestamps are passed in (matches the codebase's determinism rule; the workflow/test runtime forbids argless time).
- **Full names, no shorthand** (golden rule 12) — `@magna-carta/ai-detection`, `AiTextDetectionPort`, `DetectionReport`. `AI` is allowed as a universal external term.
- **No process-doc references in source** (golden rule 13) — no `ADR-NNNN`/spec/slice citations in code or test files; explain reasoning inline or cite a file path.
- **Module layout & scaffolding** mirror `packages/conversion` and `packages/integrations`: `package.json` (`"type":"module"`, `"sideEffects":false`, per-subpath `exports`, `"test":"vp test run"`), `tsconfig.json` extending `@magna-carta/tsconfig/base.json`, `vitest.config.ts` via `vite-plus` with `root: import.meta.dirname`.
- **Commands** — run a single package's tests with `cd packages/ai-detection && pnpm test` (alias for `vp test run`); the full gate is `pnpm check` at the repo root.

---

### Task 1: Scaffold the package + the `DetectionReport` model + purity fitness

**Files:**

- Create: `packages/ai-detection/package.json`
- Create: `packages/ai-detection/tsconfig.json`
- Create: `packages/ai-detection/vitest.config.ts`
- Create: `packages/ai-detection/src/report.ts`
- Test: `packages/ai-detection/test/report.test.ts`
- Test: `packages/ai-detection/test/purity.test.ts`

**Interfaces:**

- Produces: `LikelihoodBand`, `Reliability`, `Caveat` (string-literal unions); `SegmentScore` `{ startChar:number; endChar:number; score:number; band:LikelihoodBand }`; `DetectionReport` (see Step 3); `LIKELIHOOD_BANDS` / `CAVEATS` readonly arrays; `segmentScore(startChar, endChar, score, band): SegmentScore`.

- [ ] **Step 1: Write the failing test for the report model**

Create `packages/ai-detection/test/report.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { CAVEATS, LIKELIHOOD_BANDS, segmentScore } from "../src/report.ts";

describe("report model", () => {
  it("exposes the four likelihood bands including inconclusive", () => {
    expect(LIKELIHOOD_BANDS).toEqual(["unlikely", "mixed", "likely", "inconclusive"]);
  });

  it("lists the structured caveats", () => {
    expect(CAVEATS).toContain("text-too-short");
    expect(CAVEATS).toContain("possible-paraphrase-or-humanization");
    expect(CAVEATS).toContain("non-target-language");
    expect(CAVEATS).toContain("mixed-or-edited-authorship");
    expect(CAVEATS).toContain("low-vendor-confidence");
  });

  it("builds a segment score with its band", () => {
    expect(segmentScore(0, 10, 0.9, "likely")).toEqual({
      startChar: 0,
      endChar: 10,
      score: 0.9,
      band: "likely",
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/ai-detection && pnpm test report`
Expected: FAIL — cannot resolve `../src/report.ts` (module not found).

- [ ] **Step 3: Create the package scaffold and the report model**

Create `packages/ai-detection/package.json`:

```json
{
  "name": "@magna-carta/ai-detection",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "sideEffects": false,
  "exports": {
    "./report": "./src/report.ts",
    "./port": "./src/port.ts",
    "./normalize": "./src/normalize.ts",
    "./consent": "./src/consent.ts",
    "./manifest": "./src/manifest.ts",
    "./adapters/deferred": "./src/adapters/deferred.ts"
  },
  "scripts": {
    "test": "vp test run"
  },
  "dependencies": {
    "@magna-carta/identifiers": "workspace:*",
    "@magna-carta/integrations": "workspace:*"
  },
  "devDependencies": {
    "@magna-carta/tsconfig": "workspace:*",
    "@types/node": "catalog:",
    "vitest": "catalog:"
  }
}
```

Create `packages/ai-detection/tsconfig.json`:

```json
{
  "extends": "../tsconfig/base.json",
  "compilerOptions": {
    "lib": ["ES2022"],
    "types": ["node"],
    "allowImportingTsExtensions": true,
    "noEmit": true
  },
  "include": ["src/**/*.ts", "test/**/*.ts"]
}
```

Create `packages/ai-detection/vitest.config.ts`:

```ts
import { defineConfig } from "vite-plus";

// Pure package: the default node pool, no Cloudflare Workers runtime.
// root is pinned so the repo-root `vp test` resolves this project's tests from here.
export default defineConfig({
  root: import.meta.dirname,
});
```

Create `packages/ai-detection/src/report.ts`:

```ts
// The detection result is deliberately NOT a boolean. A reader gets a coarse likelihood band, an
// explicit reliability grade, and the structured reasons to hesitate — so a confident-looking wrong
// answer is structurally impossible to produce. `inconclusive` is a first-class, common answer.

export type LikelihoodBand = "unlikely" | "mixed" | "likely" | "inconclusive";
export const LIKELIHOOD_BANDS: readonly LikelihoodBand[] = [
  "unlikely",
  "mixed",
  "likely",
  "inconclusive",
];

export type Reliability = "high" | "moderate" | "low";

// Why a reader should hesitate. Each is detectable from the input or the vendor signal; the headline
// band degrades to `inconclusive` when reliability bottoms out (see normalize.ts).
export type Caveat =
  | "text-too-short"
  | "possible-paraphrase-or-humanization"
  | "non-target-language"
  | "mixed-or-edited-authorship"
  | "low-vendor-confidence";
export const CAVEATS: readonly Caveat[] = [
  "text-too-short",
  "possible-paraphrase-or-humanization",
  "non-target-language",
  "mixed-or-edited-authorship",
  "low-vendor-confidence",
];

export interface SegmentScore {
  readonly startChar: number;
  readonly endChar: number;
  readonly score: number; // normalized 0..1
  readonly band: LikelihoodBand;
}

export interface DetectionProvenance {
  readonly adapterId: string;
  readonly vendorModel?: string;
  readonly vendorVersion?: string;
  readonly detectedAt: string; // ISO 8601, passed in — never Date.now() in the pure core
  readonly egressedTo?: string; // which external service saw the text (consent provenance)
}

export interface DetectionReport {
  readonly band: LikelihoodBand; // the headline — coarse on purpose
  readonly score: number; // normalized 0..1, for provenance/audit, NOT the headline
  readonly reliability: Reliability; // derived from input + caveats, not vendor marketing
  readonly caveats: readonly Caveat[];
  readonly segments?: readonly SegmentScore[];
  readonly provenance: DetectionProvenance;
}

export function segmentScore(
  startChar: number,
  endChar: number,
  score: number,
  band: LikelihoodBand,
): SegmentScore {
  return { startChar, endChar, score, band };
}
```

- [ ] **Step 4: Run the report test to verify it passes**

Run: `cd packages/ai-detection && pnpm test report`
Expected: PASS (3 tests).

- [ ] **Step 5: Write the purity fitness test**

Create `packages/ai-detection/test/purity.test.ts`:

```ts
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The core stays pure: every import is a relative path OR one of the allowed workspace TYPE packages.
// No D1, Hono, env, Svelte, network, or vendor SDK ever enters this package.
const importPattern = /import[^"']*["']([^"']+)["']/g;
const allowedPackages = new Set([
  "@magna-carta/integrations/dispatch",
  "@magna-carta/integrations/problem",
  "@magna-carta/integrations/port",
  "@magna-carta/integrations/manifest",
  "@magna-carta/identifiers/types",
]);

function tsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? tsFiles(full) : full.endsWith(".ts") ? [full] : [];
  });
}

function importSpecifiers(filePath: string): string[] {
  const text = readFileSync(filePath, "utf8");
  const specifiers: string[] = [];
  for (const match of text.matchAll(importPattern)) specifiers.push(match[1]!);
  return specifiers;
}

const srcDir = join(import.meta.dirname, "..", "src");

describe("purity (fitness)", () => {
  it("actually inspects at least one source file", () => {
    expect(tsFiles(srcDir).length).toBeGreaterThanOrEqual(1);
  });

  it("every import is relative or an allowed workspace type package", () => {
    for (const file of tsFiles(srcDir)) {
      const normalizedFile = file.replaceAll("\\", "/");
      for (const specifier of importSpecifiers(file)) {
        const isRelative = specifier.startsWith("./") || specifier.startsWith("../");
        const allowed = isRelative || allowedPackages.has(specifier);
        expect(allowed, `${normalizedFile} imports disallowed specifier: "${specifier}"`).toBe(
          true,
        );
      }
    }
  });
});
```

- [ ] **Step 6: Install the new workspace package, then run both test files**

Run: `pnpm install` (from repo root — registers the new workspace package), then `cd packages/ai-detection && pnpm test`
Expected: PASS (report.test.ts + purity.test.ts).

- [ ] **Step 7: Commit**

```bash
git add packages/ai-detection
git commit -m "feat(ai-detection): scaffold package + DetectionReport model + purity fitness"
```

---

### Task 2: The port, input, raw-vendor, and consent types

**Files:**

- Create: `packages/ai-detection/src/port.ts`
- Create: `packages/ai-detection/src/consent.ts`
- Test: `packages/ai-detection/test/consent.test.ts`

**Interfaces:**

- Consumes: `DetectionReport`, `SegmentScore` from `./report.ts`; `Dispatch` from `@magna-carta/integrations/dispatch`; `FirmId` from `@magna-carta/identifiers/types`.
- Produces:
  - `DetectionInput` `{ text:string; languageHint?:string; firmId:FirmId }`
  - `RawSegment` `{ startChar:number; endChar:number; score:number }`
  - `RawDetection` `{ score:number; vendorConfidence?:number; vendorModel?:string; vendorVersion?:string; segments?:readonly RawSegment[]; signals?:{ paraphraseSuspected?:boolean; mixedAuthorship?:boolean } }`
  - `AiTextDetectionPort` `{ detect(input:DetectionInput): Promise<Dispatch<DetectionReport>> }`
  - `DetectionConsentScope` = `"engagement" | "per-matter"`; `DetectionPolicy` `{ externalDetectionEnabled:boolean; consentScope:DetectionConsentScope }`; `defaultDetectionPolicy(): DetectionPolicy` (returns `{ externalDetectionEnabled:false, consentScope:"engagement" }`).

- [ ] **Step 1: Write the failing test for the consent policy default**

Create `packages/ai-detection/test/consent.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { defaultDetectionPolicy } from "../src/consent.ts";

describe("detection consent policy", () => {
  it("is off by default — external detection requires explicit opt-in", () => {
    expect(defaultDetectionPolicy()).toEqual({
      externalDetectionEnabled: false,
      consentScope: "engagement",
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/ai-detection && pnpm test consent`
Expected: FAIL — cannot resolve `../src/consent.ts`.

- [ ] **Step 3: Create the port and consent modules**

Create `packages/ai-detection/src/port.ts`:

```ts
import type { Dispatch } from "@magna-carta/integrations/dispatch";
import type { FirmId } from "@magna-carta/identifiers/types";
import type { DetectionReport } from "./report.ts";

// The port is named in OUR domain vocabulary, never a vendor's request/response shape. firmId is
// carried for tenancy and future per-firm metering (the InferencePort precedent), never on a
// connection object.
export interface DetectionInput {
  readonly text: string;
  readonly languageHint?: string; // BCP-47; informs caveats, never required
  readonly firmId: FirmId;
}

// A vendor adapter's normalized-but-unframed output. The agnostic normalizer turns this into a
// DetectionReport; the framing (band/reliability/caveats) is OURS, not the vendor's.
export interface RawSegment {
  readonly startChar: number;
  readonly endChar: number;
  readonly score: number; // 0..1
}

export interface RawDetection {
  readonly score: number; // 0..1 probability the text is machine-generated
  readonly vendorConfidence?: number; // 0..1, the vendor's own confidence if it reports one
  readonly vendorModel?: string;
  readonly vendorVersion?: string;
  readonly segments?: readonly RawSegment[];
  readonly signals?: {
    readonly paraphraseSuspected?: boolean;
    readonly mixedAuthorship?: boolean;
  };
}

export interface AiTextDetectionPort {
  detect(input: DetectionInput): Promise<Dispatch<DetectionReport>>;
}
```

Create `packages/ai-detection/src/consent.ts`:

```ts
// Sending privileged text to a third-party detector inherits the platform's AI-confidentiality
// posture: an opt-in firm policy, OFF by default, with recorded consent. The firm setting, the UI
// consent gate, and the worker route that enforce this are downstream consumers; this module is the
// shared vocabulary they bind to.

export type DetectionConsentScope = "engagement" | "per-matter";

export interface DetectionPolicy {
  readonly externalDetectionEnabled: boolean;
  readonly consentScope: DetectionConsentScope;
}

export function defaultDetectionPolicy(): DetectionPolicy {
  return { externalDetectionEnabled: false, consentScope: "engagement" };
}
```

- [ ] **Step 4: Run the consent test to verify it passes**

Run: `cd packages/ai-detection && pnpm test consent`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add packages/ai-detection/src/port.ts packages/ai-detection/src/consent.ts packages/ai-detection/test/consent.test.ts
git commit -m "feat(ai-detection): add AiTextDetectionPort, raw-vendor types, and consent policy"
```

---

### Task 3: The vendor-agnostic normalizer (the high-value core)

**Files:**

- Create: `packages/ai-detection/src/normalize.ts`
- Test: `packages/ai-detection/test/normalize.test.ts`

**Interfaces:**

- Consumes: `DetectionReport`, `LikelihoodBand`, `Reliability`, `Caveat`, `segmentScore` from `./report.ts`; `DetectionInput`, `RawDetection` from `./port.ts`.
- Produces:
  - `MIN_RELIABLE_CHARS = 280`, `UNLIKELY_MAX = 0.2`, `LIKELY_MIN = 0.8`, `LOW_VENDOR_CONFIDENCE_MAX = 0.5`
  - `bandForScore(score: number): LikelihoodBand`
  - `caveatsFor(input: DetectionInput, raw: RawDetection): Caveat[]`
  - `reliabilityFor(caveats: readonly Caveat[]): Reliability`
  - `normalize(input, raw, meta): DetectionReport` where `meta` is `{ adapterId:string; detectedAt:string; egressedTo?:string }`

- [ ] **Step 1: Write the failing tests for the normalizer**

Create `packages/ai-detection/test/normalize.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { DetectionInput, RawDetection } from "../src/port.ts";
import { bandForScore, caveatsFor, normalize, reliabilityFor } from "../src/normalize.ts";

const FIRM = "firm_test" as DetectionInput["firmId"];
const LONG = "a".repeat(400); // over MIN_RELIABLE_CHARS

function input(over: Partial<DetectionInput> = {}): DetectionInput {
  return { text: LONG, firmId: FIRM, ...over };
}
function raw(over: Partial<RawDetection> = {}): RawDetection {
  return { score: 0.9, ...over };
}
const META = { adapterId: "deferred", detectedAt: "2026-06-28T00:00:00.000Z" };

describe("bandForScore", () => {
  it("maps low scores to unlikely", () => {
    expect(bandForScore(0.1)).toBe("unlikely");
  });
  it("maps mid scores to mixed", () => {
    expect(bandForScore(0.5)).toBe("mixed");
  });
  it("maps high scores to likely", () => {
    expect(bandForScore(0.95)).toBe("likely");
  });
});

describe("caveatsFor", () => {
  it("flags short text", () => {
    expect(caveatsFor(input({ text: "too short" }), raw())).toContain("text-too-short");
  });
  it("flags non-English language hints", () => {
    expect(caveatsFor(input({ languageHint: "fr-FR" }), raw())).toContain("non-target-language");
  });
  it("accepts English language hints without the language caveat", () => {
    expect(caveatsFor(input({ languageHint: "en-US" }), raw())).not.toContain(
      "non-target-language",
    );
  });
  it("flags low vendor confidence", () => {
    expect(caveatsFor(input(), raw({ vendorConfidence: 0.3 }))).toContain("low-vendor-confidence");
  });
  it("flags suspected paraphrase and mixed authorship from vendor signals", () => {
    const result = caveatsFor(
      input(),
      raw({ signals: { paraphraseSuspected: true, mixedAuthorship: true } }),
    );
    expect(result).toContain("possible-paraphrase-or-humanization");
    expect(result).toContain("mixed-or-edited-authorship");
  });
  it("returns no caveats for clean long English input", () => {
    expect(caveatsFor(input({ languageHint: "en" }), raw())).toEqual([]);
  });
});

describe("reliabilityFor", () => {
  it("is high with no caveats", () => {
    expect(reliabilityFor([])).toBe("high");
  });
  it("is low when text is too short", () => {
    expect(reliabilityFor(["text-too-short"])).toBe("low");
  });
  it("is low on low vendor confidence", () => {
    expect(reliabilityFor(["low-vendor-confidence"])).toBe("low");
  });
  it("is moderate for a non-fatal caveat", () => {
    expect(reliabilityFor(["non-target-language"])).toBe("moderate");
  });
});

describe("normalize", () => {
  it("produces a full report for clean high-score input", () => {
    const report = normalize(input({ languageHint: "en" }), raw({ score: 0.92 }), META);
    expect(report.band).toBe("likely");
    expect(report.reliability).toBe("high");
    expect(report.caveats).toEqual([]);
    expect(report.score).toBe(0.92);
    expect(report.provenance.adapterId).toBe("deferred");
    expect(report.provenance.detectedAt).toBe("2026-06-28T00:00:00.000Z");
  });

  it("forces the headline band to inconclusive when reliability is low", () => {
    // A vendor 'likely' verdict on a 9-char snippet must NOT assert a direction.
    const report = normalize(input({ text: "too short" }), raw({ score: 0.99 }), META);
    expect(report.reliability).toBe("low");
    expect(report.band).toBe("inconclusive");
    expect(report.caveats).toContain("text-too-short");
  });

  it("maps vendor segments to banded segment scores", () => {
    const report = normalize(
      input({ languageHint: "en" }),
      raw({ score: 0.5, segments: [{ startChar: 0, endChar: 50, score: 0.95 }] }),
      META,
    );
    expect(report.segments).toEqual([{ startChar: 0, endChar: 50, score: 0.95, band: "likely" }]);
  });

  it("records the external service that saw the text", () => {
    const report = normalize(input({ languageHint: "en" }), raw(), {
      ...META,
      egressedTo: "example-vendor",
    });
    expect(report.provenance.egressedTo).toBe("example-vendor");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd packages/ai-detection && pnpm test normalize`
Expected: FAIL — cannot resolve `../src/normalize.ts`.

- [ ] **Step 3: Implement the normalizer**

Create `packages/ai-detection/src/normalize.ts`:

```ts
import type { DetectionInput, RawDetection } from "./port.ts";
import {
  type Caveat,
  type DetectionReport,
  type LikelihoodBand,
  type Reliability,
  segmentScore,
} from "./report.ts";

// Below this many characters (~50 words) detection is unreliable regardless of the vendor's claim.
export const MIN_RELIABLE_CHARS = 280;
// Score thresholds. The band is coarse on purpose; the wide mid-zone is `mixed`, not a forced binary.
export const UNLIKELY_MAX = 0.2;
export const LIKELY_MIN = 0.8;
// A vendor-reported confidence at or below this is treated as a low-confidence signal.
export const LOW_VENDOR_CONFIDENCE_MAX = 0.5;

export function bandForScore(score: number): LikelihoodBand {
  if (score < UNLIKELY_MAX) return "unlikely";
  if (score >= LIKELY_MIN) return "likely";
  return "mixed";
}

export function caveatsFor(input: DetectionInput, raw: RawDetection): Caveat[] {
  const caveats: Caveat[] = [];
  if (input.text.length < MIN_RELIABLE_CHARS) caveats.push("text-too-short");
  if (input.languageHint !== undefined && !input.languageHint.toLowerCase().startsWith("en")) {
    caveats.push("non-target-language");
  }
  if (raw.vendorConfidence !== undefined && raw.vendorConfidence <= LOW_VENDOR_CONFIDENCE_MAX) {
    caveats.push("low-vendor-confidence");
  }
  if (raw.signals?.paraphraseSuspected === true)
    caveats.push("possible-paraphrase-or-humanization");
  if (raw.signals?.mixedAuthorship === true) caveats.push("mixed-or-edited-authorship");
  return caveats;
}

// Reliability-fatal caveats bottom the grade out; any other caveat downgrades to moderate.
const FATAL_CAVEATS: ReadonlySet<Caveat> = new Set(["text-too-short", "low-vendor-confidence"]);

export function reliabilityFor(caveats: readonly Caveat[]): Reliability {
  if (caveats.some((caveat) => FATAL_CAVEATS.has(caveat))) return "low";
  if (caveats.length > 0) return "moderate";
  return "high";
}

export interface NormalizeMeta {
  readonly adapterId: string;
  readonly detectedAt: string;
  readonly egressedTo?: string;
}

// The agnostic heart: a vendor's raw score becomes OUR framed report. A low-reliability result never
// asserts a direction — its headline band is forced to `inconclusive`.
export function normalize(
  input: DetectionInput,
  raw: RawDetection,
  meta: NormalizeMeta,
): DetectionReport {
  const caveats = caveatsFor(input, raw);
  const reliability = reliabilityFor(caveats);
  const band: LikelihoodBand = reliability === "low" ? "inconclusive" : bandForScore(raw.score);
  const segments = raw.segments?.map((segment) =>
    segmentScore(segment.startChar, segment.endChar, segment.score, bandForScore(segment.score)),
  );
  return {
    band,
    score: raw.score,
    reliability,
    caveats,
    ...(segments !== undefined ? { segments } : {}),
    provenance: {
      adapterId: meta.adapterId,
      ...(raw.vendorModel !== undefined ? { vendorModel: raw.vendorModel } : {}),
      ...(raw.vendorVersion !== undefined ? { vendorVersion: raw.vendorVersion } : {}),
      detectedAt: meta.detectedAt,
      ...(meta.egressedTo !== undefined ? { egressedTo: meta.egressedTo } : {}),
    },
  };
}
```

- [ ] **Step 4: Run the normalizer tests to verify they pass**

Run: `cd packages/ai-detection && pnpm test normalize`
Expected: PASS (all describe blocks green).

- [ ] **Step 5: Commit**

```bash
git add packages/ai-detection/src/normalize.ts packages/ai-detection/test/normalize.test.ts
git commit -m "feat(ai-detection): vendor-agnostic normalizer (band/caveats/reliability framing)"
```

---

### Task 4: The `ai-detection` category manifest + deferred adapter

**Files:**

- Create: `packages/ai-detection/src/manifest.ts`
- Create: `packages/ai-detection/src/adapters/deferred.ts`
- Test: `packages/ai-detection/test/manifest.test.ts`
- Test: `packages/ai-detection/test/deferred.test.ts`

**Interfaces:**

- Consumes: `CapabilityDescriptor`, `Adapter`, `AdapterContext` from `@magna-carta/integrations/port`; `IntegrationManifest`, `isWellFormedManifest` from `@magna-carta/integrations/manifest`; `notConnected` + `Dispatch` from `@magna-carta/integrations/dispatch`; `AiTextDetectionPort` from `../port.ts` (deferred adapter).
- Produces:
  - `AI_DETECTION_CATEGORY = "ai-detection"`
  - `deferredCapability: CapabilityDescriptor` (adapterId `"deferred"`, credential `{ kind:"none" }`, `operations: { detect: { supported:false } }`, `passthroughAvailable:false`)
  - `aiDetectionManifest: IntegrationManifest`
  - `deferredAiDetectionAdapter: Adapter<AiTextDetectionPort>`

- [ ] **Step 1: Write the failing tests**

Create `packages/ai-detection/test/manifest.test.ts`:

```ts
import { isWellFormedManifest } from "@magna-carta/integrations/manifest";
import { describe, expect, it } from "vitest";
import { AI_DETECTION_CATEGORY, aiDetectionManifest } from "../src/manifest.ts";

describe("ai-detection manifest", () => {
  it("declares the ai-detection category", () => {
    expect(AI_DETECTION_CATEGORY).toBe("ai-detection");
    expect(aiDetectionManifest.category).toBe("ai-detection");
  });

  it("is well-formed", () => {
    expect(isWellFormedManifest(aiDetectionManifest)).toEqual([]);
  });

  it("is off by default — external detection is opt-in", () => {
    expect(aiDetectionManifest.defaultEnablement).toBe("off");
  });
});
```

Create `packages/ai-detection/test/deferred.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { DetectionInput } from "../src/port.ts";
import { deferredAiDetectionAdapter } from "../src/adapters/deferred.ts";

const INPUT: DetectionInput = {
  text: "a".repeat(400),
  firmId: "firm_test" as DetectionInput["firmId"],
};

describe("deferred ai-detection adapter", () => {
  it("declares no supported operations", () => {
    expect(deferredAiDetectionAdapter.descriptor.operations.detect?.supported).toBe(false);
  });

  it("detect returns not-connected and never throws", async () => {
    const port = deferredAiDetectionAdapter.create({});
    const result = await port.detect(INPUT);
    expect(result).toEqual({ ok: false, reason: "not-connected" });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd packages/ai-detection && pnpm test manifest deferred`
Expected: FAIL — cannot resolve `../src/manifest.ts` / `../src/adapters/deferred.ts`.

- [ ] **Step 3: Create the manifest and deferred adapter**

Create `packages/ai-detection/src/manifest.ts`:

```ts
import type { IntegrationManifest } from "@magna-carta/integrations/manifest";
import type { CapabilityDescriptor } from "@magna-carta/integrations/port";

// One detection category, many vendor adapters across the credential boundary (the conversion/
// government-links pattern). No concrete vendor is registered yet; the deferred adapter keeps the
// category whole and callable until a vendor is chosen and wired.
export const AI_DETECTION_CATEGORY = "ai-detection";

// The deferred adapter is credential-less and supports nothing — the descriptor says so, so callers
// degrade gracefully instead of calling an operation that cannot run.
export const deferredCapability: CapabilityDescriptor = {
  adapterId: "deferred",
  category: AI_DETECTION_CATEGORY,
  credential: { kind: "none" },
  operations: { detect: { supported: false } },
  passthroughAvailable: false,
};

export const aiDetectionManifest: IntegrationManifest = {
  id: "deferred",
  category: AI_DETECTION_CATEGORY,
  displayName: "AI-Text Detection",
  summary: "Estimate the likelihood that text was machine-generated. Returns a signal, not proof.",
  credential: { kind: "none" },
  capability: deferredCapability,
  permission: "tools:aiTextDetection",
  defaultEnablement: "off",
};
```

Create `packages/ai-detection/src/adapters/deferred.ts`:

```ts
import { type Dispatch, notConnected } from "@magna-carta/integrations/dispatch";
import type { Adapter, AdapterContext } from "@magna-carta/integrations/port";
import type { DetectionReport } from "../report.ts";
import type { AiTextDetectionPort } from "../port.ts";
import { deferredCapability } from "../manifest.ts";

// The one runnable adapter shipped now. A concrete vendor adapter drops in beside this with no change
// to the port: it implements detect() by calling the vendor over an injected HttpClient and running
// the raw result through normalize().
export const deferredAiDetectionAdapter: Adapter<AiTextDetectionPort> = {
  descriptor: deferredCapability,
  create(_context: AdapterContext): AiTextDetectionPort {
    return {
      async detect(): Promise<Dispatch<DetectionReport>> {
        return notConnected();
      },
    };
  },
};
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd packages/ai-detection && pnpm test manifest deferred`
Expected: PASS (manifest: 3, deferred: 2).

- [ ] **Step 5: Run the full package suite + the purity test once more**

Run: `cd packages/ai-detection && pnpm test`
Expected: PASS (report, consent, normalize, manifest, deferred, purity).

- [ ] **Step 6: Commit**

```bash
git add packages/ai-detection/src/manifest.ts packages/ai-detection/src/adapters packages/ai-detection/test/manifest.test.ts packages/ai-detection/test/deferred.test.ts
git commit -m "feat(ai-detection): register ai-detection category + deferred adapter"
```

---

### Task 5: Register the permission + add the Tools catalog row

**Files:**

- Modify: `packages/access-control/src/registry.ts` (the `PERMISSIONS` array, after `"tools:fileConverter"`)
- Modify: `packages/tools/src/catalog.ts` (append a manifest row)
- Test: `packages/access-control/test/registry.test.ts` (add a case) — verify path first; if absent, add a focused test file `packages/access-control/test/registry.test.ts`
- Test: `packages/tools/test/catalog.test.ts` (add a case)

**Interfaces:**

- Consumes: `assertPermission` (already imported in `catalog.ts`); the `ToolManifest` shape from `packages/tools/src/types.ts` (`subjectGroup: "documents"` and `contextTags: ["none"]` already exist in the unions — no `types.ts` change needed).
- Produces: permission key `"tools:aiTextDetection"`; catalog row `id: "ai-text-detection"`.

- [ ] **Step 1: Write the failing catalog test**

In `packages/tools/test/catalog.test.ts`, add:

```ts
it("includes the AI-text detection tool backed by the ai-detection integration", () => {
  const tool = CATALOG.find((entry) => entry.id === "ai-text-detection");
  expect(tool).toBeDefined();
  expect(tool?.subjectGroup).toBe("documents");
  expect(tool?.backing).toEqual({ kind: "integration", category: "ai-detection" });
  expect(tool?.matterContext).toBe("optional");
});
```

(If `CATALOG` is not already imported at the top of the file, add `import { CATALOG } from "../src/catalog.ts";`.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/tools && pnpm test catalog`
Expected: FAIL — `tool` is `undefined` (and, before the registry edit, the module throws from `assertPermission("tools:aiTextDetection")`). Either failure confirms the test exercises the new row.

- [ ] **Step 3: Register the permission key**

In `packages/access-control/src/registry.ts`, add the line immediately after `"tools:fileConverter", ...`:

```ts
  "tools:aiTextDetection", // AI-text detection — likelihood that text was machine-generated (a signal, not proof)
```

- [ ] **Step 4: Add the catalog row**

In `packages/tools/src/catalog.ts`, append inside the `CATALOG` array (after the `file-converter` entry):

```ts
  {
    id: "ai-text-detection",
    name: "AI-Text Detection",
    icon: "scan-text",
    subjectGroup: "documents",
    permission: assertPermission("tools:aiTextDetection"),
    contextTags: ["none"],
    backing: { kind: "integration", category: "ai-detection" },
    matterContext: "optional",
  },
```

- [ ] **Step 5: Run the tools tests (catalog + purity) to verify they pass**

Run: `cd packages/tools && pnpm test`
Expected: PASS — the new catalog case is green and the catalog purity test still holds (no new import added).

- [ ] **Step 6: Guard the permission with a registry test**

Confirm `packages/access-control/test/registry.test.ts` exists (`ls packages/access-control/test`). If it exists, add:

```ts
it("registers the AI-text detection tool permission", () => {
  expect(isPermission("tools:aiTextDetection")).toBe(true);
});
```

ensuring `isPermission` is imported from `../src/registry.ts`. If the file does not exist, create it:

```ts
import { describe, expect, it } from "vitest";
import { isPermission } from "../src/registry.ts";

describe("permission registry", () => {
  it("registers the AI-text detection tool permission", () => {
    expect(isPermission("tools:aiTextDetection")).toBe(true);
  });
});
```

- [ ] **Step 7: Run the access-control tests**

Run: `cd packages/access-control && pnpm test registry`
Expected: PASS.

- [ ] **Step 8: Run the full quality gate**

Run: `pnpm check` (repo root — fmt + lint + typecheck + svelte-check)
Expected: PASS. Resolve any formatter/lint findings before committing.

- [ ] **Step 9: Commit**

```bash
git add packages/access-control packages/tools
git commit -m "feat(ai-detection): register tools:aiTextDetection permission + Tools catalog row"
```

---

## Final verification (after all tasks)

- [ ] Run the full test suite: `vp test` (repo root) — all packages green, including the new `ai-detection` package.
- [ ] Run the quality gate: `pnpm check` — clean.
- [ ] Confirm the deferred path end-to-end: the Tools catalog exposes `ai-text-detection`, its `backing` points at the `ai-detection` category, and the only registered adapter returns `not-connected` — i.e. the tool is present and safely inert until a vendor adapter is wired.
- [ ] **End-of-build 7-angle adversarial review** per `docs/conventions/testing.md` before any merge.
- [ ] **Docs (golden rule 5):** add a `changelog.d/<slug>.md` fragment and a `docs/decisions/pending/<slug>.md` ADR fragment for the architecture decision (ADR-AAAA in the design spec); update `STATUS.md` for this slice's row. Do not hand-edit `CHANGELOG.md` / the Decision-Log register on the branch.

## Deferred to follow-on slices (designed-in seams — NOT this plan)

Concrete vendor HTTP adapter body (+ pinning credential scope) · document text-extraction (paste-text first; `.docx`/`.pdf` via the metadata/conversion engines) · the Tools UI widget + the `id`→component mapping in the design-system shell · the firm consent setting + UI consent gate · the worker route + `tools:aiTextDetection` role-seeding · the matter-action consumer · per-firm metering.
