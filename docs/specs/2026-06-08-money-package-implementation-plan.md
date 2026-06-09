# `@magna-carta/money` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `@magna-carta/money` — the first foundational-data package (slice 0·2, package 1 of 4): all monetary math behind a swappable seam over Dinero.js v2 (default number calculator).

**Architecture:** A pure, dependency-light workspace package with no Cloudflare runtime. Dinero.js is imported in exactly one internal file (`src/dinero.ts` — the seam); every other module uses our branded `Money`/`Rate`/`Ratio` types and the in-house operations. Named rounding helpers encode rounding intent at boundaries (no global default). The public surface is exposed through the `package.json` `exports` map (no barrel file — `oxc/no-barrel-file` is an error). Raw `.ts` is shipped (no build step), consumed via `moduleResolution: bundler`.

**Tech Stack:** TypeScript (strict), **Dinero.js v2 with the default number calculator** (`dinero.js` + `dinero.js/currencies`), Vitest (Vite+ `vp test`), `decimal.js` (independent differential-test oracle, and the basis of the documented arbitrary-precision escape hatch). Source of truth for the design: [`2026-06-04-foundational-data-conventions-design.md`](2026-06-04-foundational-data-conventions-design.md) §1 and §7.

**Naming:** Golden rule 12 — fully spelled out, no shorthand. `randomSource` not `rng`, etc.

---

## Money representation (decided — read before coding)

This package uses Dinero.js v2's **default number calculator**, not bigint. The decision, recorded as an amendment to ADR-0061 (Task 11), rests on two findings from an empirical evaluation on 2026-06-08:

1. **Bigint is unnecessary for this product.** `Number.MAX_SAFE_INTEGER` (2^53−1) is **$90.07 trillion** in cents (scale 2) and **~$900 billion** for a 4-dp rate. Legal-practice-management amounts never approach those ceilings. Below 2^53, JS-number integer arithmetic is **exact** (no float error) — which is all our `*_minor`/`*_rate_e4` integer model needs.
2. **Dinero's bigint build is broken at 2.0.2 anyway.** `multiply`, `transformScale` (all rounding), `allocate`, and `toDecimal` throw `Cannot mix BigInt and other types` inside dinero's own compiled core (its `multiplyFn` does `calculator.add(scale /* number */, multiplierScale /* bigint */)`). The **number calculator runs the entire surface correctly** (verified: multiply, half-up/half-even/down rounding, largest-remainder allocate, format).

**Consequences for every task:**

- Amounts are **JS safe-integer `number`s** (cents at scale 2, ten-thousandths at scale 4). Test literals are `45000`, **not** `45000n`. `toMinor` returns `number`; `fromMinor(minor: number, …)`.
- All Dinero imports come from **`dinero.js`** (operations) and **`dinero.js/currencies`** (currencies) — never the `/bigint` subpaths.
- `money()` / `rate()` **guard `Number.isSafeInteger`** and throw on overflow — failing loud at the boundary documents the 2^53 limit precisely.
- **Escape hatch (documented, not built):** if amounts ever needed to exceed 2^53, swap the seam (`src/dinero.ts`) to a `decimal.js`-backed custom calculator via `createDinero({ calculator })`. This was verified working end-to-end (incl. $50T × 3) on 2026-06-08 and is a one-file change behind the seam. YAGNI today.

---

## File structure

```
packages/money/
  package.json          # @magna-carta/money; exports map is the public surface
  tsconfig.json         # extends @magna-carta/tsconfig/base; pure (no DOM, noEmit)
  vitest.config.ts      # minimal; root-pinned so `vp test` discovers it
  src/
    dinero.ts           # THE ONLY file importing dinero.js — number-calculator factory + snapshot + op re-exports
    money.ts            # Money/Rate/Ratio branded types + constructors + arithmetic (public)
    rounding.ts         # roundTax / roundInvoiceLine / roundLedger (public)
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
- Modify: `pnpm-workspace.yaml` (catalog only)
- Modify: `vite.config.ts` (test.projects)

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
    "dinero.js": "catalog:"
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

- [ ] **Step 5: Install and pin exact versions into the catalog**

Run:

```bash
pnpm --filter @magna-carta/money add dinero.js
pnpm --filter @magna-carta/money add -D decimal.js
```

Then pin the resolved versions as **exact** entries (no `^`/`~`) in `pnpm-workspace.yaml` under `catalog:`, and keep the `package.json` entries as `catalog:`. Add a `# Money (packages/money)` group:

```yaml
# Money (packages/money). Dinero.js default NUMBER calculator (not bigint — see the plan's
# "Money representation" note and ADR-0061 amendment). decimal.js backs the differential test.
"dinero.js": <resolved version, e.g. 2.0.2>
decimal.js: <resolved version, e.g. 10.6.0>
```

Confirm exact versions:

```bash
node -e "for (const p of ['dinero.js','decimal.js']) console.log(p, require(p+'/package.json').version)"
```

- [ ] **Step 6: Confirm the number-calculator imports resolve**

The number calculator and its currencies are the documented default. Confirm the import paths the later tasks use actually resolve in the installed build:

```bash
node --input-type=module -e "import { dinero, add, subtract, multiply, allocate, transformScale, toSnapshot, toDecimal, halfUp, halfEven, down } from 'dinero.js'; import { USD, EUR } from 'dinero.js/currencies'; const d = dinero({ amount: 45000, currency: USD, scale: 2 }); console.log('snapshot', JSON.stringify(toSnapshot(d))); console.log('ops ok', [add,subtract,multiply,allocate,transformScale,toDecimal,halfUp,halfEven,down].every(f => typeof f === 'function'), 'EUR', EUR.code);"
```

Expected: prints a snapshot with `"amount":45000,"scale":2`, `ops ok true`, `EUR EUR`. If any import does not resolve, stop and report — do not improvise paths.

- [ ] **Step 7: Verify the empty package type-checks and is discovered**

Run:

```bash
pnpm install
pnpm check
```

Expected: PASS (no source files yet; the package resolves, the catalog is consistent). `pnpm check` runs the full repo gate; if it fails for a pre-existing reason unrelated to this change, report it rather than fixing unrelated failures.

- [ ] **Step 8: Commit**

```bash
git add packages/money pnpm-workspace.yaml pnpm-lock.yaml vite.config.ts
git commit -m "chore(money): scaffold @magna-carta/money package + pin dinero/decimal in catalog"
```

---

## Task 2: The Dinero seam (`src/dinero.ts`)

**Files:**

- Create: `packages/money/src/dinero.ts`
- Test: `packages/money/test/dinero.test.ts`

The seam is the **only** file that imports `dinero.js`. It re-exports the number-calculator factory, the snapshot reader, the operations, the rounding modes, and the currencies the rest of the package needs — so every other module depends on `./dinero.ts`, never on `dinero.js`. This is what makes the engine swappable (e.g. to the documented decimal.js custom calculator) without touching consumers.

- [ ] **Step 1: Write the failing test**

