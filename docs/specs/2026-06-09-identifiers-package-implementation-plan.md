# `@magna-carta/identifiers` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `@magna-carta/identifiers` — the second foundational-data package (slice 0·2, package 2 of 4): one opaque, type-prefixed, CSPRNG-random, URL-safe handle per row, branded TypeScript id types, the prefix registry, a seeded random source for fixtures, boundary validation, and the bounded UNIQUE-insert retry idiom — all behind a swappable seam over nanoid.

**Architecture:** A pure, dependency-light workspace package with no Cloudflare runtime. `nanoid` is imported in exactly one internal file (`src/nanoid.ts` — the seam); every other module uses our branded `Identifier<T>` types and in-house functions. The public surface is exposed through the `package.json` `exports` map (no barrel file — `oxc/no-barrel-file` is an error, ADR-0070). Raw `.ts` is shipped (no build step), consumed via `moduleResolution: bundler`.

**Tech Stack:** TypeScript (strict), **nanoid v5** (`customRandom` + `urlAlphabet`), Vitest (Vite+ `vp test`). Source of truth for the design: [`2026-06-04-foundational-data-conventions-design.md`](2026-06-04-foundational-data-conventions-design.md) §2 and §7; the decision is **ADR-0062** (identifiers) and **ADR-0071** (package layout).

**Naming:** Golden rule 12 — fully spelled out, no shorthand. `randomSource` not `rng`, `newIdentifier` not `newId`, "the data-access layer" not "the DAL", `identifierBrand` not `idBrand`.

**Comments:** Self-contained / spec-agnostic — never cite a `§` or spec-section number in code comments. Cite a stable `ADR-NNNN` only when the _why_ genuinely needs it (see [`docs/conventions/code-style.md`](../conventions/code-style.md)).

---

## Identifier facts (decided — read before coding)

These are settled by ADR-0062 and verified against the current nanoid docs (v5.1.11) on 2026-06-09. Do not re-derive or improvise them.

1. **Handle format = `<prefix>_<token>`.** The prefix is the registry value (`mat`, `doc`, …) — **without** a trailing underscore; the `_` is the separator. The token is a nanoid string of **21** characters over the **URL-safe alphabet** (`A-Za-z0-9_-`, 64 symbols) → **~126 bits** (UUIDv4-class collision/guess resistance). Example: `mat_V1StGXR8Z5jdHiopq2Cf`.
2. **Purely random, never time-encoded** (no UUIDv7/ULID/Snowflake — the embedded timestamp is a confidentiality leak). The handle is both the **D1 primary key** and the **public id** in URLs/API/logs.
3. **nanoid v5 API (verified):** `customRandom(alphabet, size, random)` where `random: (bytes: number) => Uint8Array`, returning `(size?: number) => string`; `urlAlphabet` is the exported 64-char URL-safe set; default size is 21. nanoid is ESM and uses Web Crypto (`crypto.getRandomValues`) — available in Workers, Node, and the Vitest node pool. This package never runs in Workers itself (it is a pure leaf), but `crypto.getRandomValues` is a global everywhere it is consumed.
4. **`crypto.getRandomValues` is the default source; a seeded PRNG is injected for fixtures** (ADR-0034 determinism). The seeded PRNG is hand-rolled (mulberry32 + FNV-1a seed hash) — dep-free, so the leaf depends on **nanoid only**. It is **not** cryptographic; it exists solely so fixtures produce byte-identical ids from the same seed.
5. **Non-overlap is a correctness guarantee, not a probability:** a `UNIQUE` primary key plus bounded retry-on-collision. The retry _loop_ is pure logic (`generateUniqueIdentifier`); the actual `INSERT … ON CONFLICT` lives in `@magna-carta/database`/`@magna-carta/data-access` and is supplied to the loop as a `tryInsert` callback. This is the UNIQUE-insert idiom that idempotency (ADR-0063) and the outbox (ADR-0064) reuse.
6. **Brands are compile-time only** (erased at runtime — the value is just the string). A branded id _is_ assignable to `string` (so it flows into DB values and URLs), but a raw `string` is **not** assignable to a branded id without going through `validate` (`isIdentifier`/`assertIdentifier`).

---

## File structure

```
packages/identifiers/
  package.json          # @magna-carta/identifiers; exports map is the public surface
  tsconfig.json         # extends ../tsconfig/base.json (RELATIVE path); pure; types: ["node"]; noEmit
  vitest.config.ts      # minimal; root-pinned so `vp test` discovers it
  src/
    nanoid.ts           # THE ONLY file importing nanoid — token-generator factory + alphabet/size constants
    random.ts           # RandomSource type; cryptoRandomSource (default) + seededRandomSource (fixtures)
    registry.ts         # ENTITY_PREFIXES (source of truth) + EntityType + prefixFor
    types.ts            # Identifier<T> brand, BrandFor<T>, AnyIdentifier, named aliases (MatterId, …)
    generate.ts         # newIdentifier + generateUniqueIdentifier (bounded UNIQUE-insert retry)
    validate.ts         # isIdentifier + assertIdentifier (untrusted-input narrowing)
  test/
    random.test.ts
    registry.test.ts
    nanoid.test.ts
    brand-types.ts        # NEGATIVE compile-time assertions — NOT *.test.ts (vitest skips; the gate type-checks)
    generate.test.ts
    validate.test.ts
    seam-boundary.test.ts # fitness function: only nanoid.ts imports nanoid
```

