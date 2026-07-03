# PII/erasure registry + coverage fitness — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the *attribution seam* for GDPR subject-level erasure — a declarative PII/erasure registry plus a coverage fitness function so no per-firm table holding personal data can escape subject attribution unregistered. The `eraseDataSubject` orchestrator that consumes the registry is designed but **not** built here.

**Architecture:** One pure-data manifest (`PII_TABLES`) sibling to `@magna-carta/database`'s `PROTECTED_COLUMNS`, listing every PII-bearing table, the column that resolves it to a data subject, and the erasure action. A Vitest fitness test introspects the Drizzle schema (the `getTableConfig` idiom already used by `protected-field-registry.test.ts`) and forces every table to be classified as either PII (registered) or explicitly non-PII. A drift tripwire keeps the registry's entity-axis rows a superset of the directory merge's `REPOINT_TARGETS` reference set.

**Tech Stack:** TypeScript (strict), Vitest, Drizzle ORM (`drizzle-orm/sqlite-core` `getTableConfig`), pnpm workspaces.

**Design:** `docs/specs/2026-07-02-data-subject-attribution-erasure-residency-design.md` (§1–§5).

## Global Constraints

- **No name shorthand** — spell names in full (`@magna-carta/data-access`, not "dal"). Repo golden rule.
- **No process-doc references in source** — code/tests must not cite `ADR-NNNN`, spec paths as "spec §N", or slice/phase numbers. State reasoning inline or cite a living standard by path (`docs/conventions/…`). Legal citations (`GDPR Art. 17(3)`) are fine. Enforced by `pnpm run lint:process-refs`.
- **Quality gate:** `pnpm check` (fmt + lint + `tsc -b`) and `pnpm --filter <pkg> test` must pass before each commit.
- **The registry is pure data** — no I/O, no `env`, no Drizzle imports in `pii-registry.ts` itself (types + literals only), so it stays trivially unit-testable and importable anywhere.
- **Deferred, do not build here:** the `eraseDataSubject` orchestrator, the `directory:eraseSubject` permission (its only consumer is the orchestrator), and any route/UI. This plan is the registry + its enforcement only.

---

### Task 1: The PII/erasure registry manifest

**Files:**
- Create: `packages/data-access/src/pii-registry.ts`
- Test: `packages/data-access/test/pii-registry.test.ts`

**Interfaces:**
- Produces: `PII_TABLES: readonly PiiTableEntry[]`; types `PiiTableEntry`, `ErasureAction`, `SubjectRef`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/data-access/test/pii-registry.test.ts
import { describe, expect, it } from "vitest";
import { PII_TABLES } from "../src/pii-registry.ts";

