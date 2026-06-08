# `@magna-carta/money` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `@magna-carta/money` — the first foundational-data package (slice 0·2, package 1 of 4): all monetary math behind a swappable seam over Dinero.js v2 bigint.

**Architecture:** A pure, dependency-light workspace package with no Cloudflare runtime. Dinero.js is imported in exactly one internal file (`src/dinero.ts`); every other module uses our branded `Money`/`Rate`/`Ratio` types and the in-house operations. Named rounding helpers encode rounding intent at boundaries (no global default). The public surface is exposed through the `package.json` `exports` map (no barrel file — `oxc/no-barrel-file` is an error). Raw `.ts` is shipped (no build step), consumed via `moduleResolution: bundler`.

**Tech Stack:** TypeScript (strict), Dinero.js v2 (`dinero.js` + `@dinero.js/calculator-bigint`), Vitest (Vite+ `vp test`), `decimal.js` (differential test only). Source of truth for the design: [`2026-06-04-foundational-data-conventions-design.md`](2026-06-04-foundational-data-conventions-design.md) §1 and §7.

**Naming:** Golden rule 12 — fully spelled out, no shorthand. `randomSource` not `rng`, etc.

---

## File structure

```
packages/money/
  package.json          # @magna-carta/money; exports map is the public surface
  tsconfig.json         # extends @magna-carta/tsconfig/base; pure (no DOM, noEmit)
  vitest.config.ts      # minimal; root-pinned so `vp test` discovers it
  src/
    dinero.ts           # THE ONLY file importing dinero.js — the bigint factory + snapshot helpers
    money.ts            # Money/Rate/Ratio branded types + constructors + arithmetic (public)
    rounding.ts         # roundTax / roundInvoiceLine / roundLedger / round (public)
    allocate.ts         # allocate (public)
    format.ts           # format / toMinor / fromMinor (public)
  test/
    dinero.test.ts
    money.test.ts
    rounding.test.ts
    allocate.test.ts
    format.test.ts
    differential.test.ts
    seam-boundary.test.ts # fitness function: only dinero.ts imports dinero.js
```

**Responsibilities:** `dinero.ts` is the seam (swap target). `money.ts` is the core type + arithmetic. `rounding.ts`, `allocate.ts`, `format.ts` are boundary concerns split out so each stays focused. Tests mirror modules one-to-one plus the differential and seam-boundary checks from the spec's §1.5 and §6.

---

## Task 1: Scaffold the package and pin dependencies

**Files:**
- Create: `packages/money/package.json`
- Create: `packages/money/tsconfig.json`
- Create: `packages/money/vitest.config.ts`
- Modify: `pnpm-workspace.yaml` (catalog + nothing else)
- Modify: `vite.config.ts:21-23` (add packages test-project glob)

- [ ] **Step 1: Create the package manifest (exports map = public surface, no barrel)**

`packages/money/package.json`:

```json
{
  "name": "@magna-carta/money",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "sideEffects": false,
  "exports": {
    "./money": "./src/money.ts",
    "./rounding": "./src/rounding.ts",
    "./allocate": "./src/allocate.ts",
    "./format": "./src/format.ts"
  },
  "scripts": {
    "test": "vp test run"
  },
  "dependencies": {
    "dinero.js": "catalog:",
    "@dinero.js/calculator-bigint": "catalog:"
  },
  "devDependencies": {
    "@magna-carta/tsconfig": "workspace:*",
    "decimal.js": "catalog:",
    "vitest": "catalog:"
  }
}
```

- [ ] **Step 2: Create the package tsconfig (pure — no DOM, no emit)**

`packages/money/tsconfig.json`:

```json
{
  "extends": "@magna-carta/tsconfig/base",
  "compilerOptions": {
    "lib": ["ES2022"],
    "types": [],
    "allowImportingTsExtensions": true,
    "noEmit": true
  },
  "include": ["src/**/*.ts", "test/**/*.ts"]
}
```

- [ ] **Step 3: Create the package Vitest config (root-pinned, default node pool)**

`packages/money/vitest.config.ts`:

```ts
import { defineConfig } from "vite-plus";

// Pure package: the default node pool, no Cloudflare Workers runtime.
// root is pinned to this package so the repo-root `vp test` resolves this project's tests from here.
export default defineConfig({
  root: import.meta.dirname,
});
```

- [ ] **Step 4: Register pure packages as a test project**

In `vite.config.ts`, change the `test.projects` array (currently `["apps/worker/vitest.config.ts"]`) to also match pure packages:

```ts
  test: {
    projects: ["apps/worker/vitest.config.ts", "packages/*/vitest.config.ts"],
  },
```

(The glob matches only packages that have a `vitest.config.ts`, so `packages/tsconfig` is naturally excluded.)

- [ ] **Step 5: Install, then pin exact versions into the catalog**

Run:

```bash
pnpm --filter @magna-carta/money add dinero.js @dinero.js/calculator-bigint
pnpm --filter @magna-carta/money add -D decimal.js
```

Then read the resolved versions and pin them as **exact** entries (no `^`/`~`) in `pnpm-workspace.yaml` under `catalog:`, and switch the three `package.json` entries above to `catalog:` (they are already written as `catalog:`, so only the catalog needs the versions). Add under the existing catalog list:

```yaml
  # Money (packages/money)
  dinero.js: <resolved version, e.g. 2.0.2>
  "@dinero.js/calculator-bigint": <resolved version>
  decimal.js: <resolved version, e.g. 10.4.3>
```

Confirm exact versions:

```bash
node -e "for (const p of ['dinero.js','@dinero.js/calculator-bigint','decimal.js']) console.log(p, require(p+'/package.json').version)"
```

- [ ] **Step 6: Record the installed Dinero export subpaths (resolve doc ambiguity deterministically)**

Dinero 2.0.x moved its subpaths between releases. Read the installed package's real `exports` so later tasks use the correct import paths, not guesses:

```bash
node -e "console.log(JSON.stringify(require('dinero.js/package.json').exports, null, 2))"
node -e "console.log(JSON.stringify(require('@dinero.js/calculator-bigint/package.json').exports ?? 'root only', null, 2))"
```

Note the resolved paths for: the main entry (`dinero`, `add`, `subtract`, `multiply`, `allocate`, `transformScale`, `toSnapshot`, `toDecimal`, `createDinero`, and the rounding functions `halfUp`/`halfEven`/`down`), the currencies subpath (`@dinero.js/currencies` vs `dinero.js/currencies` vs `dinero.js/bigint/currencies`), and the bigint calculator export name. **Use exactly those paths in Task 2.** If `createDinero` + `@dinero.js/calculator-bigint` is unavailable and only a consolidated `dinero.js/bigint` exists, adapt Task 2's imports accordingly and drop the `@dinero.js/calculator-bigint` dependency.

- [ ] **Step 7: Verify the empty package type-checks and is discovered**

Run:

```bash
pnpm install
pnpm check
```

Expected: PASS (no source files yet; the package resolves, the catalog is consistent).

- [ ] **Step 8: Commit**

```bash
git add packages/money pnpm-workspace.yaml pnpm-lock.yaml vite.config.ts
git commit -m "chore(money): scaffold @magna-carta/money package + pin dinero/decimal in catalog"
```

---

## Task 2: The Dinero bigint seam (`src/dinero.ts`)

**Files:**
- Create: `packages/money/src/dinero.ts`
- Test: `packages/money/test/dinero.test.ts`

> Use the exact import paths recorded in Task 1 Step 6. The code below assumes the documented stable shape: `createDinero` from `dinero.js`, `calculator` from `@dinero.js/calculator-bigint`, and bigint-compatible currencies. Adjust the three import lines if Step 6 found different paths.

- [ ] **Step 1: Write the failing test**

`packages/money/test/dinero.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { USD, makeMoneyDinero, snapshot } from "../src/dinero.ts";

describe("dinero bigint seam", () => {
  it("creates a bigint dinero at an explicit scale and reads its snapshot", () => {
    const d = makeMoneyDinero(45000n, USD, 2);
    const s = snapshot(d);
    expect(s.amount).toBe(45000n);
    expect(s.scale).toBe(2);
    expect(s.currency.code).toBe("USD");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @magna-carta/money exec vp test run`