**Responsibilities:** `nanoid.ts` is the seam (swap target). `random.ts` owns the randomness concern and its type. `registry.ts` is the single source of truth for prefixes; `EntityType` derives from it. `types.ts` is the brand layer keyed off `EntityType`. `generate.ts` mints handles; `validate.ts` narrows untrusted strings. Tests mirror modules one-to-one plus the seam-boundary check.

**Dependency direction (acyclic):** `registry` (no deps) ← `types`; `random` (no deps) ← `nanoid` (seam, type-only) ; `generate` → {seam, registry, random, types}; `validate` → {registry, seam, types}.

---

## Task 1: Scaffold the package and pin nanoid

**Files:**

- Create: `packages/identifiers/package.json`
- Create: `packages/identifiers/tsconfig.json`
- Create: `packages/identifiers/vitest.config.ts`
- Modify: `pnpm-workspace.yaml` (catalog only)

(No `vite.config.ts` change needed — its `test.projects` already globs `packages/*/vitest.config.ts`, which this package matches.)

- [ ] **Step 1: Create the package manifest (exports map = public surface, no barrel)**

`packages/identifiers/package.json`:

```json
{
  "name": "@magna-carta/identifiers",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "sideEffects": false,
  "exports": {
    "./random": "./src/random.ts",
    "./registry": "./src/registry.ts",
    "./types": "./src/types.ts",
    "./generate": "./src/generate.ts",
    "./validate": "./src/validate.ts"
  },
  "scripts": {
    "test": "vp test run"
  },
  "dependencies": {
    "nanoid": "catalog:"
  },
  "devDependencies": {
    "@magna-carta/tsconfig": "workspace:*",
    "@types/node": "catalog:",
    "vitest": "catalog:"
  }
}
```

- [ ] **Step 2: Create the package tsconfig (pure — relative extends, no DOM, no emit)**

`packages/identifiers/tsconfig.json` — **note the RELATIVE `extends` path.** An npm-package ref like `@magna-carta/tsconfig/base` breaks the oxc tsconfig loader on this toolchain; the relative path is what the money package actually uses.

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

(`types: ["node"]` makes the `crypto` global and `node:fs`/`node:path` resolve — the seeded source uses `crypto`, the seam-boundary test reads the source directory.)

- [ ] **Step 3: Create the package Vitest config (root-pinned, default node pool)**

`packages/identifiers/vitest.config.ts`:

```ts
import { defineConfig } from "vite-plus";

// Pure package: the default node pool, no Cloudflare Workers runtime.
// root is pinned to this package so the repo-root `vp test` resolves this project's tests from here.
export default defineConfig({
  root: import.meta.dirname,
});
```

- [ ] **Step 4: Install and pin the exact version into the catalog**

Run:

```bash
pnpm --filter @magna-carta/identifiers add nanoid
```

Then pin the resolved version as an **exact** entry (no `^`/`~`) in `pnpm-workspace.yaml` under `catalog:`, keeping the `package.json` entry as `catalog:`. Add an `# Identifiers (packages/identifiers)` group near the money group:

```yaml
# Identifiers (packages/identifiers). nanoid v5 (ESM, Web Crypto); customRandom + urlAlphabet.
nanoid: <resolved version, e.g. 5.1.11>
```

Confirm the exact version:

```bash
node -e "console.log('nanoid', require('nanoid/package.json').version)"
```

- [ ] **Step 5: Confirm the nanoid imports resolve**

Confirm the exact import paths the seam uses resolve in the installed build:

```bash
node --input-type=module -e "import { customRandom, urlAlphabet } from 'nanoid'; const gen = customRandom(urlAlphabet, 21, (n) => new Uint8Array(n).fill(7)); const id = gen(); console.log('len', id.length, 'alphabet64', urlAlphabet.length, 'urlsafe', /^[A-Za-z0-9_-]+$/.test(urlAlphabet));"
```

Expected: `len 21 alphabet64 64 urlsafe true`. If any import does not resolve, stop and report — do not improvise paths.

- [ ] **Step 6: Verify the empty package type-checks and is discovered**

Run:

```bash
pnpm install
pnpm check
```

Expected: PASS (no source files yet; the package resolves, the catalog is consistent). `pnpm check` runs the full repo gate; if it fails for a pre-existing reason unrelated to this change, report it rather than fixing unrelated failures.

- [ ] **Step 7: Commit**

```bash
git add packages/identifiers pnpm-workspace.yaml pnpm-lock.yaml
git commit -m "chore(identifiers): scaffold @magna-carta/identifiers package + pin nanoid in catalog"
```

---

