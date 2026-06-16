# Property external-links resolver — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the pure `@magna-carta/property-links` package — a provider registry that turns a property reference into the external "view this property on X" links available for it (Zillow + Redfin to start).

**Architecture:** A pure, dependency-free package (mirrors `@magna-carta/parcels`): a `formatAddress` helper, one `LinkProvider` per site (each `build(reference) → url | null`), and a registry that maps the providers and drops the `null`s via a total `resolvePropertyLinks(reference) → PropertyLink[]`. URL construction only — no network, no credentials, no UI.

**Tech Stack:** TypeScript (NodeNext, explicit `.ts` imports), Vitest via `vp test`, pnpm workspace. No runtime dependencies. Follows `@magna-carta/parcels` conventions.

**Scope note:** This plan delivers the resolver + Zillow/Redfin providers + tests — a complete, self-contained, fully-tested deliverable. The UI buttons are deferred to the Locations UI (design system 0·7a → 0·7b → slice 1·1 UI); the additional providers (Maps/Realtor/Trulia, county-assessor via `parcels`), per-firm config, and the optional framework adapter are documented seams in the spec, not built here.

Spec: [`2026-06-16-property-links-design.md`](2026-06-16-property-links-design.md) · ADR-0093.

**Commit policy:** every commit message ends with `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`. Run the suite with `pnpm --filter @magna-carta/property-links test` (target one file with `vp test run <path>` from inside the package).

---

## File structure (new package `packages/property-links/`)

- `package.json`, `tsconfig.json`, `vitest.config.ts` — scaffold (mirrors `packages/parcels`).
- `src/types.ts` — `PropertyReference`, `PropertyLink`, `LinkProvider`.
- `src/format.ts` — `formatAddress(reference) → string | null`.
- `src/providers/zillow.ts` — `zillowProvider`.
- `src/providers/redfin.ts` — `redfinProvider`.
- `src/registry.ts` — the provider array + `resolvePropertyLinks(reference)`.
- `src/CLAUDE.md` — local notes (Task 5).
- `test/*.test.ts` — one suite per module.

---

### Task 1: Scaffold the package + `formatAddress`

**Files:**
- Create: `packages/property-links/package.json`, `tsconfig.json`, `vitest.config.ts`
- Create: `packages/property-links/src/types.ts`
- Create: `packages/property-links/src/format.ts`
- Test: `packages/property-links/test/format.test.ts`

- [ ] **Step 1: Create the scaffold files**

`packages/property-links/package.json`:
```json
{
  "name": "@magna-carta/property-links",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "sideEffects": false,
  "exports": {
    "./types": "./src/types.ts",
    "./format": "./src/format.ts",
    "./registry": "./src/registry.ts",
    "./providers/zillow": "./src/providers/zillow.ts",
    "./providers/redfin": "./src/providers/redfin.ts"
  },
  "scripts": {
    "test": "vp test run"
  },
  "devDependencies": {
    "@magna-carta/tsconfig": "workspace:*",
    "@types/node": "catalog:",
    "vitest": "catalog:"
  }
}
```

`packages/property-links/tsconfig.json`:
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

`packages/property-links/vitest.config.ts`:
```ts
import { defineConfig } from "vite-plus";

// Pure package: the default node pool, no Cloudflare Workers runtime.
// root is pinned to this package so the repo-root `vp test` resolves this project's tests from here.
export default defineConfig({
  root: import.meta.dirname,
});
```

- [ ] **Step 2: Create the type home**

`packages/property-links/src/types.ts`:
```ts
// What the caller knows about a property. Field names match the codebase AddressInput
// (street/city/region/postal) so a Location maps in directly. `apn`/`jurisdictionId` are unused by
// Zillow/Redfin — reserved for the future county-assessor provider (wraps @magna-carta/parcels).
export interface PropertyReference {
  readonly street?: string;
  readonly city?: string;
  readonly region?: string;
  readonly postal?: string;
  readonly formattedAddress?: string;
  readonly apn?: string;
  readonly jurisdictionId?: string;
}

// One ready-to-use external link for a property.
export interface PropertyLink {
  readonly providerId: string;
  readonly label: string;
  readonly url: string;
}

// An external-link provider for one site. `build` returns null when it lacks the information it
// needs, so the registry can omit it.
export interface LinkProvider {
  readonly id: string;
  readonly label: string;
  build(reference: PropertyReference): string | null;
}
```

- [ ] **Step 3: Write the failing test**