`packages/money/test/dinero.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { USD, makeMoneyDinero, snapshot } from "../src/dinero.ts";

describe("dinero seam (number calculator)", () => {
  it("creates a dinero at an explicit scale and reads its snapshot", () => {
    const d = makeMoneyDinero(45000, USD, 2);
    const s = snapshot(d);
    expect(s.amount).toBe(45000);
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
// Everything else uses the branded Money/Rate/Ratio types and the in-house operations re-exported here.
// We use Dinero's default NUMBER calculator: amounts are JS safe-integer numbers (exact below 2^53 =
// $90T at cents). If amounts ever needed to exceed 2^53, swap to a decimal.js custom calculator via
// createDinero({ calculator }) — a one-file change here (verified working on 2026-06-08). See ADR-0061.
import {
  add as addDinero,
  allocate as allocateDinero,
  dinero,
  down,
  halfEven,
  halfUp,
  multiply as multiplyDinero,
  subtract as subtractDinero,
  toDecimal,
  toSnapshot,
  transformScale,
  type Dinero,
} from "dinero.js";
import { EUR, USD } from "dinero.js/currencies";

export {
  addDinero,
  allocateDinero,
  down,
  EUR,
  halfEven,
  halfUp,
  multiplyDinero,
  subtractDinero,
  toDecimal,
  transformScale,
  USD,
};

export type NumberDinero = Dinero<number>;
export type NumberCurrency = typeof USD;

export function makeMoneyDinero(
  amount: number,
  currency: NumberCurrency,
  scale: number,
): NumberDinero {
  return dinero({ amount, currency, scale });
}

export function snapshot(value: NumberDinero): {
  amount: number;
  scale: number;
  currency: NumberCurrency;
} {
  return toSnapshot(value);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @magna-carta/money exec vp test run`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/money/src/dinero.ts packages/money/test/dinero.test.ts
git commit -m "feat(money): dinero seam (number calculator; only file importing dinero.js)"
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
    const m: Money = money(45000, USD); // $450.00
    expect(toMinor(m)).toBe(45000);
    expect(toMinor(fromMinor(45000, USD))).toBe(45000);
  });

  it("builds Rate at 4dp", () => {
    const r = rate(4500000, USD); // $450.0000
    expect(r).toBeDefined();
  });

  it("rejects a non-safe-integer minor amount (fails loud at the 2^53 boundary)", () => {
    expect(() => money(Number.MAX_SAFE_INTEGER + 2, USD)).toThrow();
    expect(() => money(1.5, USD)).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @magna-carta/money exec vp test run`
Expected: FAIL — `../src/money.ts` not found.

- [ ] **Step 3: Write minimal implementation**

`packages/money/src/money.ts`:

```ts
import { makeMoneyDinero, USD, type NumberCurrency, type NumberDinero } from "./dinero.ts";

export { USD };
export type { NumberCurrency };

// Branded, immutable. Backed by Dinero<number> (default calculator): Money @ scale 2, Rate @ scale 4.
// Amounts are JS safe integers (exact below 2^53). Brands are compile-time only (erased at runtime).
declare const moneyBrand: unique symbol;
declare const rateBrand: unique symbol;
declare const ratioBrand: unique symbol;

export type Money = NumberDinero & { readonly [moneyBrand]: "Money" };
export type Rate = NumberDinero & { readonly [rateBrand]: "Rate" };
// Ratio is dimensionless (no currency) — a scaled amount, e.g. { amount: 8375, scale: 5 } === 0.08375.
// It is NOT a Dinero (Dinero requires a currency); it is the multiplier shape Dinero's multiply() accepts.
export type Ratio = {
  readonly amount: number;
  readonly scale: number;
  readonly [ratioBrand]: "Ratio";
};

const MONEY_SCALE = 2;
const RATE_SCALE = 4;

function assertSafeInteger(value: number): void {
  // Fail loud at the boundary: the number calculator is exact only for safe integers (< 2^53).
  // If this ever fires in practice, the engine must move to the decimal.js custom calculator (ADR-0061).
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`money amount must be a safe integer, received ${value}`);
  }
}

export function money(minor: number, currency: NumberCurrency): Money {
  assertSafeInteger(minor);
  return makeMoneyDinero(minor, currency, MONEY_SCALE) as Money;
}

export function rate(e4: number, currency: NumberCurrency): Rate {
  assertSafeInteger(e4);
  return makeMoneyDinero(e4, currency, RATE_SCALE) as Rate;
}
```

`packages/money/src/format.ts`:

```ts
import { snapshot } from "./dinero.ts";
import { money, type NumberCurrency, type Money } from "./money.ts";

// DB boundary: Money <-> minor units (cents). Money is always scale 2, so the snapshot amount IS minor units.
export function toMinor(value: Money): number {
  return snapshot(value).amount;
}