## Task 2: The random source (`src/random.ts`)

**Files:**

- Create: `packages/identifiers/src/random.ts`
- Test: `packages/identifiers/test/random.test.ts`

`RandomSource` is exactly nanoid's `getRandom` contract — `(bytes: number) => Uint8Array`. Two implementations ship: `cryptoRandomSource` (default, CSPRNG) and `seededRandomSource(seed)` (deterministic, for fixtures). This module is pure — it must NOT import nanoid.

- [ ] **Step 1: Write the failing test**

`packages/identifiers/test/random.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { cryptoRandomSource, seededRandomSource } from "../src/random.ts";

describe("random sources", () => {
  it("cryptoRandomSource returns the requested number of bytes", () => {
    expect(cryptoRandomSource(16)).toHaveLength(16);
    expect(cryptoRandomSource(16)).toBeInstanceOf(Uint8Array);
  });

  it("cryptoRandomSource is not constant (overwhelmingly likely to differ)", () => {
    expect([...cryptoRandomSource(32)]).not.toEqual([...cryptoRandomSource(32)]);
  });

  it("seededRandomSource is deterministic: same seed -> identical byte sequence", () => {
    expect([...seededRandomSource("matter-fixtures")(24)]).toEqual([
      ...seededRandomSource("matter-fixtures")(24),
    ]);
    expect([...seededRandomSource(42)(24)]).toEqual([...seededRandomSource(42)(24)]);
  });

  it("seededRandomSource diverges for different seeds", () => {
    expect([...seededRandomSource("a")(24)]).not.toEqual([...seededRandomSource("b")(24)]);
  });

  it("seededRandomSource advances state across calls on the same instance", () => {
    const source = seededRandomSource("x");
    expect([...source(8)]).not.toEqual([...source(8)]);
  });

  it("seededRandomSource returns bytes in range 0-255", () => {
    for (const byte of seededRandomSource("range-check")(64)) {
      expect(byte).toBeGreaterThanOrEqual(0);
      expect(byte).toBeLessThanOrEqual(255);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @magna-carta/identifiers exec vp test run`
Expected: FAIL — cannot resolve `../src/random.ts`.

- [ ] **Step 3: Write minimal implementation**

`packages/identifiers/src/random.ts`:

```ts
// A source of random bytes. This is exactly nanoid's getRandom contract — (byteCount) => Uint8Array —
// so a RandomSource can be handed straight to the seam's token generator (see ./nanoid.ts).
export type RandomSource = (bytes: number) => Uint8Array;

// Default: the Web Crypto CSPRNG, a global in Workers, Node, and the test runner.
export const cryptoRandomSource: RandomSource = (bytes) =>
  crypto.getRandomValues(new Uint8Array(bytes));

// Deterministic source for fixtures (ADR-0034): the same seed yields the same byte sequence, so fixture
// ids are byte-identical run to run. NOT cryptographic — fixtures only — it exists for reproducibility.
// mulberry32 (a tiny, well-known seedable PRNG) drives the bytes; the seed string is folded to 32-bit
// state with FNV-1a so a human-readable seed ("contingency-scenario") works as well as a number.
export function seededRandomSource(seed: string | number): RandomSource {
  let state = hashSeed(seed);
  return (bytes) => {
    const out = new Uint8Array(bytes);
    for (let index = 0; index < bytes; index++) {
      state = (state + 0x6d2b79f5) | 0;
      let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
      mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
      out[index] = (mixed ^ (mixed >>> 14)) & 0xff;
    }
    return out;
  };
}

// FNV-1a 32-bit hash of the seed's string form — maps any seed to an unsigned 32-bit PRNG state.
function hashSeed(seed: string | number): number {
  const text = typeof seed === "number" ? seed.toString() : seed;
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @magna-carta/identifiers exec vp test run`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/identifiers/src/random.ts packages/identifiers/test/random.test.ts
git commit -m "feat(identifiers): RandomSource — crypto default + deterministic seeded source for fixtures"
```

---

## Task 3: The prefix registry (`src/registry.ts`)

**Files:**

- Create: `packages/identifiers/src/registry.ts`
- Test: `packages/identifiers/test/registry.test.ts`

`ENTITY_PREFIXES` is the single source of truth: entity type → handle prefix. `EntityType` derives from its keys, so adding an entity is one row here (and one alias line in `types.ts`).

- [ ] **Step 1: Write the failing test**

`packages/identifiers/test/registry.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ENTITY_PREFIXES, prefixFor } from "../src/registry.ts";