`packages/property-links/test/format.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { formatAddress } from "../src/format.ts";

describe("formatAddress", () => {
  it("joins components into one line", () => {
    expect(
      formatAddress({ street: "123 Main St", city: "Reno", region: "NV", postal: "89501" }),
    ).toBe("123 Main St, Reno, NV 89501");
  });

  it("returns a caller-provided formattedAddress verbatim (trimmed)", () => {
    expect(formatAddress({ formattedAddress: "  500 Oak Ave, Las Vegas, NV 89101 " })).toBe(
      "500 Oak Ave, Las Vegas, NV 89101",
    );
  });

  it("returns null without a street, or with a street but no city and no postal", () => {
    expect(formatAddress({ city: "Reno", region: "NV" })).toBeNull();
    expect(formatAddress({ street: "123 Main St", region: "NV" })).toBeNull();
    expect(formatAddress({})).toBeNull();
  });

  it("builds from street + postal when city is absent", () => {
    expect(formatAddress({ street: "123 Main St", postal: "89501" })).toBe("123 Main St, 89501");
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `vp install && vp test run test/format.test.ts` (from `packages/property-links`)
Expected: install succeeds; test FAILS — `formatAddress` not found.

- [ ] **Step 5: Write the implementation**

`packages/property-links/src/format.ts`:
```ts
import type { PropertyReference } from "./types.ts";

