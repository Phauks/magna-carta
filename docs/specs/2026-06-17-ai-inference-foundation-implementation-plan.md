# AI inference foundation — implementation plan

> **As-built corrections (2026-06-19).** The following divergences from the as-authored plan were discovered and applied during execution:
>
> - **Migration number:** the token-usage table migration is **`0014_inference-token-usage`** (journal index 14), not `0007` as authored — the plan was written against a branch 113 commits behind `main`; migration `0013_custom-fields` was the live latest at execution time.
> - **Tools-catalog row and `tools:inference` permission DROPPED this slice** — deferred to the first AI feature that has a real user surface. The `@magna-carta/tools` sidebar is for tools a user opens; this foundation ships no UI. Consequently there is also no seed migration (what the plan called `0008`). Exactly **one** new per-firm migration lands with this slice: `0014_inference-token-usage`.
> - **Standalone-resolver precedent:** the correct precedent is **`@magna-carta/government-links`** (formerly `@magna-carta/parcels`) — cited as `@magna-carta/property-links` in the as-authored plan; `government-links` is the actual standalone-library package the plan intends to cite.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the backend plumbing for the AI inference foundation — a standalone `@magna-carta/inference` package (the credential-less AI-Gateway-backed model chokepoint: `InferencePort`, the curated ZDR-eligible catalog, the per-firm reasoning-model setting, the platform-fixed embedding operation, the AI-Gateway-backed implementation), a one-row `@magna-carta/tools` catalog entry, an authoritative per-firm token-usage metering table in the firm-scoped data-access layer, and the worker call-site wiring (AI + Queue bindings, the off-hot-path Queue consumer, the firm-isolated metering write). No UI, no first AI feature, no BYOK adapter.

**Architecture:** `@magna-carta/inference` is a pure package (no D1, no Hono, no `env` in the contract surface) that reuses `@magna-carta/integrations` only at the **type level** — the `Dispatch` sum and the `IntegrationProblem` taxonomy. Its implementation goes direct to the authenticated Worker `AI` binding (`env.AI.run(model, input, { gateway: { id } })`) because the framework's buffered `Dispatch`/`HttpClient` cannot stream or run durably; it pins the confidentiality/tenancy control plane (caching off, logging off, derived firm metadata, fail-closed ZDR) on every request through the binding's documented `gateway` options. The worker is the composition root for the call site only — it reads the firm's model through the firm-scoped data-access layer, dispatches off the hot path via a Queue, and writes the authoritative response-captured token-usage record through the firm-scoped data-access layer.

**Tech Stack:** TypeScript (NodeNext, explicit `.ts` imports), Zod 4 (`catalog:`), Vitest via `vp test`, pnpm workspace, Drizzle (per-firm schema + drizzle-kit migration), Cloudflare Workers AI + AI Gateway (`Ai` binding) + Queues, Miniflare worker integration via `cloudflare:test`. Follows the pure-package conventions of `@magna-carta/integrations` / `@magna-carta/tools`.

## Global Constraints

Copy these into every task's mental checklist; they bind the whole plan.

- **Spell every name in full — no shorthand (golden rule 12):** `@magna-carta/data-access` not "the DAL", `newIdentifier` not `newId`, "the data-access layer" not "DAL". Only documented storage-encoding suffixes and universal external terms (`id`, `URL`, `JSON`, `SQL`) are exempt.
- **No process-doc citations in proposed source or consumer-facing strings (golden rule 13):** no `ADR-NNNN`, no "spec §N", no "slice 0·N" / "Phase N" / "decided #N" / "spike" in source, tests, comments, or OpenAPI `description`s. State the reasoning inline or cite a concrete file. A _forward-looking_ "swapped in a later slice" schedule phrase is the one allowed exception. Enforced by `pnpm run lint:process-refs`.
- **All business data through the firm-scoped data-access layer (golden rule 3):** no query crosses firms; the firm's own D1 handle (`firmDatabase`) is the structural isolation; bulk content to R2, never D1.
- **Redact by default; never log privileged content (golden rule 4):** `problem.detail` is caller-safe text only — never a spliced upstream response body (which can echo tokens/auth headers). Gateway metadata keys are opaque ids only, never client/matter text.
- **No heavy work on the hot path (golden rule 10):** inference dispatches off the hot path via a Queue; the streaming path never buffers the full response to scan it.
- **TDD, write-path fixtures, never raw inserts** for the firm-scoped data: compose through the effect batch (`composeEffectBatch`/`commitEffectBatch`), never hand-write an `INSERT` in a test fixture for the metering record.
- **Model ids are gateway-routable, provider-prefixed** (`anthropic/claude-opus-4-8`); a separate bare `referenceId` (`claude-opus-4-8`) is used only for Anthropic-reference ZDR/retention verification.
- **Commands.** Quality gate: `pnpm check` (`vp check` fmt+lint+typecheck AND `svelte-check`). Tests: `vp test` (Vitest single-run incl. the Miniflare worker integration test). Per-file from inside a package: `vp test run test/<name>.test.ts`. Per-package: `pnpm --filter @magna-carta/inference test`. Process-ref scan: `pnpm run lint:process-refs`. Deploy dry-run: `pnpm --filter @magna-carta/worker exec wrangler deploy --dry-run`.
- **Commit policy:** every commit message ends with the footer line `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` — the exact trailer from the repo's current `CLAUDE.md` commit-footer rule. (The integration-port-system exemplar uses an older `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` variant; that variant is stale — do **not** copy it. Use the no-suffix form shown in every commit step below.)

---

## File structure

**New package `packages/inference/`:**

- `package.json`, `tsconfig.json`, `vitest.config.ts` — scaffold (mirrors `packages/integrations`).
- `src/port.ts` — `InferenceModelId`, `GenerateInput`, `TokenUsage`, `GenerateResult`, `StreamResult`, `EmbedInput`, `EmbeddingResult`, the `InferencePort` interface (no `cf-aig-*`, no `env`).
- `src/catalog.ts` — `CatalogEntry` + `catalogEntrySchema`, the `CATALOG` table, module-load validation, the reasoning-subset/embedding accessors.
- `src/settings.ts` — `primaryReasoningModelDefinition` + `aiProcessingEligibilityDefinition` (the inference-owned `FirmSettingDefinition`s).
- `src/gateway.ts` — `gatewayOptions`, `deriveFirmMetadata`, the fail-closed ZDR guard, `createGatewayInferencePort`, the `AiBinding` type seam.
- `test/*.test.ts` — one suite per module.
- `CLAUDE.md` — local notes.

**Modified `packages/data-access/`:**

- Create `src/token-usage-statements.ts` — `tokenUsageCommitStatements` + `readTokenUsage`.
- Modify `package.json` — add the `./token-usage-statements` subpath export.

**Modified `packages/database/`:**

- Modify `src/per-firm-schema.ts` — the `tokenUsageMeter` table.
- Create `drizzle/per-firm/0007_inference-token-usage.sql` + journal entry (**drizzle-kit generated** — a `CREATE TABLE` schema change).
- Create `drizzle/per-firm/0008_seed-tools-inference.sql` + journal entry (**hand-written** data seed — drizzle-kit emits nothing for a pure-data migration).

**Modified `packages/access-control/`:** `src/registry.ts` — the `tools:inference` permission.

**Modified `packages/tools/`:** `src/catalog.ts` — one row.

**Modified `apps/worker/`:**

- Modify `src/http/app.ts` — `AI: Ai` + `INFERENCE: Queue` bindings on `Bindings`.
- Create `src/inference/call-site.ts` — the firm-scoped read + port construction helper.
- Create `src/background/inference/inference-consumer.ts` — the Queue consumer + `firmRateGate` pass-through hook + the metering write.
- Modify `src/index.ts` — route the inference queue.
- Modify `src/per-firm-migrations.ts` — register 0007 **and** 0008 in the `migrationsFromJournal` map.
- Modify `wrangler.jsonc` — the `INFERENCE` producer/consumer + the `ai` binding.
- Create `test/inference-isolation.test.ts` — the Miniflare firm-isolation integration test.

**Fitness tests:** `packages/inference/test/fitness-*.test.ts` (caching-off, derived-firm-metadata, firm-prefixed-cache-key guard, catalog `zdrEligible` invariant).

**Docs:** `ROADMAP.md`, `STATUS.md`, `CHANGELOG.md`, `docs/operating-costs.md`, `docs/Magna-Carta-White-Paper.md`, `docs/Decision-Log.md`.

---

### Task 1: Scaffold the `@magna-carta/inference` package

**Files:**

- Create: `packages/inference/package.json`
- Create: `packages/inference/tsconfig.json`
- Create: `packages/inference/vitest.config.ts`
- Create: `packages/inference/src/port.ts` (placeholder export so the suite has something to import)
- Test: `packages/inference/test/smoke.test.ts`

**Interfaces:**

- Produces: the workspace package `@magna-carta/inference` with subpath exports `./port`, `./catalog`, `./settings`, `./gateway`.
- Consumes: nothing yet (deps declared but unused).

- [ ] **Step 1: Create the package manifest**

`packages/inference/package.json`:

```json
{
  "name": "@magna-carta/inference",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "sideEffects": false,
  "exports": {
    "./port": "./src/port.ts",
    "./catalog": "./src/catalog.ts",
    "./settings": "./src/settings.ts",
    "./gateway": "./src/gateway.ts"
  },
  "scripts": {
    "test": "vp test run"
  },
  "dependencies": {
    "@magna-carta/data-access": "workspace:*",
    "@magna-carta/identifiers": "workspace:*",
    "@magna-carta/integrations": "workspace:*",
    "zod": "catalog:"
  },
  "devDependencies": {
    "@magna-carta/tsconfig": "workspace:*",
    "@types/node": "catalog:",
    "vitest": "catalog:"
  }
}
```

(`@magna-carta/data-access` is a dependency because `settings.ts` imports the `FirmSettingDefinition` type + the read/write accessors from `@magna-carta/data-access/setting-statements`.)

- [ ] **Step 2: Create the tsconfig and vitest config**

`packages/inference/tsconfig.json`:

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

`packages/inference/vitest.config.ts`:

```ts
import { defineConfig } from "vite-plus";

// Pure package: the default node pool, no Cloudflare Workers runtime.
// root is pinned to this package so the repo-root `vp test` resolves this project's tests from here.
export default defineConfig({
  root: import.meta.dirname,
});
```

- [ ] **Step 3: Add a placeholder source export and a smoke test**

`packages/inference/src/port.ts`:

```ts
// Placeholder — replaced in Task 2. Lets the workspace resolve the package before the real modules land.
export const INFERENCE_PACKAGE = "@magna-carta/inference";
```

`packages/inference/test/smoke.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { INFERENCE_PACKAGE } from "../src/port.ts";

describe("package", () => {
  it("is wired into the workspace", () => {
    expect(INFERENCE_PACKAGE).toBe("@magna-carta/inference");
  });
});
```

- [ ] **Step 4: Install and run the smoke test**

Run: `vp install && pnpm --filter @magna-carta/inference test`
Expected: PASS (1 test). `vp install` links the `workspace:*` deps; the `packages/*` glob in `pnpm-workspace.yaml` auto-includes the new package (no workspace edit).

- [ ] **Step 5: Commit**

```bash
git add packages/inference pnpm-lock.yaml
git commit -m "$(cat <<'EOF'
feat(inference): scaffold the AI inference foundation package

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: The `InferencePort` contract (streaming + durable + embedding)

**Files:**

- Modify: `packages/inference/src/port.ts`
- Delete (in this task): `packages/inference/test/smoke.test.ts`
- Test: `packages/inference/test/port.test.ts`

**Interfaces:**

- Consumes: `import type { Dispatch } from "@magna-carta/integrations/dispatch";` (the only reuse surface in the pure port); `import type { FirmId } from "@magna-carta/identifiers/types";`.
- Produces:
  - `type InferenceModelId = string` (the gateway-routable, provider-prefixed id passed to the operation).
  - `interface TokenUsage { readonly inputTokens: number; readonly outputTokens: number; }`
  - `interface GenerateInput { readonly modelId: InferenceModelId; readonly prompt: string; readonly firmId: FirmId; }`
  - `interface GenerateResult { readonly text: string; readonly usage: TokenUsage; readonly snapshotId: string; }`
  - `interface StreamResult { readonly stream: AsyncIterable<string>; readonly usage: Promise<TokenUsage>; readonly snapshotId: string; }`
  - `interface EmbedInput { readonly text: string; readonly firmId: FirmId; }` (no `modelId` — the type-enforced platform-fixed invariant).
  - `interface EmbeddingResult { readonly vector: readonly number[]; readonly usage: TokenUsage; readonly snapshotId: string; }`
  - `interface InferencePort { generate; generateStream; generateDurable; embed; }` (each returns `Promise<Dispatch<…>>`).

- [ ] **Step 1: Write the failing test**

`packages/inference/test/port.test.ts`:

```ts
import { describe, expectTypeOf, it } from "vitest";
import type { FirmId } from "@magna-carta/identifiers/types";
import type { Dispatch } from "@magna-carta/integrations/dispatch";
import type {
  EmbedInput,
  EmbeddingResult,
  GenerateInput,
  GenerateResult,
  InferencePort,
  StreamResult,
} from "../src/port.ts";