describe("prefix registry", () => {
  it("maps the known entity types to their prefixes", () => {
    expect(prefixFor("matter")).toBe("mat");
    expect(prefixFor("document")).toBe("doc");
    expect(prefixFor("firm")).toBe("firm");
    expect(prefixFor("idempotencyRecord")).toBe("idr");
  });

  it("has no duplicate prefixes (prefix space partitions the id space)", () => {
    const prefixes = Object.values(ENTITY_PREFIXES);
    expect(new Set(prefixes).size).toBe(prefixes.length);
  });

  it("every prefix is lowercase letters only (no digits, no underscore)", () => {
    for (const prefix of Object.values(ENTITY_PREFIXES)) {
      expect(prefix).toMatch(/^[a-z]+$/);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @magna-carta/identifiers exec vp test run`
Expected: FAIL — `../src/registry.ts` not found.

- [ ] **Step 3: Write minimal implementation**

`packages/identifiers/src/registry.ts`:

```ts
// The single source of truth mapping each entity type to its handle prefix. A handle is
// `<prefix>_<token>` (e.g. mat_V1StGXR8Z5jdHiopq2Cf): the prefix here carries NO trailing underscore —
// the `_` is the separator added at generation time. Adding an entity = one row here + one alias in types.ts.
// Self-describing prefixes make ids debuggable in logs and defend against id-type confusion (ADR-0062).
export const ENTITY_PREFIXES = {
  matter: "mat",
  document: "doc",
  directory: "dir",
  invoice: "inv",
  event: "evt",
  portalGrant: "pgr",
  ledgerEntry: "led",
  outbox: "obx",
  idempotencyRecord: "idr",
  user: "usr",
  firm: "firm",
} as const;

export type EntityType = keyof typeof ENTITY_PREFIXES;
export type EntityPrefix = (typeof ENTITY_PREFIXES)[EntityType];

export function prefixFor(type: EntityType): EntityPrefix {
  return ENTITY_PREFIXES[type];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @magna-carta/identifiers exec vp test run`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/identifiers/src/registry.ts packages/identifiers/test/registry.test.ts
git commit -m "feat(identifiers): prefix registry (entity type -> prefix, single source of truth)"
```

---

## Task 4: Branded identifier types (`src/types.ts`) + negative-compile tests (`test/brand-types.ts`)

**Files:**

- Create: `packages/identifiers/src/types.ts`
- Create: `packages/identifiers/test/brand-types.ts` (compile-checked by the gate; NOT run by Vitest)

The brand is parametrized by the entity literal over one symbol, so `MatterId` ≠ `DocumentId` automatically and the named aliases are one-line sugar over `Identifier<T>`.

- [ ] **Step 1: Write the implementation**

`packages/identifiers/src/types.ts`:

```ts
import type { EntityType } from "./registry.ts";

// Branded handle strings. The brand is keyed by the entity literal over one symbol, so Identifier<"matter">
// and Identifier<"document"> are mutually non-assignable. Brands are compile-time only — erased at runtime,
// so they cost nothing on the wire. A branded id IS assignable to string (it flows into DB values and URLs);
// a raw string is NOT assignable to a branded id without going through validate.ts.
declare const identifierBrand: unique symbol;

export type Identifier<T extends EntityType> = string & { readonly [identifierBrand]: T };

// The brand for a given entity type — the return type of newIdentifier(type) and the narrowed type of a
// validated handle. Trivial here because the brand already keys off the entity literal.
export type BrandFor<T extends EntityType> = Identifier<T>;

// Any identifier, regardless of entity type — for code that handles handles polymorphically.
export type AnyIdentifier = Identifier<EntityType>;

// Named aliases — one per registry entry (golden rule 12: spelled out). Keep in sync with ENTITY_PREFIXES.
export type MatterId = Identifier<"matter">;
export type DocumentId = Identifier<"document">;
export type DirectoryId = Identifier<"directory">;
export type InvoiceId = Identifier<"invoice">;
export type EventId = Identifier<"event">;
export type PortalGrantId = Identifier<"portalGrant">;
export type LedgerEntryId = Identifier<"ledgerEntry">;
export type OutboxId = Identifier<"outbox">;
export type IdempotencyRecordId = Identifier<"idempotencyRecord">;
export type UserId = Identifier<"user">;
export type FirmId = Identifier<"firm">;
```

- [ ] **Step 2: Write the negative-compile test file**

`packages/identifiers/test/brand-types.ts` — this file is deliberately NOT named `*.test.ts`, so Vitest never runs it, but `tsconfig`'s `include` covers it so `vp check` (the gate) type-checks it. Each `@ts-expect-error` must stay USED: an unused directive is itself a gate error (TS2578, verified on this toolchain), so a brand that stops being distinct would make these assignments legal and FAIL the gate.

```ts
import type { DocumentId, FirmId, MatterId } from "../src/types.ts";

declare const documentId: DocumentId;
declare const firmId: FirmId;
declare const matterId: MatterId;

// @ts-expect-error - a DocumentId must not be assignable to a MatterId (distinct brands)
export const wrongBrand: MatterId = documentId;

// @ts-expect-error - a FirmId must not be assignable to a MatterId either
export const wrongBrand2: MatterId = firmId;

// @ts-expect-error - a raw string must not be assignable to a MatterId without validation
export const rawString: MatterId = "mat_V1StGXR8Z5jdHiopq2Cf";

// POSITIVE control: a branded id flows into a plain string (so handles can be used as DB values / URLs).
export const asString: string = matterId;
```

- [ ] **Step 3: Run the gate to verify the type assertions hold**

Run: `pnpm check`
Expected: PASS. The three `@ts-expect-error` directives are all USED (the assignments are genuine type errors that the directive suppresses); the positive control compiles. If the gate reports an "Unused '@ts-expect-error' directive" (TS2578), a brand has collapsed — fix `types.ts` before continuing. (Note: `vp test` does NOT type-check, so this assertion is validated only by `pnpm check`.)

- [ ] **Step 4: Commit**

```bash
git add packages/identifiers/src/types.ts packages/identifiers/test/brand-types.ts
git commit -m "feat(identifiers): branded Identifier<T> types + negative-compile assertions"
```

---

## Task 5: The nanoid seam (`src/nanoid.ts`)

**Files:**

- Create: `packages/identifiers/src/nanoid.ts`
- Test: `packages/identifiers/test/nanoid.test.ts`

The seam is the **only** file that imports `nanoid`. It binds nanoid's `customRandom` to the URL-safe alphabet and the 21-char size, and exposes a factory that takes a `RandomSource`. Every other module depends on `./nanoid.ts`, never on `nanoid` — that is what makes the engine swappable.

- [ ] **Step 1: Write the failing test**

`packages/identifiers/test/nanoid.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { makeTokenGenerator, TOKEN_ALPHABET, TOKEN_SIZE } from "../src/nanoid.ts";
import { cryptoRandomSource, seededRandomSource } from "../src/random.ts";

describe("nanoid seam", () => {
  it("uses a 64-char URL-safe alphabet and a 21-char token (~126 bits)", () => {
    expect(TOKEN_SIZE).toBe(21);
    expect(TOKEN_ALPHABET).toHaveLength(64);
    expect(TOKEN_ALPHABET).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("generates a token of TOKEN_SIZE chars from the alphabet", () => {
    const token = makeTokenGenerator(cryptoRandomSource)();
    expect(token).toHaveLength(TOKEN_SIZE);
    expect(token).toMatch(/^[A-Za-z0-9_-]{21}$/);
  });

  it("is deterministic under a seeded source", () => {
    expect(makeTokenGenerator(seededRandomSource("seed"))()).toBe(
      makeTokenGenerator(seededRandomSource("seed"))(),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @magna-carta/identifiers exec vp test run`
Expected: FAIL — `../src/nanoid.ts` not found.

- [ ] **Step 3: Write minimal implementation**

`packages/identifiers/src/nanoid.ts`:

```ts
// THE SEAM. This is the only file in the package that imports nanoid.
// Everything else uses the branded Identifier<T> types and the in-house functions built on this factory.
// If nanoid ever needed replacing, this one file is the swap target — consumers never see the library.
import { customRandom, urlAlphabet } from "nanoid";
import type { RandomSource } from "./random.ts";

// The URL-safe alphabet (64 symbols: A-Za-z0-9_-) and a 21-char token give ~126 bits of entropy —
// UUIDv4-class collision/guess resistance, the IDOR/unguessability bar of ADR-0062.
export const TOKEN_ALPHABET = urlAlphabet;
export const TOKEN_SIZE = 21;

// Build a token generator bound to a random source. customRandom calls the source with the byte count it
// needs; both cryptoRandomSource and seededRandomSource satisfy (bytes) => Uint8Array. The returned
// generator produces a TOKEN_SIZE-char token per call.
export function makeTokenGenerator(randomSource: RandomSource): () => string {
  return customRandom(TOKEN_ALPHABET, TOKEN_SIZE, randomSource);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @magna-carta/identifiers exec vp test run`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/identifiers/src/nanoid.ts packages/identifiers/test/nanoid.test.ts
git commit -m "feat(identifiers): nanoid seam (only file importing nanoid; 21-char URL-safe token)"
```

---

## Task 6: Generation (`src/generate.ts`)

**Files:**

- Create: `packages/identifiers/src/generate.ts`
- Test: `packages/identifiers/test/generate.test.ts`

`newIdentifier` builds `<prefix>_<token>`. `generateUniqueIdentifier` wraps the bounded retry-on-collision loop (the UNIQUE-insert idiom of ADR-0062): it hands each candidate to a caller-supplied `tryInsert`, which performs the actual `INSERT … ON CONFLICT` and returns `true` on success / `false` on a primary-key collision.

- [ ] **Step 1: Write the failing test**

`packages/identifiers/test/generate.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { generateUniqueIdentifier, newIdentifier } from "../src/generate.ts";
import { seededRandomSource } from "../src/random.ts";
import type { MatterId } from "../src/types.ts";

describe("newIdentifier", () => {
  it("builds a <prefix>_<token> handle with the registered prefix", () => {
    const id = newIdentifier("matter");
    expect(id).toMatch(/^mat_[A-Za-z0-9_-]{21}$/);
    expect(newIdentifier("document")).toMatch(/^doc_[A-Za-z0-9_-]{21}$/);
  });

  it("returns the entity's brand (compile-time) and is assignable to string", () => {
    const matterId: MatterId = newIdentifier("matter"); // must compile (correct brand)
    const asString: string = matterId; // branded id flows into string
    expect(typeof asString).toBe("string");
  });

  it("is deterministic with a seeded source: same seed -> same id sequence", () => {
    const sequence = (seed: string) => {
      const source = seededRandomSource(seed);
      return [newIdentifier("matter", source), newIdentifier("matter", source)];
    };
    expect(sequence("a")).toEqual(sequence("a"));
    expect(sequence("a")).not.toEqual(sequence("b"));
  });
});

describe("generateUniqueIdentifier", () => {
  it("returns the candidate on the first successful insert", async () => {
    let calls = 0;
    const id = await generateUniqueIdentifier("matter", () => {
      calls++;
      return true;
    });
    expect(calls).toBe(1);
    expect(id).toMatch(/^mat_/);
  });

  it("retries on collision with a fresh candidate each time, then succeeds", async () => {
    const candidates: string[] = [];
    const id = await generateUniqueIdentifier("matter", (candidate) => {
      candidates.push(candidate);
      return candidates.length >= 3; // first two "collide", third "inserts"
    });
    expect(candidates).toHaveLength(3);
    expect(new Set(candidates).size).toBe(3); // each retry generated a distinct candidate
    expect(id).toBe(candidates[2]);
  });

  it("supports an async tryInsert", async () => {
    const id = await generateUniqueIdentifier("invoice", async () => Promise.resolve(true));
    expect(id).toMatch(/^inv_/);
  });

  it("throws after exhausting maxAttempts (signals a broken random source)", async () => {
    await expect(
      generateUniqueIdentifier("matter", () => false, { maxAttempts: 3 }),
    ).rejects.toThrow(/3 attempts/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @magna-carta/identifiers exec vp test run`
Expected: FAIL — `../src/generate.ts` not found.

- [ ] **Step 3: Write minimal implementation**

`packages/identifiers/src/generate.ts`:

```ts
import { makeTokenGenerator } from "./nanoid.ts";
import { cryptoRandomSource, type RandomSource } from "./random.ts";
import { ENTITY_PREFIXES, type EntityType } from "./registry.ts";
import type { BrandFor } from "./types.ts";

// Mint a new handle for an entity type: <prefix>_<token>. Uses the CSPRNG by default; fixtures pass a
// seededRandomSource for byte-deterministic ids (ADR-0034).
export function newIdentifier<T extends EntityType>(
  type: T,
  randomSource: RandomSource = cryptoRandomSource,
): BrandFor<T> {
  const token = makeTokenGenerator(randomSource)();
  return `${ENTITY_PREFIXES[type]}_${token}` as BrandFor<T>;
}

const DEFAULT_MAX_ATTEMPTS = 3;

export interface GenerateUniqueOptions {
  randomSource?: RandomSource;
  maxAttempts?: number;
}

// The UNIQUE-insert idiom (ADR-0062), reused by idempotency (ADR-0063) and the outbox (ADR-0064):
// generate a candidate and hand it to tryInsert, which performs the real INSERT … ON CONFLICT and returns
// true on success / false on a primary-key collision. Retry with a FRESH candidate up to maxAttempts.
// At ~126 bits a genuine collision is astronomically rare, so exhausting attempts means the random source
// is broken (e.g. a seeded source reused where uniqueness is required) — fail loud rather than loop.
export async function generateUniqueIdentifier<T extends EntityType>(
  type: T,
  tryInsert: (candidate: BrandFor<T>) => boolean | Promise<boolean>,
  options: GenerateUniqueOptions = {},
): Promise<BrandFor<T>> {
  const { randomSource = cryptoRandomSource, maxAttempts = DEFAULT_MAX_ATTEMPTS } = options;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const candidate = newIdentifier(type, randomSource);
    if (await tryInsert(candidate)) return candidate;
  }
  throw new Error(
    `generateUniqueIdentifier: ${maxAttempts} attempts collided for "${type}" — check the random source`,
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @magna-carta/identifiers exec vp test run`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/identifiers/src/generate.ts packages/identifiers/test/generate.test.ts
git commit -m "feat(identifiers): newIdentifier + generateUniqueIdentifier (bounded UNIQUE-insert retry)"
```

---

## Task 7: Boundary validation (`src/validate.ts`)

**Files:**

- Create: `packages/identifiers/src/validate.ts`
- Test: `packages/identifiers/test/validate.test.ts`

`isIdentifier`/`assertIdentifier` are the only sanctioned way an untrusted `string` (URL param, request body, foreign key) becomes a branded `BrandFor<T>`. Validation = the prefix matches the expected entity AND the token is 21 chars from the URL-safe set.

- [ ] **Step 1: Write the failing test**

`packages/identifiers/test/validate.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { newIdentifier } from "../src/generate.ts";
import { assertIdentifier, isIdentifier } from "../src/validate.ts";
import type { MatterId } from "../src/types.ts";

describe("isIdentifier", () => {
  it("accepts a freshly minted id of the matching type", () => {
    expect(isIdentifier(newIdentifier("matter"), "matter")).toBe(true);
  });

  it("rejects a handle of the wrong entity type", () => {
    expect(isIdentifier(newIdentifier("document"), "matter")).toBe(false);
  });

  it("rejects malformed handles", () => {
    expect(isIdentifier("mat_tooshort", "matter")).toBe(false);
    expect(isIdentifier("mat_V1StGXR8Z5jdHiopq2Cf!", "matter")).toBe(false); // 22 chars / bad char
    expect(isIdentifier("matV1StGXR8Z5jdHiopq2Cf", "matter")).toBe(false); // no separator
    expect(isIdentifier("", "matter")).toBe(false);
    expect(isIdentifier("mat_", "matter")).toBe(false);
  });

  it("rejects non-strings", () => {
    expect(isIdentifier(undefined, "matter")).toBe(false);
    expect(isIdentifier(123, "matter")).toBe(false);
    expect(isIdentifier(null, "matter")).toBe(false);
  });

  it("narrows the type for the compiler", () => {
    const value: unknown = newIdentifier("matter");
    if (isIdentifier(value, "matter")) {
      const matterId: MatterId = value; // must compile — narrowed to MatterId
      expect(matterId).toMatch(/^mat_/);
    }
  });
});

describe("assertIdentifier", () => {
  it("returns the branded id when valid", () => {
    const raw: unknown = newIdentifier("matter");
    const matterId: MatterId = assertIdentifier(raw, "matter"); // narrows + returns
    expect(matterId).toMatch(/^mat_/);
  });

  it("throws on an invalid or wrong-type handle", () => {
    expect(() => assertIdentifier("doc_V1StGXR8Z5jdHiopq2Cf", "matter")).toThrow(/matter/);
    expect(() => assertIdentifier(42, "matter")).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @magna-carta/identifiers exec vp test run`
Expected: FAIL — `../src/validate.ts` not found.

- [ ] **Step 3: Write minimal implementation**

`packages/identifiers/src/validate.ts`:

```ts
import { TOKEN_SIZE } from "./nanoid.ts";
import { ENTITY_PREFIXES, type EntityType } from "./registry.ts";
import type { BrandFor } from "./types.ts";

// The token character class is the URL-safe set (A-Za-z0-9_-) the generator's alphabet draws from.
// A test (registry/seam conformance) asserts every character of the seam's TOKEN_ALPHABET falls in this
// class, so the two cannot drift. One precompiled pattern per entity type — built once at module load.
const HANDLE_PATTERNS = Object.fromEntries(
  Object.entries(ENTITY_PREFIXES).map(([type, prefix]) => [
    type,
    new RegExp(`^${prefix}_[A-Za-z0-9_-]{${TOKEN_SIZE}}$`),
  ]),
) as Record<EntityType, RegExp>;

// Type guard: is `value` a well-formed handle for entity `type`? Narrows an untrusted value to the brand.
export function isIdentifier<T extends EntityType>(value: unknown, type: T): value is BrandFor<T> {
  return typeof value === "string" && HANDLE_PATTERNS[type].test(value);
}

// Throwing narrower for the common "reject bad input" path (e.g. a URL param). The caller's error
// middleware maps the throw to a 400; here we only fail loud with a clear message.
export function assertIdentifier<T extends EntityType>(value: unknown, type: T): BrandFor<T> {
  if (!isIdentifier(value, type)) {
    const shown = typeof value === "string" ? JSON.stringify(value) : typeof value;
    throw new TypeError(`not a valid ${type} identifier: ${shown}`);
  }
  return value;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @magna-carta/identifiers exec vp test run`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/identifiers/src/validate.ts packages/identifiers/test/validate.test.ts
git commit -m "feat(identifiers): isIdentifier/assertIdentifier — untrusted-string narrowing at boundaries"
```

---

## Task 8: Seam-boundary + alphabet-sync fitness function (`test/seam-boundary.test.ts`)

**Files:**

- Create: `packages/identifiers/test/seam-boundary.test.ts`

Two structural guarantees in one file: nanoid is imported only inside `nanoid.ts` (the swappable seam holds), and the validator's hardcoded URL-safe class cannot drift from the seam's actual alphabet.

- [ ] **Step 1: Write the test**

`packages/identifiers/test/seam-boundary.test.ts`:

```ts
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { TOKEN_ALPHABET } from "../src/nanoid.ts";

const SRC = join(import.meta.dirname, "..", "src");

describe("nanoid seam boundary", () => {
  it("only src/nanoid.ts imports nanoid", async () => {
    const files = (await readdir(SRC)).filter((file) => file.endsWith(".ts"));
    const offenders: string[] = [];
    for (const file of files) {
      if (file === "nanoid.ts") continue;
      const text = await readFile(join(SRC, file), "utf8");
      if (/from\s+["']nanoid/.test(text)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });

  it("the seam's alphabet stays within the URL-safe class the validator assumes", () => {
    // validate.ts hardcodes [A-Za-z0-9_-] for the token; this guards against the seam's alphabet drifting
    // out of that set, which would make valid generated ids fail validation.
    expect(TOKEN_ALPHABET).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});
```

- [ ] **Step 2: Run test to verify it passes (or catches a real leak)**

Run: `pnpm --filter @magna-carta/identifiers exec vp test run`
Expected: PASS — only `nanoid.ts` imports the engine and the alphabet is URL-safe. If the first assertion FAILS, a module leaked the dependency; move that import behind `nanoid.ts` before continuing.

- [ ] **Step 3: Run the full gate**

Run: `pnpm check && pnpm test`
Expected: PASS (fmt + lint incl. `oxc/no-barrel-file`, type-check incl. the `brand-types.ts` negative assertions, all identifiers tests, and the existing money + worker tests).

- [ ] **Step 4: Commit**

```bash
git add packages/identifiers/test/seam-boundary.test.ts
git commit -m "test(identifiers): fitness function — nanoid imported only inside the seam; alphabet sync"
```

---

## Task 9: Docs (golden rule 5)

**Files:**

- Modify: `ROADMAP.md` (slice 0·2 progress)
- Modify: `CHANGELOG.md`

No Decision-Log change is needed: the plan implements **ADR-0062** faithfully (no decision diverged), and **ADR-0071** already names `@magna-carta/identifiers` in the package layout. (Contrast with money, which amended ADR-0061 because the bigint→number representation genuinely changed.)

- [ ] **Step 1: Update ROADMAP.md**

Under "Now", update the slice 0·2 line so `@magna-carta/identifiers` is marked complete (package 2 of 4 — `money` and `identifiers` done; `database` and `data-access` remaining). Do not move the slice to "Recently shipped" until all four packages land.

- [ ] **Step 2: Update CHANGELOG.md**

Add an entry: `@magna-carta/identifiers` — opaque type-prefixed CSPRNG handles (`<prefix>_<token>`, ~126-bit, URL-safe) that are both primary key and public id; branded `Identifier<T>` types; the prefix registry; a seeded random source for fixture determinism; `isIdentifier`/`assertIdentifier` boundary validation; and the bounded UNIQUE-insert retry idiom — all behind a swappable seam over nanoid.

- [ ] **Step 3: Run the full gate one more time**

Run: `pnpm check && pnpm test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add ROADMAP.md CHANGELOG.md
git commit -m "docs(identifiers): roadmap + changelog for @magna-carta/identifiers"
```

---

## Self-review notes (spec coverage)

- **§2.1 format** (`<prefix>_<token>`, ~126 bits, URL-safe, random never time-encoded; handle = PK + public id): Tasks 5 (seam: alphabet + 21-char size) and 6 (`newIdentifier` assembles `<prefix>_<token>`). The "handle is the D1 primary key / FKs store the handle" property is realized in `@magna-carta/database`, where columns exist.
- **§2.2 prefix registry** (entity → prefix → brand; conformance): Task 3 (`ENTITY_PREFIXES`, the source of truth; unique/lowercase conformance) + Task 4 (named brand per entity). The "every persisted entity has a registered prefix and brand" cross-check belongs to `@magna-carta/database`/`data-access` (it needs tables/entities); here the registry's internal consistency is covered.
- **§2.3 generation** (`cryptoRandomSource` default + seeded PRNG for fixtures; UNIQUE-insert + bounded retry): Tasks 2 (sources), 6 (`newIdentifier` determinism + `generateUniqueIdentifier` retry/exhaustion). The real `INSERT … ON CONFLICT` lives in `database`/`data-access`; the pure retry loop here is supplied a `tryInsert` callback.
- **§2.4 branded types** (`DocumentId` ≠ `MatterId`, erased at runtime): Task 4 (`Identifier<T>` + named aliases) + the `brand-types.ts` negative-compile assertions (verified caught by the gate via TS2578).
- **§2.5 cross-database references** (per-firm rows store the control-plane `usr_`/`firm_` handle): supported by the `user`/`firm` registry entries and `UserId`/`FirmId` brands (Tasks 3–4). The reference columns themselves are a `database` concern.
- **§6 identifiers test plan** (collision-retry under forced collision; brand negative-compile; fixture determinism; prefix-registry conformance): Tasks 6, 4, 2/6, 3 respectively. The collision is forced via `tryInsert` returning `false` (faithful to how a DB `UNIQUE` rejection surfaces) rather than by engineering RNG output equality, which nanoid's internal byte-consumption makes brittle — noted, not silently changed.
- **§1.5/enforcement parallel** (seam discipline): Task 8 (only `nanoid.ts` imports nanoid) + `oxc/no-barrel-file` (gate) + the alphabet-sync guard.

**Deferred to later packages (not gaps):** the persisted-entity prefix/brand conformance test and the FK-stores-handle wiring (need schemas — `@magna-carta/database`); fixtures minting ids through `newIdentifier` with a seeded source (the fixtures harness is its own Phase 0 item, consuming `./generate` + `./random`).