describe("PII/erasure registry", () => {
  it("declares at least the known directory PII tables", () => {
    const tables = new Set(PII_TABLES.map((entry) => entry.table));
    for (const table of ["directory_identifier", "directory_email", "directory_person"]) {
      expect(tables.has(table), `${table} must be registered`).toBe(true);
    }
  });

  it("every entry has a table, a subjectKey, and a valid action", () => {
    const actions = new Set([
      "hard-delete",
      "anonymize",
      "retain-under-matter",
      "pseudonymize-keep",
      "report-manual",
    ]);
    for (const entry of PII_TABLES) {
      expect(entry.table.length, "table is non-empty").toBeGreaterThan(0);
      expect(entry.subjectKey.length, "subjectKey is non-empty").toBeGreaterThan(0);
      expect(actions.has(entry.action), `${entry.table} has a valid action`).toBe(true);
    }
  });

  it("a retain-under-matter entry carries a note stating the basis", () => {
    for (const entry of PII_TABLES.filter((candidate) => entry_is_retain(candidate))) {
      expect(entry.note, `${entry.table} retain entry needs a note`).toBeTruthy();
    }
    function entry_is_retain(entry: (typeof PII_TABLES)[number]) {
      return entry.action === "retain-under-matter";
    }
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @magna-carta/data-access test pii-registry`
Expected: FAIL — `Cannot find module '../src/pii-registry.ts'`.

- [ ] **Step 3: Write the registry**

```ts
// packages/data-access/src/pii-registry.ts
import type { UserId } from "@magna-carta/identifiers";

// A GDPR data subject resolves to one of two existing anchors — a Directory entity
// (person/organization, the entity_id axis) or a firm member (the control-plane user_id axis).
// There is no dedicated data_subject table: the Directory IS the registry. This union is consumed
// by the deferred eraseDataSubject orchestrator; it is declared now so the attribution discipline
// exists before the personal-data schema hardens. Home of the reasoning: docs/conventions/compliance.md.
export type SubjectRef =
  | { readonly kind: "entity"; readonly entityId: string } // a directoryPerson_/directoryOrganization_ handle
  | { readonly kind: "user"; readonly userId: UserId };

// What the (deferred) erasure orchestrator does to a table's rows for one subject.
export type ErasureAction =
  | "hard-delete" // remove the subject's rows outright
  | "anonymize" // scrub the PII columns, keep the row (referential integrity / tombstone)
  | "retain-under-matter" // kept: data retained for legal obligations / claims (GDPR Art. 17(3))
  | "pseudonymize-keep" // append-only rows: replace the subject reference, never delete
  | "report-manual"; // free-text / document content — surfaced in the residue report, not auto-erased

// One entry per per-firm (or control-plane) table that holds personal data. `subjectKey` is the
// column that resolves a row to its data subject ("self" = the node's own id). A table may appear
// more than once when it references a subject through more than one column (e.g. an edge's two
// endpoints) — mirroring the directory merge repoint set.
export interface PiiTableEntry {
  readonly table: string;
  readonly subjectKey: string;
  readonly action: ErasureAction;
  readonly note?: string; // e.g. the retention basis for a retain-under-matter row
}

// The PII/erasure registry — sibling to @magna-carta/database's PROTECTED_COLUMNS. Every table with
// a personal-data column appears here; a coverage fitness test forces that completeness. The deferred
// eraseDataSubject orchestrator traverses this list; the entity-axis rows are the same inbound
// references the Directory merge repoints (a drift tripwire keeps them a superset).
export const PII_TABLES: readonly PiiTableEntry[] = [
  // Directory contact & identifier PII — hard-deletable at the entity.
  { table: "directory_identifier", subjectKey: "entity_id", action: "hard-delete" },
  { table: "directory_name", subjectKey: "entity_id", action: "hard-delete" },
  { table: "directory_name_phonetic_code", subjectKey: "entity_id", action: "hard-delete" },
  { table: "directory_email", subjectKey: "entity_id", action: "hard-delete" },
  { table: "directory_phone", subjectKey: "entity_id", action: "hard-delete" },
  { table: "directory_address", subjectKey: "entity_id", action: "hard-delete" },
  { table: "directory_entity_category", subjectKey: "entity_id", action: "hard-delete" },
  // Edges reference a subject on both endpoints (mirrors the merge repoint set).
  { table: "directory_edge", subjectKey: "from_entity_id", action: "hard-delete" },
  { table: "directory_edge", subjectKey: "to_entity_id", action: "hard-delete" },
  // The node itself: anonymize to a tombstone, keep the id for matter-link / audit integrity.
  { table: "directory_person", subjectKey: "self", action: "anonymize" },
  { table: "directory_organization", subjectKey: "self", action: "anonymize" },
  // Matter-corpus references — retained under GDPR Art. 17(3); PII is scrubbed at the entity.
  {
    table: "matter_party",
    subjectKey: "entity_id",
    action: "retain-under-matter",
    note: "a party's role on a matter is itself a matter record",
  },
  { table: "custom_field_value", subjectKey: "value_reference_id", action: "anonymize" },
  { table: "custom_field_value", subjectKey: "target_row_id", action: "anonymize" },
  {
    table: "cost_entry",
    subjectKey: "vendor_id",
    action: "retain-under-matter",
    note: "vendor payee on a financial record",
  },
  { table: "file", subjectKey: "matter_id", action: "retain-under-matter", note: "matter corpus" },
  {
    table: "file_version",
    subjectKey: "matter_id",
    action: "retain-under-matter",
    note: "matter corpus",
  },
  // User-axis: firm members are data subjects of their own account/activity PII.
  {
    table: "time_entry",
    subjectKey: "timekeeper_user_id",
    action: "retain-under-matter",
    note: "billing record; the narrative free-text is handled by the residue report",
  },
  { table: "incident", subjectKey: "reported_by", action: "pseudonymize-keep" },
  { table: "ai_detection_usage", subjectKey: "requested_by", action: "pseudonymize-keep" },
  // Append-only tables: pseudonymize the subject reference, never delete the row.
  { table: "audit_log", subjectKey: "actor_user_id", action: "pseudonymize-keep" },
  { table: "entity_merge", subjectKey: "subordinate_id", action: "pseudonymize-keep" },
];
```

- [ ] **Step 4: Run tests to green**

Run: `pnpm --filter @magna-carta/data-access test pii-registry`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/data-access/src/pii-registry.ts packages/data-access/test/pii-registry.test.ts
git commit -m "feat(data-access): PII/erasure registry manifest"
```

---

### Task 2: The coverage fitness function

Forces every per-firm table to be **classified** — registered as PII or explicitly listed as non-PII — so a new personal-data table cannot slip in unattributed. Uses the schema-introspection idiom from `packages/data-access/test/protected-field-registry.test.ts`.

**Files:**
- Modify: `packages/data-access/src/pii-registry.ts` (add `NO_PII_TABLES`)
- Test: `packages/data-access/test/pii-registry-coverage.test.ts`

**Interfaces:**
- Consumes: `PII_TABLES` (Task 1), `PROTECTED_COLUMNS` from `@magna-carta/database/protected-columns`, `perFirmSchema` tables.
- Produces: `NO_PII_TABLES: readonly string[]`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/data-access/test/pii-registry-coverage.test.ts
import { getTableConfig, type SQLiteTable } from "drizzle-orm/sqlite-core";
import { describe, expect, it } from "vitest";
import { PROTECTED_COLUMNS } from "@magna-carta/database/protected-columns";
import * as perFirmSchema from "@magna-carta/database/per-firm-schema";
import { NO_PII_TABLES, PII_TABLES } from "../src/pii-registry.ts";

// Every physical per-firm table name, introspected from the Drizzle schema exports (the same idiom
// as protected-field-registry.test.ts).
const schemaTables = new Set<string>();
for (const exported of Object.values(perFirmSchema)) {
  if (typeof exported !== "object" || exported === null) continue;
  try {
    schemaTables.add(getTableConfig(exported as SQLiteTable).name);
  } catch {
    continue;
  }
}

const registered = new Set(PII_TABLES.map((entry) => entry.table));
const declaredNonPii = new Set(NO_PII_TABLES);

describe("PII registry coverage", () => {
  it("every per-firm table is classified as PII (registered) or explicitly non-PII", () => {
    const unclassified = [...schemaTables].filter(
      (table) => !registered.has(table) && !declaredNonPii.has(table),
    );
    expect(
      unclassified,
      `unclassified tables — add each to PII_TABLES or NO_PII_TABLES: ${unclassified.join(", ")}`,
    ).toEqual([]);
  });

  it("PII and non-PII classifications are disjoint", () => {
    for (const table of registered) {
      expect(declaredNonPii.has(table), `${table} is in both PII_TABLES and NO_PII_TABLES`).toBe(
        false,
      );
    }
  });

  it("every registered table actually exists in the schema (no stale entries)", () => {
    for (const table of [...registered, ...declaredNonPii]) {
      expect(schemaTables.has(table), `${table} is classified but not in the per-firm schema`).toBe(
        true,
      );
    }
  });

  it("every protected column's table is registered as PII", () => {
    for (const protectedColumn of PROTECTED_COLUMNS) {
      // firm_secret is control-plane, not per-firm; skip control-plane-only protected tables.
      if (!schemaTables.has(protectedColumn.table)) continue;
      expect(
        registered.has(protectedColumn.table),
        `protected table ${protectedColumn.table} must be in PII_TABLES`,
      ).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Add an empty `NO_PII_TABLES` and run the test**

Append to `packages/data-access/src/pii-registry.ts`:

```ts
// Per-firm tables that hold NO personal data — the explicit non-PII half of the coverage fitness.
// A table added to the schema is unclassified until it appears here or in PII_TABLES, so a new
// personal-data table cannot slip in unattributed. Fill from the coverage test's failure output.
export const NO_PII_TABLES: readonly string[] = [];
```

Run: `pnpm --filter @magna-carta/data-access test pii-registry-coverage`
Expected: FAIL — the first assertion lists every unregistered per-firm table (matter, folder, ledger tables, role, role_permission, custom_field, settings, migration bookkeeping, etc.).

- [ ] **Step 3: Classify the listed tables**

From the failure output, put every table that carries **no** personal data into `NO_PII_TABLES` (matters/ledger/roles/settings/scan/file-structure/bookkeeping tables). Any table the failure lists that *does* carry personal data belongs in `PII_TABLES` instead (Task 1 should already cover the current ones; add any missed). Example shape (fill from the actual output — do not guess table names):

```ts
export const NO_PII_TABLES: readonly string[] = [
  "matter",
  "matter_number_sequence",
  "folder",
  "role",
  "role_permission",
  "custom_field",
  // …every remaining non-PII per-firm table from the coverage failure output…
];
```

- [ ] **Step 4: Run to green**

Run: `pnpm --filter @magna-carta/data-access test pii-registry-coverage`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/data-access/src/pii-registry.ts packages/data-access/test/pii-registry-coverage.test.ts
git commit -m "feat(data-access): PII registry coverage fitness — every table classified"
```

---

### Task 3: The merge drift tripwire

Keeps the registry's entity-axis rows a **superset** of the Directory merge's `REPOINT_TARGETS` reference set, so a new inbound reference to an entity (added to merge) cannot bypass erasure attribution. Lives in the `@magna-carta/directory` package (which may depend on `@magna-carta/data-access`; not the reverse).

**Files:**
- Modify: `packages/directory/src/merge.ts` (export a derived reference list)
- Test: `packages/directory/test/pii-registry-merge-sync.test.ts`

**Interfaces:**
- Consumes: `PII_TABLES` from `@magna-carta/data-access`, the exported reference list from `merge.ts`.
- Produces: `REPOINT_REFERENCE_COLUMNS: readonly { table: string; column: string }[]`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/directory/test/pii-registry-merge-sync.test.ts
import { describe, expect, it } from "vitest";
import { PII_TABLES } from "@magna-carta/data-access/pii-registry";
import { REPOINT_REFERENCE_COLUMNS } from "../src/merge.ts";

// Drift tripwire: every entity reference the merge repoints must also be an entity-axis entry in the
// PII/erasure registry, so an inbound entity reference can never be added to merge without also being
// attributed for erasure.
describe("PII registry ⊇ merge repoint references", () => {
  it("every REPOINT_REFERENCE_COLUMNS pair is a registry entry", () => {
    const registryPairs = new Set(PII_TABLES.map((entry) => `${entry.table}.${entry.subjectKey}`));
    const missing = REPOINT_REFERENCE_COLUMNS.filter(
      (reference) => !registryPairs.has(`${reference.table}.${reference.column}`),
    ).map((reference) => `${reference.table}.${reference.column}`);
    expect(missing, `merge references missing from PII_TABLES: ${missing.join(", ")}`).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @magna-carta/directory test pii-registry-merge-sync`
Expected: FAIL — `REPOINT_REFERENCE_COLUMNS` is not exported from `merge.ts`.

- [ ] **Step 3: Export the derived reference list from `merge.ts`**

Immediately after the `REPOINT_TARGETS` definition (`packages/directory/src/merge.ts`, after the array literal ends ~line 230), add:

```ts
// The (table, column) inbound-reference pairs the merge repoints — exported so the PII/erasure
// registry can be pinned as a superset (a new entity reference here must also be attributed for
// erasure). Derived from REPOINT_TARGETS so the two never drift.
export const REPOINT_REFERENCE_COLUMNS: readonly { readonly table: string; readonly column: string }[] =
  REPOINT_TARGETS.map((target) => ({ table: target.table, column: target.column }));
```

- [ ] **Step 4: Run to green + confirm the merge suite is unaffected**

Run: `pnpm --filter @magna-carta/directory test pii-registry-merge-sync`
Expected: PASS.
Run: `pnpm --filter @magna-carta/directory test merge`
Expected: PASS (the export is additive; behavior unchanged).

- [ ] **Step 5: Commit**

```bash
git add packages/directory/src/merge.ts packages/directory/test/pii-registry-merge-sync.test.ts
git commit -m "feat(directory): pin PII registry as a superset of merge repoint references"
```

---

### Task 4: Wire the fitness tests into the package test run + final gate

**Files:** none new — confirm the three tests run under the standard `pnpm check` / package test invocation.

- [ ] **Step 1: Run the full quality gate**

Run: `pnpm check`
Expected: PASS (fmt + lint + `tsc -b`; `lint:process-refs` clean — the registry comments cite reasoning and `docs/conventions/compliance.md`, no ADR/spec citations).

- [ ] **Step 2: Run the affected package suites**

Run: `pnpm --filter @magna-carta/data-access test` and `pnpm --filter @magna-carta/directory test`
Expected: PASS.

- [ ] **Step 3: Changelog fragment**

Create `changelog.d/pii-erasure-registry.md`:

```markdown
---
category: Added
---

**A PII/erasure registry now attributes every personal-data table to a data subject.** A declarative
manifest (`PII_TABLES`, sibling to `PROTECTED_COLUMNS`) plus a coverage fitness function force every
per-firm table to be classified as PII or explicitly non-PII, so no personal-data table can escape
subject attribution — the seam GDPR subject-level erasure (Art. 17) will traverse. A drift tripwire
keeps it a superset of the Directory merge's reference set. The erasure orchestrator itself is deferred.
```

- [ ] **Step 4: Commit**

```bash
git add changelog.d/pii-erasure-registry.md
git commit -m "docs(changelog): PII/erasure registry"
```

## Self-review notes

- **Spec coverage:** §2 registry → Task 1; §3 fitness function → Task 2; §8 drift tripwire → Task 3; §4 module placement → Tasks 1–3 (the `directory:eraseSubject` permission and the orchestrator are the spec's explicitly-deferred items, not built here). Residency (§7) is the separate Track B plan.
- **No placeholders:** `NO_PII_TABLES` is filled from real test output in Task 2 Step 3 (the honest TDD path — the schema table list is discovered, not guessed).
- **Type consistency:** `PiiTableEntry.subjectKey` is the actual column name (`entity_id`, `from_entity_id`, `value_reference_id`, `vendor_id`, `timekeeper_user_id`, `reported_by`, `actor_user_id`, `subordinate_id`, `matter_id`, or `self`), so Task 3's `${table}.${subjectKey}` join matches `REPOINT_REFERENCE_COLUMNS`' `${table}.${column}`.