// Joins the address components into one human-style line, or returns the caller's pre-formatted
// string when given. Returns null when there is too little to locate a property — a street plus at
// least one of city/postal — so a provider then declines to build a link (the total-function rule).
export function formatAddress(reference: PropertyReference): string | null {
  const explicit = reference.formattedAddress?.trim();
  if (explicit) return explicit;

  const street = reference.street?.trim();
  const city = reference.city?.trim();
  const region = reference.region?.trim();
  const postal = reference.postal?.trim();
  if (!street || (!city && !postal)) return null;

  const regionPostal = [region, postal].filter(Boolean).join(" ");
  return [street, city, regionPostal].filter(Boolean).join(", ");
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `vp test run test/format.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 7: Commit**

```bash
git add packages/property-links pnpm-lock.yaml
git commit -m "$(cat <<'EOF'
feat(property-links): scaffold the package + formatAddress

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Zillow provider

**Files:**
- Create: `packages/property-links/src/providers/zillow.ts`
- Test: `packages/property-links/test/zillow.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/property-links/test/zillow.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { zillowProvider } from "../src/providers/zillow.ts";

describe("zillowProvider", () => {
  it("builds the _rb homes slug (spaces to hyphens, commas dropped)", () => {
    expect(
      zillowProvider.build({ street: "123 Main St", city: "Reno", region: "NV", postal: "89501" }),
    ).toBe("https://www.zillow.com/homes/123-Main-St-Reno-NV-89501_rb/");
  });

  it("declares its id and label", () => {
    expect(zillowProvider.id).toBe("zillow");
    expect(zillowProvider.label).toBe("Zillow");
  });

  it("returns null when the reference is insufficient", () => {
    expect(zillowProvider.build({ city: "Reno" })).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `vp test run test/zillow.test.ts`
Expected: FAIL — `../src/providers/zillow.ts` not found.

- [ ] **Step 3: Write the implementation**

`packages/property-links/src/providers/zillow.ts`:
```ts
import { formatAddress } from "../format.ts";
import type { LinkProvider } from "../types.ts";

// https://www.zillow.com/homes/{slug}_rb/ — the slug is the address with commas removed and runs of
// whitespace collapsed to single hyphens; Zillow geocodes it and usually redirects to the property
// page. encodeURIComponent guards any remaining path-unsafe characters (hyphens are left intact).
export const zillowProvider: LinkProvider = {
  id: "zillow",
  label: "Zillow",
  build(reference) {
    const address = formatAddress(reference);
    if (address === null) return null;
    const slug = encodeURIComponent(address.replace(/,/g, "").trim().replace(/\s+/g, "-"));
    return `https://www.zillow.com/homes/${slug}_rb/`;
  },
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `vp test run test/zillow.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/property-links/src/providers/zillow.ts packages/property-links/test/zillow.test.ts
git commit -m "$(cat <<'EOF'
feat(property-links): Zillow address deep-link provider

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Redfin provider

**Files:**
- Create: `packages/property-links/src/providers/redfin.ts`
- Test: `packages/property-links/test/redfin.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/property-links/test/redfin.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { redfinProvider } from "../src/providers/redfin.ts";

describe("redfinProvider", () => {
  it("builds the ?location search URL (percent-encoded address)", () => {
    expect(
      redfinProvider.build({ street: "123 Main St", city: "Reno", region: "NV", postal: "89501" }),
    ).toBe("https://www.redfin.com/?location=123%20Main%20St%2C%20Reno%2C%20NV%2089501");
  });

  it("declares its id and label", () => {
    expect(redfinProvider.id).toBe("redfin");
    expect(redfinProvider.label).toBe("Redfin");
  });

  it("returns null when the reference is insufficient", () => {
    expect(redfinProvider.build({ region: "NV" })).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `vp test run test/redfin.test.ts`
Expected: FAIL — `../src/providers/redfin.ts` not found.

- [ ] **Step 3: Write the implementation**

`packages/property-links/src/providers/redfin.ts`:
```ts
import { formatAddress } from "../format.ts";
import type { LinkProvider } from "../types.ts";

// https://www.redfin.com/?location={encoded address} — lands on the search/map result, auto-
// navigating to the listing on a single exact match (Redfin needs an internal property id we do
// not have for a guaranteed detail URL).
export const redfinProvider: LinkProvider = {
  id: "redfin",
  label: "Redfin",
  build(reference) {
    const address = formatAddress(reference);
    if (address === null) return null;
    return `https://www.redfin.com/?location=${encodeURIComponent(address)}`;
  },
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `vp test run test/redfin.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/property-links/src/providers/redfin.ts packages/property-links/test/redfin.test.ts
git commit -m "$(cat <<'EOF'
feat(property-links): Redfin address search-link provider

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: The registry and `resolvePropertyLinks`

**Files:**
- Create: `packages/property-links/src/registry.ts`
- Test: `packages/property-links/test/registry.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/property-links/test/registry.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { resolvePropertyLinks } from "../src/registry.ts";

const fullAddress = { street: "123 Main St", city: "Reno", region: "NV", postal: "89501" };

describe("resolvePropertyLinks", () => {
  it("returns every provider's link for a sufficient reference", () => {
    expect(resolvePropertyLinks(fullAddress)).toEqual([
      {
        providerId: "zillow",
        label: "Zillow",
        url: "https://www.zillow.com/homes/123-Main-St-Reno-NV-89501_rb/",
      },
      {
        providerId: "redfin",
        label: "Redfin",
        url: "https://www.redfin.com/?location=123%20Main%20St%2C%20Reno%2C%20NV%2089501",
      },
    ]);
  });

  it("works from a pre-formatted address too", () => {
    const links = resolvePropertyLinks({ formattedAddress: "123 Main St, Reno, NV 89501" });
    expect(links.map((link) => link.providerId)).toEqual(["zillow", "redfin"]);
  });

  it("returns [] for an insufficient reference and never throws", () => {
    expect(resolvePropertyLinks({})).toEqual([]);
    expect(resolvePropertyLinks({ city: "Reno" })).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `vp test run test/registry.test.ts`
Expected: FAIL — `../src/registry.ts` not found.

- [ ] **Step 3: Write the implementation**

`packages/property-links/src/registry.ts`:
```ts
import { redfinProvider } from "./providers/redfin.ts";
import { zillowProvider } from "./providers/zillow.ts";
import type { LinkProvider, PropertyLink, PropertyReference } from "./types.ts";

// Every external-link provider composes into one ordered registry. Adding a provider (Google Maps,
// Realtor.com, a county-assessor link wrapping @magna-carta/parcels) is one import + one row here —
// nothing else changes.
const PROVIDERS: readonly LinkProvider[] = [zillowProvider, redfinProvider];

// The external lookups usable for what the caller knows about a property. Providers lacking the
// information they need are omitted. Total: never throws, never yields an empty or broken URL — a
// consumer can always render whatever comes back.
export function resolvePropertyLinks(reference: PropertyReference): PropertyLink[] {
  const links: PropertyLink[] = [];
  for (const provider of PROVIDERS) {
    const url = provider.build(reference);
    if (url !== null) {
      links.push({ providerId: provider.id, label: provider.label, url });
    }
  }
  return links;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @magna-carta/property-links test`
Expected: PASS (all suites; 13 tests total).

- [ ] **Step 5: Commit**

```bash
git add packages/property-links/src/registry.ts packages/property-links/test/registry.test.ts
git commit -m "$(cat <<'EOF'
feat(property-links): provider registry + resolvePropertyLinks

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Package notes, quality gate, and docs

**Files:**
- Create: `packages/property-links/CLAUDE.md`
- Modify: `CHANGELOG.md`, `STATUS.md`, `ROADMAP.md`

- [ ] **Step 1: Write the package CLAUDE.md**

`packages/property-links/CLAUDE.md`:
```markdown
# @magna-carta/property-links — local notes

Pure, dependency-free utility (mirrors `@magna-carta/parcels`): turns a `PropertyReference` into the
external "view this property on X" links available for it. URL construction only — no network, no
credentials, no `env`, no UI.

- A `LinkProvider` is `{ id, label, build(reference) → url | null }`; `build` returns `null` when it
  lacks the info it needs. Add a provider = one file in `src/providers/` + one row in `registry.ts`.
- `resolvePropertyLinks(reference)` maps the registry and drops the `null`s — total, never throws.
- Delivered as plain `https` links; the consuming UI adds `target="_blank" rel="noopener noreferrer"`
  (Universal/App Links open the native app when installed, else the website). No `zillow://` schemes.
- Honest limit: address-only links land best-effort (Zillow usually the property, Redfin the search
  result) — neither site exposes a guaranteed exact-listing URL without an internal id.

Seams (see `docs/specs/2026-06-16-property-links-design.md`, ADR-0093): Maps/Realtor/Trulia providers;
a county-assessor provider wrapping `@magna-carta/parcels` (`apn`/`jurisdictionId` reserved on the
reference); per-firm provider config; an optional credential-less framework adapter. Property *data*
(valuation/ownership) is a separate credentialed concern, not this package.
```

- [ ] **Step 2: Run the full quality gate**

Run (from repo root): `pnpm --filter @magna-carta/property-links test && pnpm check`
Expected: tests pass (13); `pnpm check` passes (fmt + lint + typecheck + svelte-check). If the formatter flags files, run `vp check --fix` and re-run `pnpm check`.

- [ ] **Step 3: Update the living docs**

In `CHANGELOG.md` under `[Unreleased]` → **Added**: "Property external-links resolver (`@magna-carta/property-links`) — one-click 'view this property on Zillow/Redfin' links from a property reference; pure registry-driven utility, extensible to more providers (ADR-0093)."

In `STATUS.md`, add a Cross-cutting row: `Property external-links | [-] | [x] Opus 4.8 | [x] Opus 4.8 | [x] Opus 4.8 | [-] | [ ]` with a note: built (Zillow + Redfin providers, 13 tests); UI buttons deferred to the Locations UI; Maps/Realtor/assessor providers + per-firm config are seams; spec `docs/specs/2026-06-16-property-links-design.md` (ADR-0093). Load profile `[-]`: pure resolver, no per-firm data.

In `ROADMAP.md` under the **Cross-cutting — phase-independent** section, add a bullet: the property external-links resolver — built 2026-06-16 (Zillow + Redfin), the external-links half of property lookups (distinct from the credentialed property-data ports); UI rides the Locations UI; provider/registry growth path per ADR-0093.

- [ ] **Step 4: Final verification and commit**

Run: `pnpm --filter @magna-carta/property-links test && pnpm check`
Expected: all green.

```bash
git add packages/property-links/CLAUDE.md CHANGELOG.md STATUS.md ROADMAP.md
git commit -m "$(cat <<'EOF'
docs(property-links): package notes, changelog, status/roadmap

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Self-review

**Spec coverage:**
- §1 module placement (package + the 6 files) → Tasks 1–4 + Task 5 (CLAUDE.md).
- §2 provider model (`LinkProvider`, registry, total `resolvePropertyLinks`) → Tasks 1 (types), 4.
- §3 `PropertyReference` aligned to AddressInput + `formatAddress` null-rule → Task 1.
- §4 Zillow/Redfin URL templates + encoding + honest limit → Tasks 2, 3 (limit noted in CLAUDE.md).
- §5 `PropertyLink` output → Task 1 (type) + Task 4 (produced).
- §6 UI surfacing → deferred (out of scope), noted in CLAUDE.md + STATUS.
- §7 testing (per-provider exact URLs, encoding, null, aggregation, total-function) → Tasks 1–4.
- §8 seams → documented in CLAUDE.md/ADR, no code (correct).
- §9 ADR + docs → ADR-0093 already recorded; Task 5 does CHANGELOG/STATUS/ROADMAP.

**Placeholder scan:** none — every code step is complete.

**Type consistency:** `PropertyReference`, `PropertyLink`, `LinkProvider`, `formatAddress`, `zillowProvider`, `redfinProvider`, `resolvePropertyLinks` are used identically across tasks. `build` returns `string | null` everywhere; `formatAddress` returns `string | null` everywhere; `resolvePropertyLinks` returns `PropertyLink[]`. Field names (`street`/`city`/`region`/`postal`/`formattedAddress`/`apn`/`jurisdictionId`) match the spec and the codebase `AddressInput`.