export function fromMinor(minor: number, currency: NumberCurrency): Money {
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
    expect(toMinor(add(money(45000, USD), money(5000, USD)))).toBe(50000);
    expect(toMinor(subtract(money(45000, USD), money(5000, USD)))).toBe(40000);
  });

  it("throws when currencies are mixed", () => {
    expect(() => add(money(100, USD), money(100, EUR))).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @magna-carta/money exec vp test run`
Expected: FAIL — `add`, `subtract`, `EUR` not exported from `../src/money.ts`.

- [ ] **Step 3: Write minimal implementation**

In `src/money.ts`, add (EUR and the operations come from the seam, which already re-exports them):

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

## Task 5: Rate x quantity, percent-of, and the Money transform (`src/money.ts`)

**Files:**

- Modify: `packages/money/src/money.ts`
- Test: `packages/money/test/money.test.ts`

- [ ] **Step 1: Write the failing test (append)**

```ts
import { multiplyByQuantity, percentOf, ratio, transformToMoney } from "../src/money.ts";

describe("rate x quantity and percent", () => {
  it("multiplies a Rate by a fractional quantity and transforms to Money (2dp)", () => {
    // $450.0000/hr x 2.5 hr = $1125.00
    const line = transformToMoney(multiplyByQuantity(rate(4500000, USD), 2.5));
    expect(toMinor(line)).toBe(112500);
  });

  it("takes a percent of a Money via a Ratio, keeping a high-precision intermediate", () => {
    // 8.375% of $100.00; intermediate kept at higher precision until rounded (Task 6 rounds it).
    const intermediate = percentOf(money(10000, USD), ratio(8375, 5)); // 0.08375
    expect(transformToMoney(intermediate)).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @magna-carta/money exec vp test run`
Expected: FAIL — `multiplyByQuantity`, `percentOf`, `ratio`, `transformToMoney` not defined.

- [ ] **Step 3: Write minimal implementation**

In `src/money.ts`, add:

```ts
import { down, multiplyDinero, transformScale, type NumberDinero } from "./dinero.ts";

// MONEY_SCALE (= 2) is already declared in this module (Task 3). Reuse it — do NOT redeclare.

// Dimensionless ratio: a scaled amount (e.g. ratio(8375, 5) === 0.08375). Not a Dinero.
export function ratio(amount: number, scale: number): Ratio {
  return { amount, scale } as Ratio;
}

// Rate x quantity -> high-precision intermediate (NOT yet rounded to Money). Quantity may be fractional.
export function multiplyByQuantity(value: Rate | Money, quantity: number): NumberDinero {
  // Represent quantity as a scaled multiplier to stay in integer math (e.g. 2.5 -> { amount: 25, scale: 1 }).
  return multiplyDinero(value, decimalToScaled(quantity));
}

export function percentOf(value: Money, percent: Ratio): NumberDinero {
  return multiplyDinero(value, { amount: percent.amount, scale: percent.scale });
}

// Collapse an intermediate to Money (scale 2). Rounds DOWN here; the NAMED boundary helpers
// (rounding.ts) are the real rounding API used at money boundaries.
export function transformToMoney(value: NumberDinero): Money {
  return transformScale(value, MONEY_SCALE, down) as Money;
}

// Turn a JS number like 2.5 into { amount: 25, scale: 1 } without float drift on typical inputs.
function decimalToScaled(n: number): { amount: number; scale: number } {
  const text = n.toString();
  const dot = text.indexOf(".");
  if (dot === -1) return { amount: Number(text), scale: 0 };
  const scale = text.length - dot - 1;
  return { amount: Number(text.replace(".", "")), scale };
}
```

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
- Test: `packages/money/test/rounding.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/money/test/rounding.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { money, percentOf, ratio, USD } from "../src/money.ts";
import { roundLedger, roundTax } from "../src/rounding.ts";
import { toMinor } from "../src/format.ts";

describe("named rounding helpers", () => {
  it("roundTax is half-up: $100.00 * 0.08375 = $8.375 -> 838 cents", () => {
    const tax = roundTax(percentOf(money(10000, USD), ratio(8375, 5)));
    expect(toMinor(tax)).toBe(838);
  });

  it("roundLedger is banker's (half-even): 2.5c -> 2, 3.5c -> 4", () => {
    const half5 = percentOf(money(100, USD), ratio(25, 3)); // $1.00 * 0.025 = 2.5 cents
    const half7 = percentOf(money(100, USD), ratio(35, 3)); // 3.5 cents
    expect(toMinor(roundLedger(half5))).toBe(2);
    expect(toMinor(roundLedger(half7))).toBe(4);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @magna-carta/money exec vp test run`
Expected: FAIL — `../src/rounding.ts` not found.

- [ ] **Step 3: Write minimal implementation**

`packages/money/src/rounding.ts`:

```ts
import { halfEven, halfUp, transformScale, type NumberDinero } from "./dinero.ts";
import type { Money } from "./money.ts";

const MONEY_SCALE = 2;

// No global default rounding. The mode is chosen by the boundary's intent (spec §1.3).
// roundTax / roundInvoiceLine: half-up. roundLedger: banker's (half-even).

export function roundTax(value: NumberDinero): Money {
  return transformScale(value, MONEY_SCALE, halfUp) as Money;
}

export function roundInvoiceLine(value: NumberDinero): Money {
  return transformScale(value, MONEY_SCALE, halfUp) as Money;
}

export function roundLedger(value: NumberDinero): Money {
  return transformScale(value, MONEY_SCALE, halfEven) as Money;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @magna-carta/money exec vp test run`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/money/src/rounding.ts packages/money/test/rounding.test.ts
git commit -m "feat(money): named boundary rounding helpers (half-up tax/line, half-even ledger)"
```

---

## Task 7: `allocate` — splits that sum exactly (`src/allocate.ts`)

**Files:**

- Create: `packages/money/src/allocate.ts`
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
    const parts = allocate(money(1003, USD), [50, 50]);
    expect(parts.map(toMinor)).toEqual([502, 501]);
    expect(parts.reduce((sum, p) => sum + toMinor(p), 0)).toBe(1003);
  });

  it("contingency split sums exactly to gross for arbitrary weights", () => {
    const gross = money(1_000_000, USD); // $10,000.00
    const parts = allocate(gross, [333, 333, 333, 1]);
    expect(parts.reduce((sum, p) => sum + toMinor(p), 0)).toBe(1_000_000);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @magna-carta/money exec vp test run`
Expected: FAIL — `../src/allocate.ts` not found.

- [ ] **Step 3: Write minimal implementation**

`packages/money/src/allocate.ts`:

```ts
import { allocateDinero } from "./dinero.ts";
import type { Money } from "./money.ts";

// Largest-remainder split: parts always sum exactly to the input (no penny drift). Spec §1.4.
// Weights are integer ratios (Dinero distributes any remainder as evenly as possible).
export function allocate(value: Money, weights: number[]): Money[] {
  return allocateDinero(value, weights) as Money[];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @magna-carta/money exec vp test run`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/money/src/allocate.ts packages/money/test/allocate.test.ts
git commit -m "feat(money): allocate (largest-remainder, sums exactly to input)"
```

---

## Task 8: `format` for display (`src/format.ts`)

**Files:**

- Modify: `packages/money/src/format.ts`
- Test: `packages/money/test/format.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/money/test/format.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { money, USD } from "../src/money.ts";
import { format } from "../src/format.ts";

describe("format", () => {
  it("formats Money with explicit currency via Intl", () => {
    expect(format(money(45000, USD))).toBe("$450.00");
  });

  it("formats negative amounts", () => {
    expect(format(money(-45000, USD))).toBe("-$450.00");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @magna-carta/money exec vp test run`
Expected: FAIL — `format` not exported.

- [ ] **Step 3: Write minimal implementation**

Add to `src/format.ts`:

```ts
import { snapshot, toDecimal } from "./dinero.ts";

export function format(value: Money): string {
  // toDecimal gives the exact decimal string; Intl applies locale currency formatting with an explicit currency.
  const code = snapshot(value).currency.code;
  const decimal = toDecimal(value);
  return new Intl.NumberFormat("en-US", { style: "currency", currency: code }).format(
    Number(decimal),
  );
}
```

> `toDecimal(value)` returns a string. `Intl.NumberFormat` is locale-stable here ("en-US"); the firm-locale parameterization is a later slice — keep it explicit, not implicit. (`Number(decimal)` is display-only — never used for math.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @magna-carta/money exec vp test run`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/money/src/format.ts packages/money/test/format.test.ts
git commit -m "feat(money): format via Intl with explicit currency"
```

---

## Task 9: Differential test vs `decimal.js` (`test/differential.test.ts`)

**Files:**

- Create: `packages/money/test/differential.test.ts`

- [ ] **Step 1: Write the test (validates the Dinero wrapper against an independent oracle, spec §6)**

`packages/money/test/differential.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import Decimal from "decimal.js";
import { add, money, subtract, USD } from "../src/money.ts";
import { allocate } from "../src/allocate.ts";
import { toMinor } from "../src/format.ts";

// Sample-based differential check: our Dinero-backed ops must match an independent decimal implementation.
// All samples stay well below 2^53 (the number calculator's exact range — the money model's documented bound).
const SAMPLES: Array<[number, number]> = [
  [45000, 5000],
  [1, 999999],
  [-250, 250],
  [123456789, 987654321],
];

describe("differential vs decimal.js", () => {
  it("add matches decimal.js (in minor units)", () => {
    for (const [a, b] of SAMPLES) {
      const ours = toMinor(add(money(a, USD), money(b, USD)));
      const reference = new Decimal(a).plus(b).toNumber();
      expect(ours).toBe(reference);
    }
  });

  it("subtract matches decimal.js (in minor units)", () => {
    for (const [a, b] of SAMPLES) {
      const ours = toMinor(subtract(money(a, USD), money(b, USD)));
      const reference = new Decimal(a).minus(b).toNumber();
      expect(ours).toBe(reference);
    }
  });

  it("allocate always sums to the input (property)", () => {
    for (const [a] of SAMPLES) {
      const gross = Math.abs(a);
      const parts = allocate(money(gross, USD), [1, 2, 3, 5]);
      expect(parts.reduce((sum, p) => sum + toMinor(p), 0)).toBe(gross);
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

- [ ] **Step 1: Write the test (enforces spec §1.5: Dinero imported only inside dinero.ts)**

`packages/money/test/seam-boundary.test.ts`:

```ts
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(import.meta.dirname, "..", "src");

describe("Dinero seam boundary (spec §1.5)", () => {
  it("only src/dinero.ts imports dinero.js", async () => {
    const files = (await readdir(SRC)).filter((f) => f.endsWith(".ts"));
    const offenders: string[] = [];
    for (const file of files) {
      if (file === "dinero.ts") continue;
      const text = await readFile(join(SRC, file), "utf8");
      if (/from\s+["']dinero(\.js)?/.test(text)) offenders.push(file);
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

## Task 11: Decision records + docs (golden rules 5 & 8)

**Files:**

- Modify: `docs/Decision-Log.md` (amend ADR-0061; add ADR-0071)
- Modify: `docs/specs/2026-06-04-foundational-data-conventions-design.md` (§1.2 representation note)
- Modify: `ROADMAP.md` (slice 0·2 progress)
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Amend ADR-0061 (money representation)**

In `docs/Decision-Log.md`, add a dated amendment to **ADR-0061**: the money module is backed by **Dinero.js v2's default number calculator** (JS safe-integer amounts), **not `Dinero<bigint>`**. Rationale: (a) amounts never approach 2^53 ($90T cents / $900B at 4-dp rate) in legal practice management, so number arithmetic is exact for our range; (b) dinero 2.0.2's bigint build is broken for `multiply`/`transformScale`/`allocate`/`toDecimal` (mixes number+bigint internally). The branded-seam discipline is unchanged. The documented arbitrary-precision escape hatch (decimal.js custom calculator via `createDinero`) is a one-file seam swap if amounts ever exceed 2^53. Keep the original decision text; append the amendment with today's date.

- [ ] **Step 2: Add ADR-0071 — foundational primitives package layout**

In `docs/Decision-Log.md`, add **ADR-0071: Foundational-data package layout (four packages on the structure-vs-access seam)** — the four packages (`money`, `identifiers`, `database`, `data-access`), the rationale (pure leaves split cleanly; `database` vs `data-access` is an acyclic structure-vs-access seam; idempotency + outbox stay together in `data-access` because the shared D1 transaction makes separate packages circular), and the acyclic dependency graph. Status: Accepted. Link to the spec's §7. Match the surrounding ADR entries' heading/field structure.

- [ ] **Step 3: Amend spec §1.2 representation note**

In `docs/specs/2026-06-04-foundational-data-conventions-design.md` §1.2, add a short amendment noting the in-memory representation is `Dinero<number>` (default calculator, safe-integer amounts), not `Dinero<bigint>` — storage (`*_minor`/`*_rate_e4` INTEGER) is unchanged. Reference the ADR-0061 amendment. One or two sentences; do not restate the rationale.

- [ ] **Step 4: Update ROADMAP.md**

Under "Now", note slice 0·2 in progress with the `money` package complete (first of four). Add a one-line entry; do not move the slice to "Recently shipped" until all four packages land.

- [ ] **Step 5: Update CHANGELOG.md**

Add an entry: `@magna-carta/money` — branded Money/Rate/Ratio over Dinero.js v2 (number calculator), named rounding helpers, allocate, format, behind a swappable seam; differential-tested vs decimal.js.

- [ ] **Step 6: Run the full gate one more time**

Run: `pnpm check && pnpm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add docs/Decision-Log.md docs/specs/2026-06-04-foundational-data-conventions-design.md ROADMAP.md CHANGELOG.md
git commit -m "docs(money): amend ADR-0061 (number calculator) + ADR-0071 layout + roadmap/changelog"
```

---

## Self-review notes (spec coverage)

- Spec §1.1 storage (minor / e4 scales): encoded in `money()` (scale 2) and `rate()` (scale 4); the D1 column convention is enforced later in `@magna-carta/database`. Amounts are JS safe integers, which map exactly to D1 `INTEGER` columns.
- §1.2 types & operations: Tasks 3–8. **Representation amended** from `Dinero<bigint>` to `Dinero<number>` (number calculator) — see Task 11 Step 1/3.
- §1.3 rounding helpers: Task 6 (`roundTax`, `roundInvoiceLine`, `roundLedger`). Raw `round(mode)` and the "flag raw round outside helpers" fitness function are deferred to the `data-access`/lint layer where call sites exist — noted, not silently dropped.
- §1.4 flows (contingency split, payment application, tax on cost): exercised by Tasks 6, 7, 9.
- §1.5 enforcement: Task 10 (Dinero seam) + `oxc/no-barrel-file` (gate). The no-`REAL`-column / no-float-on-money checks belong to the schema package (`database`).
- §6 money test plan (property `allocate` sums; add/subtract; round-trip; named-rounding tables; differential vs decimal.js): Tasks 3, 6, 7, 9.

**Deferred to later packages (not gaps):** the `REAL`-money-column and raw-`round` fitness functions (need schema / call sites — `database` and `data-access` slices); fixtures constructing money via `money`/`rate` (the fixtures harness is its own Phase 0 item).