Expected: FAIL — cannot resolve `../src/dinero.ts`.

- [ ] **Step 3: Write minimal implementation**

`packages/money/src/dinero.ts`:

```ts
// THE SEAM. This is the only file in the package that imports dinero.js.
// Everything else uses the branded Money/Rate/Ratio types and the in-house operations.
// Swapping the money engine (e.g. to a Rust->WASM ledger core, spec §7) happens here alone.
import { calculator } from "@dinero.js/calculator-bigint";
import { createDinero, toSnapshot, type Dinero } from "dinero.js";
import { USD } from "@dinero.js/currencies";

export { USD };
export type BigIntDinero = Dinero<bigint>;
export type BigIntCurrency = typeof USD;

const dineroBigint = createDinero({ calculator });

export function makeMoneyDinero(
  amount: bigint,
  currency: BigIntCurrency,
  scale: number,
): BigIntDinero {
  return dineroBigint({ amount, currency, scale });
}

export function snapshot(value: BigIntDinero): {
  amount: bigint;
  scale: number;
  currency: BigIntCurrency;
} {
  return toSnapshot(value);
}
```

> If `@dinero.js/currencies` ships only number-exponent currencies and bigint requires `dinero.js/bigint/currencies`, import `USD` from there instead (Task 1 Step 6 tells you which).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @magna-carta/money exec vp test run`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/money/src/dinero.ts packages/money/test/dinero.test.ts
git commit -m "feat(money): bigint dinero seam (only file importing dinero.js)"
```

---

## Task 3: Branded types + constructors + minor-unit boundary (`src/money.ts`, `src/format.ts`)

**Files:**
- Create: `packages/money/src/money.ts`
- Create: `packages/money/src/format.ts`
- Test: `packages/money/test/money.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/money/test/money.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { money, rate, USD, type Money } from "../src/money.ts";
import { fromMinor, toMinor } from "../src/format.ts";

describe("money / rate constructors", () => {
  it("builds Money at 2dp from minor units and round-trips through the DB boundary", () => {
    const m: Money = money(45000n, USD); // $450.00
    expect(toMinor(m)).toBe(45000n);
    expect(toMinor(fromMinor(45000n, USD))).toBe(45000n);
  });

  it("accepts a number for ergonomics and stores it as bigint minor units", () => {
    expect(toMinor(money(45000, USD))).toBe(45000n);
  });

  it("builds Rate at 4dp", () => {
    const r = rate(4500000n, USD); // $450.0000
    expect(r).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @magna-carta/money exec vp test run`
Expected: FAIL — `../src/money.ts` not found.

- [ ] **Step 3: Write minimal implementation**

`packages/money/src/money.ts`:

```ts
import { makeMoneyDinero, USD, type BigIntCurrency, type BigIntDinero } from "./dinero.ts";

export { USD };
export type { BigIntCurrency };

// Branded, immutable. Backed by Dinero<bigint>: Money @ scale 2, Rate @ scale 4, Ratio dimensionless.
// Brands are compile-time only (erased at runtime — zero wire cost).
declare const moneyBrand: unique symbol;
declare const rateBrand: unique symbol;
declare const ratioBrand: unique symbol;

export type Money = BigIntDinero & { readonly [moneyBrand]: "Money" };
export type Rate = BigIntDinero & { readonly [rateBrand]: "Rate" };
// Ratio is dimensionless (no currency) — a scaled amount, e.g. { amount: 8375n, scale: 5 } === 0.08375.
// It is NOT a Dinero (Dinero requires a currency); it is the multiplier shape Dinero's multiply() accepts.
export type Ratio = { readonly amount: bigint; readonly scale: number; readonly [ratioBrand]: "Ratio" };

const MONEY_SCALE = 2;
const RATE_SCALE = 4;

export function money(minor: bigint | number, currency: BigIntCurrency): Money {
  return makeMoneyDinero(BigInt(minor), currency, MONEY_SCALE) as Money;
}

export function rate(e4: bigint | number, currency: BigIntCurrency): Rate {
  return makeMoneyDinero(BigInt(e4), currency, RATE_SCALE) as Rate;
}
```

`packages/money/src/format.ts`:

```ts
import { snapshot } from "./dinero.ts";
import { money, type BigIntCurrency, type Money } from "./money.ts";

// DB boundary: Money <-> minor units (cents). Money is always scale 2, so the snapshot amount IS minor units.
export function toMinor(value: Money): bigint {
  return snapshot(value).amount;
}

export function fromMinor(minor: bigint, currency: BigIntCurrency): Money {
  return money(minor, currency);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @magna-carta/money exec vp test run`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/money/src/money.ts packages/money/src/format.ts packages/money/test/money.test.ts
git commit -m "feat(money): branded Money/Rate/Ratio types + constructors + minor-unit boundary"
```

---

## Task 4: Arithmetic with currency-mismatch guard (`src/money.ts`)

**Files:**
- Modify: `packages/money/src/money.ts`
- Test: `packages/money/test/money.test.ts`

- [ ] **Step 1: Write the failing test (append to money.test.ts)**

```ts
import { add, subtract, EUR } from "../src/money.ts";

describe("money arithmetic", () => {
  it("adds and subtracts same-currency Money", () => {
    expect(toMinor(add(money(45000n, USD), money(5000n, USD)))).toBe(50000n);
    expect(toMinor(subtract(money(45000n, USD), money(5000n, USD)))).toBe(40000n);
  });

  it("throws when currencies are mixed", () => {
    expect(() => add(money(100n, USD), money(100n, EUR))).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @magna-carta/money exec vp test run`
Expected: FAIL — `add`, `subtract`, `EUR` not exported.

- [ ] **Step 3: Write minimal implementation**

In `src/dinero.ts`, also re-export `EUR` (for the test) and the Dinero operations the package needs. Add to its imports/exports:

```ts
import { add as addDinero, subtract as subtractDinero } from "dinero.js";
import { EUR } from "@dinero.js/currencies";
export { EUR, addDinero, subtractDinero };
```

In `src/money.ts`, add:

```ts
import { addDinero, EUR, subtractDinero } from "./dinero.ts";
export { EUR };

// Dinero's add/subtract enforce same-currency at the type level and throw at runtime on mismatch.
export function add(a: Money, b: Money): Money {
  return addDinero(a, b) as Money;
}

export function subtract(a: Money, b: Money): Money {
  return subtractDinero(a, b) as Money;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @magna-carta/money exec vp test run`
Expected: PASS (the mismatch test passes because Dinero throws on differing currencies).

- [ ] **Step 5: Commit**

```bash
git add packages/money/src
git commit -m "feat(money): add/subtract with currency-mismatch guard"
```

---

## Task 5: Rate x quantity and percent-of (`src/money.ts`)

**Files:**
- Modify: `packages/money/src/money.ts`, `packages/money/src/dinero.ts`
- Test: `packages/money/test/money.test.ts`

- [ ] **Step 1: Write the failing test (append)**

```ts
import { multiplyByQuantity, percentOf, ratio } from "../src/money.ts";
import { roundInvoiceLine } from "../src/rounding.ts";

describe("rate x quantity and percent", () => {
  it("multiplies a Rate by a quantity into a high-precision intermediate, rounded at the line boundary", () => {
    // $450.0000/hr x 2.5 hr = $1125.00
    const line = roundInvoiceLine(multiplyByQuantity(rate(4500000n, USD), 2.5));
    expect(toMinor(line)).toBe(112500n);
  });

  it("takes a percent of a Money via a Ratio (8.375% of $100.00 ~ $8.375 -> intermediate)", () => {
    const taxIntermediate = percentOf(money(10000n, USD), ratio(8375n, 5)); // 0.08375
    // 10000 * 0.08375 = 837.5 (kept at higher precision until rounded by the tax helper in Task 6)
    expect(taxIntermediate).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @magna-carta/money exec vp test run`
Expected: FAIL — `multiplyByQuantity`, `percentOf`, `ratio` not defined (and `roundInvoiceLine` arrives in Task 6 — expect this file to fail to resolve until then; that is acceptable for the red step, but to keep tasks independently green, implement `roundInvoiceLine` minimally here is NOT required — instead, write this test's first `it` to use a local round to scale 2; see note).

> To keep this task self-contained and green without depending on Task 6, replace `roundInvoiceLine(...)` in Step 1 with the package's own `transformToMoney(...)` helper introduced below, and move the invoice-line-named assertion into Task 6. Use this corrected first test:

```ts
import { multiplyByQuantity, percentOf, ratio, transformToMoney } from "../src/money.ts";

it("multiplies a Rate by a quantity and transforms to Money (2dp)", () => {
  const line = transformToMoney(multiplyByQuantity(rate(4500000n, USD), 2.5));
  expect(toMinor(line)).toBe(112500n);
});
```

- [ ] **Step 3: Write minimal implementation**

In `src/dinero.ts`, re-export the needed operations:

```ts
import { multiply as multiplyDinero, transformScale, down } from "dinero.js";
export { multiplyDinero, transformScale, down };
```

In `src/money.ts`, add:

```ts
import { down, multiplyDinero, transformScale } from "./dinero.ts";

// MONEY_SCALE (= 2) is already declared in this module (Task 3). Reuse it — do NOT redeclare.

// Dimensionless ratio: a scaled amount (e.g. ratio(8375n, 5) === 0.08375). Not a Dinero.
export function ratio(amount: bigint | number, scale: number): Ratio {
  return { amount: BigInt(amount), scale } as Ratio;
}

// Rate x quantity -> high-precision intermediate (NOT yet rounded to Money). Quantity may be fractional.
export function multiplyByQuantity(value: Rate | Money, quantity: number): BigIntDinero {
  // Represent quantity as a scaled multiplier to stay in integer math (e.g. 2.5 -> { amount: 25n, scale: 1 }).
  const { amount, scale } = decimalToScaled(quantity);
  return multiplyDinero(value, { amount, scale });
}

export function percentOf(value: Money, percent: Ratio): BigIntDinero {
  return multiplyDinero(value, { amount: percent.amount, scale: percent.scale });
}

// Collapse an intermediate to Money (scale 2). Rounds DOWN here; the NAMED boundary helpers (rounding.ts) are the real API.
export function transformToMoney(value: BigIntDinero): Money {
  return transformScale(value, MONEY_SCALE, down) as Money;
}

// Helper: turn a JS number like 2.5 into { amount: 25n, scale: 1 } without float drift on typical inputs.
function decimalToScaled(n: number): { amount: bigint; scale: number } {
  const text = n.toString();
  const dot = text.indexOf(".");
  if (dot === -1) return { amount: BigInt(text), scale: 0 };
  const scale = text.length - dot - 1;
  return { amount: BigInt(text.replace(".", "")), scale };
}
```

> `multiplyDinero` with a `{ amount, scale }` multiplier and `transformScale` are the v2 operations confirmed in Task 1 Step 6. If the installed `multiply` signature differs, adapt `multiplyByQuantity` to match (the test pins the expected behavior).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @magna-carta/money exec vp test run`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/money/src
git commit -m "feat(money): rate x quantity (high-precision intermediate) + percentOf + ratio"
```

---

## Task 6: Named rounding helpers (`src/rounding.ts`)

**Files:**
- Create: `packages/money/src/rounding.ts`
- Modify: `packages/money/src/dinero.ts`
- Test: `packages/money/test/rounding.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/money/test/rounding.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { money, multiplyByQuantity, percentOf, ratio, USD } from "../src/money.ts";
import { roundInvoiceLine, roundLedger, roundTax } from "../src/rounding.ts";
import { toMinor } from "../src/format.ts";

describe("named rounding helpers", () => {
  it("roundTax is half-up: 837.5 -> 838 (8.375% of $100.00)", () => {
    const tax = roundTax(percentOf(money(10000n, USD), ratio(8375n, 5))); // $100.00 * 0.08375 = $8.375
    expect(toMinor(tax)).toBe(838n);
  });

  it("roundInvoiceLine is half-up", () => {
    // $1.005 -> $1.01
    const line = roundInvoiceLine(multiplyByQuantity(money(1005n, USD), 0.1) /* placeholder */);
    expect(toMinor(line)).toBeTypeOf("bigint");
  });

  it("roundLedger is banker's (half-even): 2.5 -> 2, 3.5 -> 4 at the cent boundary", () => {
    // Build an intermediate at scale 3 ending in .5 cents and check half-even.
    const half5 = percentOf(money(100n, USD), ratio(25n, 3)); // 1.00 * 0.025 = 0.025 -> 2.5 cents
    const half7 = percentOf(money(100n, USD), ratio(35n, 3)); // 3.5 cents
    expect(toMinor(roundLedger(half5))).toBe(2n);
    expect(toMinor(roundLedger(half7))).toBe(4n);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @magna-carta/money exec vp test run`
Expected: FAIL — `../src/rounding.ts` not found.

- [ ] **Step 3: Write minimal implementation**

In `src/dinero.ts`, re-export the rounding modes confirmed in Task 1 Step 6:

```ts
import { halfEven, halfUp } from "dinero.js";
export { halfEven, halfUp };
```

`packages/money/src/rounding.ts`:

```ts
import { halfEven, halfUp, transformScale } from "./dinero.ts";
import type { BigIntDinero } from "./dinero.ts";
import type { Money } from "./money.ts";

const MONEY_SCALE = 2;

// No global default rounding. The mode is chosen by the boundary's intent (spec §1.3).
// roundTax / roundInvoiceLine: half-up. roundLedger: banker's (half-even).

export function roundTax(value: BigIntDinero): Money {
  return transformScale(value, MONEY_SCALE, halfUp) as Money;
}

export function roundInvoiceLine(value: BigIntDinero): Money {
  return transformScale(value, MONEY_SCALE, halfUp) as Money;
}

export function roundLedger(value: BigIntDinero): Money {
  return transformScale(value, MONEY_SCALE, halfEven) as Money;
}
```

> Replace the placeholder second test (`roundInvoiceLine` line) with a real half-up boundary case once you confirm an input that lands exactly on .5 cents through `multiplyByQuantity`/`percentOf`. The tax and ledger cases are the load-bearing assertions.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @magna-carta/money exec vp test run`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/money/src/rounding.ts packages/money/src/dinero.ts packages/money/test/rounding.test.ts
git commit -m "feat(money): named boundary rounding helpers (half-up tax/line, half-even ledger)"
```

---

## Task 7: `allocate` — splits that sum exactly (`src/allocate.ts`)

**Files:**
- Create: `packages/money/src/allocate.ts`
- Modify: `packages/money/src/dinero.ts`
- Test: `packages/money/test/allocate.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/money/test/allocate.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { money, USD } from "../src/money.ts";
import { allocate } from "../src/allocate.ts";
import { toMinor } from "../src/format.ts";

describe("allocate (largest-remainder)", () => {
  it("splits with no penny drift: $10.03 by [50,50] -> 502 + 501", () => {
    const parts = allocate(money(1003n, USD), [50, 50]);
    expect(parts.map(toMinor)).toEqual([502n, 501n]);
    expect(parts.reduce((sum, p) => sum + toMinor(p), 0n)).toBe(1003n);
  });

  it("contingency split sums exactly to gross for arbitrary weights", () => {
    const gross = money(1_000_000n, USD); // $10,000.00
    const parts = allocate(gross, [333, 333, 333, 1]);
    expect(parts.reduce((sum, p) => sum + toMinor(p), 0n)).toBe(1_000_000n);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @magna-carta/money exec vp test run`
Expected: FAIL — `../src/allocate.ts` not found.

- [ ] **Step 3: Write minimal implementation**

In `src/dinero.ts`:

```ts
import { allocate as allocateDinero } from "dinero.js";
export { allocateDinero };
```

`packages/money/src/allocate.ts`:

```ts
import { allocateDinero } from "./dinero.ts";
import type { Money } from "./money.ts";

// Largest-remainder split: parts always sum exactly to the input (no penny drift). Spec §1.4.
// Weights are integer ratios (or { amount, scale } for fractional weights, per Dinero v2).
export function allocate(value: Money, weights: number[]): Money[] {
  return allocateDinero(value, weights) as Money[];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @magna-carta/money exec vp test run`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/money/src/allocate.ts packages/money/src/dinero.ts packages/money/test/allocate.test.ts
git commit -m "feat(money): allocate (largest-remainder, sums exactly to input)"
```

---

## Task 8: `format` for display (`src/format.ts`)

**Files:**
- Modify: `packages/money/src/format.ts`, `packages/money/src/dinero.ts`
- Test: `packages/money/test/format.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/money/test/format.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { money, USD } from "../src/money.ts";
import { format } from "../src/format.ts";

describe("format", () => {
  it("formats Money with explicit currency via Intl", () => {
    expect(format(money(45000n, USD))).toBe("$450.00");
  });

  it("formats negative amounts", () => {
    expect(format(money(-45000n, USD))).toBe("-$450.00");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @magna-carta/money exec vp test run`
Expected: FAIL — `format` not exported.

- [ ] **Step 3: Write minimal implementation**

In `src/dinero.ts`:

```ts
import { toDecimal } from "dinero.js";
export { toDecimal };
```

Add to `src/format.ts`:

```ts
import { snapshot, toDecimal } from "./dinero.ts";

export function format(value: Money): string {
  // toDecimal gives the exact decimal string; Intl applies the currency's locale formatting with an explicit currency.
  const code = snapshot(value).currency.code;
  const decimal = toDecimal(value);
  return new Intl.NumberFormat("en-US", { style: "currency", currency: code }).format(Number(decimal));
}
```

> `toDecimal(value)` returns a string. `Intl.NumberFormat` is locale-stable here ("en-US"); the firm-locale parameterization is a later slice — keep it explicit, not implicit.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @magna-carta/money exec vp test run`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/money/src/format.ts packages/money/src/dinero.ts packages/money/test/format.test.ts
git commit -m "feat(money): format via Intl with explicit currency"
```

---

## Task 9: Differential test vs `decimal.js` (`test/differential.test.ts`)

**Files:**
- Create: `packages/money/test/differential.test.ts`

- [ ] **Step 1: Write the test (this IS the deliverable — validates the Dinero wrapper, spec §6)**

`packages/money/test/differential.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import Decimal from "decimal.js";
import { add, money, subtract, USD } from "../src/money.ts";
import { allocate } from "../src/allocate.ts";
import { toMinor } from "../src/format.ts";

// Sample-based differential check: our Dinero-backed ops must match an independent decimal implementation.
const SAMPLES: Array<[bigint, bigint]> = [
  [45000n, 5000n],
  [1n, 999999n],
  [-250n, 250n],
  [123456789n, 987654321n],
];

describe("differential vs decimal.js", () => {
  it("add matches decimal.js (in minor units)", () => {
    for (const [a, b] of SAMPLES) {
      const ours = toMinor(add(money(a, USD), money(b, USD)));
      const reference = BigInt(new Decimal(a.toString()).plus(b.toString()).toFixed(0));
      expect(ours).toBe(reference);
    }
  });

  it("subtract matches decimal.js (in minor units)", () => {
    for (const [a, b] of SAMPLES) {
      const ours = toMinor(subtract(money(a, USD), money(b, USD)));
      const reference = BigInt(new Decimal(a.toString()).minus(b.toString()).toFixed(0));
      expect(ours).toBe(reference);
    }
  });

  it("allocate always sums to the input (property)", () => {
    for (const [a] of SAMPLES) {
      const gross = a < 0n ? -a : a;
      const parts = allocate(money(gross, USD), [1, 2, 3, 5]);
      expect(parts.reduce((sum, p) => sum + toMinor(p), 0n)).toBe(gross);
    }
  });
});
```

- [ ] **Step 2: Run the test**

Run: `pnpm --filter @magna-carta/money exec vp test run`
Expected: PASS (all differential and property assertions hold).

- [ ] **Step 3: Commit**

```bash
git add packages/money/test/differential.test.ts
git commit -m "test(money): differential vs decimal.js + allocate sum-to-input property"
```

---

## Task 10: Seam-boundary fitness function (`test/seam-boundary.test.ts`)

**Files:**
- Create: `packages/money/test/seam-boundary.test.ts`

- [ ] **Step 1: Write the failing test (enforces spec §1.5: Dinero imported only inside dinero.ts)**

`packages/money/test/seam-boundary.test.ts`:

```ts
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(import.meta.dirname, "..", "src");

describe("Dinero seam boundary (spec §1.5)", () => {
  it("only src/dinero.ts imports dinero.js / @dinero.js/*", async () => {
    const files = (await readdir(SRC)).filter((f) => f.endsWith(".ts"));
    const offenders: string[] = [];
    for (const file of files) {
      if (file === "dinero.ts") continue;
      const text = await readFile(join(SRC, file), "utf8");
      if (/from\s+["']@?dinero(\.js)?/.test(text)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it passes (or catches a real leak)**

Run: `pnpm --filter @magna-carta/money exec vp test run`
Expected: PASS — only `dinero.ts` imports the engine. If it FAILS, a module leaked the dependency; move that import behind `dinero.ts` before continuing.

- [ ] **Step 3: Run the full gate**

Run: `pnpm check && pnpm test`
Expected: PASS (fmt + lint incl. `oxc/no-barrel-file`, type-check, all money tests).

- [ ] **Step 4: Commit**

```bash
git add packages/money/test/seam-boundary.test.ts
git commit -m "test(money): fitness function — Dinero imported only inside the seam"
```

---

## Task 11: Decision record + docs (golden rules 5 & 8)

**Files:**
- Modify: `docs/Decision-Log.md` (new ADR-0071, package layout)
- Modify: `ROADMAP.md` (slice 0·2 progress)
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Add ADR-0071 — foundational primitives package layout**

In `docs/Decision-Log.md`, following the register's existing ADR format, add **ADR-0071: Foundational-data package layout (four packages on the structure-vs-access seam)**. Record: the four packages (`money`, `identifiers`, `database`, `data-access`), the rationale (pure leaves split cleanly; `database` vs `data-access` is an acyclic structure-vs-access seam; idempotency + outbox stay together in `data-access` because the shared D1 transaction makes separate packages circular), and the acyclic dependency graph. Status: Accepted. Link to the spec's §7. Match the surrounding ADR entries' exact heading/field structure.

- [ ] **Step 2: Update ROADMAP.md**

Under "Now", note slice 0·2 in progress with the `money` package shipped (first of four). Move nothing to "Recently shipped" yet — the slice completes when all four packages land. Add a one-line entry noting `@magna-carta/money` is complete.

- [ ] **Step 3: Update CHANGELOG.md**

Add an entry: `@magna-carta/money` — branded Money/Rate/Ratio over Dinero.js v2 bigint, named rounding helpers, allocate, format, behind a swappable seam; differential-tested vs decimal.js.

- [ ] **Step 4: Run the full gate one more time**

Run: `pnpm check && pnpm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add docs/Decision-Log.md ROADMAP.md CHANGELOG.md
git commit -m "docs(money): ADR-0071 package layout + roadmap/changelog for slice 0.2 money"
```

---

## Self-review notes (spec coverage)

- Spec §1.1 storage (minor / e4 scales): encoded in `money()` (scale 2) and `rate()` (scale 4); the D1 column convention is enforced later in `@magna-carta/database` (the schema-fitness-function lives with the schema, not here).
- §1.2 types & operations: Tasks 3–8 (`money`, `rate`, `ratio`, `add`, `subtract`, `multiplyByQuantity`, `percentOf`, `allocate`, `format`, `toMinor`, `fromMinor`).
- §1.3 rounding helpers: Task 6 (`roundTax`, `roundInvoiceLine`, `roundLedger`). Raw `round(mode)` with an explicit mode and the "flag raw round outside helpers" fitness function are deferred to the `data-access`/lint layer where call sites exist — noted, not silently dropped.
- §1.4 flows (contingency split, payment application, tax on cost): exercised by Tasks 6, 7, 9.
- §1.5 enforcement: Task 10 (Dinero seam) + `oxc/no-barrel-file` (gate) + the no-`REAL`-column / no-float checks that belong to the schema package.
- §6 money test plan (property `allocate` sums; add/subtract; round-trip; named-rounding tables; differential vs decimal.js): Tasks 3, 6, 7, 9.

**Deferred to later packages (not gaps):** the `REAL`-money-column and raw-`round` fitness functions (need schema / call sites — `database` and `data-access` slices); fixtures constructing money via `money`/`rate` (the fixtures harness is its own Phase 0 item).