describe("InferencePort contract", () => {
  it("generate returns a buffered Dispatch carrying text + token usage + snapshot", () => {
    expectTypeOf<InferencePort["generate"]>().parameter(0).toEqualTypeOf<GenerateInput>();
    expectTypeOf<Awaited<ReturnType<InferencePort["generate"]>>>().toEqualTypeOf<
      Dispatch<GenerateResult>
    >();
    expectTypeOf<GenerateResult["usage"]>().toMatchTypeOf<{
      inputTokens: number;
      outputTokens: number;
    }>();
  });

  it("generateStream returns a token stream plus a deferred usage promise (no buffering)", () => {
    expectTypeOf<Awaited<ReturnType<InferencePort["generateStream"]>>>().toEqualTypeOf<
      Dispatch<StreamResult>
    >();
    expectTypeOf<StreamResult["stream"]>().toMatchTypeOf<AsyncIterable<string>>();
    expectTypeOf<StreamResult["usage"]>().toMatchTypeOf<Promise<unknown>>();
  });

  it("the embedding operation exposes NO firm-selectable model argument (the type-level invariant)", () => {
    expectTypeOf<EmbedInput>().toMatchTypeOf<{ text: string; firmId: FirmId }>();
    // @ts-expect-error embedding takes no caller-supplied model — it is platform-fixed.
    const _bad: EmbedInput = { text: "x", firmId: "firm_1" as FirmId, modelId: "anything" };
    expectTypeOf<Awaited<ReturnType<InferencePort["embed"]>>>().toEqualTypeOf<
      Dispatch<EmbeddingResult>
    >();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `packages/inference`): `vp test run test/port.test.ts`
Expected: FAIL — the named types are not exported from `../src/port.ts`.

- [ ] **Step 3: Write the implementation and delete the smoke test**

Replace `packages/inference/src/port.ts` entirely:

```ts
import type { FirmId } from "@magna-carta/identifiers/types";
import type { Dispatch } from "@magna-carta/integrations/dispatch";

// InferencePort is named in OUR domain vocabulary — never a vendor's API, never the gateway's. It is
// the single chokepoint every AI feature reaches a model through. Every operation returns a typed
// Dispatch: a model/provider/gateway failure becomes a first-class adapter-error carrying a normalized
// problem, never a bare throw. The reasoning model id is an explicit per-call parameter (read per call
// site through the firm-scoped data-access layer); it never rides on a connection or context object.

// A gateway-routable, provider-prefixed model id (e.g. "anthropic/claude-opus-4-8"). A bare id would
// not route through the gateway binding.
export type InferenceModelId = string;

// Authoritative per-request usage, captured from the inference RESPONSE (the provider usage object) —
// the durable billing source, never the gateway logs.
export interface TokenUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
}

// firmId is carried so the implementation can derive the gateway firm-metadata tag and the per-firm
// spend dimension; callers pass the firm context they already hold, never a free-form metadata string.
export interface GenerateInput {
  readonly modelId: InferenceModelId;
  readonly prompt: string;
  readonly firmId: FirmId;
}

export interface GenerateResult {
  readonly text: string;
  readonly usage: TokenUsage;
  // The pinned model snapshot the run actually used — persisted per run for reproducibility.
  readonly snapshotId: string;
}

// Streaming generation for interactive drafting where first-token latency matters. The stream is an
// async iterable of text deltas; usage resolves once the stream completes, so the caller never buffers
// the whole response (buffering to scan it would defeat streaming).
export interface StreamResult {
  readonly stream: AsyncIterable<string>;
  readonly usage: Promise<TokenUsage>;
  readonly snapshotId: string;
}

// The embedding operation is platform-fixed: its model is a module constant pinned to the Vectorize
// index version. There is deliberately NO modelId field — per-firm embedding variation is
// unrepresentable in the signature, because a firm-swappable embedding model would invalidate the index.
export interface EmbedInput {
  readonly text: string;
  readonly firmId: FirmId;
}

export interface EmbeddingResult {
  readonly vector: readonly number[];
  readonly usage: TokenUsage;
  readonly snapshotId: string;
}

export interface InferencePort {
  // Buffered text generation (one value).
  generate(input: GenerateInput): Promise<Dispatch<GenerateResult>>;
  // Streaming text generation (token deltas + deferred usage).
  generateStream(input: GenerateInput): Promise<Dispatch<StreamResult>>;
  // A long/agentic run invoked one operation per step from a durable Workflow — the run state lives in
  // the Workflow, not the port. The result shape matches generate; a Workflow step calls this per step.
  generateDurable(input: GenerateInput): Promise<Dispatch<GenerateResult>>;
  // The platform-fixed embedding operation (no firm-selectable model).
  embed(input: EmbedInput): Promise<Dispatch<EmbeddingResult>>;
}
```

Then delete the placeholder smoke test in the same step, so the suite is never transiently red on a vanished export: `git rm packages/inference/test/smoke.test.ts`.

- [ ] **Step 4: Run test to verify it passes**

Run (from `packages/inference`): `vp test run test/port.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/inference/src/port.ts packages/inference/test
git commit -m "$(cat <<'EOF'
feat(inference): the InferencePort contract (streaming + durable + fixed embedding)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: The curated model catalog + module-load validation

**Files:**

- Create: `packages/inference/src/catalog.ts`
- Test: `packages/inference/test/catalog.test.ts`

**Interfaces:**

- Consumes: `zod`; `import type { InferenceModelId } from "./port.ts";`.
- Produces:
  - `type ModelSlot = "reasoning" | "utility" | "embedding"`.
  - `interface CatalogEntry { slot; modelId; snapshotId; referenceId; zdrEligible; noTrainingEligible; verifiedOn; }`.
  - `const catalogEntrySchema: z.ZodType<CatalogEntry>`.
  - `const CATALOG: readonly CatalogEntry[]` (validated at module load).
  - `const CATALOG_VERSION: number`, `const CATALOG_EFFECTIVE_DATE: string`.
  - `const PLATFORM_EMBEDDING_MODEL_ID: string` — the platform-fixed embedding id, isolated as ONE named constant flagged "confirm against the Vectorize index version before merge". The spec/research name no embedding model id, so the implementer fills this from the Vectorize index they pin to; the test asserts only the structural invariants below, never this literal.
  - `function reasoningModelIds(): readonly InferenceModelId[]`.
  - `function embeddingEntry(): CatalogEntry`.
  - `function isZdrEligible(modelId: string): boolean`.
  - `function catalogEntryFor(modelId: string): CatalogEntry | undefined`.

- [ ] **Step 1: Write the failing test**

`packages/inference/test/catalog.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  CATALOG,
  CATALOG_VERSION,
  catalogEntrySchema,
  embeddingEntry,
  isZdrEligible,
  reasoningModelIds,
} from "../src/catalog.ts";

describe("the curated model catalog", () => {
  it("validates every entry at module load (the import did not throw)", () => {
    expect(CATALOG.length).toBeGreaterThan(0);
    expect(CATALOG_VERSION).toBeGreaterThanOrEqual(1);
  });

  it("ships the default reasoning model anthropic/claude-opus-4-8 in the ZDR-eligible subset", () => {
    expect(reasoningModelIds()).toContain("anthropic/claude-opus-4-8");
  });

  it("EXCLUDES claude-fable-5 — it mandates retention and is not ZDR-eligible", () => {
    expect(CATALOG.some((entry) => entry.referenceId === "claude-fable-5")).toBe(false);
  });

  it("every reasoning entry is zdrEligible", () => {
    for (const entry of CATALOG.filter((e) => e.slot === "reasoning")) {
      expect(entry.zdrEligible, entry.modelId).toBe(true);
    }
  });

  it("has exactly one embedding entry, platform-fixed and ZDR-eligible (no provider hardcoded here)", () => {
    // Structural invariants only — the embedding model id is a named constant in catalog.ts that the
    // implementer confirms against the Vectorize index version; the test never pins a provider/model.
    const embeddings = CATALOG.filter((e) => e.slot === "embedding");
    expect(embeddings).toHaveLength(1);
    expect(embeddingEntry().slot).toBe("embedding");
    expect(embeddingEntry().zdrEligible).toBe(true);
  });

  it("isZdrEligible answers per model id", () => {
    expect(isZdrEligible("anthropic/claude-opus-4-8")).toBe(true);
    expect(isZdrEligible("anthropic/not-in-catalog")).toBe(false);
  });

  it("rejects a malformed entry through the entry schema (module-load guard)", () => {
    const result = catalogEntrySchema.safeParse({
      slot: "reasoning",
      modelId: "anthropic/claude-opus-4-8",
      // missing snapshotId/referenceId/zdrEligible/noTrainingEligible/verifiedOn
    });
    expect(result.success).toBe(false);
  });

  it("the entry schema enforces a reasoning entry to be zdrEligible", () => {
    const nonZdrReasoning = {
      slot: "reasoning",
      modelId: "anthropic/some-model",
      snapshotId: "some-model-20260101",
      referenceId: "some-model",
      zdrEligible: false,
      noTrainingEligible: true,
      verifiedOn: "2026-06-17",
    };
    expect(catalogEntrySchema.safeParse(nonZdrReasoning).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `vp test run test/catalog.test.ts`
Expected: FAIL — `../src/catalog.ts` not found.

- [ ] **Step 3: Write the implementation**

`packages/inference/src/catalog.ts`:

```ts
import { z } from "zod";
import type { InferenceModelId } from "./port.ts";

// The single curated source of truth for which models exist, what they retain, and which slot they may
// fill. Eligibility is VERIFIED DATA, not a constant trusted blindly: model ids and retention/ZDR facts
// are re-checked against the Anthropic reference per release (verifiedOn records the last check). The
// catalog is validated at module load, so a malformed entry fails loud at import — never at first
// inference.

export type ModelSlot = "reasoning" | "utility" | "embedding";

export interface CatalogEntry {
  // The slot the model may fill.
  readonly slot: ModelSlot;
  // The gateway-routable, provider-prefixed id passed to the AI binding.
  readonly modelId: InferenceModelId;
  // The pinned snapshot in effect — persisted per run so a result is reproducible.
  readonly snapshotId: string;
  // The bare first-party id used only when verifying ZDR/retention against the Anthropic reference.
  readonly referenceId: string;
  // True only when the provider supports Zero-Data-Retention for this model under the gateway.
  readonly zdrEligible: boolean;
  // True when the provider will not train on the data.
  readonly noTrainingEligible: boolean;
  // ISO date the entry was last verified against the reference.
  readonly verifiedOn: string;
}

// A reasoning entry that is not ZDR-eligible can never enter the reasoning slot, so the entry schema
// itself refuses it — the curated invariant is enforced at the data boundary, not only in a fitness test.
export const catalogEntrySchema: z.ZodType<CatalogEntry> = z
  .object({
    slot: z.enum(["reasoning", "utility", "embedding"]),
    modelId: z.string().min(1),
    snapshotId: z.string().min(1),
    referenceId: z.string().min(1),
    zdrEligible: z.boolean(),
    noTrainingEligible: z.boolean(),
    verifiedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  })
  .refine((entry) => entry.slot !== "reasoning" || entry.zdrEligible, {
    message: "a reasoning model must be ZDR-eligible",
  });

// Table-level version + effective date — the hook a future eval harness attaches to (nothing to
// evaluate yet).
export const CATALOG_VERSION = 1;
export const CATALOG_EFFECTIVE_DATE = "2026-06-17";

// CONFIRM BEFORE MERGE: this id must equal the embedding model the live Vectorize index was built with —
// a mismatch silently corrupts similarity. It is platform-fixed (no firm selects it) and versioned with
// the index. The reasoning/utility ids and their ZDR facts are verified against the Anthropic reference;
// this embedding id is pinned to the index, not asserted ZDR-verified by the reasoning-reference process.
export const PLATFORM_EMBEDDING_MODEL_ID = "@cf/baai/bge-large-en-v1.5";

// The launch catalog. Reasoning default first; the small utility model; the platform-fixed embedding
// model pinned to the Vectorize index version. claude-fable-5 is intentionally absent — it mandates a
// retention window and returns a hard error under ZDR, so it is not ZDR-eligible and never enters the
// reasoning slot.
const RAW_CATALOG: readonly CatalogEntry[] = [
  {
    slot: "reasoning",
    modelId: "anthropic/claude-opus-4-8",
    snapshotId: "claude-opus-4-8-20260101",
    referenceId: "claude-opus-4-8",
    zdrEligible: true,
    noTrainingEligible: true,
    verifiedOn: "2026-06-17",
  },
  {
    slot: "reasoning",
    modelId: "anthropic/claude-sonnet-4-6",
    snapshotId: "claude-sonnet-4-6-20260101",
    referenceId: "claude-sonnet-4-6",
    zdrEligible: true,
    noTrainingEligible: true,
    verifiedOn: "2026-06-17",
  },
  {
    slot: "utility",
    modelId: "anthropic/claude-haiku-4-5",
    snapshotId: "claude-haiku-4-5-20260101",
    referenceId: "claude-haiku-4-5",
    zdrEligible: true,
    noTrainingEligible: true,
    verifiedOn: "2026-06-17",
  },
  {
    slot: "embedding",
    modelId: PLATFORM_EMBEDDING_MODEL_ID,
    snapshotId: `${PLATFORM_EMBEDDING_MODEL_ID}@vectorize-index-v1`,
    referenceId: PLATFORM_EMBEDDING_MODEL_ID,
    zdrEligible: true,
    noTrainingEligible: true,
    verifiedOn: "2026-06-17",
  },
];

// Module-load validation: every entry parses (all fields present, every reasoning entry ZDR-eligible),
// and exactly one embedding entry exists. A malformed table aborts the import.
function validateCatalog(entries: readonly CatalogEntry[]): readonly CatalogEntry[] {
  const validated = entries.map((entry) => catalogEntrySchema.parse(entry));
  const embeddings = validated.filter((entry) => entry.slot === "embedding");
  if (embeddings.length !== 1) {
    throw new Error(
      `the catalog must declare exactly one embedding entry (found ${embeddings.length})`,
    );
  }
  return validated;
}

export const CATALOG: readonly CatalogEntry[] = validateCatalog(RAW_CATALOG);

const REASONING_IDS: readonly InferenceModelId[] = CATALOG.filter(
  (entry) => entry.slot === "reasoning",
).map((entry) => entry.modelId);

const ZDR_IDS: ReadonlySet<string> = new Set(
  CATALOG.filter((entry) => entry.zdrEligible).map((entry) => entry.modelId),
);

// The ZDR-eligible reasoning subset a firm may select from (consumed by the setting schema).
export function reasoningModelIds(): readonly InferenceModelId[] {
  return REASONING_IDS;
}

// The single platform-fixed embedding entry the embedding operation closes over.
export function embeddingEntry(): CatalogEntry {
  const entry = CATALOG.find((candidate) => candidate.slot === "embedding");
  if (entry === undefined) throw new Error("no embedding entry in the catalog");
  return entry;
}

export function isZdrEligible(modelId: string): boolean {
  return ZDR_IDS.has(modelId);
}

export function catalogEntryFor(modelId: string): CatalogEntry | undefined {
  return CATALOG.find((entry) => entry.modelId === modelId);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run (from `packages/inference`): `vp test run test/catalog.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/inference/src/catalog.ts packages/inference/test/catalog.test.ts
git commit -m "$(cat <<'EOF'
feat(inference): curated ZDR-eligible model catalog with module-load validation

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: The per-firm reasoning-model setting + the AI-eligibility setting

**Files:**

- Create: `packages/inference/src/settings.ts`
- Test: `packages/inference/test/settings.test.ts`

**Interfaces:**

- Consumes: `import type { FirmSettingDefinition } from "@magna-carta/data-access/setting-statements";`, `import { readFirmSetting, writeFirmSettingStatement } from "@magna-carta/data-access/setting-statements";`, `import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";`, `reasoningModelIds` from `./catalog.ts`, `zod`.
- Produces:
  - `const primaryReasoningModelDefinition: FirmSettingDefinition<string>` — `{ key: "inference.primaryReasoningModel", schema: refinement-over-the-ZDR-reasoning-subset, defaultValue: "anthropic/claude-opus-4-8" }`.
  - `const aiProcessingEligibilityDefinition: FirmSettingDefinition<boolean>` — `{ key: "inference.aiProcessingEligibility", schema: z.boolean(), defaultValue: false }`.

- [ ] **Step 1: Write the failing test**

`packages/inference/test/settings.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import {
  readFirmSetting,
  writeFirmSettingStatement,
} from "@magna-carta/data-access/setting-statements";
import {
  aiProcessingEligibilityDefinition,
  primaryReasoningModelDefinition,
} from "../src/settings.ts";

// A minimal in-memory stand-in for the firm's D1 handle, honoring the real SqlStatement return shapes
// (run -> { meta: { changes } }, all -> { results }) so the fake conforms to the SqlDatabase contract
// the production accessor consumes (no `as never` escape hatch).
function fakeDatabase() {
  const rows = new Map<string, string>();
  const database = {
    rows,
    prepare(_sql: string) {
      const binds: unknown[] = [];
      return {
        bind(...values: unknown[]) {
          binds.push(...values);
          return this;
        },
        async all<T>() {
          // SELECT value FROM setting WHERE key = ?1
          const value = rows.get(binds[0] as string);
          return { results: (value === undefined ? [] : [{ value }]) as T[] };
        },
        async run() {
          // INSERT ... (key, value, updated_at) ...
          rows.set(binds[0] as string, binds[1] as string);
          return { meta: { changes: 1 } };
        },
      };
    },
  };
  return database;
}

const asDatabase = (database: ReturnType<typeof fakeDatabase>): SqlDatabase =>
  database as unknown as SqlDatabase;

describe("primaryReasoningModelDefinition", () => {
  it("defaults to anthropic/claude-opus-4-8 on a missing row", async () => {
    const database = fakeDatabase();
    expect(await readFirmSetting(asDatabase(database), primaryReasoningModelDefinition)).toBe(
      "anthropic/claude-opus-4-8",
    );
  });

  it("accepts an in-catalog ZDR-eligible reasoning id at the write path", async () => {
    const database = fakeDatabase();
    await writeFirmSettingStatement(
      asDatabase(database),
      primaryReasoningModelDefinition,
      "anthropic/claude-sonnet-4-6",
      "2026-06-18T00:00:00.000Z",
    ).run();
    expect(await readFirmSetting(asDatabase(database), primaryReasoningModelDefinition)).toBe(
      "anthropic/claude-sonnet-4-6",
    );
  });

  it("rejects an off-catalog id at the write path (schema.parse fails loud)", () => {
    const database = fakeDatabase();
    expect(() =>
      writeFirmSettingStatement(
        asDatabase(database),
        primaryReasoningModelDefinition,
        "anthropic/not-in-catalog",
        "2026-06-18T00:00:00.000Z",
      ),
    ).toThrow();
  });

  it("read stays total on a schema-invalid stored value (returns the default)", async () => {
    const database = fakeDatabase();
    database.rows.set("inference.primaryReasoningModel", JSON.stringify("garbage/model"));
    expect(await readFirmSetting(asDatabase(database), primaryReasoningModelDefinition)).toBe(
      "anthropic/claude-opus-4-8",
    );
  });
});

describe("aiProcessingEligibilityDefinition", () => {
  it("defaults to false — third-party-frontier egress is off until a firm opts in", async () => {
    const database = fakeDatabase();
    expect(await readFirmSetting(asDatabase(database), aiProcessingEligibilityDefinition)).toBe(
      false,
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `vp test run test/settings.test.ts`
Expected: FAIL — `../src/settings.ts` not found.

- [ ] **Step 3: Write the implementation**

`packages/inference/src/settings.ts`:

```ts
import type { FirmSettingDefinition } from "@magna-carta/data-access/setting-statements";
import { z } from "zod";
import { reasoningModelIds } from "./catalog.ts";

// Per-firm inference configuration, read through the generic firm-setting accessor (a missing row = the
// default in code). The selection UI is a later slice; these are the storage seam.

// The firm's primary reasoning model. The schema is a refinement over the curated ZDR-eligible reasoning
// subset, so the existing setting write-time validation (writeFirmSettingStatement's schema.parse) is
// the enforcement point: an off-catalog or non-ZDR id is rejected at the write path, no new machinery.
// The read stays total — a missing/invalid stored value yields the safe default.
const reasoningModelSchema = z
  .string()
  .refine((value) => (reasoningModelIds() as readonly string[]).includes(value), {
    message: "not a selectable ZDR-eligible reasoning model",
  });

export const primaryReasoningModelDefinition: FirmSettingDefinition<string> = {
  key: "inference.primaryReasoningModel",
  schema: reasoningModelSchema,
  defaultValue: "anthropic/claude-opus-4-8",
};

// The firm-default policy axis: may this firm's content go to a third-party frontier model at all?
// Default OFF — the strictest posture; privilege never rides on an implicit yes. Per-matter granularity,
// enforcement, and the consent surface land with the first concrete AI feature, which owns the caller.
export const aiProcessingEligibilityDefinition: FirmSettingDefinition<boolean> = {
  key: "inference.aiProcessingEligibility",
  schema: z.boolean(),
  defaultValue: false,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run (from `packages/inference`): `vp test run test/settings.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/inference/src/settings.ts packages/inference/test/settings.test.ts
git commit -m "$(cat <<'EOF'
feat(inference): per-firm reasoning-model + AI-eligibility settings

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: The gateway request control plane (binding options + ZDR guard)

This task builds the **pure** request-shaping pieces of the implementation (no `AI` binding call yet), so they can be unit-tested in isolation before wiring the binding. Task 6 composes them into `createGatewayInferencePort`.

The control plane is realized through the **AI binding's documented `gateway` options object** — `{ id, skipCache, collectLog, cacheKey?, metadata }` — NOT through `cf-aig-*` string headers (those are the REST-API surface the binding does not consume). Caching is pinned off with `skipCache: true`; request logging is pinned off with `collectLog: false`. The binding's `collectLog` is all-or-nothing (it has no payload-only toggle equivalent to the REST `cf-aig-collect-log-payload`), so we set it `false` outright — no prompt/response body is logged — and the authoritative token usage is read from the inference RESPONSE (Task 6), independent of logs.

**Files:**

- Create: `packages/inference/src/gateway.ts` (partial — the pure helpers + types)
- Test: `packages/inference/test/gateway-controls.test.ts`

**Interfaces:**

- Consumes: `import { adapterError, type Dispatch } from "@magna-carta/integrations/dispatch";`, `import { integrationProblem, type IntegrationProblem } from "@magna-carta/integrations/problem";`, `isZdrEligible` from `./catalog.ts`, `import type { FirmId } from "@magna-carta/identifiers/types";`.
- Produces:
  - `const GATEWAY_ID = "magna-carta-inference"`.
  - `interface GatewayOptions { readonly id: string; readonly skipCache: true; readonly collectLog: false; readonly metadata: Record<string, string>; }` — the exact shape passed as `{ gateway: GatewayOptions }` to `env.AI.run`.
  - `function deriveFirmMetadata(firmId, slot, env): Record<string, string>` — `{ firm_id, slot, env }`; opaque ids only, ≤5 keys, no `model` tag.
  - `function gatewayOptions(firmId, slot, env): GatewayOptions`.
  - `function assertZdrEligible(modelId): IntegrationProblem | null` — the fail-closed guard. On a miss it returns a caller-safe **non-retryable** (`category: "validation"`) problem — a local fail-closed policy refusal must never be advertised as a retryable upstream error.
  - `function zdrRejection<T>(modelId): Dispatch<T>`.

- [ ] **Step 1: Write the failing test**

`packages/inference/test/gateway-controls.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { FirmId } from "@magna-carta/identifiers/types";
import {
  assertZdrEligible,
  deriveFirmMetadata,
  gatewayOptions,
  zdrRejection,
} from "../src/gateway.ts";

const FIRM = "firm_abc" as FirmId;

describe("derived firm metadata", () => {
  it("carries a non-empty firm_id plus opaque ids only, never a model tag, <=5 keys", () => {
    const metadata = deriveFirmMetadata(FIRM, "reasoning", "production");
    expect(metadata.firm_id).toBe("firm_abc");
    expect(metadata.slot).toBe("reasoning");
    expect(metadata.env).toBe("production");
    expect(metadata).not.toHaveProperty("model");
    expect(Object.keys(metadata).length).toBeLessThanOrEqual(5);
  });
});

describe("gateway options (the binding control plane)", () => {
  it("pins caching off and logging off on every request, with derived metadata", () => {
    const options = gatewayOptions(FIRM, "reasoning", "production");
    expect(options.id).toBe("magna-carta-inference");
    expect(options.skipCache).toBe(true);
    expect(options.collectLog).toBe(false);
    expect(options.metadata.firm_id).toBe("firm_abc");
  });

  it("never sets a cache key (a key alone caches even with caching off)", () => {
    expect(gatewayOptions(FIRM, "reasoning", "production")).not.toHaveProperty("cacheKey");
  });
});

describe("the fail-closed ZDR guard", () => {
  it("passes a ZDR-eligible model", () => {
    expect(assertZdrEligible("anthropic/claude-opus-4-8")).toBeNull();
  });

  it("rejects a non-ZDR model with a caller-safe, NON-retryable problem (no spliced body)", () => {
    const problem = assertZdrEligible("anthropic/not-in-catalog");
    expect(problem).not.toBeNull();
    expect(problem?.category).toBe("validation"); // a local policy refusal, never a retryable upstream
    expect(problem?.retryable).toBe(false);
    expect(problem?.detail).not.toContain("anthropic/not-in-catalog"); // caller-safe, no echoed input
  });

  it("zdrRejection yields a typed adapter-error Dispatch", () => {
    const dispatch = zdrRejection("anthropic/not-in-catalog");
    expect(dispatch).toMatchObject({ ok: false, reason: "adapter-error" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `vp test run test/gateway-controls.test.ts`
Expected: FAIL — `../src/gateway.ts` not found.

- [ ] **Step 3: Write the implementation**

`packages/inference/src/gateway.ts`:

```ts
import type { FirmId } from "@magna-carta/identifiers/types";
import { adapterError, type Dispatch } from "@magna-carta/integrations/dispatch";
import { integrationProblem, type IntegrationProblem } from "@magna-carta/integrations/problem";
import { isZdrEligible } from "./catalog.ts";

// All firms share one gateway per environment. The control plane below is pinned on EVERY request via
// the AI binding's documented `gateway` options object (id/skipCache/collectLog/metadata) — NOT via
// cf-aig-* string headers, which are the REST-API surface the binding does not read. These options are
// the confidentiality and tenant-isolation guarantees the InferencePort promises, realized as gateway
// controls the interface never names.
export const GATEWAY_ID = "magna-carta-inference";

// The exact object passed as { gateway } to env.AI.run. skipCache is pinned true (caching off);
// collectLog is pinned false (the binding's logging toggle is all-or-nothing — there is no payload-only
// option on the binding path — so we turn logging off outright; no prompt/response body is ever logged,
// and authoritative usage is read from the response, not the logs). No cacheKey is ever set.
export interface GatewayOptions {
  readonly id: string;
  readonly skipCache: true;
  readonly collectLog: false;
  readonly metadata: Record<string, string>;
}

// Firm metadata is DERIVED from the firm-scoped call context, never caller-supplied — the tag fails
// open (the request still runs, mis-metered) if omitted, so it must be structural here. Opaque ids only:
// the metadata is logged in cleartext, so it carries no client/matter text. The redundant model tag is
// dropped (model is already a native gateway log/spend dimension). Capped well under the 5-key gateway
// limit so a future matter_id key still fits.
export function deriveFirmMetadata(
  firmId: FirmId,
  slot: string,
  env: string,
): Record<string, string> {
  return { firm_id: firmId, slot, env };
}

// Caching off + logging off, on every firm-data request. The default cache key carries no firm
// dimension under shared Cloudflare-managed billing credentials, so a byte-identical prompt from two
// firms could collide — caching stays off, and no cacheKey is ever set (any future cache key MUST be
// firm-id-prefixed; see the firm-prefixed-cache-key fitness guard).
export function gatewayOptions(firmId: FirmId, slot: string, env: string): GatewayOptions {
  return {
    id: GATEWAY_ID,
    skipCache: true,
    collectLog: false,
    metadata: deriveFirmMetadata(firmId, slot, env),
  };
}

// The fail-closed ZDR guard: before dispatch, assert the selected model is ZDR-eligible in the catalog.
// On a miss it returns a caller-safe problem — never the model id or any upstream text. The category is
// "validation" (non-retryable): this is a LOCAL fail-closed policy refusal, not an upstream failure, so
// it must never be advertised as a retryable upstream error a caller would re-attempt.
export function assertZdrEligible(modelId: string): IntegrationProblem | null {
  if (isZdrEligible(modelId)) return null;
  return integrationProblem("validation", 400, "Model is not eligible for zero-data-retention", {
    detail:
      "The selected model is not zero-data-retention eligible and cannot process firm content.",
  });
}

export function zdrRejection<T>(modelId: string): Dispatch<T> {
  const problem = assertZdrEligible(modelId);
  // Only call this when a rejection is intended; a null here is a programming error, surfaced loud.
  if (problem === null) throw new Error("zdrRejection called for a ZDR-eligible model");
  return adapterError<T>(problem);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run (from `packages/inference`): `vp test run test/gateway-controls.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/inference/src/gateway.ts packages/inference/test/gateway-controls.test.ts
git commit -m "$(cat <<'EOF'
feat(inference): gateway control plane — caching-off, logging-off, derived metadata, fail-closed ZDR guard

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: The AI-Gateway-backed `InferencePort` implementation

**Files:**

- Modify: `packages/inference/src/gateway.ts` (merge the new imports into the existing top import block; append the port factory + the `AiBinding` seam + usage extraction)
- Test: `packages/inference/test/gateway-port.test.ts`

**Interfaces:**

- Consumes (merged into `gateway.ts`'s existing imports): add `ok` to the existing `@magna-carta/integrations/dispatch` import; add `catalogEntryFor`, `embeddingEntry` to the existing `./catalog.ts` import; add a new `import type { … } from "./port.ts";`.
- Produces:
  - `interface AiBinding { run(model: string, input: unknown, options: { gateway: GatewayOptions }): Promise<unknown>; }` — the minimal structural seam over the platform `Ai` binding (so the pure package needs no `@cloudflare/workers-types`).
  - `interface GatewayPortOptions { readonly ai: AiBinding; readonly env: string; }`.
  - `function createGatewayInferencePort(options: GatewayPortOptions): InferencePort`.
  - `function extractUsage(response: unknown): TokenUsage` (reads the provider usage object from the response — the authoritative billing source).

- [ ] **Step 1: Write the failing test**

`packages/inference/test/gateway-port.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import type { FirmId } from "@magna-carta/identifiers/types";
import { createGatewayInferencePort, GATEWAY_ID, type AiBinding } from "../src/gateway.ts";

const FIRM = "firm_t" as FirmId;

// A fake AI binding capturing the model + options it is called with, and replaying a canned response
// shaped like the gateway's (text + a usage object).
function fakeAi(response: unknown): {
  ai: AiBinding;
  calls: Array<{ model: string; options: unknown }>;
} {
  const calls: Array<{ model: string; options: unknown }> = [];
  return {
    calls,
    ai: {
      async run(model, _input, options) {
        calls.push({ model, options });
        return response;
      },
    },
  };
}

// A streaming fake whose run() returns an async generator of deltas plus a terminal usage object the
// stream closure reads after the stream drains.
function streamingAi(
  deltas: string[],
  usage: { prompt_tokens: number; completion_tokens: number },
) {
  async function* gen(): AsyncGenerator<string> {
    for (const delta of deltas) yield delta;
  }
  const stream = gen() as AsyncGenerator<string> & {
    usage: { prompt_tokens: number; completion_tokens: number };
  };
  stream.usage = usage; // extractUsage reads .usage off the returned object
  return { ai: { run: async () => stream } satisfies AiBinding };
}

describe("createGatewayInferencePort.generate", () => {
  it("routes through the gateway with caching off, logging off, derived metadata; returns usage", async () => {
    const { ai, calls } = fakeAi({
      response: "Drafted clause.",
      usage: { prompt_tokens: 11, completion_tokens: 22 },
    });
    const port = createGatewayInferencePort({ ai, env: "production" });
    const result = await port.generate({
      modelId: "anthropic/claude-opus-4-8",
      prompt: "Draft a clause.",
      firmId: FIRM,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.text).toBe("Drafted clause.");
      expect(result.value.usage).toEqual({ inputTokens: 11, outputTokens: 22 });
      expect(result.value.snapshotId).toBe("claude-opus-4-8-20260101");
    }
    expect(calls[0]?.model).toBe("anthropic/claude-opus-4-8");
    const options = calls[0]?.options as {
      gateway: {
        id: string;
        skipCache: boolean;
        collectLog: boolean;
        metadata: Record<string, string>;
      };
    };
    expect(options.gateway.id).toBe(GATEWAY_ID);
    expect(options.gateway.skipCache).toBe(true);
    expect(options.gateway.collectLog).toBe(false);
    expect(options.gateway.metadata.firm_id).toBe("firm_t");
  });

  it("rejects a non-ZDR model fail-closed without ever calling the binding", async () => {
    const { ai, calls } = fakeAi({ response: "x", usage: {} });
    const port = createGatewayInferencePort({ ai, env: "production" });
    const result = await port.generate({
      modelId: "anthropic/not-in-catalog",
      prompt: "x",
      firmId: FIRM,
    });
    expect(result).toMatchObject({ ok: false, reason: "adapter-error" });
    if (!result.ok) expect(result.problem?.retryable).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it("maps a thrown binding failure to a caller-safe adapter-error (no upstream body spliced)", async () => {
    const port = createGatewayInferencePort({
      ai: { run: vi.fn().mockRejectedValue(new Error("upstream 503: secret-token-leak")) },
      env: "production",
    });
    const result = await port.generate({
      modelId: "anthropic/claude-opus-4-8",
      prompt: "x",
      firmId: FIRM,
    });
    expect(result).toMatchObject({ ok: false, reason: "adapter-error" });
    if (!result.ok) expect(result.problem?.detail ?? "").not.toContain("secret-token-leak");
  });
});

describe("createGatewayInferencePort.generateStream", () => {
  it("relays deltas and resolves usage only after the stream drains", async () => {
    const { ai } = streamingAi(["Draf", "ted ", "clause."], {
      prompt_tokens: 5,
      completion_tokens: 7,
    });
    const port = createGatewayInferencePort({ ai, env: "production" });
    const result = await port.generateStream({
      modelId: "anthropic/claude-opus-4-8",
      prompt: "Draft.",
      firmId: FIRM,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.snapshotId).toBe("claude-opus-4-8-20260101");
    const collected: string[] = [];
    for await (const delta of result.value.stream) collected.push(delta);
    expect(collected.join("")).toBe("Drafted clause.");
    // Usage resolves once the stream has drained.
    expect(await result.value.usage).toEqual({ inputTokens: 5, outputTokens: 7 });
  });
});

describe("createGatewayInferencePort.embed", () => {
  it("uses the platform-fixed embedding model (no firm-selectable arg)", async () => {
    const { ai, calls } = fakeAi({
      data: [[0.1, 0.2]],
      usage: { prompt_tokens: 3, completion_tokens: 0 },
    });
    const port = createGatewayInferencePort({ ai, env: "production" });
    const result = await port.embed({ text: "embed me", firmId: FIRM });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.vector).toEqual([0.1, 0.2]);
    // The model is the catalog's single embedding entry — asserted via its slot, not a hardcoded id.
    expect(typeof calls[0]?.model).toBe("string");
    expect(
      (calls[0]?.options as { gateway: { metadata: { slot: string } } }).gateway.metadata.slot,
    ).toBe("embedding");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `vp test run test/gateway-port.test.ts`
Expected: FAIL — `createGatewayInferencePort` / `AiBinding` not exported.

- [ ] **Step 3: Merge the new imports into the top block, then append the implementation**

First, EDIT the existing import block at the top of `packages/inference/src/gateway.ts` (do not append a second import block at the bottom). Merge `ok` into the dispatch import, add `catalogEntryFor`/`embeddingEntry` to the catalog import, and add the `./port.ts` type import. The top of the file becomes:

```ts
import type { FirmId } from "@magna-carta/identifiers/types";
import { adapterError, ok, type Dispatch } from "@magna-carta/integrations/dispatch";
import { integrationProblem, type IntegrationProblem } from "@magna-carta/integrations/problem";
import { catalogEntryFor, embeddingEntry, isZdrEligible } from "./catalog.ts";
import type {
  EmbedInput,
  EmbeddingResult,
  GenerateInput,
  GenerateResult,
  InferencePort,
  StreamResult,
  TokenUsage,
} from "./port.ts";
```

Then APPEND to the end of `packages/inference/src/gateway.ts`:

```ts
// The minimal structural seam over the Worker AI binding the implementation calls. Declaring it here
// (rather than importing @cloudflare/workers-types) keeps the package pure — the worker passes its real
// `AI` binding, which satisfies this shape. The options carry only the documented `gateway` object.
export interface AiBinding {
  run(model: string, input: unknown, options: { gateway: GatewayOptions }): Promise<unknown>;
}

export interface GatewayPortOptions {
  readonly ai: AiBinding;
  // The deploy environment label that rides the firm metadata (e.g. "production"). Opaque to the gateway.
  readonly env: string;
}

// Reads the authoritative per-request usage from the inference RESPONSE (the provider usage object) —
// the durable billing source, independent of the gateway logs (which are off). Tolerant of an absent
// object (zeros), so a malformed response never throws on the metering path.
export function extractUsage(response: unknown): TokenUsage {
  const usage = (response as { usage?: { prompt_tokens?: number; completion_tokens?: number } })
    .usage;
  return {
    inputTokens: usage?.prompt_tokens ?? 0,
    outputTokens: usage?.completion_tokens ?? 0,
  };
}

function responseText(response: unknown): string {
  return String((response as { response?: unknown }).response ?? "");
}

function responseVector(response: unknown): readonly number[] {
  const data = (response as { data?: number[][] }).data;
  return data?.[0] ?? [];
}

// Caller-safe failure mapping: a thrown gateway/model/network error becomes an adapter-error carrying a
// normalized problem. The detail is a fixed caller-safe string — the raw error (which can echo tokens or
// auth headers) is never spliced into it (it is reported through the standard redacting pipeline upstream).
// upstream/502 is retryable, so a transient gateway failure is re-attempted off the hot path.
function gatewayFailure<T>(): Dispatch<T> {
  return adapterError<T>(
    integrationProblem("upstream", 502, "Inference request failed", {
      detail: "The inference request could not be completed.",
    }),
  );
}

export function createGatewayInferencePort(options: GatewayPortOptions): InferencePort {
  const { ai, env } = options;

  async function runGenerate(input: GenerateInput): Promise<Dispatch<GenerateResult>> {
    const guard = assertZdrEligible(input.modelId);
    if (guard !== null) return adapterError<GenerateResult>(guard);
    const entry = catalogEntryFor(input.modelId);
    if (entry === undefined) return zdrRejection<GenerateResult>(input.modelId);
    const gateway = gatewayOptions(input.firmId, entry.slot, env);
    try {
      const response = await ai.run(input.modelId, { prompt: input.prompt }, { gateway });
      return ok({
        text: responseText(response),
        usage: extractUsage(response),
        snapshotId: entry.snapshotId,
      });
    } catch {
      return gatewayFailure<GenerateResult>();
    }
  }

  return {
    generate: runGenerate,
    // A durable Workflow step invokes one operation per step; the buffered result shape matches generate.
    generateDurable: runGenerate,

    async generateStream(input): Promise<Dispatch<StreamResult>> {
      const guard = assertZdrEligible(input.modelId);
      if (guard !== null) return adapterError<StreamResult>(guard);
      const entry = catalogEntryFor(input.modelId);
      if (entry === undefined) return zdrRejection<StreamResult>(input.modelId);
      const gateway = gatewayOptions(input.firmId, entry.slot, env);
      try {
        const response = await ai.run(
          input.modelId,
          { prompt: input.prompt, stream: true },
          { gateway },
        );
        // The binding returns an async-iterable of text deltas under streaming; usage is read once the
        // stream completes (response-scanning stays off this path — buffering would defeat streaming).
        const stream = response as AsyncIterable<string>;
        let resolveUsage: (usage: TokenUsage) => void = () => {};
        const usage = new Promise<TokenUsage>((resolve) => (resolveUsage = resolve));
        async function* relay(): AsyncIterable<string> {
          for await (const delta of stream) yield String(delta);
          resolveUsage(extractUsage(response));
        }
        return ok({ stream: relay(), usage, snapshotId: entry.snapshotId });
      } catch {
        return gatewayFailure<StreamResult>();
      }
    },

    async embed(input: EmbedInput): Promise<Dispatch<EmbeddingResult>> {
      const entry = embeddingEntry();
      const gateway = gatewayOptions(input.firmId, entry.slot, env);
      try {
        const response = await ai.run(entry.modelId, { text: input.text }, { gateway });
        return ok({
          vector: responseVector(response),
          usage: extractUsage(response),
          snapshotId: entry.snapshotId,
        });
      } catch {
        return gatewayFailure<EmbeddingResult>();
      }
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @magna-carta/inference test`
Expected: PASS (all `inference` suites green, including the new `gateway-port` streaming + embed tests).

- [ ] **Step 5: Commit**

```bash
git add packages/inference/src/gateway.ts packages/inference/test/gateway-port.test.ts
git commit -m "$(cat <<'EOF'
feat(inference): the AI-Gateway-backed InferencePort implementation (buffered + streaming + embed)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: The fitness functions (caching-off, firm-prefixed-cache-key, derived-metadata, catalog ZDR)

**Files:**

- Create: `packages/inference/test/fitness-controls.test.ts`
- Create: `packages/inference/test/fitness-catalog.test.ts`

**Interfaces:**

- Consumes: `gatewayOptions`, `deriveFirmMetadata` from `../src/gateway.ts`; `CATALOG` from `../src/catalog.ts`. (No new production code — these are invariant guards over Task 3/5 output.)

- [ ] **Step 1: Write the caching-off + firm-prefixed-cache-key + derived-metadata fitness test**

`packages/inference/test/fitness-controls.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { FirmId } from "@magna-carta/identifiers/types";
import { deriveFirmMetadata, gatewayOptions, GATEWAY_ID } from "../src/gateway.ts";

// A representative spread of firms/slots/envs — the controls invariant holds for every one.
const CASES: Array<[FirmId, string, string]> = [
  ["firm_1" as FirmId, "reasoning", "production"],
  ["firm_2" as FirmId, "utility", "production"],
  ["firm_3" as FirmId, "embedding", "development"],
];

describe("caching-off fitness", () => {
  it("every request skips the cache and sets no cache key", () => {
    for (const [firmId, slot, env] of CASES) {
      const options = gatewayOptions(firmId, slot, env);
      expect(options.skipCache).toBe(true);
      // A cache key alone caches for minutes even with caching off — none may appear.
      expect(options).not.toHaveProperty("cacheKey");
    }
  });

  it("logging is off on every request (no prompt/response body is logged)", () => {
    for (const [firmId, slot, env] of CASES) {
      expect(gatewayOptions(firmId, slot, env).collectLog).toBe(false);
    }
  });
});

// The real spec invariant: a cache key, IF ever present, must be firm-id-prefixed (the default key
// carries no firm dimension under shared credentials, so two firms could collide). This guard fails any
// controls object that grows a non-firm-prefixed cache key, so a future "add caching" change cannot
// silently weaponize the shared default.
function cacheKeyIsFirmPrefixedOrAbsent(options: {
  metadata: { firm_id: string };
  cacheKey?: string;
}): boolean {
  if (options.cacheKey === undefined) return true;
  return options.cacheKey.startsWith(`${options.metadata.firm_id}:`);
}

describe("firm-prefixed-cache-key fitness", () => {
  it("holds for the shipped controls (no key today) and would reject a bare cache key", () => {
    for (const [firmId, slot, env] of CASES) {
      expect(cacheKeyIsFirmPrefixedOrAbsent(gatewayOptions(firmId, slot, env))).toBe(true);
    }
    // A hypothetical non-firm-prefixed key is rejected by the guard.
    expect(
      cacheKeyIsFirmPrefixedOrAbsent({ metadata: { firm_id: "firm_1" }, cacheKey: "global-key" }),
    ).toBe(false);
    expect(
      cacheKeyIsFirmPrefixedOrAbsent({ metadata: { firm_id: "firm_1" }, cacheKey: "firm_1:abc" }),
    ).toBe(true);
  });
});

describe("derived-firm-metadata fitness", () => {
  it("every request carries a derived non-empty firm_id, <=5 keys, no model tag", () => {
    for (const [firmId, slot, env] of CASES) {
      const metadata = deriveFirmMetadata(firmId, slot, env);
      expect(metadata.firm_id.length).toBeGreaterThan(0);
      expect(Object.keys(metadata).length).toBeLessThanOrEqual(5);
      expect(metadata).not.toHaveProperty("model");
      expect(gatewayOptions(firmId, slot, env).id).toBe(GATEWAY_ID);
    }
  });
});
```

- [ ] **Step 2: Write the catalog `zdrEligible` invariant fitness test**

`packages/inference/test/fitness-catalog.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { CATALOG } from "../src/catalog.ts";

describe("catalog zdrEligible invariant (fitness)", () => {
  it("every selectable reasoning model is ZDR-eligible — non-ZDR never enters the reasoning slot", () => {
    for (const entry of CATALOG.filter((e) => e.slot === "reasoning")) {
      expect(entry.zdrEligible, entry.modelId).toBe(true);
    }
  });

  it("exactly one embedding entry exists (the platform-fixed, index-pinned model)", () => {
    expect(CATALOG.filter((e) => e.slot === "embedding")).toHaveLength(1);
  });
});
```

- [ ] **Step 3: Run both fitness suites + the process-ref scan**

Run: `pnpm --filter @magna-carta/inference test`
Expected: PASS (all suites).
Run: `pnpm run lint:process-refs`
Expected: no process references reported.

- [ ] **Step 4: Commit**

```bash
git add packages/inference/test/fitness-controls.test.ts packages/inference/test/fitness-catalog.test.ts
git commit -m "$(cat <<'EOF'
test(inference): caching-off, firm-prefixed-cache-key, derived-metadata, and catalog ZDR fitness functions

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: The token-usage metering table (per-firm schema + migration + registration)

**Files:**

- Modify: `packages/database/src/per-firm-schema.ts` (add the `tokenUsageMeter` table)
- Create: `packages/database/drizzle/per-firm/0007_inference-token-usage.sql` (drizzle-kit generated)
- Modify: `packages/database/drizzle/per-firm/meta/_journal.json` (drizzle-kit generated — appended automatically)
- Modify: `packages/database/test/schema-conformance.test.ts` (the expected-table count + the composite-key allowlist)
- Modify: `apps/worker/src/per-firm-migrations.ts` (import + register 0007)

**Interfaces:**

- Produces: `export const tokenUsageMeter` — a `sqliteTable("token_usage_meter", …)` with a natural composite primary key `(day, slot, model_id)` (all three TEXT) and additive counters `input_tokens`, `output_tokens`, `request_count`. Authoritative, append-by-delta usage (`ON CONFLICT DO UPDATE SET col = col + excluded.col`) — the same idiom as `storageMeter`, so no new identifier handle is needed.

- [ ] **Step 1: Write the failing schema-conformance update**

In `packages/database/test/schema-conformance.test.ts`, bump the multi-line per-firm enumeration comment and the assertion (lines 17–21 are the real comment block; line 21 is the `>= 36` assertion). Replace the exact existing comment + assertion:

```ts
// control-plane: firm + the five Better Auth tables + auth_audit + outbox + idempotency_key (9);
// per-firm: idempotency_key, outbox, ledger_account, ledger_entry, ledger_line, account_balance,
// member, role, role_permission, member_role, direct_grant, incident (12) + location,
// location_address, member_location, matter_type, document_type, numbering_scheme,
// matter_number_counter, matter, folder, file, file_version, upload_session, storage_meter,
// setting, audit_log (15) = 27 per-firm; 9 + 27 = 36 across both lineages.
expect(ALL_TABLES.length).toBeGreaterThanOrEqual(36);
```

with (adds `token_usage_meter` to the file-manager-adjacent group, raising 15→16 and 27→28, 36→37):

```ts
// control-plane: firm + the five Better Auth tables + auth_audit + outbox + idempotency_key (9);
// per-firm: idempotency_key, outbox, ledger_account, ledger_entry, ledger_line, account_balance,
// member, role, role_permission, member_role, direct_grant, incident (12) + location,
// location_address, member_location, matter_type, document_type, numbering_scheme,
// matter_number_counter, matter, folder, file, file_version, upload_session, storage_meter,
// setting, audit_log, token_usage_meter (16) = 28 per-firm; 9 + 28 = 37 across both lineages.
expect(ALL_TABLES.length).toBeGreaterThanOrEqual(37);
```

And extend the composite-key allowlist (the real line is `const compositeKeyTables = new Set(["storage_meter"]);`):

```ts
// storage_meter and token_usage_meter are keyed by WHAT they roll up — composite natural keys, no
// handle. Every key column is TEXT (day/slot/model_id are all TEXT), so the existing TEXT-key
// assertion below holds.
const compositeKeyTables = new Set(["storage_meter", "token_usage_meter"]);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @magna-carta/database test`
Expected: FAIL — the table count is still 36 (the new table does not exist yet) and the composite-key allowlist now references a missing table.

- [ ] **Step 3: Add the table to the per-firm schema**

In `packages/database/src/per-firm-schema.ts`, after the `storageMeter` table, add:

```ts
// Authoritative per-firm AI token usage, captured from the inference RESPONSE (the provider usage
// object) — the durable, reconcilable billing source, never the gateway logs. Rolled up by
// (day, slot, model_id) so the firm-usage diagnostics feed reads a compact per-day breakdown. Composite
// NATURAL key (no handle) — the same documented exception as storage_meter; every key column is TEXT.
// The rollup moves by delta (INSERT ... ON CONFLICT DO UPDATE SET col = col + excluded.col) in the same
// batch as the run it counts.
export const tokenUsageMeter = sqliteTable(
  "token_usage_meter",
  {
    day: text("day").notNull(), // YYYY-MM-DD civil date bucket (UTC)
    slot: text("slot").notNull(), // reasoning | utility | embedding
    modelId: text("model_id").notNull(), // the gateway-routable, provider-prefixed id
    inputTokens: integer("input_tokens").notNull(),
    outputTokens: integer("output_tokens").notNull(),
    requestCount: integer("request_count").notNull(),
  },
  (table) => [primaryKey({ columns: [table.day, table.slot, table.modelId] })],
);
```

(`sqliteTable`, `text`, `integer`, `primaryKey` are already imported at the top of the file.)

- [ ] **Step 4: Generate the migration**

Run: `pnpm --filter @magna-carta/database run generate-per-firm-migrations`
Expected: drizzle-kit writes `packages/database/drizzle/per-firm/0007_<slug>.sql` containing `CREATE TABLE token_usage_meter (...)` and appends an `idx: 7` entry to `meta/_journal.json`. Rename the generated file to `0007_inference-token-usage.sql` and set the journal entry's `tag` to `0007_inference-token-usage` so the journal `tag` and the filename stem match byte-for-byte (the journal-driven runner resolves migrations by tag).

- [ ] **Step 5: Register 0007 in the worker bundle**

`apps/worker/src/per-firm-migrations.ts` carries an explicit name→SQL import map, and `migrationsFromJournal` fails loud when the journal gains a migration the map lacks (the file's own comment states this), so firm provisioning and every Miniflare migrate-to-head call would throw without this. Add the import after the `0006` import:

```ts
import seedToolsFirmUsageSql from "@magna-carta/database/drizzle/per-firm/0006_seed-tools-firm-usage.sql";
import inferenceTokenUsageSql from "@magna-carta/database/drizzle/per-firm/0007_inference-token-usage.sql";
```

And add the entry to the `migrationsFromJournal` map inside `perFirmMigrations()`:

```ts
    "0006_seed-tools-firm-usage": seedToolsFirmUsageSql,
    "0007_inference-token-usage": inferenceTokenUsageSql,
```

- [ ] **Step 6: Run the database suite + a worker migrate-check**

Run: `pnpm --filter @magna-carta/database test`
Expected: PASS — the generated-migrations test sees the new file matches the schema; schema-conformance passes with 37 tables and the extended composite-key allowlist.
Run: `pnpm --filter @magna-carta/worker exec wrangler deploy --dry-run`
Expected: PASS — the bundle compiles with no journal/map mismatch (the 0007 import resolves and the map carries its tag). `apps/worker/test/support/apply-per-firm-migrations.ts` reuses `perFirmMigrations()` directly, so registering it here is what makes the Task 14 Miniflare migrate succeed.

- [ ] **Step 7: Commit**

```bash
git add packages/database/src/per-firm-schema.ts packages/database/drizzle/per-firm packages/database/test/schema-conformance.test.ts apps/worker/src/per-firm-migrations.ts
git commit -m "$(cat <<'EOF'
feat(database): per-firm token-usage metering table, migration, and worker registration

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: The token-usage write-path builder + read accessor (data-access)

**Files:**

- Create: `packages/data-access/src/token-usage-statements.ts`
- Modify: `packages/data-access/package.json` (add the `./token-usage-statements` export)
- Test: `packages/data-access/test/token-usage-statements.test.ts`

**Interfaces:**

- Consumes: `import type { SqlDatabase, SqlStatement } from "./idempotency-statements.ts";`.
- Produces:
  - `const TOKEN_USAGE_METER_TABLE = "token_usage_meter"`.
  - `interface TokenUsageKey { readonly day: string; readonly slot: string; readonly modelId: string; }`.
  - `function tokenUsageCommitStatements(database, key, inputTokens, outputTokens): SqlStatement[]` — the delta upsert, composed INTO an effect batch (mirrors `meterCommitStatements`).
  - `interface TokenUsageRow { readonly slot: string; readonly modelId: string; readonly inputTokens: number; readonly outputTokens: number; readonly requestCount: number; }`.
  - `function readTokenUsage(database): Promise<readonly TokenUsageRow[]>` — the firm-usage-feed read (mirrors `readStorageUsage`: each domain owns the read of its own tables).

- [ ] **Step 1: Add the package export**

In `packages/data-access/package.json`, add to `exports` after `"./setting-statements"`:

```json
    "./setting-statements": "./src/setting-statements.ts",
    "./token-usage-statements": "./src/token-usage-statements.ts",
```

- [ ] **Step 2: Write the failing test**

`packages/data-access/test/token-usage-statements.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { SqlDatabase } from "../src/idempotency-statements.ts";
import {
  readTokenUsage,
  tokenUsageCommitStatements,
  type TokenUsageKey,
} from "../src/token-usage-statements.ts";

// A tiny in-memory database honoring the exact SQL the builder emits AND the real SqlStatement return
// shapes (run -> { meta: { changes } }, all -> { results }), so the fake conforms to SqlDatabase.
function fakeDatabase() {
  const rows = new Map<
    string,
    { input: number; output: number; count: number; key: TokenUsageKey }
  >();
  const database = {
    prepare(_sql: string) {
      let binds: unknown[] = [];
      return {
        bind(...values: unknown[]) {
          binds = values;
          return this;
        },
        async run() {
          const [day, slot, modelId, input, output] = binds as [
            string,
            string,
            string,
            number,
            number,
          ];
          const composite = `${day}|${slot}|${modelId}`;
          const existing = rows.get(composite) ?? {
            input: 0,
            output: 0,
            count: 0,
            key: { day, slot, modelId },
          };
          existing.input += input;
          existing.output += output;
          existing.count += 1;
          rows.set(composite, existing);
          return { meta: { changes: 1 } };
        },
        async all<T>() {
          // SELECT slot, model_id, SUM(...) ... GROUP BY slot, model_id
          const grouped = new Map<
            string,
            { slot: string; model_id: string; i: number; o: number; c: number }
          >();
          for (const row of rows.values()) {
            const k = `${row.key.slot}|${row.key.modelId}`;
            const g = grouped.get(k) ?? {
              slot: row.key.slot,
              model_id: row.key.modelId,
              i: 0,
              o: 0,
              c: 0,
            };
            g.i += row.input;
            g.o += row.output;
            g.c += row.count;
            grouped.set(k, g);
          }
          return {
            results: [...grouped.values()].map((g) => ({
              slot: g.slot,
              model_id: g.model_id,
              input_tokens: g.i,
              output_tokens: g.o,
              request_count: g.c,
            })) as T[],
          };
        },
      };
    },
  };
  return database as unknown as SqlDatabase;
}

const KEY: TokenUsageKey = {
  day: "2026-06-18",
  slot: "reasoning",
  modelId: "anthropic/claude-opus-4-8",
};

describe("tokenUsageCommitStatements", () => {
  it("adds the delta to an existing day/slot/model bucket and increments the request count", async () => {
    const database = fakeDatabase();
    for (const statement of tokenUsageCommitStatements(database, KEY, 10, 20))
      await statement.run();
    for (const statement of tokenUsageCommitStatements(database, KEY, 5, 7)) await statement.run();
    const usage = await readTokenUsage(database);
    expect(usage).toEqual([
      {
        slot: "reasoning",
        modelId: "anthropic/claude-opus-4-8",
        inputTokens: 15,
        outputTokens: 27,
        requestCount: 2,
      },
    ]);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run (from `packages/data-access`): `vp test run test/token-usage-statements.test.ts`
Expected: FAIL — `../src/token-usage-statements.ts` not found.

- [ ] **Step 4: Write the implementation**

`packages/data-access/src/token-usage-statements.ts`:

```ts
import type { SqlDatabase, SqlStatement } from "./idempotency-statements.ts";

// Authoritative per-firm AI token usage, captured from the inference RESPONSE — never the gateway logs.
// Behavior over the table lives here (the structure lives in @magna-carta/database's per-firm schema);
// the rollup is composed INTO the effect batch that records the run, so it moves atomically with it —
// the same delta-upsert idiom as the storage meter.
export const TOKEN_USAGE_METER_TABLE = "token_usage_meter";

export interface TokenUsageKey {
  readonly day: string; // YYYY-MM-DD civil date bucket (UTC)
  readonly slot: string; // reasoning | utility | embedding
  readonly modelId: string; // gateway-routable, provider-prefixed id
}

// The delta upsert: add this run's tokens (and one request) to its (day, slot, model_id) bucket, or
// seed the row. Composed into the same batch as the run it counts, so an idempotent replay no-ops with it.
export function tokenUsageCommitStatements(
  database: SqlDatabase,
  key: TokenUsageKey,
  inputTokens: number,
  outputTokens: number,
): SqlStatement[] {
  return [
    database
      .prepare(
        `INSERT INTO ${TOKEN_USAGE_METER_TABLE} (day, slot, model_id, input_tokens, output_tokens, request_count) VALUES (?1, ?2, ?3, ?4, ?5, 1) ON CONFLICT (day, slot, model_id) DO UPDATE SET input_tokens = input_tokens + excluded.input_tokens, output_tokens = output_tokens + excluded.output_tokens, request_count = request_count + 1`,
      )
      .bind(key.day, key.slot, key.modelId, inputTokens, outputTokens),
  ];
}

export interface TokenUsageRow {
  readonly slot: string;
  readonly modelId: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly requestCount: number;
}

// The firm-usage-feed read: each domain owns the read of its own tables. Sums the rollup over days,
// grouped by (slot, model_id), for the diagnostics snapshot.
export async function readTokenUsage(database: SqlDatabase): Promise<readonly TokenUsageRow[]> {
  const { results } = await database
    .prepare(
      `SELECT slot, model_id, SUM(input_tokens) AS input_tokens, SUM(output_tokens) AS output_tokens, SUM(request_count) AS request_count FROM ${TOKEN_USAGE_METER_TABLE} GROUP BY slot, model_id`,
    )
    .all<{
      slot: string;
      model_id: string;
      input_tokens: number;
      output_tokens: number;
      request_count: number;
    }>();
  return results.map((row) => ({
    slot: row.slot,
    modelId: row.model_id,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    requestCount: row.request_count,
  }));
}
```

- [ ] **Step 5: Run test to verify it passes**

Run (from `packages/data-access`): `vp test run test/token-usage-statements.test.ts`
Expected: PASS (1 test).

- [ ] **Step 6: Commit**

```bash
git add packages/data-access/src/token-usage-statements.ts packages/data-access/package.json packages/data-access/test/token-usage-statements.test.ts
git commit -m "$(cat <<'EOF'
feat(data-access): authoritative per-firm token-usage write path + read accessor

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: The tools-catalog library row + permission registration + seed

**Files:**

- Modify: `packages/access-control/src/registry.ts` (add the `tools:inference` permission)
- Modify: `packages/tools/src/catalog.ts` (one row)
- Create: `packages/database/drizzle/per-firm/0008_seed-tools-inference.sql` (**hand-written** data seed)
- Modify: `packages/database/drizzle/per-firm/meta/_journal.json` (the 0008 journal entry — **hand-added**; drizzle-kit emits nothing for a pure-data migration)
- Modify: `apps/worker/src/per-firm-migrations.ts` (import + register 0008)
- Test: `packages/tools/test/catalog-inference.test.ts`

**Interfaces:**

- Consumes: `assertPermission` from `@magna-carta/access-control/registry`; `ToolManifest` from `./types.ts`.
- Produces: the `inference` catalog row (`backing: { kind: "library" }`); the `tools:inference` registry key; the role seed onto the Owner/Admin role.

- [ ] **Step 1: Register the permission**

In `packages/access-control/src/registry.ts`, add to the Tools block (after `"tools:firmUsage"`):

```ts
  "tools:firmUsage", // firm usage snapshot — storage + entity counts (read-only, per-firm)
  "tools:inference", // AI inference foundation — the firm's model chokepoint (catalog presence)
```

- [ ] **Step 2: Write the failing catalog test**

`packages/tools/test/catalog-inference.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { CATALOG } from "../src/catalog.ts";

describe("the inference catalog row", () => {
  it("is a library-backed diagnostics tool gated by tools:inference", () => {
    const row = CATALOG.find((manifest) => manifest.id === "inference");
    expect(row).toBeDefined();
    expect(row?.backing).toEqual({ kind: "library" });
    expect(row?.permission).toBe("tools:inference");
    expect(row?.contextTags).toContain("none");
    expect(row?.matterContext).toBe("none");
  });
});
```

- [ ] **Step 3: Run test to verify it fails, then add the row**

Run (from `packages/tools`): `vp test run test/catalog-inference.test.ts`
Expected: FAIL — no `inference` row.

In `packages/tools/src/catalog.ts`, add after the `firm-usage` row (inside the array):

```ts
  {
    id: "inference",
    name: "AI Inference",
    icon: "sparkles",
    subjectGroup: "diagnostics",
    permission: assertPermission("tools:inference"),
    contextTags: ["none"],
    backing: { kind: "library" },
    matterContext: "none",
  },
```

Run: `pnpm --filter @magna-carta/tools test`
Expected: PASS (the new catalog test + the purity test + the existing select tests all green; `assertPermission("tools:inference")` resolves because Step 1 registered the key).

- [ ] **Step 4: Write the role-seed migration (hand-written) + the hand-added journal entry**

0008 is a DATA seed (INSERT into `role_permission`), not a schema change — `drizzle-kit generate` produces nothing for it (no schema diff). Hand-author it exactly like the `0006_seed-tools-firm-usage.sql` precedent.

`packages/database/drizzle/per-firm/0008_seed-tools-inference.sql`:

```sql
-- Seed tools:inference onto the Owner/Admin role so firm administrators see the AI inference tool in
-- the catalog. The other default roles start without it.
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_Qz7mB4tHr2Np9sWxLcK6d', 'role_Gw-zKO8hOHQuNv2bWokMp', 'tools:inference');
```

`role_Gw-zKO8hOHQuNv2bWokMp` is the committed Owner/Admin role literal (the exact one `0006_seed-tools-firm-usage.sql` targets). `rolePermission_Qz7mB4tHr2Np9sWxLcK6d` is a freshly-minted, committed `rolePermission_` handle distinct from every existing seed (0006 uses `rolePermission_Ku9Tn3aWx7Lp0qRsVbE2c`). To mint your own instead, run `pnpm --filter @magna-carta/identifiers exec node -e "import('@magna-carta/identifiers/generate').then((m) => console.log(m.newIdentifier('rolePermission')))"` and substitute it.

Hand-add the journal entry to `packages/database/drizzle/per-firm/meta/_journal.json` after the `0007` entry (copy the field shape of the existing `0006`/`0007` entries — `version: "6"`, `breakpoints: true`, the next `idx`, a `when` epoch-ms within the surrounding range, and the `tag` matching the filename stem):

```json
{
  "idx": 8,
  "version": "6",
  "when": 1781800000000,
  "tag": "0008_seed-tools-inference",
  "breakpoints": true
}
```

- [ ] **Step 5: Register 0008 in the worker bundle**

In `apps/worker/src/per-firm-migrations.ts`, add the import after the `0007` import from Task 8:

```ts
import inferenceTokenUsageSql from "@magna-carta/database/drizzle/per-firm/0007_inference-token-usage.sql";
import seedToolsInferenceSql from "@magna-carta/database/drizzle/per-firm/0008_seed-tools-inference.sql";
```

And add the entry to the `migrationsFromJournal` map (after the 0007 line):

```ts
    "0007_inference-token-usage": inferenceTokenUsageSql,
    "0008_seed-tools-inference": seedToolsInferenceSql,
```

- [ ] **Step 6: Run the suites + the worker migrate-check**

Run: `pnpm --filter @magna-carta/database test`
Expected: PASS — the role-permission seed fitness (every seeded `permission` value is a registered registry key) accepts `tools:inference`, and the journal/file map is consistent.
Run: `pnpm --filter @magna-carta/worker exec wrangler deploy --dry-run`
Expected: PASS — no journal/map mismatch (both 0007 and 0008 imports resolve and the map carries both tags).

- [ ] **Step 7: Commit**

```bash
git add packages/access-control/src/registry.ts packages/tools/src/catalog.ts packages/tools/test/catalog-inference.test.ts packages/database/drizzle/per-firm apps/worker/src/per-firm-migrations.ts
git commit -m "$(cat <<'EOF'
feat(tools): inference catalog row + tools:inference permission seeded to Owner/Admin

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: Worker bindings (AI + inference queue)

**Files:**

- Modify: `apps/worker/src/app.ts` (the `Bindings` type — add `AI` + `INFERENCE`)
- Modify: `apps/worker/wrangler.jsonc` (the `ai` binding + the `INFERENCE` queue producer/consumer)
- Modify: `apps/worker/package.json` (add `@magna-carta/inference` dependency)

**Interfaces:**

- Produces: `Bindings.AI: Ai` (the platform Workers AI binding type, ambient from `@cloudflare/workers-types`) and `Bindings.INFERENCE: Queue` (the off-hot-path inference dispatch queue). `worker-env.d.ts` mirrors `Bindings` via `interface Env extends Bindings`, so both auto-flow to the ambient `Cloudflare.Env` the test harness types `env` as — no separate edit there.

- [ ] **Step 1: Add the worker dependency**

In `apps/worker/package.json`, add to `dependencies` (alphabetical, after `@magna-carta/identifiers`):

```json
    "@magna-carta/identifiers": "workspace:*",
    "@magna-carta/inference": "workspace:*",
```

Run: `vp install`
Expected: links the workspace dependency.

- [ ] **Step 2: Add the bindings to the `Bindings` type**

In `apps/worker/src/app.ts`, inside `export type Bindings = { … }`, after `QUEUE: Queue;`:

```ts
QUEUE: Queue;
// The off-hot-path AI inference dispatch queue: an inference request is enqueued here and the consumer
// (src/background/inference/inference-consumer.ts) runs env.AI.run, so a single firm cannot starve the shared
// gateway cap synchronously on the request path. Distinct from QUEUE (jobs) and FILES_INGEST.
INFERENCE: Queue;
// The authenticated Workers AI binding — the only path inference reaches the gateway through (no raw
// gateway token in any firm-reachable config). Pre-authenticated within the account.
AI: Ai;
```

(`Ai` and `Queue` are ambient from `@cloudflare/workers-types`, already a worker dependency — the same source the existing `QUEUE: Queue` / `R2: R2Bucket` bindings draw from.)

- [ ] **Step 3: Declare the bindings in wrangler.jsonc**

In `apps/worker/wrangler.jsonc`, add the `INFERENCE` producer to the existing `queues.producers` array (after the `FILES_INGEST` producer):

```jsonc
      { "binding": "QUEUE", "queue": "magna-carta-production-platform-jobs" },
      { "binding": "FILES_INGEST", "queue": "magna-carta-production-files-ingest" },
      { "binding": "INFERENCE", "queue": "magna-carta-production-inference" },
```

In the `queues.consumers` array, after the files-ingest consumer:

```jsonc
      {
        "queue": "magna-carta-production-files-ingest",
        "dead_letter_queue": "magna-carta-production-files-ingest-deadletter",
      },
      {
        "queue": "magna-carta-production-inference",
        "dead_letter_queue": "magna-carta-production-inference-deadletter",
      },
```

After the `r2_buckets` line (top-level), add the AI binding:

```jsonc
  "r2_buckets": [{ "binding": "R2", "bucket_name": "magna-carta-production-platform-files" }],
  // Workers AI — the authenticated binding the inference foundation reaches the AI Gateway through.
  // No per-firm provider key at launch (Unified Billing, Cloudflare-managed credentials).
  "ai": { "binding": "AI" },
```

- [ ] **Step 4: Validate the deploy config**

Run: `pnpm --filter @magna-carta/worker exec wrangler deploy --dry-run`
Expected: wrangler validates the `ai` binding and the new producer. A declared consumer with no exported handler fails the deploy (the existing `wrangler.jsonc` comment states this for files-ingest), and the inference consumer handler lands in Task 13 — so if the dry-run rejects the `magna-carta-production-inference` consumer here, defer ONLY that `consumers` array entry to Task 13 (keep the producer + the `ai` binding here) and add it there alongside the handler. Note which path you took.

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/app.ts apps/worker/wrangler.jsonc apps/worker/package.json pnpm-lock.yaml
git commit -m "$(cat <<'EOF'
feat(worker): AI + inference-queue bindings

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 12: The call-site helper (firm-scoped model read + port construction)

**Files:**

- Create: `apps/worker/src/inference/call-site.ts`
- Test: `apps/worker/test/inference-call-site.test.ts` (pure unit test — no Miniflare needed; runs in the worker's vitest project)

**Interfaces:**

- Consumes: `readFirmSetting` from `@magna-carta/data-access/setting-statements`; `primaryReasoningModelDefinition` from `@magna-carta/inference/settings`; `createGatewayInferencePort`, `type AiBinding` from `@magna-carta/inference/gateway`; `type InferencePort` from `@magna-carta/inference/port`; `type SqlDatabase` from `@magna-carta/data-access/idempotency-statements`.
- Produces:
  - `function inferencePortFor(ai: AiBinding, env: string): InferencePort`.
  - `function resolveReasoningModel(firmDatabase: SqlDatabase): Promise<string>` — reads the firm's selected model through the firm-scoped data-access layer (the firm's own D1 handle).

- [ ] **Step 1: Write the failing test**

`apps/worker/test/inference-call-site.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { AiBinding } from "@magna-carta/inference/gateway";
import { inferencePortFor, resolveReasoningModel } from "../src/inference/call-site.ts";

const NO_AI: AiBinding = { run: async () => ({ response: "", usage: {} }) };

function fakeFirmDatabase(stored?: string) {
  return {
    prepare(_sql: string) {
      const binds: unknown[] = [];
      return {
        bind(...values: unknown[]) {
          binds.push(...values);
          return this;
        },
        async all<T>() {
          return {
            results: (stored === undefined ? [] : [{ value: JSON.stringify(stored) }]) as T[],
          };
        },
        async run() {
          return { meta: { changes: 1 } };
        },
      };
    },
  };
}

describe("resolveReasoningModel", () => {
  it("returns the firm's stored model through the firm-scoped read", async () => {
    expect(
      await resolveReasoningModel(fakeFirmDatabase("anthropic/claude-sonnet-4-6") as never),
    ).toBe("anthropic/claude-sonnet-4-6");
  });

  it("returns the safe default when no firm row is set", async () => {
    expect(await resolveReasoningModel(fakeFirmDatabase() as never)).toBe(
      "anthropic/claude-opus-4-8",
    );
  });
});

describe("inferencePortFor", () => {
  it("constructs the AI-Gateway-backed port with the injected binding", () => {
    const port = inferencePortFor(NO_AI, "production");
    expect(typeof port.generate).toBe("function");
    expect(typeof port.embed).toBe("function");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @magna-carta/worker exec vitest run test/inference-call-site.test.ts`
Expected: FAIL — `../src/inference/call-site.ts` not found.

- [ ] **Step 3: Write the implementation**

`apps/worker/src/inference/call-site.ts`:

```ts
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import { readFirmSetting } from "@magna-carta/data-access/setting-statements";
import { createGatewayInferencePort, type AiBinding } from "@magna-carta/inference/gateway";
import type { InferencePort } from "@magna-carta/inference/port";
import { primaryReasoningModelDefinition } from "@magna-carta/inference/settings";

// The inference call site composition: construct the port over the authenticated AI binding, and read
// the firm's selected reasoning model through the firm-scoped data-access layer (the firm's own D1
// handle — the structural tenant isolation). The model is passed as an explicit operation parameter,
// never carried on a connection or context object.

export function inferencePortFor(ai: AiBinding, env: string): InferencePort {
  return createGatewayInferencePort({ ai, env });
}

export function resolveReasoningModel(firmDatabase: SqlDatabase): Promise<string> {
  return readFirmSetting(firmDatabase, primaryReasoningModelDefinition);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @magna-carta/worker exec vitest run test/inference-call-site.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/inference/call-site.ts apps/worker/test/inference-call-site.test.ts
git commit -m "$(cat <<'EOF'
feat(worker): inference call-site helper — firm-scoped model read + port construction

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 13: The inference Queue consumer + firmRateGate hook + the metering write

**Files:**

- Create: `apps/worker/src/inference/inference-consumer.ts`
- Modify: `apps/worker/src/index.ts` (route the inference queue)
- Test: `apps/worker/test/inference-consumer-unit.test.ts` (a focused unit test for the firm-rate-gate pass-through and the bucket-key derivation; the metering write is exercised end-to-end in Task 14)

**Interfaces:**

- Consumes: `commitEffectBatch` from `@magna-carta/data-access/effect-batch`; `tokenUsageCommitStatements`, `type TokenUsageKey` from `@magna-carta/data-access/token-usage-statements`; `catalogEntryFor` from `@magna-carta/inference/catalog`; `inferencePortFor`, `resolveReasoningModel` from `./call-site.ts`; `resolveFirmDatabase` from `../firm-binding-resolver.ts`; `newCorrelationId` from `@magna-carta/telemetry/ids`; `logOperationFailed` from `@magna-carta/telemetry/operation`; `createWorkersLogger` from `@magna-carta/telemetry/workers-logger`; `type Bindings` from `../app.ts`. (`resolveFirmDatabase`, `newCorrelationId`, `logOperationFailed`, `createWorkersLogger`, and `MessageBatch` are the exact symbols `apps/worker/src/files/ingest-consumer.ts` imports — confirmed against that file.)
- Produces:
  - `interface InferenceJob { readonly firmId: string; readonly databaseIdentifier: string; readonly prompt: string; }`.
  - `function firmRateGate(firmId: string): void` — the pass-through no-op back-pressure seam.
  - `function tokenUsageKeyForDay(nowIso: string, slot: string, modelId: string): TokenUsageKey`.
  - `async function handleInferenceJob(env: Bindings, job: InferenceJob): Promise<void>`.
  - `async function inferenceQueue(batch: MessageBatch<InferenceJob>, env: Bindings): Promise<void>`.

- [ ] **Step 1: Write the failing unit test**

`apps/worker/test/inference-consumer-unit.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { firmRateGate, tokenUsageKeyForDay } from "../src/inference/inference-consumer.ts";

describe("firmRateGate (the back-pressure seam)", () => {
  it("is a pass-through no-op at launch — never throws, returns nothing", () => {
    expect(firmRateGate("firm_anything")).toBeUndefined();
  });
});

describe("tokenUsageKeyForDay", () => {
  it("buckets a run by UTC civil date + slot + model id", () => {
    const key = tokenUsageKeyForDay(
      "2026-06-18T13:45:00.000Z",
      "reasoning",
      "anthropic/claude-opus-4-8",
    );
    expect(key).toEqual({
      day: "2026-06-18",
      slot: "reasoning",
      modelId: "anthropic/claude-opus-4-8",
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @magna-carta/worker exec vitest run test/inference-consumer-unit.test.ts`
Expected: FAIL — `../src/inference/inference-consumer.ts` not found.

- [ ] **Step 3: Write the consumer**

`apps/worker/src/inference/inference-consumer.ts`:

```ts
import { commitEffectBatch } from "@magna-carta/data-access/effect-batch";
import {
  tokenUsageCommitStatements,
  type TokenUsageKey,
} from "@magna-carta/data-access/token-usage-statements";
import { catalogEntryFor } from "@magna-carta/inference/catalog";
import { newCorrelationId } from "@magna-carta/telemetry/ids";
import { logOperationFailed } from "@magna-carta/telemetry/operation";
import { createWorkersLogger } from "@magna-carta/telemetry/workers-logger";
import type { Bindings } from "../app.ts";
import { resolveFirmDatabase } from "../firm-binding-resolver.ts";
import { inferencePortFor, resolveReasoningModel } from "./call-site.ts";

// The inference queue consumer runs OFF the hot path: a single firm cannot starve the shared gateway cap
// synchronously on the request path. It derives the firm database from the firm-scoped job context,
// routes through the firmRateGate back-pressure seam, calls the AI binding, captures the authoritative
// token usage from the response, and writes the metering record through the firm-scoped data-access
// layer — the firm's own D1 handle is the structural isolation.

export interface InferenceJob {
  readonly firmId: string;
  readonly databaseIdentifier: string; // the firm's database binding name (the firm-scoped context)
  readonly prompt: string;
}

// The per-firm back-pressure seam: a pass-through no-op at launch, sited between the queue dequeue and
// the AI binding call. A per-firm token bucket (or a Durable Object per firm) drops in here later
// without touching the InferencePort contract or any call site; only this body changes.
export function firmRateGate(_firmId: string): void {
  // Intentionally empty: the launch posture relies on queue dispatch + a single firm-scoped gateway
  // spend rule for back-pressure; the per-firm limiter is added when load is measured.
}

// The metering bucket key: a run's UTC civil date + the model's slot + the model id.
export function tokenUsageKeyForDay(nowIso: string, slot: string, modelId: string): TokenUsageKey {
  return { day: nowIso.slice(0, 10), slot, modelId };
}

const ENVIRONMENT_LABEL = "production";

export async function handleInferenceJob(env: Bindings, job: InferenceJob): Promise<void> {
  const firmDatabase = resolveFirmDatabase(env, job.databaseIdentifier);
  if (firmDatabase === null) return; // a firm this deployment cannot reach — no work to do, ack.

  firmRateGate(job.firmId);

  const modelId = await resolveReasoningModel(firmDatabase);
  const port = inferencePortFor(env.AI, ENVIRONMENT_LABEL);
  const result = await port.generate({
    modelId,
    prompt: job.prompt,
    firmId: job.firmId as never, // the firm-scoped context's id; the port derives the metadata tag
  });
  if (!result.ok) {
    // A model/gateway failure is a first-class adapter-error. A retryable problem throws so the queue
    // redelivers; a terminal one (e.g. the fail-closed ZDR refusal) acks — retrying cannot help it.
    if (result.problem?.retryable === true) {
      throw new Error(`inference adapter-error (${result.problem.category})`);
    }
    return;
  }

  const entry = catalogEntryFor(modelId);
  const slot = entry?.slot ?? "reasoning";
  const now = () => new Date().toISOString();
  const key = tokenUsageKeyForDay(now(), slot, modelId);
  await commitEffectBatch(
    firmDatabase,
    {
      statements: tokenUsageCommitStatements(
        firmDatabase,
        key,
        result.value.usage.inputTokens,
        result.value.usage.outputTokens,
      ),
      outboxMessages: [],
    },
    { now },
  );
}

export async function inferenceQueue(
  batch: MessageBatch<InferenceJob>,
  env: Bindings,
): Promise<void> {
  const logger = createWorkersLogger(env.TELEMETRY);
  for (const message of batch.messages) {
    try {
      await handleInferenceJob(env, message.body);
      message.ack();
    } catch (error) {
      logOperationFailed(logger, `queue:inference:${message.id}`, error, newCorrelationId());
      message.retry();
    }
  }
}
```

> `commitEffectBatch` types its database as `BatchDatabase` (a `SqlDatabase` with `batch()`); the real per-firm `D1Database` `resolveFirmDatabase` returns satisfies it. `firmDatabase` is passed to both `tokenUsageCommitStatements` (prepares the statements) and `commitEffectBatch` (commits them), exactly as the file-manager consumer pairs `meterCommitStatements` with the effect batch.

- [ ] **Step 4: Route the inference queue in `index.ts`**

The current `queue(batch, env)` handler casts every batch directly to `R2EventMessage` (it consumes only files-ingest today). Branch on the producing queue's name. In `apps/worker/src/index.ts`, add the import and replace the handler body:

```ts
import { ingestQueue, type R2EventMessage } from "./files/ingest-consumer.ts";
import { inferenceQueue, type InferenceJob } from "./inference/inference-consumer.ts";
```

```ts
  queue(batch, env) {
    // Route by the producing queue's name: inference carries inference jobs; files-ingest carries R2
    // events (the only other consumed queue). A queue with no branch here is a misconfigured binding.
    if (batch.queue === "magna-carta-production-inference") {
      return inferenceQueue(batch as MessageBatch<InferenceJob>, env);
    }
    return ingestQueue(batch as MessageBatch<R2EventMessage>, env);
  },
```

- [ ] **Step 5: Run the unit test + the deploy dry-run**

Run: `pnpm --filter @magna-carta/worker exec vitest run test/inference-consumer-unit.test.ts`
Expected: PASS (2 tests).
Run: `pnpm --filter @magna-carta/worker exec wrangler deploy --dry-run`
Expected: PASS — the inference consumer now has an exported handler reachable from `index.ts`, so the declared `magna-carta-production-inference` consumer validates. (If you deferred the consumer entry in Task 11 Step 4, add it to `wrangler.jsonc` now.)

- [ ] **Step 6: Commit**

```bash
git add apps/worker/src/inference/inference-consumer.ts apps/worker/src/index.ts apps/worker/test/inference-consumer-unit.test.ts apps/worker/wrangler.jsonc
git commit -m "$(cat <<'EOF'
feat(worker): off-hot-path inference queue consumer with firm-scoped metering write

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 14: The Miniflare worker integration test (firm isolation of the metering record + the setting)

**Files:**

- Create: `apps/worker/test/inference-isolation.test.ts`

**Interfaces:**

- Consumes (test support): `env` from `cloudflare:test`; `applyControlPlaneMigrations`, `applyPerFirmMigrations` from `./support/*`; `seedFirm` from `./support/test-auth.ts`; `writeFirmSettingStatement` + `commitEffectBatch` (write-path fixtures, never raw inserts); `primaryReasoningModelDefinition` from `@magna-carta/inference/settings`; `readTokenUsage`, `tokenUsageCommitStatements` from `@magna-carta/data-access/token-usage-statements`. The two dev-pool firm bindings `DB_FIRM_POOL_1` / `DB_FIRM_POOL_2` are the two-firm isolation fixture. `applyPerFirmMigrations` migrates the full lineage (incl. 0007 + 0008, registered in Tasks 8/10) because it reuses `perFirmMigrations()`.

- [ ] **Step 1: Write the integration test**

`apps/worker/test/inference-isolation.test.ts`:

```ts
import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { commitEffectBatch } from "@magna-carta/data-access/effect-batch";
import { writeFirmSettingStatement } from "@magna-carta/data-access/setting-statements";
import {
  readTokenUsage,
  tokenUsageCommitStatements,
} from "@magna-carta/data-access/token-usage-statements";
import { primaryReasoningModelDefinition } from "@magna-carta/inference/settings";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import { applyPerFirmMigrations } from "./support/apply-per-firm-migrations.ts";
import { seedFirm } from "./support/test-auth.ts";

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  await applyPerFirmMigrations(env.DB_FIRM_POOL_1); // full lineage incl. 0007 token_usage_meter + 0008
  await applyPerFirmMigrations(env.DB_FIRM_POOL_2);
  await seedFirm({ name: "Inference Firm One", databaseIdentifier: "DB_FIRM_POOL_1" });
  await seedFirm({ name: "Inference Firm Two", databaseIdentifier: "DB_FIRM_POOL_2" });
});

const now = () => "2026-06-18T00:00:00.000Z";

describe("inference per-firm isolation (the firm's own D1 handle)", () => {
  it("a firm's reasoning-model setting never resolves across firms", async () => {
    // Write firm one's selection through the write path (validated, never a raw insert).
    await commitEffectBatch(
      env.DB_FIRM_POOL_1,
      {
        statements: [
          writeFirmSettingStatement(
            env.DB_FIRM_POOL_1,
            primaryReasoningModelDefinition,
            "anthropic/claude-sonnet-4-6",
            now(),
          ),
        ],
        outboxMessages: [],
      },
      { now },
    );

    const { results: one } = await env.DB_FIRM_POOL_1.prepare(
      "SELECT value FROM setting WHERE key = ?1",
    )
      .bind(primaryReasoningModelDefinition.key)
      .all<{ value: string }>();
    const { results: two } = await env.DB_FIRM_POOL_2.prepare(
      "SELECT value FROM setting WHERE key = ?1",
    )
      .bind(primaryReasoningModelDefinition.key)
      .all<{ value: string }>();
    expect(JSON.parse(one[0]!.value)).toBe("anthropic/claude-sonnet-4-6");
    expect(two).toHaveLength(0); // firm two carries no row — its read would return the default
  });

  it("a firm's token-usage record never resolves across firms", async () => {
    // Meter a run in firm one through the write path (effect batch, never a raw insert).
    await commitEffectBatch(
      env.DB_FIRM_POOL_1,
      {
        statements: tokenUsageCommitStatements(
          env.DB_FIRM_POOL_1,
          { day: "2026-06-18", slot: "reasoning", modelId: "anthropic/claude-opus-4-8" },
          100,
          200,
        ),
        outboxMessages: [],
      },
      { now },
    );

    const firmOneUsage = await readTokenUsage(env.DB_FIRM_POOL_1);
    const firmTwoUsage = await readTokenUsage(env.DB_FIRM_POOL_2);
    expect(firmOneUsage).toEqual([
      {
        slot: "reasoning",
        modelId: "anthropic/claude-opus-4-8",
        inputTokens: 100,
        outputTokens: 200,
        requestCount: 1,
      },
    ]);
    expect(firmTwoUsage).toEqual([]); // firm two's database has no such row — structural isolation
  });
});
```

> `seedFirm({ name, databaseIdentifier })` returns `{ firmId, databaseIdentifier }` (confirmed against `apps/worker/test/support/test-auth.ts`); this test does not need the returned `firmId`, so it does not bind it. `commitEffectBatch` here is called with no `idempotencyRecord` (an empty batch is skipped; a non-empty one commits via `database.batch`), matching the file-manager metering precedent.

- [ ] **Step 2: Run the integration test**

Run: `pnpm --filter @magna-carta/worker exec vitest run test/inference-isolation.test.ts`
Expected: PASS (2 tests) — the setting and the metering record are firm-isolated; the second firm's database resolves neither.

- [ ] **Step 3: Run the full worker suite + the process-ref scan**

Run: `pnpm --filter @magna-carta/worker test`
Expected: all green (incl. the call-site unit test, the consumer unit test, and this isolation test).
Run: `pnpm run lint:process-refs`
Expected: no process references reported in source/tests.

- [ ] **Step 4: Commit**

```bash
git add apps/worker/test/inference-isolation.test.ts
git commit -m "$(cat <<'EOF'
test(worker): Miniflare firm-isolation of the inference setting + token-usage record

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 15: Package notes, full quality gate, and the living docs (same commit as the build)

**Files:**

- Create: `packages/inference/CLAUDE.md`
- Modify: `docs/Decision-Log.md` (ADR-0104..0108)
- Modify: `ROADMAP.md`, `STATUS.md`, `CHANGELOG.md`
- Modify: `docs/operating-costs.md`
- Modify: `docs/Magna-Carta-White-Paper.md`

**Interfaces:** documentation only — no code symbols.

- [ ] **Step 1: Write the package CLAUDE.md**

`packages/inference/CLAUDE.md`:

```markdown
# @magna-carta/inference — local notes

The single credential-less chokepoint every AI feature reaches a model through. Pure package — no D1, no
Hono, no `env` in the contract surface; the implementation receives the authenticated `AI` binding and
the firm-scoped read result as injected parameters.

- `InferencePort` (`src/port.ts`) names two operation families: text generation (buffered / streaming /
  durable Workflow-invocable) and the platform-FIXED embedding op. The reasoning model id is an explicit
  per-call parameter (read per call site through the firm-scoped data-access layer), never on a
  connection or context. The embedding op takes NO firm-selectable model argument — per-firm embedding
  variation is unrepresentable in the signature (a swap would invalidate the Vectorize index).
- The catalog (`src/catalog.ts`) is the curated source of truth: every entry carries `zdrEligible` /
  `noTrainingEligible` / `verifiedOn` and a pinned `snapshotId`. Validated at module load — a malformed
  entry, or a non-ZDR reasoning entry, fails loud at import. `claude-fable-5` is excluded (it mandates
  retention; non-ZDR). `PLATFORM_EMBEDDING_MODEL_ID` is the one place to confirm the embedding model
  against the live Vectorize index version before merge.
- The setting (`src/settings.ts`) stores the firm's primary reasoning model in the per-firm `setting`
  table via a `FirmSettingDefinition`; the schema is a refinement over the ZDR-eligible reasoning subset,
  so an off-catalog/non-ZDR id is rejected at the write path. Reads stay total (default on missing/invalid).
- The implementation (`src/gateway.ts`) reaches the model only through the authenticated `AI` binding
  (`env.AI.run(model, input, { gateway })`). The control plane is the binding's documented `gateway`
  options object — `skipCache: true` (caching off), `collectLog: false` (logging off — the binding's
  toggle is all-or-nothing, no payload-only option, so no prompt/response body is logged), and derived
  firm metadata (`firm_id` opaque, <=5 keys, no model tag). NOT `cf-aig-*` string headers (the REST
  surface the binding does not read). The fail-closed ZDR guard runs before dispatch and returns a
  NON-retryable (`validation`) problem on a miss. `problem.detail` is caller-safe text only — never a
  spliced upstream body. Authoritative token usage is read from the RESPONSE usage object, never the logs.

Reuse of `@magna-carta/integrations` is type-level only: the `Dispatch` sum and the problem taxonomy.
No registry / connection / credential machinery is touched.

**Deferred seam (the BYOK credentialed adapter):** a later slice registers a genuinely-credentialed
framework adapter (the one place the framework's connection/credential lifecycle applies) for firms that
require their own provider key — built when a firm attestation requires it or the shared rate cap is
measured-binding. Not built here.
```

- [ ] **Step 2: Record the ADRs**

In `docs/Decision-Log.md`, add five entries in the register's house format. ADR-0104 through ADR-0107 are **Accepted**; ADR-0108 is **Proposed — owner decision pending** (created in an open state, not Accepted):

- **ADR-0104 (Accepted)** — placement: standalone `@magna-carta/inference`, AI-Gateway-backed, the integration framework reused at the type level; BYOK as a later credentialed adapter; gateway lock-in recorded as an accepted tradeoff (model-swap cheap, gateway-exit not).
- **ADR-0105 (Accepted)** — credential & confidentiality posture: Unified Billing + ZDR-on + payload-off; ZDR as a diligence obligation backed by named Cloudflare/Anthropic procurement artifacts (which gate the first real AI feature, not this plumbing slice); the fail-closed per-request ZDR guard; residual-classifier-retention disclosure.
- **ADR-0106 (Accepted)** — tenant-isolation hard constraints: caching disabled for firm-data inference; firm metadata derived not caller-supplied; authenticated gateway; authoritative response-captured token-usage metering in the firm-scoped data-access layer (never gateway logs).
- **ADR-0107 (Accepted)** — multi-tenant fairness/availability: one gateway per environment; off-hot-path Queue dispatch required; a single firm-scoped spend rule; account-level credit alarm; the named BYOK/Enterprise scaling switch point; the `firmRateGate` per-firm back-pressure seam built now, machinery deferred.
- **ADR-0108 (Proposed — owner decision pending)** — client-consent model for third-party-frontier processing: the recommendation (yes, but only under ZDR, gated by the firm-level eligibility setting plus a recorded consent decision; strictest firms default to the on-Cloudflare Workers-AI path) is recorded; the choice is not yet made.

- [ ] **Step 3: Update ROADMAP / STATUS / CHANGELOG**

In `ROADMAP.md`, add a slice row recording the AI inference foundation as built (backend plumbing; no UI; first AI feature deferred). In `STATUS.md`, add a row: `AI inference foundation | [x] | [x] | [x] | [x] Opus 4.8 * | [-] | [ ]` (spec→plan→built→tested; no UI), noting the deferred BYOK adapter seam and the load-profile-harness extension deferred to the first feature. In `CHANGELOG.md` `[Unreleased]` under **Added**: "AI inference foundation (`@magna-carta/inference`) — the credential-less AI-Gateway-backed model chokepoint (`InferencePort` with streaming + durable paths, the curated ZDR-eligible model catalog, the per-firm reasoning-model setting, the platform-fixed embedding operation), an authoritative per-firm token-usage metering table, the `inference` tools-catalog row, and the worker call-site wiring (AI + inference-queue bindings, the off-hot-path queue consumer, the firm-isolated metering write). Backend plumbing only; no UI; the first AI feature and the BYOK adapter are later slices."

- [ ] **Step 4: Update operating-costs**

In `docs/operating-costs.md`, add the recurring AI line: the AI Gateway Unified-Billing flat **5% credit-purchase fee** (provider rates pass through with no markup; committed-use/volume discounts forfeited vs a direct contract, recovered later via BYOK at volume), plus the gateway + Workers AI usage line. Note the Unified-Billing↔BYOK crossover is a per-firm config switch, not a code change.

- [ ] **Step 5: Add the white-paper AI-inference home**

In `docs/Magna-Carta-White-Paper.md`, add one _AI / inference_ home describing the shared model chokepoint (the foundation, the catalog, the confidentiality/tenancy control plane, BYOK deferred). The _Document Automation_ / _Discovery_ / _Search_ topics reference it **by topic name**, never duplicating its content (one home per fact).

- [ ] **Step 6: Run the full quality gate**

Run: `pnpm check`
Expected: PASS (fmt + lint + typecheck + svelte-check across the workspace, including the new package). Fix any finding the gate reports before continuing.

Run: `vp test`
Expected: PASS — the whole Vitest single-run, including the new `inference` suites, the data-access token-usage suite, the database schema-conformance suite, and the Miniflare worker integration test.

Run: `pnpm run lint:process-refs`
Expected: no process references reported in source.

- [ ] **Step 7: Final verification and commit**

Run: `pnpm --filter @magna-carta/inference test && pnpm --filter @magna-carta/data-access test && pnpm --filter @magna-carta/database test && pnpm --filter @magna-carta/tools test && pnpm --filter @magna-carta/worker test && pnpm check && pnpm run lint:process-refs`
Expected: all green.

```bash
git add packages/inference/CLAUDE.md docs/Decision-Log.md ROADMAP.md STATUS.md CHANGELOG.md docs/operating-costs.md docs/Magna-Carta-White-Paper.md
git commit -m "$(cat <<'EOF'
docs(inference): ADRs 0104-0108, package notes, roadmap/status/changelog, costs, white-paper home

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Self-review

**Spec coverage map:**

- §1 module placement (standalone `@magna-carta/inference`, one tools row, worker call site, type-level integrations reuse only) → Tasks 1, 2, 10, 11–13. `createIntegrationRegistry().register(...)` is never called for inference (the BYOK seam is documented, not built).
- §2 `InferencePort` (streaming + durable, typed `Dispatch`, model id as operation parameter, response-captured usage) → Tasks 2, 6 (the streaming runtime path is exercised in Task 6's `generateStream` test — relayed deltas + deferred usage).
- §3 platform-fixed embedding (no firm-selectable model arg, type-enforced) → Task 2 (`@ts-expect-error` type test) + Task 6 (`embed` uses `embeddingEntry()`).
- §4 curated catalog (entry shape, module-load zod validation, every reasoning entry `zdrEligible`, exactly one embedding entry, Fable-5 excluded, version/effective-date) → Task 3 + Task 7 fitness. The embedding model id is a single flagged constant, not an asserted provider fact (the spec names none).
- §5 per-firm reasoning-model setting (`FirmSettingDefinition`, refinement-over-catalog, write-path validation, total read) → Task 4.
- §6 credential/confidentiality posture (authenticated AI binding only, caching off, logging off, fail-closed ZDR guard) → Tasks 5, 6. The control plane uses the binding's documented `gateway` options (`skipCache`/`collectLog`/`metadata`), verified against the Cloudflare worker-binding-methods docs — not the REST `cf-aig-*` headers. The procurement diligence artifacts gate the first feature, not this slice (ADR-0105, Task 15).
- §7 caching off → Task 5 (`skipCache: true`, no cache key) + Task 7 fitness (caching-off AND the real firm-prefixed-cache-key invariant).
- §8 derived firm metadata + authoritative metering → Task 5 (`deriveFirmMetadata`), Tasks 8–9 (table + write/read), Task 13 (the write), Task 14 (firm isolation). The binding's `collectLog` is all-or-nothing, so logging is off and metering rides the RESPONSE usage object — never the logs.
- §9 fairness/availability (off-hot-path Queue, `firmRateGate(firm_id)` pass-through seam) → Tasks 11, 13.
- §10 DLP posture → the streaming path keeps response-scanning off (no buffering); native DLP config is account configuration, correctly not code here.
- §11 per-matter AI-governance seam + the consent open decision → Task 4 (`aiProcessingEligibilityDefinition`) + ADR-0108 (Task 15); per-matter enforcement + consent UI deferred to the first feature.
- §12 portability/lock-in → ADR-0104 + the white-paper home (Task 15); `InferencePort` carries the control-plane guarantees provider-neutrally (the interface never names `cf-aig-*`/`gateway`).
- §13 deferred BYOK adapter → explicitly NOT built (stated in the CLAUDE.md and ADR-0104); no `apiKey`/connection-store dependency, no integration-platform worktree needed.
- §14 cost → operating-costs (Task 15).
- §15 testing (unit incl. the streaming result shape, fitness incl. the firm-prefixed-cache-key guard, Miniflare integration, write-path fixtures) → Tasks 2–7, 9, 12–14.
- §16 docs (ADRs, ROADMAP/STATUS/CHANGELOG, operating-costs, white-paper home, tools row + seeded permission; no `docs/user/`) → Tasks 10, 15.

**Migration-wiring check:** 0007 is drizzle-kit-generated (a `CREATE TABLE`) and registered in `per-firm-migrations.ts` (Task 8 Step 5); 0008 is hand-written (a pure-data `INSERT`, no schema diff) with a hand-added journal entry and registered in `per-firm-migrations.ts` (Task 10 Step 5). Both registrations precede the Miniflare migrate-to-head in Task 14, which reuses `perFirmMigrations()` via `apply-per-firm-migrations.ts` — so `migrationsFromJournal` never sees a journal entry its map lacks, and firm provisioning does not throw.

**Explicitly out of scope (stated per the spec):** the BYOK credentialed adapter (§13 — deferred seam, not built); the load-profile-harness extension for the token-usage table (named in STATUS, built with the first AI feature when it is volume-shaped); any UI / first AI feature / consent surface.

**Placeholder scan:** none — every code step shows complete code. The conditional notes (Task 8 migration-slug rename, Task 11 Step 4 / Task 13 consumer-validation ordering) are operational fallbacks, not missing implementation. `PLATFORM_EMBEDDING_MODEL_ID` is a real constant with a documented confirm-before-merge flag, not a placeholder.

**Type-consistency check:** `InferencePort`, `GenerateInput`/`GenerateResult`/`StreamResult`/`EmbedInput`/`EmbeddingResult`/`TokenUsage`, `InferenceModelId`, `CatalogEntry`/`ModelSlot`, `catalogEntrySchema`/`CATALOG`/`reasoningModelIds`/`embeddingEntry`/`isZdrEligible`/`catalogEntryFor`/`PLATFORM_EMBEDDING_MODEL_ID`, `primaryReasoningModelDefinition`/`aiProcessingEligibilityDefinition`, `GATEWAY_ID`/`GatewayOptions`/`gatewayOptions`/`deriveFirmMetadata`/`assertZdrEligible`/`zdrRejection`/`AiBinding`/`createGatewayInferencePort`/`extractUsage`, `tokenUsageCommitStatements`/`readTokenUsage`/`TokenUsageKey`/`TokenUsageRow`, `tokenUsageMeter`, `inferencePortFor`/`resolveReasoningModel`, `InferenceJob`/`firmRateGate`/`tokenUsageKeyForDay`/`handleInferenceJob`/`inferenceQueue` are used identically across the tasks that define and consume them. The control-plane object is `GatewayOptions` everywhere (binding `gateway` options — `skipCache`/`collectLog`/`metadata`), never a `headers` map. The fakes conform to the real `SqlDatabase`/`SqlStatement` contract (`run → { meta: { changes } }`, `all → { results }`) via `as unknown as SqlDatabase`, not `as never`. The type-level reuse imports (`Dispatch`, `IntegrationProblem`, `adapterError`, `ok`, `integrationProblem`) match the verified `@magna-carta/integrations/dispatch` + `/problem` surfaces. No new identifier handle is introduced (the metering table is a natural composite key — the documented `storage_meter`-style exception).
