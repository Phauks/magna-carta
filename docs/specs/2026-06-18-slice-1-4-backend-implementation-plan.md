# Slice 1·4 — Custom-Fields Engine — Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the per-firm, typed-EAV custom-fields engine — a new `@magna-carta/custom-fields` domain package plus the migration, merge extension, worker routes, fitness, and load-profile work — letting a firm's administrator add typed fields to matters and directory entities, with handle-stable identity, non-destructive retype, full-temporal value history, archive-first delete, and reference-kind merge relinking.

**Architecture:** A new domain package on the established structure-vs-access seam (mirrors `@magna-carta/directory` and `@magna-carta/matters`): pure domain logic that composes `composeEffectBatch` statements and never touches Hono or `env`. Three per-firm tables (`custom_field`, `picklist_option`, `custom_field_value`) land in migration `0012`. The directory's existing `merge.ts` gains two repoint targets and a per-target `onCollision` mode so reference-kind values survive entity merges. Worker routes register through the slice-0·5 `defineOpenAPIRoute` chokepoint. Design spec: `docs/specs/2026-06-18-slice-1-4-custom-fields-design.md`.

**Tech Stack:** TypeScript (ESM, ES2022), Drizzle (schema types only; migrations are hand-written raw SQL), Cloudflare D1 (per-firm), Hono + `@hono/zod-openapi`, Vitest (+ `@cloudflare/vitest-pool-workers` Miniflare for the worker), `vp` (vite-plus) for test/lint/format.

## Global Constraints

Every task's requirements implicitly include this section. Values copied from the design spec and the root `CLAUDE.md`.

- **Full names, no shorthand** (golden rule 12): identifier prefixes are spelled in full — `customField_`, `picklistOption_`, `customFieldValue_` (never `cf_`); packages by full name (`@magna-carta/data-access`, never "DAL"); `newIdentifier` not `newId`.
- **No process-artifact references in source, tests, or OpenAPI `description`s** (golden rule 13): no `ADR-NNNN`, no "spec", no "slice 0·N"/"Phase N" except a forward-looking "when X is built" schedule note. Enforced by `pnpm lint:process-refs`.
- **All business data through the firm-scoped data-access layer** (golden rule 3): every query runs against the firm-scoped database passed into the service; no cross-firm query; no raw `env` access in the package.
- **No floats** (ADR-0061): `value_number` is an integer; currency uses minor units (the `@magna-carta/money` scale), `number` uses a per-field `number_scale`.
- **Every mutation composes an `audit_log` event** via `domainAuditStatement` in the same atomic batch as the write. Audit `metadata` is always `null` (redact-by-default); never write a field value into the audit log.
- **Worker mutation routes are idempotency-keyed** (the `Idempotency-Key` header → the chokepoint → `runIdempotentEffect`).
- **Migration ordinal `0012`** is assigned against the per-firm head `0011_directory-phonetic-code-index`; **ADR numbers 0104/0105 and the migration ordinal reconcile at merge** if a sibling slice lands first.
- **The exactly-one-non-null and partial-unique value invariants are DB-enforced** (CHECK + partial index), not application-only.
- **TDD:** every task writes the failing test first, watches it fail, implements the minimum, watches it pass, commits.

## Commands (used throughout)

- Per-package unit tests: `pnpm --filter @magna-carta/custom-fields test` (alias `vp test run` inside the package).
- Repo-wide tests incl. the Miniflare worker suite: `pnpm test`.
- Quality gate (TS typecheck + lint + format): `pnpm check`.
- Process-reference lint: `pnpm lint:process-refs`.
- Regenerate the OpenAPI snapshot: `pnpm --filter @magna-carta/worker run emit-openapi`.
- Regenerate the typed client: `pnpm --filter @magna-carta/api-client run generate`.
- Measurement baseline: `pnpm --filter @magna-carta/fixtures run measure`.

## File Structure

**New package `packages/custom-fields/`:**

- `package.json`, `tsconfig.json`, `vitest.config.ts` — scaffold (copies of the `@magna-carta/matters` versions).
- `src/types.ts` — `CustomFieldKind`, `CustomFieldTarget`, input/row types, the named-error classes.
- `src/custom-field-statements.ts` — definition statement builders.
- `src/picklist-option-statements.ts` — option statement builders.
- `src/custom-field-value-statements.ts` — value statement builders (append-and-flip).
- `src/audit.ts` — `customFieldAuditStatement` adapter.
- `src/run-custom-field-effect.ts` — the idempotency/effect runner (copy of `run-directory-effect.ts`).
- `src/custom-field-service.ts` — definition service (define/rename/setRequired/reorder/archive/unarchive/hard-delete) + caps.
- `src/picklist-option-service.ts` — option service.
- `src/custom-field-value-service.ts` — value service (set/edit/clear) + reference validation.
- `src/reads.ts` — `resolveCustomField`, `readCurrentValues`, `readValueHistory`.
- `src/coercion.ts` — the pure coercion classifier.
- `src/convert.ts` — Convert preview + apply.
- `src/purge.ts` — the Purge seam (throws `PurgeNotYetEnabled`).
- `src/fitness.ts` — table-wide fitness queries.
- `test/*.test.ts` — one test file per src module.

**Edited existing files:**

- `packages/identifiers/src/registry.ts`, `packages/identifiers/src/types.ts` — three new prefixes + branded types.
- `packages/access-control/src/registry.ts` — `customFields:manage`, `customFields:purge`.
- `packages/database/src/per-firm-schema.ts` — three Drizzle table definitions (schema types).
- `packages/database/drizzle/per-firm/0013_custom-fields.sql` (new) + `meta/_journal.json` — the migration.
- `apps/worker/src/per-firm-migrations.ts` — register `0013`.
- `packages/directory/src/merge.ts`, `packages/directory/src/fitness.ts` — the merge extension.
- `apps/worker/src/routes/firm/custom-fields.ts` (new) + `apps/worker/src/app.ts` — the route surface.
- `packages/fixtures/src/load-profile/*` — the volume profile + measurements.
- `apps/worker/package.json` — add the package dependency.

---

## Task 1: Register identifiers, branded types, and permissions

**Files:**

- Modify: `packages/identifiers/src/registry.ts` (add to `ENTITY_PREFIXES`, near line 75)
- Modify: `packages/identifiers/src/types.ts` (add after the last `Identifier<>` alias, ~line 72)
- Modify: `packages/access-control/src/registry.ts` (add to the `PERMISSIONS` array)
- Test: `packages/identifiers/test/registry.test.ts` (existing fitness test should already assert registry/types parity — extend if needed)

**Interfaces:**

- Produces: `newIdentifier("customField" | "picklistOption" | "customFieldValue", randomSource)`; branded types `CustomFieldId`, `PicklistOptionId`, `CustomFieldValueId`; permission strings `"customFields:manage"`, `"customFields:purge"`.

- [ ] **Step 1: Write the failing test** — assert the new prefixes and permissions exist.

```typescript
// packages/identifiers/test/registry.test.ts (add to the existing suite)
import { ENTITY_PREFIXES } from "../src/registry.ts";

it("registers the custom-fields prefixes spelled in full", () => {
  expect(ENTITY_PREFIXES.customField).toBe("customField");
  expect(ENTITY_PREFIXES.picklistOption).toBe("picklistOption");
  expect(ENTITY_PREFIXES.customFieldValue).toBe("customFieldValue");
});
```

```typescript
// packages/access-control/test/registry.test.ts (add to the existing suite)
import { isPermission } from "../src/registry.ts";

it("registers the custom-fields permissions", () => {
  expect(isPermission("customFields:manage")).toBe(true);
  expect(isPermission("customFields:purge")).toBe(true);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @magna-carta/identifiers test && pnpm --filter @magna-carta/access-control test`
Expected: FAIL (`ENTITY_PREFIXES.customField` is `undefined`; `isPermission(...)` is `false`).

- [ ] **Step 3: Add the registry entries, branded types, and permissions**

```typescript
// packages/identifiers/src/registry.ts — inside ENTITY_PREFIXES, before the closing `} as const;`
  customField: "customField",
  picklistOption: "picklistOption",
  customFieldValue: "customFieldValue",
```

```typescript
// packages/identifiers/src/types.ts — after the last Identifier<> alias
export type CustomFieldId = Identifier<"customField">;
export type PicklistOptionId = Identifier<"picklistOption">;
export type CustomFieldValueId = Identifier<"customFieldValue">;
```

```typescript
// packages/access-control/src/registry.ts — inside the PERMISSIONS array
  "customFields:manage",
  "customFields:purge",
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @magna-carta/identifiers test && pnpm --filter @magna-carta/access-control test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/identifiers packages/access-control
git commit -m "feat(custom-fields): register identifier prefixes and permissions"
```

---

## Task 2: Migration 0012 — the three tables and permission seed

**Files:**

- Modify: `packages/database/src/per-firm-schema.ts` (append three `sqliteTable` definitions)
- Create: `packages/database/drizzle/per-firm/0013_custom-fields.sql`
- Modify: `packages/database/drizzle/per-firm/meta/_journal.json` (append the `0012` entry)
- Modify: `apps/worker/src/per-firm-migrations.ts` (import + register the new SQL)
- Test: `apps/worker/test/per-firm-migrations.test.ts` (or the existing migration-apply integration test)

**Interfaces:**

- Produces: tables `custom_field`, `picklist_option`, `custom_field_value`; the Drizzle objects `customField`, `picklistOption`, `customFieldValue` exported from `per-firm-schema.ts`; the migration tag `"0013_custom-fields"`.

- [ ] **Step 1: Write the failing test** — a freshly migrated per-firm DB has the three tables and the partial unique index.

```typescript
// apps/worker/test/per-firm-migrations.test.ts (or extend the existing migration suite)
it("applies 0012 and creates the custom-fields tables", async () => {
  const db = await freshlyMigratedPerFirmDatabase(); // existing test helper
  const tables = await db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('custom_field','picklist_option','custom_field_value')",
    )
    .all<{ name: string }>();
  expect(tables.results.map((r) => r.name).sort()).toEqual([
    "custom_field",
    "custom_field_value",
    "picklist_option",
  ]);
  const idx = await db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='index' AND name='custom_field_value_current_unique_index'",
    )
    .all();
  expect(idx.results.length).toBe(1);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test -- per-firm-migrations`
Expected: FAIL (tables do not exist).

- [ ] **Step 3: Write the migration SQL**

```sql
-- packages/database/drizzle/per-firm/0013_custom-fields.sql
CREATE TABLE `custom_field` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`target` text NOT NULL,
	`attachment_id` text,
	`number_scale` integer,
	`required` integer DEFAULT 0 NOT NULL,
	`archived` integer DEFAULT 0 NOT NULL,
	`converting` integer DEFAULT 0 NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`template_field_key` text,
	`created_at` text NOT NULL,
	`created_by` text,
	CONSTRAINT "custom_field_kind_check" CHECK(`kind` IN ('checkbox','date','time','number','currency','picklist','single-line','multi-line','url','email','matter-reference','contact-reference')),
	CONSTRAINT "custom_field_target_check" CHECK(`target` IN ('matter','entity')),
	CONSTRAINT "custom_field_required_check" CHECK(`required` IN (0,1)),
	CONSTRAINT "custom_field_archived_check" CHECK(`archived` IN (0,1)),
	CONSTRAINT "custom_field_converting_check" CHECK(`converting` IN (0,1))
);
--> statement-breakpoint
CREATE INDEX `custom_field_scope_index` ON `custom_field` (`target`, `attachment_id`);--> statement-breakpoint
CREATE TABLE `picklist_option` (
	`id` text PRIMARY KEY NOT NULL,
	`field_id` text NOT NULL,
	`name` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`archived` integer DEFAULT 0 NOT NULL,
	CONSTRAINT "picklist_option_archived_check" CHECK(`archived` IN (0,1))
);
--> statement-breakpoint
CREATE INDEX `picklist_option_field_id_index` ON `picklist_option` (`field_id`);--> statement-breakpoint
CREATE TABLE `custom_field_value` (
	`id` text PRIMARY KEY NOT NULL,
	`field_id` text NOT NULL,
	`target_row_id` text NOT NULL,
	`value_text` text,
	`value_number` integer,
	`value_date` text,
	`value_option_id` text,
	`value_reference_id` text,
	`is_current` integer DEFAULT 1 NOT NULL,
	`valid_from` text NOT NULL,
	`valid_to` text,
	`created_at` text NOT NULL,
	`created_by` text,
	CONSTRAINT "custom_field_value_is_current_check" CHECK(`is_current` IN (0,1)),
	CONSTRAINT "custom_field_value_one_value_check" CHECK(
		(`value_text` IS NOT NULL) + (`value_number` IS NOT NULL) + (`value_date` IS NOT NULL) + (`value_option_id` IS NOT NULL) + (`value_reference_id` IS NOT NULL) = 1
	)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `custom_field_value_current_unique_index` ON `custom_field_value` (`target_row_id`, `field_id`) WHERE `is_current` = 1;--> statement-breakpoint
CREATE INDEX `custom_field_value_record_index` ON `custom_field_value` (`target_row_id`, `is_current`);--> statement-breakpoint
CREATE INDEX `custom_field_value_field_index` ON `custom_field_value` (`field_id`);--> statement-breakpoint
CREATE INDEX `custom_field_value_reference_index` ON `custom_field_value` (`value_reference_id`);--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES
	('rolePermission_cf1Manage0Owner00000000', '<OWNER_ROLE_ID>', 'customFields:manage'),
	('rolePermission_cf2Manage0Admin00000000', '<ADMIN_ROLE_ID>', 'customFields:manage'),
	('rolePermission_cf3Purge00Owner00000000', '<OWNER_ROLE_ID>', 'customFields:purge');
```

> Copy `<OWNER_ROLE_ID>` and `<ADMIN_ROLE_ID>` verbatim from `packages/database/drizzle/per-firm/0010_seed-tools-firm-usage.sql` (the same role ids that migration seeds `tools:firmUsage` to). The three `rolePermission_` ids above are placeholders — replace each with a freshly minted handle (`newIdentifier("rolePermission")` from a scratch script, or copy the format of an existing `rolePermission_` id and change the token). `customFields:purge` seeds to Owner only.

- [ ] **Step 4: Append the journal entry**

```json
// packages/database/drizzle/per-firm/meta/_journal.json — append to the "entries" array after idx 11
{
  "idx": 12,
  "version": "6",
  "when": 1781900000000,
  "tag": "0013_custom-fields",
  "breakpoints": true
}
```

> `when` is a millisecond timestamp; any value larger than the `0011` entry's is fine (it is not load-bearing beyond ordering).

- [ ] **Step 5: Add the Drizzle table definitions** (schema types, so the data-access layer and fitness tests can reference column names)

```typescript
// packages/database/src/per-firm-schema.ts — append
export const customField = sqliteTable(
  "custom_field",
  {
    id: text("id").primaryKey().$type<CustomFieldId>(),
    name: text("name").notNull(),
    kind: text("kind", {
      enum: [
        "checkbox",
        "date",
        "time",
        "number",
        "currency",
        "picklist",
        "single-line",
        "multi-line",
        "url",
        "email",
        "matter-reference",
        "contact-reference",
      ],
    }).notNull(),
    target: text("target", { enum: ["matter", "entity"] }).notNull(),
    attachmentId: text("attachment_id"),
    numberScale: integer("number_scale"),
    required: integer("required").notNull().default(0),
    archived: integer("archived").notNull().default(0),
    converting: integer("converting").notNull().default(0),
    position: integer("position").notNull().default(0),
    templateFieldKey: text("template_field_key"),
    createdAt: text("created_at").notNull(),
    createdBy: text("created_by"),
  },
  (table) => [index("custom_field_scope_index").on(table.target, table.attachmentId)],
);

export const picklistOption = sqliteTable(
  "picklist_option",
  {
    id: text("id").primaryKey().$type<PicklistOptionId>(),
    fieldId: text("field_id").notNull().$type<CustomFieldId>(),
    name: text("name").notNull(),
    position: integer("position").notNull().default(0),
    archived: integer("archived").notNull().default(0),
  },
  (table) => [index("picklist_option_field_id_index").on(table.fieldId)],
);

export const customFieldValue = sqliteTable(
  "custom_field_value",
  {
    id: text("id").primaryKey().$type<CustomFieldValueId>(),
    fieldId: text("field_id").notNull().$type<CustomFieldId>(),
    targetRowId: text("target_row_id").notNull(),
    valueText: text("value_text"),
    valueNumber: integer("value_number"),
    valueDate: text("value_date"),
    valueOptionId: text("value_option_id").$type<PicklistOptionId>(),
    valueReferenceId: text("value_reference_id"),
    isCurrent: integer("is_current").notNull().default(1),
    validFrom: text("valid_from").notNull(),
    validTo: text("valid_to"),
    createdAt: text("created_at").notNull(),
    createdBy: text("created_by"),
  },
  (table) => [
    uniqueIndex("custom_field_value_current_unique_index")
      .on(table.targetRowId, table.fieldId)
      .where(sql`${table.isCurrent} = 1`),
    index("custom_field_value_record_index").on(table.targetRowId, table.isCurrent),
    index("custom_field_value_field_index").on(table.fieldId),
    index("custom_field_value_reference_index").on(table.valueReferenceId),
  ],
);
```

> Import `CustomFieldId`, `PicklistOptionId`, `CustomFieldValueId` from `@magna-carta/identifiers/types` at the top of the file (follow the existing import of `MatterId`/`DirectoryCategoryId`). `index`, `uniqueIndex`, `sql`, `integer`, `text` are already imported in this file.

- [ ] **Step 6: Register the migration in the worker bundler**

```typescript
// apps/worker/src/per-firm-migrations.ts
import customFieldsSql from "@magna-carta/database/drizzle/per-firm/0013_custom-fields.sql";
// ... inside the sqlByTag object passed to migrationsFromJournal:
  "0013_custom-fields": customFieldsSql,
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `pnpm test -- per-firm-migrations`
Expected: PASS (tables and partial unique index exist).

- [ ] **Step 8: Run the full check**

Run: `pnpm check`
Expected: PASS (the Drizzle types compile).

- [ ] **Step 9: Commit**

```bash
git add packages/database apps/worker/src/per-firm-migrations.ts
git commit -m "feat(custom-fields): add 0012 migration and per-firm schema"
```

---

## Task 3: Scaffold the `@magna-carta/custom-fields` package

**Files:**

- Create: `packages/custom-fields/package.json`, `packages/custom-fields/tsconfig.json`, `packages/custom-fields/vitest.config.ts`
- Create: `packages/custom-fields/src/types.ts`
- Modify: `apps/worker/package.json` (add the dependency)
- Test: `packages/custom-fields/test/types.test.ts`

**Interfaces:**

- Produces: the package `@magna-carta/custom-fields`; `CustomFieldKind` (the 12-kind union), `CustomFieldTarget` (`"matter" | "entity"`), `CUSTOM_FIELD_KINDS` (the `as const` array), and the named-error base `CustomFieldError` (with a `.code` string).

- [ ] **Step 1: Write the failing test**

```typescript
// packages/custom-fields/test/types.test.ts
import { CUSTOM_FIELD_KINDS, isCustomFieldKind, CustomFieldError } from "../src/types.ts";

it("lists exactly the twelve kinds", () => {
  expect(CUSTOM_FIELD_KINDS).toHaveLength(12);
  expect(isCustomFieldKind("currency")).toBe(true);
  expect(isCustomFieldKind("rating")).toBe(false);
});

it("CustomFieldError carries a stable code", () => {
  const error = new CustomFieldError("field-in-use", "still has values");
  expect(error.code).toBe("field-in-use");
  expect(error).toBeInstanceOf(Error);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @magna-carta/custom-fields test`
Expected: FAIL (package/module does not resolve).

- [ ] **Step 3: Create the scaffold** (copy the matters versions)

```json
// packages/custom-fields/package.json
{
  "name": "@magna-carta/custom-fields",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "sideEffects": false,
  "exports": {
    "./types": "./src/types.ts",
    "./custom-field-service": "./src/custom-field-service.ts",
    "./picklist-option-service": "./src/picklist-option-service.ts",
    "./custom-field-value-service": "./src/custom-field-value-service.ts",
    "./reads": "./src/reads.ts",
    "./coercion": "./src/coercion.ts",
    "./convert": "./src/convert.ts",
    "./purge": "./src/purge.ts",
    "./fitness": "./src/fitness.ts"
  },
  "scripts": { "test": "vp test run" },
  "dependencies": {
    "@magna-carta/data-access": "workspace:*",
    "@magna-carta/database": "workspace:*",
    "@magna-carta/identifiers": "workspace:*",
    "@magna-carta/money": "workspace:*",
    "zod": "catalog:"
  },
  "devDependencies": {
    "@magna-carta/tsconfig": "workspace:*",
    "@types/node": "catalog:",
    "drizzle-orm": "catalog:",
    "vitest": "catalog:"
  }
}
```

Copy `packages/matters/tsconfig.json` and `packages/matters/vitest.config.ts` verbatim into `packages/custom-fields/`.

```typescript
// packages/custom-fields/src/types.ts
export const CUSTOM_FIELD_KINDS = [
  "checkbox",
  "date",
  "time",
  "number",
  "currency",
  "picklist",
  "single-line",
  "multi-line",
  "url",
  "email",
  "matter-reference",
  "contact-reference",
] as const;
export type CustomFieldKind = (typeof CUSTOM_FIELD_KINDS)[number];
export type CustomFieldTarget = "matter" | "entity";

export function isCustomFieldKind(value: string): value is CustomFieldKind {
  return (CUSTOM_FIELD_KINDS as readonly string[]).includes(value);
}

export type CustomFieldErrorCode =
  | "unknown-field"
  | "field-in-use"
  | "kind-immutable-during-convert"
  | "convert-has-parked-values"
  | "reference-kind-handle-mismatch"
  | "cannot-protect-reference-or-picklist-kind"
  | "too-many-fields-for-scope"
  | "too-many-fields-for-firm"
  | "too-many-options-for-field"
  | "option-in-use"
  | "purge-not-yet-enabled";

export class CustomFieldError extends Error {
  readonly code: CustomFieldErrorCode;
  constructor(code: CustomFieldErrorCode, message: string) {
    super(message);
    this.name = "CustomFieldError";
    this.code = code;
  }
}
```

- [ ] **Step 4: Add the worker dependency and install**

```jsonc
// apps/worker/package.json — in "dependencies"
"@magna-carta/custom-fields": "workspace:*",
```

Run: `pnpm install`

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @magna-carta/custom-fields test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/custom-fields apps/worker/package.json pnpm-lock.yaml
git commit -m "feat(custom-fields): scaffold the domain package and shared types"
```

---

## Task 4: Field-definition statements, audit adapter, and effect runner

**Files:**

- Create: `packages/custom-fields/src/custom-field-statements.ts`
- Create: `packages/custom-fields/src/audit.ts`
- Create: `packages/custom-fields/src/run-custom-field-effect.ts`
- Create: `packages/custom-fields/test/helpers.ts` (local `migratedFirmDatabase` + `fixtureWriteOptions` — used by every later test)
- Test: `packages/custom-fields/test/custom-field-statements.test.ts`

**Interfaces:**

- Consumes: `SqlDatabase`, `SqlStatement` from `@magna-carta/data-access`; `domainAuditStatement`; `runIdempotentEffect`.
- Produces: `insertCustomFieldStatement`, `updateCustomFieldNameStatement`, `updateCustomFieldFlagsStatement`, `deleteCustomFieldStatement`, `selectCustomFieldStatement`; `customFieldAuditStatement(database, options, event, subjectId)`; `runCustomFieldEffect(database, options, responseCode, build)`; `CustomFieldWriteOptions` (`{ clock, actorUserId, randomSource?, idempotency? }`); `InsertCustomFieldRow`.

- [ ] **Step 1: Write the failing test** — the insert builder emits a parameterized statement.

```typescript
// packages/custom-fields/test/helpers.ts  (create this — used by every later unit test)
import { createMigratedNodeDatabase } from "@magna-carta/database/node-sqlite";
import { seededRandomSource } from "@magna-carta/identifiers/random";
import type { CustomFieldWriteOptions } from "../src/run-custom-field-effect.ts";

// createMigratedNodeDatabase is synchronous; wrap async so `await migratedFirmDatabase()` reads naturally.
export async function migratedFirmDatabase() {
  return createMigratedNodeDatabase("per-firm").database;
}
export function fixtureWriteOptions(seed = "cf-test"): CustomFieldWriteOptions {
  return {
    clock: { now: () => "2026-06-18T00:00:00.000Z" },
    actorUserId: null,
    randomSource: seededRandomSource(seed),
  };
}
```

```typescript
// packages/custom-fields/test/custom-field-statements.test.ts
import { insertCustomFieldStatement } from "../src/custom-field-statements.ts";
import { migratedFirmDatabase } from "./helpers.ts";

it("inserts a definition row that reads back", async () => {
  const db = await migratedFirmDatabase();
  await insertCustomFieldStatement(db, {
    id: "customField_abc",
    name: "Court Date",
    kind: "date",
    target: "matter",
    attachmentId: "matterType_pi",
    numberScale: null,
    required: 1,
    position: 3,
    templateFieldKey: null,
    createdAt: "2026-06-18T00:00:00.000Z",
    createdBy: "user_x",
  }).run();
  const row = await db
    .prepare("SELECT name, kind FROM custom_field WHERE id = 'customField_abc'")
    .first<{ name: string; kind: string }>();
  expect(row).toEqual({ name: "Court Date", kind: "date" });
});
```

> The migrated test database is `createMigratedNodeDatabase("per-firm").database` from `@magna-carta/database/node-sqlite` (the helper matters/directory unit tests use) — `.database` is the `BatchDatabase`. A statement from `database.prepare(...).bind(...)` runs directly with `.run()` / `.first()` / `.all()`. There is no shared `fixtureWriteOptions` in the repo; the local `test/helpers.ts` above is this package's version, built inline from `seededRandomSource` (`@magna-carta/identifiers/random`).

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @magna-carta/custom-fields test`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the statement builders, audit adapter, and effect runner**

```typescript
// packages/custom-fields/src/custom-field-statements.ts
import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type { CustomFieldId } from "@magna-carta/identifiers/types";

const CUSTOM_FIELD_TABLE = "custom_field";

export interface InsertCustomFieldRow {
  readonly id: CustomFieldId;
  readonly name: string;
  readonly kind: string;
  readonly target: string;
  readonly attachmentId: string | null;
  readonly numberScale: number | null;
  readonly required: number;
  readonly position: number;
  readonly templateFieldKey: string | null;
  readonly createdAt: string;
  readonly createdBy: string | null;
}

export function insertCustomFieldStatement(
  database: SqlDatabase,
  row: InsertCustomFieldRow,
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${CUSTOM_FIELD_TABLE} (id, name, kind, target, attachment_id, number_scale, required, archived, converting, position, template_field_key, created_at, created_by) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 0, 0, ?8, ?9, ?10, ?11)`,
    )
    .bind(
      row.id,
      row.name,
      row.kind,
      row.target,
      row.attachmentId,
      row.numberScale,
      row.required,
      row.position,
      row.templateFieldKey,
      row.createdAt,
      row.createdBy,
    );
}

export function updateCustomFieldNameStatement(
  database: SqlDatabase,
  id: CustomFieldId,
  name: string,
): SqlStatement {
  return database
    .prepare(`UPDATE ${CUSTOM_FIELD_TABLE} SET name = ?2 WHERE id = ?1`)
    .bind(id, name);
}

export function updateCustomFieldFlagsStatement(
  database: SqlDatabase,
  id: CustomFieldId,
  fields: {
    required?: number;
    archived?: number;
    position?: number;
    converting?: number;
    kind?: string;
    numberScale?: number | null;
  },
): SqlStatement {
  const sets: string[] = [];
  const bindings: (string | number | null)[] = [id];
  let index = 2;
  for (const [column, value] of Object.entries({
    required: fields.required,
    archived: fields.archived,
    position: fields.position,
    converting: fields.converting,
    kind: fields.kind,
    number_scale: fields.numberScale,
  })) {
    if (value === undefined) continue;
    sets.push(`${column} = ?${index}`);
    bindings.push(value as string | number | null);
    index += 1;
  }
  return database
    .prepare(`UPDATE ${CUSTOM_FIELD_TABLE} SET ${sets.join(", ")} WHERE id = ?1`)
    .bind(...bindings);
}

export function deleteCustomFieldStatement(database: SqlDatabase, id: CustomFieldId): SqlStatement {
  return database.prepare(`DELETE FROM ${CUSTOM_FIELD_TABLE} WHERE id = ?1`).bind(id);
}

export function selectCustomFieldStatement(database: SqlDatabase, id: CustomFieldId): SqlStatement {
  return database
    .prepare(
      `SELECT id, name, kind, target, attachment_id, number_scale, required, archived, converting, position FROM ${CUSTOM_FIELD_TABLE} WHERE id = ?1`,
    )
    .bind(id);
}
```

```typescript
// packages/custom-fields/src/audit.ts
import { domainAuditStatement } from "@magna-carta/data-access/audit-statements";
import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type { CustomFieldWriteOptions } from "./run-custom-field-effect.ts";

export function customFieldAuditStatement(
  database: SqlDatabase,
  options: CustomFieldWriteOptions,
  event: string,
  subjectId: string,
): SqlStatement {
  return domainAuditStatement(database, {
    event,
    subjectId,
    actorUserId: options.actorUserId,
    clock: options.clock,
    randomSource: options.randomSource,
  });
}
```

```typescript
// packages/custom-fields/src/run-custom-field-effect.ts
// Model on runMatterEffect + finishMatterResult from packages/matters/src/matter-service.ts (~lines 181-203),
// renaming to runCustomFieldEffect / CustomFieldWriteOptions / finishCustomFieldResult.
// Signature: runCustomFieldEffect<T>(database, options, responseCode, build), where build returns
// { statements, outboxMessages, value }. It calls runIdempotentEffect (key/fingerprint/newRecordId/now drawn
// from options.idempotency and options.clock) and returns `T & ReplayFlag` (the `idempotentReplay` flag the
// route reads). It serializes the value with canonicalJsonStringify for replay.
import { canonicalJsonStringify } from "@magna-carta/data-access/canonical";
```

> `CustomFieldWriteOptions` is `{ clock: { now(): string }; actorUserId: UserId | null; randomSource?: RandomSource; idempotency?: { key: string | undefined; fingerprint: string; newRecordId?: () => IdempotencyRecordId } }`. The runner wraps `runIdempotentEffect` **internally** (the matters/directory pattern) — so routes call the service and serialize its return value and never wrap idempotency themselves (Task 14). The canonical-JSON helper is at `@magna-carta/data-access/canonical` (not `/canonical-json`). Read `matter-service.ts:181-203` for the exact body.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @magna-carta/custom-fields test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/custom-fields/src/custom-field-statements.ts packages/custom-fields/src/audit.ts packages/custom-fields/src/run-custom-field-effect.ts packages/custom-fields/test/helpers.ts packages/custom-fields/test/custom-field-statements.test.ts
git commit -m "feat(custom-fields): definition statements, audit adapter, effect runner"
```

---

## Task 5: Field-definition service — define / rename / archive / reorder

**Files:**

- Create: `packages/custom-fields/src/custom-field-service.ts`
- Test: `packages/custom-fields/test/custom-field-service.test.ts`

**Interfaces:**

- Consumes: the statement builders + `runCustomFieldEffect` from Task 4; `newIdentifier`.
- Produces: `defineCustomField(database, input, options)`, `renameCustomField(...)`, `setCustomFieldRequired(...)`, `reorderCustomField(...)`, `archiveCustomField(...)`, `unarchiveCustomField(...)`. `DefineCustomFieldInput` (`{ name, kind, target, attachmentId, numberScale?, required? }`). Returns include the new `customFieldId`.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/custom-fields/test/custom-field-service.test.ts
import { migratedFirmDatabase } from "@magna-carta/database/testing"; // existing helper used by matters tests
import {
  defineCustomField,
  renameCustomField,
  archiveCustomField,
} from "../src/custom-field-service.ts";
import { fixtureWriteOptions } from "./helpers.ts"; // small local helper: { clock, actorUserId, randomSource }

it("defines a field, then renames it without touching the kind or id", async () => {
  const db = await migratedFirmDatabase();
  const options = fixtureWriteOptions();
  const { customFieldId } = await defineCustomField(
    db,
    { name: "Court Date", kind: "date", target: "matter", attachmentId: "matterType_pi" },
    options,
  );
  await renameCustomField(db, { fieldId: customFieldId, name: "Hearing Date" }, options);
  const row = await db
    .prepare("SELECT name, kind FROM custom_field WHERE id = ?1")
    .bind(customFieldId)
    .first<{ name: string; kind: string }>();
  expect(row).toEqual({ name: "Hearing Date", kind: "date" });
});

it("writes a custom_field.defined audit event on define", async () => {
  const db = await migratedFirmDatabase();
  const { customFieldId } = await defineCustomField(
    db,
    { name: "X", kind: "single-line", target: "entity", attachmentId: null },
    fixtureWriteOptions(),
  );
  const audit = await db
    .prepare("SELECT event, subject_id FROM audit_log WHERE subject_id = ?1")
    .bind(customFieldId)
    .first<{ event: string }>();
  expect(audit?.event).toBe("custom_field.defined");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @magna-carta/custom-fields test`
Expected: FAIL (service module not found).

- [ ] **Step 3: Implement the service** (each mutation composes its statement + an audit statement, run through `runCustomFieldEffect`)

```typescript
// packages/custom-fields/src/custom-field-service.ts
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { CustomFieldId } from "@magna-carta/identifiers/types";
import type { BatchDatabase } from "@magna-carta/data-access/effect-batch";
import { customFieldAuditStatement } from "./audit.ts";
import {
  insertCustomFieldStatement,
  updateCustomFieldNameStatement,
  updateCustomFieldFlagsStatement,
} from "./custom-field-statements.ts";
import { runCustomFieldEffect, type CustomFieldWriteOptions } from "./run-custom-field-effect.ts";
import type { CustomFieldKind, CustomFieldTarget } from "./types.ts";

export interface DefineCustomFieldInput {
  readonly name: string;
  readonly kind: CustomFieldKind;
  readonly target: CustomFieldTarget;
  readonly attachmentId: string | null;
  readonly numberScale?: number | null;
  readonly required?: boolean;
}

export async function defineCustomField(
  database: BatchDatabase,
  input: DefineCustomFieldInput,
  options: CustomFieldWriteOptions,
) {
  const fieldId = newIdentifier("customField", options.randomSource) as CustomFieldId;
  return runCustomFieldEffect<{ customFieldId: CustomFieldId }>(database, options, 201, () => {
    const now = options.clock.now();
    return {
      statements: [
        insertCustomFieldStatement(database, {
          id: fieldId,
          name: input.name,
          kind: input.kind,
          target: input.target,
          attachmentId: input.attachmentId,
          numberScale: input.numberScale ?? null,
          required: input.required ? 1 : 0,
          position: 0,
          templateFieldKey: null,
          createdAt: now,
          createdBy: options.actorUserId,
        }),
        customFieldAuditStatement(database, options, "custom_field.defined", fieldId),
      ],
      outboxMessages: [],
      value: { customFieldId: fieldId },
    };
  });
}

export async function renameCustomField(
  database: BatchDatabase,
  input: { fieldId: CustomFieldId; name: string },
  options: CustomFieldWriteOptions,
) {
  return runCustomFieldEffect<{ ok: true }>(database, options, 200, () => ({
    statements: [
      updateCustomFieldNameStatement(database, input.fieldId, input.name),
      customFieldAuditStatement(database, options, "custom_field.renamed", input.fieldId),
    ],
    outboxMessages: [],
    value: { ok: true },
  }));
}
// archiveCustomField / unarchiveCustomField / setCustomFieldRequired / reorderCustomField follow the same
// shape using updateCustomFieldFlagsStatement and the events custom_field.archived / .unarchived / .required_changed / .reordered.
```

Implement `archiveCustomField` (`updateCustomFieldFlagsStatement(database, fieldId, { archived: 1 })` + `custom_field.archived`), `unarchiveCustomField` (`{ archived: 0 }` + `.unarchived`), `setCustomFieldRequired` (`{ required }` + `.required_changed`), and `reorderCustomField` (`{ position }` + `.reordered`) in the same shape.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @magna-carta/custom-fields test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/custom-fields/src/custom-field-service.ts packages/custom-fields/test/
git commit -m "feat(custom-fields): field-definition service (define/rename/archive/reorder)"
```

---

## Task 6: Picklist-option service

**Files:**

- Create: `packages/custom-fields/src/picklist-option-statements.ts`
- Create: `packages/custom-fields/src/picklist-option-service.ts`
- Test: `packages/custom-fields/test/picklist-option-service.test.ts`

**Interfaces:**

- Produces: `createPicklistOption(database, { fieldId, name }, options)`, `renamePicklistOption(...)`, `reorderPicklistOption(...)`, `archivePicklistOption(...)`, `hardDeletePicklistOption(...)`. `hardDeletePicklistOption` throws `CustomFieldError("option-in-use", …)` if any value references the option.

- [ ] **Step 1: Write the failing tests**

```typescript
// packages/custom-fields/test/picklist-option-service.test.ts
import { migratedFirmDatabase } from "@magna-carta/database/testing";
import { defineCustomField } from "../src/custom-field-service.ts";
import {
  createPicklistOption,
  renamePicklistOption,
  hardDeletePicklistOption,
} from "../src/picklist-option-service.ts";
import { setCustomFieldValue } from "../src/custom-field-value-service.ts";
import { fixtureWriteOptions } from "./helpers.ts";
import { CustomFieldError } from "../src/types.ts";

it("creates an option keyed by handle; rename does not change the id", async () => {
  const db = await migratedFirmDatabase();
  const o = fixtureWriteOptions();
  const { customFieldId } = await defineCustomField(
    db,
    { name: "Stage", kind: "picklist", target: "matter", attachmentId: null },
    o,
  );
  const { optionId } = await createPicklistOption(db, { fieldId: customFieldId, name: "Filed" }, o);
  await renamePicklistOption(db, { optionId, name: "Filed with court" }, o);
  const row = await db
    .prepare("SELECT id, name FROM picklist_option WHERE id = ?1")
    .bind(optionId)
    .first<{ id: string; name: string }>();
  expect(row).toEqual({ id: optionId, name: "Filed with court" });
});

it("refuses hard-delete of an in-use option", async () => {
  const db = await migratedFirmDatabase();
  const o = fixtureWriteOptions();
  const { customFieldId } = await defineCustomField(
    db,
    { name: "Stage", kind: "picklist", target: "matter", attachmentId: null },
    o,
  );
  const { optionId } = await createPicklistOption(db, { fieldId: customFieldId, name: "Filed" }, o);
  await setCustomFieldValue(
    db,
    { fieldId: customFieldId, targetRowId: "matter_1", value: { kind: "picklist", optionId } },
    o,
  );
  await expect(hardDeletePicklistOption(db, { optionId }, o)).rejects.toMatchObject({
    code: "option-in-use",
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @magna-carta/custom-fields test`
Expected: FAIL (modules not found).

- [ ] **Step 3: Implement statements + service**

```typescript
// packages/custom-fields/src/picklist-option-statements.ts
import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type { PicklistOptionId, CustomFieldId } from "@magna-carta/identifiers/types";

const TABLE = "picklist_option";

export function insertPicklistOptionStatement(
  database: SqlDatabase,
  row: { id: PicklistOptionId; fieldId: CustomFieldId; name: string; position: number },
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${TABLE} (id, field_id, name, position, archived) VALUES (?1, ?2, ?3, ?4, 0)`,
    )
    .bind(row.id, row.fieldId, row.name, row.position);
}
export function updatePicklistOptionNameStatement(
  database: SqlDatabase,
  id: PicklistOptionId,
  name: string,
): SqlStatement {
  return database.prepare(`UPDATE ${TABLE} SET name = ?2 WHERE id = ?1`).bind(id, name);
}
export function setPicklistOptionArchivedStatement(
  database: SqlDatabase,
  id: PicklistOptionId,
  archived: number,
): SqlStatement {
  return database.prepare(`UPDATE ${TABLE} SET archived = ?2 WHERE id = ?1`).bind(id, archived);
}
export function setPicklistOptionPositionStatement(
  database: SqlDatabase,
  id: PicklistOptionId,
  position: number,
): SqlStatement {
  return database.prepare(`UPDATE ${TABLE} SET position = ?2 WHERE id = ?1`).bind(id, position);
}
export function deletePicklistOptionStatement(
  database: SqlDatabase,
  id: PicklistOptionId,
): SqlStatement {
  return database.prepare(`DELETE FROM ${TABLE} WHERE id = ?1`).bind(id);
}
```

```typescript
// packages/custom-fields/src/picklist-option-service.ts
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { PicklistOptionId, CustomFieldId } from "@magna-carta/identifiers/types";
import type { BatchDatabase } from "@magna-carta/data-access/effect-batch";
import { customFieldAuditStatement } from "./audit.ts";
import { runCustomFieldEffect, type CustomFieldWriteOptions } from "./run-custom-field-effect.ts";
import {
  insertPicklistOptionStatement,
  deletePicklistOptionStatement,
  updatePicklistOptionNameStatement,
} from "./picklist-option-statements.ts";
import { CustomFieldError } from "./types.ts";

export async function createPicklistOption(
  database: BatchDatabase,
  input: { fieldId: CustomFieldId; name: string },
  options: CustomFieldWriteOptions,
) {
  const optionId = newIdentifier("picklistOption", options.randomSource) as PicklistOptionId;
  return runCustomFieldEffect<{ optionId: PicklistOptionId }>(database, options, 201, () => ({
    statements: [
      insertPicklistOptionStatement(database, {
        id: optionId,
        fieldId: input.fieldId,
        name: input.name,
        position: 0,
      }),
      customFieldAuditStatement(database, options, "custom_field.option_created", optionId),
    ],
    outboxMessages: [],
    value: { optionId },
  }));
}

export async function hardDeletePicklistOption(
  database: BatchDatabase,
  input: { optionId: PicklistOptionId },
  options: CustomFieldWriteOptions,
) {
  const inUse = await database
    .prepare(`SELECT 1 FROM custom_field_value WHERE value_option_id = ?1 LIMIT 1`)
    .bind(input.optionId)
    .first();
  if (inUse)
    throw new CustomFieldError(
      "option-in-use",
      "Cannot delete a picklist option that has stored values; archive it instead.",
    );
  return runCustomFieldEffect<{ ok: true }>(database, options, 200, () => ({
    statements: [
      deletePicklistOptionStatement(database, input.optionId),
      customFieldAuditStatement(database, options, "custom_field.option_deleted", input.optionId),
    ],
    outboxMessages: [],
    value: { ok: true },
  }));
}
// renamePicklistOption (updatePicklistOptionNameStatement + custom_field.option_renamed),
// reorderPicklistOption (setPicklistOptionPositionStatement + .option_reordered),
// archivePicklistOption (setPicklistOptionArchivedStatement(1) + .option_archived) follow the same shape.
```

Implement `renamePicklistOption`, `reorderPicklistOption`, `archivePicklistOption` in the same shape.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @magna-carta/custom-fields test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/custom-fields/src/picklist-option-* packages/custom-fields/test/picklist-option-service.test.ts
git commit -m "feat(custom-fields): picklist-option service with in-use delete guard"
```

---

## Task 7: Value service — set / edit / clear (append-and-flip) + reference validation

**Files:**

- Create: `packages/custom-fields/src/custom-field-value-statements.ts`
- Create: `packages/custom-fields/src/custom-field-value-service.ts`
- Test: `packages/custom-fields/test/custom-field-value-service.test.ts`

**Interfaces:**

- Produces: `setCustomFieldValue(database, { fieldId, targetRowId, value }, options)`, `clearCustomFieldValue(database, { fieldId, targetRowId }, options)`. `value` is a tagged union: `{ kind: "text", text } | { kind: "number", number } | { kind: "date", date } | { kind: "picklist", optionId } | { kind: "reference", referenceId, referenceKind: "matter-reference" | "contact-reference" }`. `flipCurrentValueStatement`, `insertCurrentValueStatement`.

- [ ] **Step 1: Write the failing tests**

```typescript
// packages/custom-fields/test/custom-field-value-service.test.ts
import { migratedFirmDatabase } from "@magna-carta/database/testing";
import { defineCustomField } from "../src/custom-field-service.ts";
import { setCustomFieldValue, clearCustomFieldValue } from "../src/custom-field-value-service.ts";
import { fixtureWriteOptions } from "./helpers.ts";

it("set then edit keeps exactly one current row and flips the prior to history", async () => {
  const db = await migratedFirmDatabase();
  const o = fixtureWriteOptions();
  const { customFieldId } = await defineCustomField(
    db,
    { name: "Court Date", kind: "date", target: "matter", attachmentId: null },
    o,
  );
  await setCustomFieldValue(
    db,
    {
      fieldId: customFieldId,
      targetRowId: "matter_1",
      value: { kind: "date", date: "2026-09-18" },
    },
    o,
  );
  await setCustomFieldValue(
    db,
    {
      fieldId: customFieldId,
      targetRowId: "matter_1",
      value: { kind: "date", date: "2026-09-25" },
    },
    o,
  );
  const current = await db
    .prepare(
      "SELECT value_date FROM custom_field_value WHERE target_row_id='matter_1' AND field_id=?1 AND is_current=1",
    )
    .bind(customFieldId)
    .all<{ value_date: string }>();
  expect(current.results).toEqual([{ value_date: "2026-09-25" }]);
  const history = await db
    .prepare(
      "SELECT COUNT(*) AS n FROM custom_field_value WHERE target_row_id='matter_1' AND field_id=?1 AND is_current=0",
    )
    .bind(customFieldId)
    .first<{ n: number }>();
  expect(history?.n).toBe(1);
});

it("rejects a contact-reference value whose handle is a matter", async () => {
  const db = await migratedFirmDatabase();
  const o = fixtureWriteOptions();
  const { customFieldId } = await defineCustomField(
    db,
    { name: "Carrier", kind: "contact-reference", target: "matter", attachmentId: null },
    o,
  );
  await expect(
    setCustomFieldValue(
      db,
      {
        fieldId: customFieldId,
        targetRowId: "matter_1",
        value: { kind: "reference", referenceId: "matter_9", referenceKind: "contact-reference" },
      },
      o,
    ),
  ).rejects.toMatchObject({ code: "reference-kind-handle-mismatch" });
});

it("clear flips the current row to history and leaves no current row", async () => {
  const db = await migratedFirmDatabase();
  const o = fixtureWriteOptions();
  const { customFieldId } = await defineCustomField(
    db,
    { name: "Note", kind: "single-line", target: "entity", attachmentId: null },
    o,
  );
  await setCustomFieldValue(
    db,
    {
      fieldId: customFieldId,
      targetRowId: "directoryPerson_1",
      value: { kind: "text", text: "vip" },
    },
    o,
  );
  await clearCustomFieldValue(db, { fieldId: customFieldId, targetRowId: "directoryPerson_1" }, o);
  const current = await db
    .prepare(
      "SELECT COUNT(*) AS n FROM custom_field_value WHERE target_row_id='directoryPerson_1' AND field_id=?1 AND is_current=1",
    )
    .bind(customFieldId)
    .first<{ n: number }>();
  expect(current?.n).toBe(0);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @magna-carta/custom-fields test`
Expected: FAIL.

- [ ] **Step 3: Implement statements + service**

```typescript
// packages/custom-fields/src/custom-field-value-statements.ts
import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type { CustomFieldId, CustomFieldValueId } from "@magna-carta/identifiers/types";

const TABLE = "custom_field_value";

export function flipCurrentValueStatement(
  database: SqlDatabase,
  fieldId: CustomFieldId,
  targetRowId: string,
  now: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${TABLE} SET is_current = 0, valid_to = ?3 WHERE field_id = ?1 AND target_row_id = ?2 AND is_current = 1`,
    )
    .bind(fieldId, targetRowId, now);
}

export interface InsertValueRow {
  readonly id: CustomFieldValueId;
  readonly fieldId: CustomFieldId;
  readonly targetRowId: string;
  readonly valueText: string | null;
  readonly valueNumber: number | null;
  readonly valueDate: string | null;
  readonly valueOptionId: string | null;
  readonly valueReferenceId: string | null;
  readonly now: string;
  readonly createdBy: string | null;
}

export function insertCurrentValueStatement(
  database: SqlDatabase,
  row: InsertValueRow,
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${TABLE} (id, field_id, target_row_id, value_text, value_number, value_date, value_option_id, value_reference_id, is_current, valid_from, valid_to, created_at, created_by) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 1, ?9, NULL, ?9, ?10)`,
    )
    .bind(
      row.id,
      row.fieldId,
      row.targetRowId,
      row.valueText,
      row.valueNumber,
      row.valueDate,
      row.valueOptionId,
      row.valueReferenceId,
      row.now,
      row.createdBy,
    );
}
```

```typescript
// packages/custom-fields/src/custom-field-value-service.ts
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { CustomFieldId, CustomFieldValueId } from "@magna-carta/identifiers/types";
import type { BatchDatabase } from "@magna-carta/data-access/effect-batch";
import { customFieldAuditStatement } from "./audit.ts";
import { runCustomFieldEffect, type CustomFieldWriteOptions } from "./run-custom-field-effect.ts";
import {
  flipCurrentValueStatement,
  insertCurrentValueStatement,
} from "./custom-field-value-statements.ts";
import { CustomFieldError } from "./types.ts";

export type CustomFieldValueInput =
  | { kind: "text"; text: string }
  | { kind: "number"; number: number }
  | { kind: "date"; date: string }
  | { kind: "picklist"; optionId: string }
  | {
      kind: "reference";
      referenceId: string;
      referenceKind: "matter-reference" | "contact-reference";
    };

function columnsFor(value: CustomFieldValueInput) {
  const empty = {
    valueText: null,
    valueNumber: null,
    valueDate: null,
    valueOptionId: null,
    valueReferenceId: null,
  };
  switch (value.kind) {
    case "text":
      return { ...empty, valueText: value.text };
    case "number":
      return { ...empty, valueNumber: value.number };
    case "date":
      return { ...empty, valueDate: value.date };
    case "picklist":
      return { ...empty, valueOptionId: value.optionId };
    case "reference": {
      const ok =
        value.referenceKind === "matter-reference"
          ? value.referenceId.startsWith("matter_")
          : value.referenceId.startsWith("directoryPerson_") ||
            value.referenceId.startsWith("directoryOrganization_");
      if (!ok)
        throw new CustomFieldError(
          "reference-kind-handle-mismatch",
          `Handle ${value.referenceId} is not valid for ${value.referenceKind}.`,
        );
      return { ...empty, valueReferenceId: value.referenceId };
    }
  }
}

export async function setCustomFieldValue(
  database: BatchDatabase,
  input: { fieldId: CustomFieldId; targetRowId: string; value: CustomFieldValueInput },
  options: CustomFieldWriteOptions,
) {
  const columns = columnsFor(input.value); // throws on a bad reference handle before any write
  const valueId = newIdentifier("customFieldValue", options.randomSource) as CustomFieldValueId;
  return runCustomFieldEffect<{ customFieldValueId: CustomFieldValueId }>(
    database,
    options,
    200,
    () => {
      const now = options.clock.now();
      return {
        statements: [
          flipCurrentValueStatement(database, input.fieldId, input.targetRowId, now),
          insertCurrentValueStatement(database, {
            id: valueId,
            fieldId: input.fieldId,
            targetRowId: input.targetRowId,
            ...columns,
            now,
            createdBy: options.actorUserId,
          }),
          customFieldAuditStatement(database, options, "custom_field.value_set", valueId),
        ],
        outboxMessages: [],
        value: { customFieldValueId: valueId },
      };
    },
  );
}

export async function clearCustomFieldValue(
  database: BatchDatabase,
  input: { fieldId: CustomFieldId; targetRowId: string },
  options: CustomFieldWriteOptions,
) {
  return runCustomFieldEffect<{ ok: true }>(database, options, 200, () => ({
    statements: [
      flipCurrentValueStatement(database, input.fieldId, input.targetRowId, options.clock.now()),
      customFieldAuditStatement(database, options, "custom_field.value_cleared", input.fieldId),
    ],
    outboxMessages: [],
    value: { ok: true },
  }));
}
```

> Currency/number scaling: callers pass `value_number` already scaled to integer minor units (the route layer multiplies by `10^number_scale` using `@magna-carta/money`). The value service stores the integer as-is — it never sees a float.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @magna-carta/custom-fields test`
Expected: PASS (the partial-unique index guarantees the "exactly one current" invariant; the flip-then-insert order keeps it satisfied within the atomic batch).

- [ ] **Step 5: Commit**

```bash
git add packages/custom-fields/src/custom-field-value-* packages/custom-fields/test/custom-field-value-service.test.ts
git commit -m "feat(custom-fields): value service with append-and-flip history and reference validation"
```

---

## Task 8: Read paths — resolve, current values, history

**Files:**

- Create: `packages/custom-fields/src/reads.ts`
- Test: `packages/custom-fields/test/reads.test.ts`

**Interfaces:**

- Produces: `resolveCustomField(database, fieldId)` → `{ status: "active"; field: CustomFieldRow } | { status: "archived"; field: CustomFieldRow } | { status: "absent" }`; `readCurrentValues(database, targetRowId)` → `CustomFieldValueRow[]`; `readValueHistory(database, fieldId, targetRowId)` → `CustomFieldValueRow[]` ordered by `valid_from`.

- [ ] **Step 1: Write the failing tests**

```typescript
// packages/custom-fields/test/reads.test.ts
import { migratedFirmDatabase } from "@magna-carta/database/testing";
import { defineCustomField, archiveCustomField } from "../src/custom-field-service.ts";
import { resolveCustomField, readCurrentValues } from "../src/reads.ts";
import { setCustomFieldValue } from "../src/custom-field-value-service.ts";
import { fixtureWriteOptions } from "./helpers.ts";

it("resolves active, archived, and absent fields", async () => {
  const db = await migratedFirmDatabase();
  const o = fixtureWriteOptions();
  const { customFieldId } = await defineCustomField(
    db,
    { name: "A", kind: "single-line", target: "matter", attachmentId: null },
    o,
  );
  expect((await resolveCustomField(db, customFieldId)).status).toBe("active");
  await archiveCustomField(db, { fieldId: customFieldId }, o);
  expect((await resolveCustomField(db, customFieldId)).status).toBe("archived");
  expect((await resolveCustomField(db, "customField_missing")).status).toBe("absent");
});

it("readCurrentValues returns one row per field for a record", async () => {
  const db = await migratedFirmDatabase();
  const o = fixtureWriteOptions();
  const { customFieldId } = await defineCustomField(
    db,
    { name: "A", kind: "single-line", target: "matter", attachmentId: null },
    o,
  );
  await setCustomFieldValue(
    db,
    { fieldId: customFieldId, targetRowId: "matter_1", value: { kind: "text", text: "v1" } },
    o,
  );
  await setCustomFieldValue(
    db,
    { fieldId: customFieldId, targetRowId: "matter_1", value: { kind: "text", text: "v2" } },
    o,
  );
  const rows = await readCurrentValues(db, "matter_1");
  expect(rows).toHaveLength(1);
  expect(rows[0]?.valueText).toBe("v2");
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @magna-carta/custom-fields test`
Expected: FAIL.

- [ ] **Step 3: Implement the reads**

```typescript
// packages/custom-fields/src/reads.ts
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import type { CustomFieldId } from "@magna-carta/identifiers/types";

export interface CustomFieldRow {
  readonly id: string;
  readonly name: string;
  readonly kind: string;
  readonly target: string;
  readonly attachmentId: string | null;
  readonly archived: number;
}
export interface CustomFieldValueRow {
  readonly id: string;
  readonly fieldId: string;
  readonly valueText: string | null;
  readonly valueNumber: number | null;
  readonly valueDate: string | null;
  readonly valueOptionId: string | null;
  readonly valueReferenceId: string | null;
  readonly validFrom: string;
  readonly validTo: string | null;
}

export type ResolvedCustomField =
  | { status: "active"; field: CustomFieldRow }
  | { status: "archived"; field: CustomFieldRow }
  | { status: "absent" };

export async function resolveCustomField(
  database: SqlDatabase,
  fieldId: CustomFieldId | string,
): Promise<ResolvedCustomField> {
  const row = await database
    .prepare(
      `SELECT id, name, kind, target, attachment_id AS attachmentId, archived FROM custom_field WHERE id = ?1`,
    )
    .bind(fieldId)
    .first<CustomFieldRow>();
  if (!row) return { status: "absent" };
  return { status: row.archived === 1 ? "archived" : "active", field: row };
}

export async function readCurrentValues(
  database: SqlDatabase,
  targetRowId: string,
): Promise<CustomFieldValueRow[]> {
  const { results } = await database
    .prepare(
      `SELECT id, field_id AS fieldId, value_text AS valueText, value_number AS valueNumber, value_date AS valueDate, value_option_id AS valueOptionId, value_reference_id AS valueReferenceId, valid_from AS validFrom, valid_to AS validTo FROM custom_field_value WHERE target_row_id = ?1 AND is_current = 1`,
    )
    .bind(targetRowId)
    .all<CustomFieldValueRow>();
  return results;
}

export async function readValueHistory(
  database: SqlDatabase,
  fieldId: CustomFieldId | string,
  targetRowId: string,
): Promise<CustomFieldValueRow[]> {
  const { results } = await database
    .prepare(
      `SELECT id, field_id AS fieldId, value_text AS valueText, value_number AS valueNumber, value_date AS valueDate, value_option_id AS valueOptionId, value_reference_id AS valueReferenceId, valid_from AS validFrom, valid_to AS validTo FROM custom_field_value WHERE field_id = ?1 AND target_row_id = ?2 ORDER BY valid_from`,
    )
    .bind(fieldId, targetRowId)
    .all<CustomFieldValueRow>();
  return results;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @magna-carta/custom-fields test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/custom-fields/src/reads.ts packages/custom-fields/test/reads.test.ts
git commit -m "feat(custom-fields): read paths (resolve, current values, history)"
```

---

## Task 9: Governance guards — define-time caps and field hard-delete

**Files:**

- Modify: `packages/custom-fields/src/custom-field-service.ts` (add the cap checks to `defineCustomField` and the `hardDeleteCustomField` function)
- Create: `packages/custom-fields/src/limits.ts` (the cap constants)
- Test: `packages/custom-fields/test/governance.test.ts`

**Interfaces:**

- Produces: `hardDeleteCustomField(database, { fieldId }, options)` (throws `field-in-use` when any value row exists); cap enforcement in `defineCustomField` (throws `too-many-fields-for-scope` / `too-many-fields-for-firm`); `MAX_FIELDS_PER_SCOPE`, `MAX_FIELDS_PER_FIRM`, `MAX_OPTIONS_PER_FIELD` from `limits.ts`.

- [ ] **Step 1: Write the failing tests**

```typescript
// packages/custom-fields/test/governance.test.ts
import { migratedFirmDatabase } from "@magna-carta/database/testing";
import { defineCustomField, hardDeleteCustomField } from "../src/custom-field-service.ts";
import { setCustomFieldValue } from "../src/custom-field-value-service.ts";
import { fixtureWriteOptions } from "./helpers.ts";
import { MAX_FIELDS_PER_SCOPE } from "../src/limits.ts";

it("refuses hard-delete once the field has any value (current or historical)", async () => {
  const db = await migratedFirmDatabase();
  const o = fixtureWriteOptions();
  const { customFieldId } = await defineCustomField(
    db,
    { name: "A", kind: "single-line", target: "matter", attachmentId: null },
    o,
  );
  await setCustomFieldValue(
    db,
    { fieldId: customFieldId, targetRowId: "matter_1", value: { kind: "text", text: "x" } },
    o,
  );
  await expect(hardDeleteCustomField(db, { fieldId: customFieldId }, o)).rejects.toMatchObject({
    code: "field-in-use",
  });
});

it("hard-deletes a clean, unused field", async () => {
  const db = await migratedFirmDatabase();
  const o = fixtureWriteOptions();
  const { customFieldId } = await defineCustomField(
    db,
    { name: "A", kind: "single-line", target: "matter", attachmentId: null },
    o,
  );
  await hardDeleteCustomField(db, { fieldId: customFieldId }, o);
  const row = await db
    .prepare("SELECT 1 FROM custom_field WHERE id = ?1")
    .bind(customFieldId)
    .first();
  expect(row).toBeNull();
});

it("enforces the per-scope field cap", async () => {
  const db = await migratedFirmDatabase();
  const o = fixtureWriteOptions();
  for (let n = 0; n < MAX_FIELDS_PER_SCOPE; n += 1) {
    await defineCustomField(
      db,
      { name: `f${n}`, kind: "single-line", target: "matter", attachmentId: "matterType_x" },
      o,
    );
  }
  await expect(
    defineCustomField(
      db,
      { name: "overflow", kind: "single-line", target: "matter", attachmentId: "matterType_x" },
      o,
    ),
  ).rejects.toMatchObject({ code: "too-many-fields-for-scope" });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @magna-carta/custom-fields test`
Expected: FAIL.

- [ ] **Step 3: Implement the limits, caps, and hard-delete**

```typescript
// packages/custom-fields/src/limits.ts
// Provisional ceilings — recalibrate against the load profile (Task 16) before raising them.
export const MAX_FIELDS_PER_SCOPE = 60;
export const MAX_FIELDS_PER_FIRM = 600;
export const MAX_OPTIONS_PER_FIELD = 200;
```

```typescript
// packages/custom-fields/src/custom-field-service.ts — add to defineCustomField BEFORE composing the insert:
import { MAX_FIELDS_PER_SCOPE, MAX_FIELDS_PER_FIRM } from "./limits.ts";
import { CustomFieldError } from "./types.ts";

async function assertWithinFieldCaps(
  database: BatchDatabase,
  input: DefineCustomFieldInput,
): Promise<void> {
  const scope = await database
    .prepare(
      `SELECT COUNT(*) AS n FROM custom_field WHERE target = ?1 AND ((attachment_id IS NULL AND ?2 IS NULL) OR attachment_id = ?2) AND archived = 0`,
    )
    .bind(input.target, input.attachmentId)
    .first<{ n: number }>();
  if ((scope?.n ?? 0) >= MAX_FIELDS_PER_SCOPE)
    throw new CustomFieldError(
      "too-many-fields-for-scope",
      `A scope may hold at most ${MAX_FIELDS_PER_SCOPE} active fields.`,
    );
  const firm = await database
    .prepare(`SELECT COUNT(*) AS n FROM custom_field WHERE archived = 0`)
    .first<{ n: number }>();
  if ((firm?.n ?? 0) >= MAX_FIELDS_PER_FIRM)
    throw new CustomFieldError(
      "too-many-fields-for-firm",
      `A firm may hold at most ${MAX_FIELDS_PER_FIRM} active fields.`,
    );
}
// Call `await assertWithinFieldCaps(database, input);` as the first line of defineCustomField (before minting the id).

export async function hardDeleteCustomField(
  database: BatchDatabase,
  input: { fieldId: CustomFieldId },
  options: CustomFieldWriteOptions,
) {
  const used = await database
    .prepare(`SELECT 1 FROM custom_field_value WHERE field_id = ?1 LIMIT 1`)
    .bind(input.fieldId)
    .first();
  if (used)
    throw new CustomFieldError(
      "field-in-use",
      "Cannot hard-delete a field that has values; archive it instead.",
    );
  return runCustomFieldEffect<{ ok: true }>(database, options, 200, () => ({
    statements: [
      database.prepare(`DELETE FROM picklist_option WHERE field_id = ?1`).bind(input.fieldId),
      database.prepare(`DELETE FROM custom_field WHERE id = ?1`).bind(input.fieldId),
      customFieldAuditStatement(database, options, "custom_field.hard_deleted", input.fieldId),
    ],
    outboxMessages: [],
    value: { ok: true },
  }));
}
```

> The option-per-field cap (`MAX_OPTIONS_PER_FIELD`) is enforced the same way in `createPicklistOption` (Task 6): `SELECT COUNT(*) FROM picklist_option WHERE field_id = ?1` before insert, throwing `too-many-options-for-field`. Add that check now and a test for it.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @magna-carta/custom-fields test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/custom-fields/src/limits.ts packages/custom-fields/src/custom-field-service.ts packages/custom-fields/src/picklist-option-service.ts packages/custom-fields/test/governance.test.ts
git commit -m "feat(custom-fields): define-time caps and unused-only hard-delete"
```

---

## Task 10: The coercion classifier (pure)

**Files:**

- Create: `packages/custom-fields/src/coercion.ts`
- Test: `packages/custom-fields/test/coercion.test.ts`

**Interfaces:**

- Produces: `classifyCoercion(rawValue, fromKind, toKind)` → `{ outcome: "clean"; coerced: CoercedValue } | { outcome: "needs-rule" } | { outcome: "parked" }`. `coerceWithRule(rawValue, toKind, rule)` for the confirmed-rule path. Pure functions — no database. `RawStoredValue` is the read shape (the populated `value_*` column).

- [ ] **Step 1: Write the failing tests**

```typescript
// packages/custom-fields/test/coercion.test.ts
import { classifyCoercion } from "../src/coercion.ts";

it("text that is plain digits converts cleanly to a number", () => {
  expect(
    classifyCoercion({ kind: "single-line", text: "4250000" }, "single-line", "number").outcome,
  ).toBe("clean");
});
it("currency text with a magnitude suffix needs a rule", () => {
  expect(
    classifyCoercion({ kind: "single-line", text: "4.25M" }, "single-line", "currency").outcome,
  ).toBe("needs-rule");
});
it("free text with no number parks against a date", () => {
  expect(
    classifyCoercion({ kind: "single-line", text: "approx five" }, "single-line", "date").outcome,
  ).toBe("parked");
});
it("single-line to multi-line is always clean", () => {
  expect(
    classifyCoercion({ kind: "single-line", text: "anything" }, "single-line", "multi-line")
      .outcome,
  ).toBe("clean");
});
it("picklist to text uses the option label and is clean", () => {
  expect(
    classifyCoercion({ kind: "picklist", optionLabel: "Filed" }, "picklist", "single-line").outcome,
  ).toBe("clean");
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @magna-carta/custom-fields test`
Expected: FAIL.

- [ ] **Step 3: Implement the classifier**

```typescript
// packages/custom-fields/src/coercion.ts
import type { CustomFieldKind } from "./types.ts";

export type RawStoredValue =
  | { kind: "single-line" | "multi-line" | "url" | "email"; text: string }
  | { kind: "number" | "currency"; number: number }
  | { kind: "date" | "time"; date: string }
  | { kind: "checkbox"; checkbox: number }
  | { kind: "picklist"; optionLabel: string };

export type CoercedValue =
  | { column: "value_text"; text: string }
  | { column: "value_number"; number: number }
  | { column: "value_date"; date: string };

export type Classification =
  | { outcome: "clean"; coerced: CoercedValue }
  | { outcome: "needs-rule" }
  | { outcome: "parked" };

const TEXTY: CustomFieldKind[] = ["single-line", "multi-line", "url", "email"];
const INT_RE = /^-?\d+$/;
const MAGNITUDE_RE = /^-?\d+(\.\d+)?\s*[kKmMbB]$/;

function asText(value: RawStoredValue): string {
  if ("text" in value) return value.text;
  if ("optionLabel" in value) return value.optionLabel;
  if ("number" in value) return String(value.number);
  if ("date" in value) return value.date;
  return String(value.checkbox);
}

export function classifyCoercion(
  value: RawStoredValue,
  fromKind: CustomFieldKind,
  toKind: CustomFieldKind,
): Classification {
  if (fromKind === toKind) return { outcome: "clean", coerced: trivialCoercion(value) };
  // Text family: any text kind <-> any text kind, and picklist/number/date -> text, are clean.
  if (TEXTY.includes(toKind))
    return { outcome: "clean", coerced: { column: "value_text", text: asText(value) } };
  // number <-> currency: re-scale is mechanical (handled with the field's number_scale at apply time).
  if (
    (fromKind === "number" && toKind === "currency") ||
    (fromKind === "currency" && toKind === "number")
  ) {
    if ("number" in value)
      return { outcome: "clean", coerced: { column: "value_number", number: value.number } };
  }
  // -> number / -> currency from text.
  if (toKind === "number" || toKind === "currency") {
    const text = asText(value).replaceAll(",", "").replace(/^\$/, "").trim();
    if (INT_RE.test(text))
      return { outcome: "clean", coerced: { column: "value_number", number: Number(text) } };
    if (MAGNITUDE_RE.test(text)) return { outcome: "needs-rule" };
    return { outcome: "parked" };
  }
  // -> picklist: every distinct value becomes an option the admin confirms.
  if (toKind === "picklist") return { outcome: "needs-rule" };
  // -> date / -> time from text: only an ISO-shaped string is clean.
  if (toKind === "date" || toKind === "time") {
    const text = asText(value).trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(text))
      return { outcome: "clean", coerced: { column: "value_date", date: text } };
    return { outcome: "parked" };
  }
  return { outcome: "parked" };
}

function trivialCoercion(value: RawStoredValue): CoercedValue {
  if ("text" in value) return { column: "value_text", text: value.text };
  if ("number" in value) return { column: "value_number", number: value.number };
  if ("date" in value) return { column: "value_date", date: value.date };
  if ("optionLabel" in value) return { column: "value_text", text: value.optionLabel };
  return { column: "value_number", number: value.checkbox };
}
```

> `coerceWithRule(value, toKind, rule)` handles the confirmed `needs-rule` path: for `MAGNITUDE_RE`, multiply by `{ k: 1e3, m: 1e6, b: 1e9 }[suffix]`; for `-> picklist`, return the option to create. Add it with tests in this task.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @magna-carta/custom-fields test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/custom-fields/src/coercion.ts packages/custom-fields/test/coercion.test.ts
git commit -m "feat(custom-fields): pure coercion classifier for retype preview"
```

---

## Task 11: The Convert operation — preview and apply

**Files:**

- Create: `packages/custom-fields/src/convert.ts`
- Test: `packages/custom-fields/test/convert.test.ts`

**Interfaces:**

- Consumes: `classifyCoercion` (Task 10); the value statements (Task 7); `updateCustomFieldFlagsStatement` (Task 4).
- Produces: `previewConvert(database, { fieldId, toKind })` → `{ clean: number; needsRule: number; parked: { targetRowId: string }[] }`; `applyConvert(database, { fieldId, toKind, parkedDisposition: "park" | "block" }, options)` → throws `convert-has-parked-values` when `parkedDisposition === "block"` and any value parks; otherwise appends coerced current rows, flips originals to history, clears parked records, updates `kind`, and writes one `custom_field.kind_changed` event.

- [ ] **Step 1: Write the failing tests**

```typescript
// packages/custom-fields/test/convert.test.ts
import { migratedFirmDatabase } from "@magna-carta/database/testing";
import { defineCustomField } from "../src/custom-field-service.ts";
import { setCustomFieldValue } from "../src/custom-field-value-service.ts";
import { previewConvert, applyConvert } from "../src/convert.ts";
import { readValueHistory, resolveCustomField } from "../src/reads.ts";
import { fixtureWriteOptions } from "./helpers.ts";

it("apply with park: coerces clean values, flips originals to history, clears parked, flips the kind", async () => {
  const db = await migratedFirmDatabase();
  const o = fixtureWriteOptions();
  const { customFieldId } = await defineCustomField(
    db,
    { name: "Sum", kind: "single-line", target: "matter", attachmentId: null },
    o,
  );
  await setCustomFieldValue(
    db,
    { fieldId: customFieldId, targetRowId: "matter_1", value: { kind: "text", text: "4250000" } },
    o,
  );
  await setCustomFieldValue(
    db,
    {
      fieldId: customFieldId,
      targetRowId: "matter_2",
      value: { kind: "text", text: "approx five" },
    },
    o,
  );

  const preview = await previewConvert(db, { fieldId: customFieldId, toKind: "number" });
  expect(preview.clean).toBe(1);
  expect(preview.parked).toEqual([{ targetRowId: "matter_2" }]);

  await applyConvert(
    db,
    { fieldId: customFieldId, toKind: "number", parkedDisposition: "park" },
    o,
  );

  expect((await resolveCustomField(db, customFieldId)).field?.kind).toBe("number");
  const m1 = await db
    .prepare(
      "SELECT value_number FROM custom_field_value WHERE target_row_id='matter_1' AND is_current=1",
    )
    .first<{ value_number: number }>();
  expect(m1?.value_number).toBe(4250000);
  const m2current = await db
    .prepare(
      "SELECT COUNT(*) AS n FROM custom_field_value WHERE target_row_id='matter_2' AND is_current=1",
    )
    .first<{ n: number }>();
  expect(m2current?.n).toBe(0); // parked -> cleared, original preserved as history
  const m1history = await readValueHistory(db, customFieldId, "matter_1");
  expect(m1history.length).toBe(2); // original text row + new number row
});

it("apply with block throws when any value parks", async () => {
  const db = await migratedFirmDatabase();
  const o = fixtureWriteOptions();
  const { customFieldId } = await defineCustomField(
    db,
    { name: "Sum", kind: "single-line", target: "matter", attachmentId: null },
    o,
  );
  await setCustomFieldValue(
    db,
    {
      fieldId: customFieldId,
      targetRowId: "matter_2",
      value: { kind: "text", text: "approx five" },
    },
    o,
  );
  await expect(
    applyConvert(db, { fieldId: customFieldId, toKind: "number", parkedDisposition: "block" }, o),
  ).rejects.toMatchObject({ code: "convert-has-parked-values" });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @magna-carta/custom-fields test`
Expected: FAIL.

- [ ] **Step 3: Implement preview and apply**

```typescript
// packages/custom-fields/src/convert.ts
import type { BatchDatabase } from "@magna-carta/data-access/effect-batch";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { CustomFieldId, CustomFieldValueId } from "@magna-carta/identifiers/types";
import { customFieldAuditStatement } from "./audit.ts";
import { classifyCoercion, type RawStoredValue } from "./coercion.ts";
import {
  flipCurrentValueStatement,
  insertCurrentValueStatement,
} from "./custom-field-value-statements.ts";
import { updateCustomFieldFlagsStatement } from "./custom-field-statements.ts";
import { runCustomFieldEffect, type CustomFieldWriteOptions } from "./run-custom-field-effect.ts";
import { CustomFieldError, type CustomFieldKind } from "./types.ts";

interface CurrentValueForConvert {
  readonly targetRowId: string;
  readonly raw: RawStoredValue;
}

async function loadCurrentValues(
  database: BatchDatabase,
  fieldId: CustomFieldId,
  fromKind: CustomFieldKind,
): Promise<CurrentValueForConvert[]> {
  const { results } = await database
    .prepare(
      `SELECT target_row_id AS targetRowId, value_text, value_number, value_date, value_option_id, value_reference_id FROM custom_field_value WHERE field_id = ?1 AND is_current = 1`,
    )
    .bind(fieldId)
    .all<{
      targetRowId: string;
      value_text: string | null;
      value_number: number | null;
      value_date: string | null;
      value_option_id: string | null;
      value_reference_id: string | null;
    }>();
  // Map the populated column back to a RawStoredValue using fromKind. (picklist needs the option label — join picklist_option.)
  return results.map((row) => ({ targetRowId: row.targetRowId, raw: toRaw(row, fromKind) }));
}

async function fieldKind(
  database: BatchDatabase,
  fieldId: CustomFieldId,
): Promise<CustomFieldKind> {
  const row = await database
    .prepare(`SELECT kind FROM custom_field WHERE id = ?1`)
    .bind(fieldId)
    .first<{ kind: CustomFieldKind }>();
  if (!row) throw new CustomFieldError("unknown-field", "No such custom field.");
  return row.kind;
}

export async function previewConvert(
  database: BatchDatabase,
  input: { fieldId: CustomFieldId; toKind: CustomFieldKind },
) {
  const fromKind = await fieldKind(database, input.fieldId);
  const values = await loadCurrentValues(database, input.fieldId, fromKind);
  let clean = 0,
    needsRule = 0;
  const parked: { targetRowId: string }[] = [];
  for (const v of values) {
    const c = classifyCoercion(v.raw, fromKind, input.toKind);
    if (c.outcome === "clean") clean += 1;
    else if (c.outcome === "needs-rule") needsRule += 1;
    else parked.push({ targetRowId: v.targetRowId });
  }
  return { clean, needsRule, parked };
}

export async function applyConvert(
  database: BatchDatabase,
  input: { fieldId: CustomFieldId; toKind: CustomFieldKind; parkedDisposition: "park" | "block" },
  options: CustomFieldWriteOptions,
) {
  const fromKind = await fieldKind(database, input.fieldId);
  const values = await loadCurrentValues(database, input.fieldId, fromKind);
  const classified = values.map((v) => ({ v, c: classifyCoercion(v.raw, fromKind, input.toKind) }));
  if (input.parkedDisposition === "block" && classified.some((x) => x.c.outcome === "parked")) {
    throw new CustomFieldError(
      "convert-has-parked-values",
      "Resolve or re-rule the parked values, or choose park.",
    );
  }
  return runCustomFieldEffect<{ ok: true }>(database, options, 200, () => {
    const now = options.clock.now();
    const statements = [];
    for (const { v, c } of classified) {
      statements.push(flipCurrentValueStatement(database, input.fieldId, v.targetRowId, now));
      if (c.outcome === "clean") {
        const valueId = newIdentifier(
          "customFieldValue",
          options.randomSource,
        ) as CustomFieldValueId;
        const cols = {
          valueText: null,
          valueNumber: null,
          valueDate: null,
          valueOptionId: null,
          valueReferenceId: null,
          [columnField(c.coerced.column)]: columnValue(c.coerced),
        };
        statements.push(
          insertCurrentValueStatement(database, {
            id: valueId,
            fieldId: input.fieldId,
            targetRowId: v.targetRowId,
            now,
            createdBy: options.actorUserId,
            ...(cols as any),
          }),
        );
      }
      // needs-rule with no confirmed rule, and parked: original flipped to history, no new current row (cleared).
    }
    statements.push(
      updateCustomFieldFlagsStatement(database, input.fieldId, { kind: input.toKind }),
    );
    statements.push(
      customFieldAuditStatement(database, options, "custom_field.kind_changed", input.fieldId),
    );
    return { statements, outboxMessages: [], value: { ok: true } };
  });
}
// Helpers toRaw, columnField, columnValue map between the DB row and RawStoredValue / CoercedValue. Implement them
// in this file. For a bulk field (value count over the load-profile-calibrated threshold), this Apply is the work a
// Queue consumer runs after the route sets `converting = 1`; the inline path here is the small-field case. The Queue
// offload is wired when the threshold is measured (Task 16) — until then Apply runs inline and the route is bounded
// by the per-request value count.
```

> Implement `toRaw` (build a `RawStoredValue` from the populated column + `fromKind`; for a picklist, join `picklist_option` to get the label), `columnField` (`"value_text" | "value_number" | "value_date"` → the `InsertValueRow` key), and `columnValue`. Confirmed-rule handling (`needs-rule` → coerce via `coerceWithRule`) is a follow-on step in this task with its own test.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @magna-carta/custom-fields test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/custom-fields/src/convert.ts packages/custom-fields/test/convert.test.ts
git commit -m "feat(custom-fields): non-destructive Convert (preview + apply, reversible)"
```

---

## Task 12: Extend the directory merge — repoint custom-field reference values

**Files:**

- Modify: `packages/directory/src/merge.ts` (the `RepointTarget` interface, `REPOINT_TARGETS`, the repoint loop)
- Modify: `packages/directory/src/fitness.ts` (`INBOUND_REFERENCE_PROBES`)
- Modify: `packages/directory/package.json` — no change (the table is named by string; no new dependency)
- Test: `packages/directory/test/merge.test.ts` (extend the existing merge suite)

**Interfaces:**

- Consumes: nothing new (operates on the `custom_field_value` table by name).
- Produces: a new `onCollision: "delete" | "archive-to-history"` field on `RepointTarget`; two new `REPOINT_TARGETS` entries (`custom_field_value.value_reference_id` and `custom_field_value.target_row_id`); two new `INBOUND_REFERENCE_PROBES` entries; the archive-to-history absorb branch.

- [ ] **Step 1: Write the failing test** — merging two organizations repoints a reference value and absorbs an owned value to history.

> Extend the existing `packages/directory/test/merge.test.ts`. **Reuse that file's existing harness** to create the master + subordinate organizations and to call `mergeEntities` — its real signature is `mergeEntities(context, input)` where `context` is a `DirectoryIdentifierContext` (carrying the database + clock + actorUserId + randomSource) and `input` is `MergeEntitiesInput` (`{ masterId, subordinateId, … }`). There is **no** separate third `options` argument. Copy the surrounding setup from a neighbouring merge test; only the `custom_field_value` seed rows and the assertions below are new.

```typescript
// packages/directory/test/merge.test.ts (add to the suite; `context`, `master`, `sub`, and the db handle come from the existing harness)
it("repoints a contact-reference custom value and absorbs an owned value to history on merge", async () => {
  // ...existing harness: build `context`, create `master` and `sub` organizations, get the `db` (= context.database)...
  // Target A: a matter field whose contact-reference points at the subordinate.
  await db
    .prepare(
      "INSERT INTO custom_field (id,name,kind,target,attachment_id,required,archived,converting,position,created_at) VALUES ('customField_ref','Carrier','contact-reference','matter',NULL,0,0,0,0,'t')",
    )
    .run();
  await db
    .prepare(
      "INSERT INTO custom_field_value (id,field_id,target_row_id,value_reference_id,is_current,valid_from,created_at) VALUES ('customFieldValue_a','customField_ref','matter_1',?1,1,'t','t')",
    )
    .bind(sub.id)
    .run();
  // Target B: an entity field with values OWNED BY both master and subordinate (same field) -> collision -> absorb-to-history.
  await db
    .prepare(
      "INSERT INTO custom_field (id,name,kind,target,attachment_id,required,archived,converting,position,created_at) VALUES ('customField_own','Risk','single-line','entity',NULL,0,0,0,0,'t')",
    )
    .run();
  await db
    .prepare(
      "INSERT INTO custom_field_value (id,field_id,target_row_id,value_text,is_current,valid_from,created_at) VALUES ('customFieldValue_m','customField_own',?1,'A',1,'t','t')",
    )
    .bind(master.id)
    .run();
  await db
    .prepare(
      "INSERT INTO custom_field_value (id,field_id,target_row_id,value_text,is_current,valid_from,created_at) VALUES ('customFieldValue_s','customField_own',?1,'B',1,'t','t')",
    )
    .bind(sub.id)
    .run();

  await mergeEntities(context, { masterId: master.id, subordinateId: sub.id });

  const ref = await db
    .prepare("SELECT value_reference_id FROM custom_field_value WHERE id='customFieldValue_a'")
    .first<{ value_reference_id: string }>();
  expect(ref?.value_reference_id).toBe(master.id); // Target A repointed
  const masterCurrent = await db
    .prepare(
      "SELECT COUNT(*) AS n FROM custom_field_value WHERE field_id='customField_own' AND target_row_id=?1 AND is_current=1",
    )
    .bind(master.id)
    .first<{ n: number }>();
  expect(masterCurrent?.n).toBe(1); // master's value wins, still one current
  const absorbed = await db
    .prepare(
      "SELECT is_current, target_row_id FROM custom_field_value WHERE id='customFieldValue_s'",
    )
    .first<{ is_current: number; target_row_id: string }>();
  expect(absorbed).toEqual({ is_current: 0, target_row_id: master.id }); // subordinate value -> history under master
});
```

> Match `master.id` / `sub.id` to whatever the harness names the created entity handles (it may be `.organizationId`). `MergeEntitiesInput` may also require a `survivorship` field — copy the exact shape the neighbouring test passes.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @magna-carta/directory test -- merge`
Expected: FAIL.

- [ ] **Step 3: Add `onCollision` to the interface and the existing targets**

In `packages/directory/src/merge.ts`, add the field to the interface (after `extraColumns`):

```typescript
interface RepointTarget {
  readonly table: string;
  readonly column: string;
  readonly rowColumn: string;
  readonly extraColumns: readonly string[];
  readonly onCollision: "delete" | "archive-to-history";
  readonly collides: (
    database: BatchDatabase,
    masterId: string,
    row: Readonly<Record<string, string | null>>,
  ) => Promise<boolean>;
}
```

Add `onCollision: "delete",` to each of the four existing `REPOINT_TARGETS` entries (their behaviour is unchanged).

- [ ] **Step 4: Add the two custom-field targets to `REPOINT_TARGETS`**

```typescript
// Target A: a value that points AT the merged entity (the value's own row does not move; no collision possible).
{
  table: "custom_field_value",
  column: "value_reference_id",
  rowColumn: "id",
  extraColumns: [],
  onCollision: "delete", // unreachable for this target — collides() always returns false
  collides: async () => false,
},
// Target B: values OWNED BY the merged entity (its target_row_id moves to the master; partial-unique may collide).
{
  table: "custom_field_value",
  column: "target_row_id",
  rowColumn: "id",
  extraColumns: ["field_id", "is_current"],
  onCollision: "archive-to-history",
  collides: async (database, masterId, row) => {
    if (row.is_current !== "1" && row.is_current !== 1 as unknown as string) return false; // only a live row can collide on the partial unique
    const { results } = await database
      .prepare(`SELECT 1 FROM custom_field_value WHERE target_row_id = ?1 AND field_id = ?2 AND is_current = 1 LIMIT 1`)
      .bind(masterId, row.field_id)
      .all();
    return results.length > 0;
  },
},
```

- [ ] **Step 5: Branch the absorb path on `onCollision`** — in the repoint loop, where a collision currently always `DELETE`s:

```typescript
if (await target.collides(database, masterId, row)) {
  if (target.onCollision === "archive-to-history") {
    // Move the losing row to the master and flip it to history, preserving content (field-level survivorship).
    statements.push(
      database
        .prepare(
          `UPDATE ${target.table} SET ${target.column} = ?2, is_current = 0, valid_to = ?3 WHERE ${target.rowColumn} = ?1`,
        )
        .bind(rowId, masterId, now),
    );
    repointed.push({
      table: target.table,
      row: rowId,
      from: subordinateId,
      to: masterId,
      absorbed: true,
    });
  } else {
    statements.push(
      database
        .prepare(
          `DELETE FROM ${target.table} WHERE ${target.rowColumn} = ?1 AND ${target.column} = ?2`,
        )
        .bind(rowId, subordinateId),
    );
    repointed.push({
      table: target.table,
      row: rowId,
      from: subordinateId,
      to: masterId,
      absorbed: true,
    });
  }
} else {
  // ...unchanged plain UPDATE repoint...
}
```

> `now` is captured at `merge.ts:249` (`const now = context.clock.now();`) and is in scope throughout the repoint loop — use it directly. The `RepointRecord` shape (`merge.ts:90-96`) is `{ table, row, from, to, absorbed? }`; the optional `absorbed` flag already covers the archive-to-history case, so **no `RepointRecord` type change is needed**. The statements array is `statements` (`merge.ts:256`).

- [ ] **Step 6: Add the fitness probes** — in `packages/directory/src/fitness.ts`:

```typescript
const INBOUND_REFERENCE_PROBES: ReadonlyArray<{ table: string; column: string }> = [
  { table: "matter_party", column: "entity_id" },
  { table: "directory_edge", column: "from_entity_id" },
  { table: "directory_edge", column: "to_entity_id" },
  { table: "directory_entity_category", column: "entity_id" },
  { table: "custom_field_value", column: "value_reference_id" },
  { table: "custom_field_value", column: "target_row_id" },
];
```

> `findDanglingToSubordinate` derives the row identity column per probe. `custom_field_value` has an `id`, so the default `id` expression is correct (no special-case needed like `directory_entity_category`).

- [ ] **Step 7: Run the test to verify it passes**

Run: `pnpm --filter @magna-carta/directory test -- merge`
Expected: PASS.

- [ ] **Step 8: Run the directory fitness + full check**

Run: `pnpm --filter @magna-carta/directory test && pnpm check`
Expected: PASS (the `REPOINT_TARGETS` ⇄ `INBOUND_REFERENCE_PROBES` lockstep holds).

- [ ] **Step 9: Commit**

```bash
git add packages/directory/src/merge.ts packages/directory/src/fitness.ts packages/directory/test/merge.test.ts
git commit -m "feat(directory): repoint custom-field reference values on merge (archive-to-history)"
```

---

## Task 13: The Purge seam

**Files:**

- Create: `packages/custom-fields/src/purge.ts`
- Test: `packages/custom-fields/test/purge.test.ts`

**Interfaces:**

- Produces: `purgeCustomField(database, { fieldId, reason }, options)` — throws `CustomFieldError("purge-not-yet-enabled", …)`; the documented contract (irreversible erasure of a field and all its values; emits `custom_field.purged`; gated by `customFields:purge`).

- [ ] **Step 1: Write the failing test**

```typescript
// packages/custom-fields/test/purge.test.ts
import { purgeCustomField } from "../src/purge.ts";
import { migratedFirmDatabase } from "@magna-carta/database/testing";
import { fixtureWriteOptions } from "./helpers.ts";

it("the purge seam refuses until a real erasure obligation enables it", async () => {
  const db = await migratedFirmDatabase();
  await expect(
    purgeCustomField(db, { fieldId: "customField_x", reason: "gdpr" }, fixtureWriteOptions()),
  ).rejects.toMatchObject({ code: "purge-not-yet-enabled" });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @magna-carta/custom-fields test`
Expected: FAIL.

- [ ] **Step 3: Implement the seam**

```typescript
// packages/custom-fields/src/purge.ts
import type { BatchDatabase } from "@magna-carta/data-access/effect-batch";
import type { CustomFieldId } from "@magna-carta/identifiers/types";
import type { CustomFieldWriteOptions } from "./run-custom-field-effect.ts";
import { CustomFieldError } from "./types.ts";

// Compliance erasure: an irreversible, audited removal of a custom field AND all of its values
// (current and historical) — the one case Archive cannot serve. Gated by the `customFields:purge`
// permission. The executing pass is built when a real erasure obligation appears; until then this
// seam refuses, so no destructive bulk operation ships speculatively. When built, it will: delete
// every custom_field_value for the field, delete its picklist_option rows, delete the custom_field
// row, and emit `custom_field.purged`.
export async function purgeCustomField(
  _database: BatchDatabase,
  _input: { fieldId: CustomFieldId | string; reason: string },
  _options: CustomFieldWriteOptions,
): Promise<never> {
  throw new CustomFieldError("purge-not-yet-enabled", "Custom-field purge is not yet enabled.");
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @magna-carta/custom-fields test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/custom-fields/src/purge.ts packages/custom-fields/test/purge.test.ts
git commit -m "feat(custom-fields): purge seam (refuses until a real erasure obligation)"
```

---

## Task 14: Worker route surface — `/v1/custom-fields/*`

**Files:**

- Create: `apps/worker/src/routes/firm/custom-fields.ts`
- Modify: `apps/worker/src/app.ts` (call `registerCustomFieldsRoutes(app, chokepoint)`)
- Modify: `apps/worker/openapi/openapi.json` (regenerated, committed)
- Modify: `packages/api-client/src/*` (regenerated client, committed)
- Test: `apps/worker/test/custom-fields-routes.test.ts` (Miniflare, mirrors `matters-routes.test.ts`)

**Interfaces:**

- Consumes: every service from Tasks 5–13; the chokepoint helpers (`requireChokepointFirmContext`, `requireChokepointUserId`, `requireChokepointIdempotency`), `runIdempotentEffect`, `problemJson`, `problemResponseForIdempotencyConflict`.
- Produces: `registerCustomFieldsRoutes(app, chokepoint)`; the operations `customFields.defineField`, `.renameField`, `.setRequired`, `.reorderField`, `.archiveField`, `.unarchiveField`, `.hardDeleteField`, `.previewConvert`, `.applyConvert`, `.purgeField`, `.createOption`, `.renameOption`, `.reorderOption`, `.archiveOption`, `.hardDeleteOption`, `.setValue`, `.clearValue`, `.listRecordValues`, `.resolveField`.

- [ ] **Step 1: Write the failing Miniflare test** — define a field and set a value through the HTTP surface.

> Worker route tests use `SELF` from `cloudflare:test` (the app is deployed into Miniflare by the test framework — there is **no** standalone `appForTest`/`authHeadersFor`). **Mirror `apps/worker/test/matters-routes.test.ts` verbatim** for the harness: the seeding helpers (`seedFirm`, `seedCredentialedUser`, `seedFirmKey`, `signInForSessionCookie`) from the worker `test-auth` helper, and a local `authHeaders(cookie, withKey?)` helper that sets content-type / origin / cookie / an optional `Idempotency-Key`.

```typescript
// apps/worker/test/custom-fields-routes.test.ts  (mirror apps/worker/test/matters-routes.test.ts setup)
import { SELF } from "cloudflare:test";
import { describe, it, expect, beforeEach } from "vitest";
import {
  seedFirm,
  seedCredentialedUser,
  seedFirmKey,
  signInForSessionCookie,
} from "./test-auth.ts";
// + the local authHeaders(cookie, withKey?) helper copied from matters-routes.test.ts

describe("custom-fields routes", () => {
  let cookie: string;
  beforeEach(async () => {
    // ...seedFirm / seedCredentialedUser(owner) / seedFirmKey exactly as matters-routes.test.ts does...
    cookie = await signInForSessionCookie(/* owner credentials */);
  });

  it("defines a field and sets a value", async () => {
    const define = await SELF.fetch("https://app.test/api/v1/custom-fields/fields", {
      method: "POST",
      headers: authHeaders(cookie, true), // includes a fresh Idempotency-Key
      body: JSON.stringify({
        name: "Court Date",
        kind: "date",
        target: "matter",
        attachmentId: null,
      }),
    });
    expect(define.status).toBe(201);
    const { id } = (await define.json()) as { id: string };
    const set = await SELF.fetch("https://app.test/api/v1/custom-fields/values", {
      method: "PUT",
      headers: authHeaders(cookie, true),
      body: JSON.stringify({
        fieldId: id,
        targetRowId: "matter_1",
        value: { kind: "date", date: "2026-09-18" },
      }),
    });
    expect(set.status).toBe(200);
  });

  it("maps a reference-kind mismatch to 422", async () => {
    // define a contact-reference field, then PUT a matter_ handle -> expect 422 with problem.type "validation"
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test -- custom-fields`
Expected: FAIL (route module not found / 404).

- [ ] **Step 3: Implement the route module** (follow the `routes/matters/locations.ts` pattern exactly — one `RouteMeta` + `defineOpenAPIRoute` per endpoint, `chokepointMiddleware`, `runIdempotentEffect`, a `customFieldErrorResponse` mapping `CustomFieldError.code` → status)

```typescript
// apps/worker/src/routes/firm/custom-fields.ts (representative endpoint — repeat the shape for each operation)
import { z } from "@hono/zod-openapi";
import { defineCustomField } from "@magna-carta/custom-fields/custom-field-service";
import { setCustomFieldValue } from "@magna-carta/custom-fields/custom-field-value-service";
import { CustomFieldError } from "@magna-carta/custom-fields/types";
// chokepoint + problem imports as in routes/directory/directory.ts. The service wraps idempotency internally
// (the matters/directory pattern), so the route imports NEITHER runIdempotentEffect NOR canonicalJsonStringify.

const FieldRequest = z
  .object({
    name: z.string().min(1),
    kind: z.enum([
      "checkbox",
      "date",
      "time",
      "number",
      "currency",
      "picklist",
      "single-line",
      "multi-line",
      "url",
      "email",
      "matter-reference",
      "contact-reference",
    ]),
    target: z.enum(["matter", "entity"]),
    attachmentId: z.string().nullable(),
    numberScale: z.number().int().nullable().optional(),
    required: z.boolean().optional(),
  })
  .openapi("CustomFieldRequest");
const IdAck = z.object({ id: z.string() }).openapi("CustomFieldAck");

function customFieldErrorResponse(
  c: Context,
  error: CustomFieldError,
): ProblemResponse<404> | ProblemResponse<409> | ProblemResponse<422> {
  if (error.code === "unknown-field")
    return problemJson(c, {
      type: "not-found",
      title: "Not found",
      status: 404,
      detail: error.message,
    });
  if (error.code === "field-in-use" || error.code === "option-in-use")
    return problemJson(c, {
      type: "conflict",
      title: "In use",
      status: 409,
      detail: error.message,
    });
  if (error.code === "purge-not-yet-enabled")
    return problemJson(c, {
      type: "not-implemented",
      title: "Not enabled",
      status: 409,
      detail: error.message,
    });
  return problemJson(c, {
    type: "validation",
    title: "Invalid custom-field request",
    status: 422,
    detail: error.message,
  });
}

const defineFieldMeta: RouteMeta = {
  operationId: "customFields.defineField",
  surface: "app",
  authenticated: true,
  permission: "customFields:manage",
  resource: "customField",
  audited: true,
  idempotency: "required",
  idempotencyStore: "firm",
  rateLimit: "default",
};
const defineFieldRoute = defineOpenAPIRoute(defineFieldMeta, {
  method: "post",
  path: "/api/v1/custom-fields/fields",
  description: "Defines a custom field on a matter type or entity category.",
  request: {
    headers: idempotencyKeyHeader,
    body: { content: { "application/json": { schema: FieldRequest } }, required: true },
  },
  responses: {
    201: { description: "Created", content: { "application/json": { schema: IdAck } } },
    ...writeErrorResponses,
  },
});

export function registerCustomFieldsRoutes(app: AppType, chokepoint: ChokepointType) {
  app.openapi(
    { ...defineFieldRoute, middleware: chokepointMiddleware(chokepoint, defineFieldRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const body = c.req.valid("json");
      try {
        // The service wraps runIdempotentEffect internally (the matters/directory pattern); the route just
        // calls it and serializes the returned value. Idempotency conflicts (in-progress / fingerprint-mismatch)
        // are surfaced by the chokepoint middleware BEFORE the handler, exactly as for matters/directory.
        const result = await defineCustomField(firm.firmDatabase, body, {
          clock: { now: () => new Date().toISOString() },
          actorUserId: userId,
          idempotency,
        });
        if (result.idempotentReplay) c.header("Idempotency-Replayed", "true");
        return c.json({ id: result.customFieldId } as z.infer<typeof IdAck>, 201);
      } catch (caught) {
        if (caught instanceof CustomFieldError) return customFieldErrorResponse(c, caught);
        throw caught;
      }
    },
  );
  // ... repeat for every operation. Reads (resolveField, listRecordValues) are GET routes with permission: "customFields:manage"
  // for management reads, or null (any authenticated user) for value reads — match the matters/directory precedent.
  // The value PUT route multiplies a currency/number input by 10^number_scale into an integer before calling setCustomFieldValue.
}
```

> **Idempotency wrapping (verified):** follow `apps/worker/src/routes/directory/directory.ts` / `routes/matters/matters.ts`, NOT `routes/matters/locations.ts`. The custom-fields **service** wraps `runIdempotentEffect` internally (Task 4's `runCustomFieldEffect`), so the route calls the service, reads `result.idempotentReplay`, and serializes the plain value with `c.json()`. Do **not** call `runIdempotentEffect` in the handler — that would double-wrap.

- [ ] **Step 4: Mount the routes**

```typescript
// apps/worker/src/app.ts — inside createApp(), with the other register* calls
registerCustomFieldsRoutes(app, chokepoint);
```

- [ ] **Step 5: Regenerate and commit the contract**

Run: `pnpm --filter @magna-carta/worker run emit-openapi && pnpm --filter @magna-carta/api-client run generate`
Then: `pnpm --filter @magna-carta/worker run test -- openapi-snapshot.test.ts`
Expected: PASS (snapshot matches the emitted document).

- [ ] **Step 6: Run the route test to verify it passes**

Run: `pnpm test -- custom-fields`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/worker/src/routes/firm/custom-fields.ts apps/worker/src/app.ts apps/worker/openapi/openapi.json packages/api-client apps/worker/test/custom-fields-routes.test.ts
git commit -m "feat(custom-fields): /v1/custom-fields worker routes and OpenAPI contract"
```

---

## Task 15: Domain fitness functions

**Files:**

- Create: `packages/custom-fields/src/fitness.ts`
- Test: `packages/custom-fields/test/fitness.test.ts`

**Interfaces:**

- Produces: `assertCustomFieldsFitness(database)` — asserts (a) no float column on the three tables (PRAGMA table_info type scan, the ADR-0061 discipline), (b) every primary key is a TEXT handle, (c) the exactly-one-non-null CHECK and partial-unique index exist, (d) no `custom_field_value` row points at a `merged_into` entity (reuses the directory probe shape).

- [ ] **Step 1: Write the failing test**

```typescript
// packages/custom-fields/test/fitness.test.ts
import { migratedFirmDatabase } from "@magna-carta/database/testing";
import { assertCustomFieldsFitness } from "../src/fitness.ts";

it("a freshly migrated database passes custom-fields fitness", async () => {
  const db = await migratedFirmDatabase();
  await expect(assertCustomFieldsFitness(db)).resolves.toBeUndefined();
});

it("fails when a value_number column is declared REAL", async () => {
  // Build a database with a deliberately wrong column type and assert the float scan throws.
  // (Use a scratch in-memory sqlite with a REAL column to prove the guard bites.)
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @magna-carta/custom-fields test`
Expected: FAIL.

- [ ] **Step 3: Implement the fitness checks**

```typescript
// packages/custom-fields/src/fitness.ts
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";

const TABLES = ["custom_field", "picklist_option", "custom_field_value"] as const;

export async function assertCustomFieldsFitness(database: SqlDatabase): Promise<void> {
  for (const table of TABLES) {
    const info = await database
      .prepare(`PRAGMA table_info(${table})`)
      .all<{ name: string; type: string; pk: number }>();
    for (const column of info.results) {
      if (
        column.type.toUpperCase().includes("REAL") ||
        column.type.toUpperCase().includes("FLOAT")
      ) {
        throw new Error(
          `custom-fields fitness: ${table}.${column.name} is a float column (ADR-0061 forbids floats).`,
        );
      }
    }
    const pk = info.results.find((c) => c.pk === 1);
    if (!pk || pk.type.toUpperCase() !== "TEXT")
      throw new Error(`custom-fields fitness: ${table} primary key must be a TEXT handle.`);
  }
  const idx = await database
    .prepare(
      `SELECT name FROM sqlite_master WHERE type='index' AND name='custom_field_value_current_unique_index'`,
    )
    .all();
  if (idx.results.length !== 1)
    throw new Error("custom-fields fitness: the partial-unique current-value index is missing.");
}
```

> Add the no-dangling check by importing and reusing `findDanglingToSubordinate` shape (or assert directly: `SELECT 1 FROM custom_field_value v JOIN directory_organization o ON o.id = v.value_reference_id WHERE o.status = 'merged_into'` returns nothing). Keep it a query over the two reference columns.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @magna-carta/custom-fields test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/custom-fields/src/fitness.ts packages/custom-fields/test/fitness.test.ts
git commit -m "feat(custom-fields): table-wide fitness (no floats, handle PKs, value invariants)"
```

---

## Task 16: Load-profile extension

**Files:**

- Create: `packages/fixtures/src/load-profile/custom-field-generate.ts`
- Create: `packages/fixtures/src/load-profile/custom-field-measurements.ts`
- Modify: `packages/fixtures/src/load-profile/profile.ts` (add `CustomFieldVolume`, bump `version`)
- Modify: `packages/fixtures/src/load-profile/snapshot.ts` (manifest: counts + `customFieldProbes`)
- Modify: `packages/fixtures/src/load-profile/measure-cli.ts` (wire generation + measurements + plan scan)
- Test: existing fixtures suite + a new baseline file under `packages/fixtures/baselines/`

**Interfaces:**

- Consumes: the real write paths `defineCustomField`, `setCustomFieldValue` (Tasks 5, 7).
- Produces: `generateCustomFieldVolume(database, context, volume, options)` → counts + `CustomFieldProbes` (a busiest record id, a sample reference field id); `customFieldMeasurements` (`current-values read`, `reference lookup`, `convert preview scan`, `merge repoint`); `customFieldHotPathPlans`, `CUSTOM_FIELD_PLAN_SCAN_ALLOWLIST = []`.

- [ ] **Step 1: Write the failing test** — the generator produces the configured volume and the probes resolve.

```typescript
// packages/fixtures/test/custom-field-volume.test.ts
import { loadProfileSnapshot } from "../src/load-profile/snapshot.ts";
import { ledgerVolume } from "../src/load-profile/profile.ts";

it("seeds custom-field definitions and values and records probes", async () => {
  const snapshot = await loadProfileSnapshot(ledgerVolume, "test-seed", { allowSeeding: true });
  expect(snapshot.manifest.customFieldDefinitionCount).toBeGreaterThan(0);
  expect(snapshot.manifest.customFieldProbes.busiestRecordId).toMatch(/^matter_/);
  snapshot.close();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @magna-carta/fixtures test -- custom-field-volume`
Expected: FAIL.

- [ ] **Step 3: Implement the generator and measurements** (copy `directory-generate.ts` / `directory-measurements.ts` shape)

- Add `CustomFieldVolume` to `profile.ts` (`fieldsPerMatterType`, `fieldsPerCategory`, `optionsPerPicklist`, `valuesPerRecord`, `historyDepth`, `referenceShare`), add it as a `readonly customFields: CustomFieldVolume` field on `LedgerVolumeProfile`, set values in `ledgerVolume`, scale them in `scaleProfile`, and **bump `ledgerVolume.version`** (this renames the baseline file).
- `custom-field-generate.ts`: define fields on existing matter types and categories, set values on the busiest matters/contacts (through `defineCustomField` / `setCustomFieldValue`), record `customFieldProbes`.
- `custom-field-measurements.ts`: `customFieldMeasurements` running `readCurrentValues(busiestRecordId)`, a `value_reference_id` lookup, a `previewConvert` scan over the busiest field, and a `mergeEntities` repoint at scale; `customFieldHotPathPlans` over those statements; `CUSTOM_FIELD_PLAN_SCAN_ALLOWLIST = []`.
- Wire both into `snapshot.ts` (manifest fields) and `measure-cli.ts` (generation call, `runMeasurements`, `findFullScans`).

- [ ] **Step 4: Run the test, then refresh the baseline**

Run: `pnpm --filter @magna-carta/fixtures test -- custom-field-volume`
Expected: PASS.

Run: `pnpm --filter @magna-carta/fixtures run measure`
Expected: snapshot seeds, no hot-path full scans reported, a new `baselines/ledgerVolume-v<new>.json` is written. **If any custom-field hot path reports a full scan, add the missing index to migration `0012` and re-run** (do not allowlist).

- [ ] **Step 5: Calibrate the caps** — using the measured value-count distribution, confirm `MAX_FIELDS_PER_SCOPE` / `MAX_OPTIONS_PER_FIELD` (Task 9) are comfortably above realistic firm usage and below where the per-record read plan degrades; adjust the constants if the measurement shows otherwise, and note the chosen Convert inline-vs-Queue threshold in `convert.ts`.

- [ ] **Step 6: Commit**

```bash
git add packages/fixtures/src/load-profile packages/fixtures/baselines packages/fixtures/test/custom-field-volume.test.ts packages/custom-fields/src/limits.ts packages/custom-fields/src/convert.ts
git commit -m "feat(custom-fields): extend the load profile with custom-field volume and measurements"
```

---

## Task 17: End-to-end test, per-area docs, and status

**Files:**

- Create: `apps/worker/test/e2e/custom-fields.e2e.test.ts`
- Create: `packages/custom-fields/CLAUDE.md` (from `docs/conventions/area-claude-template.md`)
- Modify: `STATUS.md` (1·4 → Built), `ROADMAP.md` (1·4 Now/Shipped)
- Add the changelog + (if applicable) ADR documentation per golden rule 5 — **fragment-aware** (see Step 3)

**Interfaces:**

- Consumes: the full HTTP surface (Task 14) and the directory merge route.

- [ ] **Step 1: Write the end-to-end test** (the spec's §13 scenario)

```typescript
// apps/worker/test/e2e/custom-fields.e2e.test.ts  (SELF + the test-auth seeding harness, like custom-fields-routes.test.ts)
import { SELF } from "cloudflare:test";
it("define -> set values -> rename -> convert -> merge -> archive -> hard-delete-refused", async () => {
  // seed firm + owner + cookie exactly as the route test; drive everything through SELF.fetch
  // 1. define a picklist + a contact-reference field on a matter type and an entity category
  // 2. set values on a matter and a contact (incl. a contact-reference at a contact)
  // 3. rename a field -> assert the stored value still resolves by handle
  // 4. convert a single-line field to currency with a parked value -> assert no data loss, kind flipped
  // 5. merge two contacts -> assert the contact-reference repointed, owned values survivorship-absorbed, alias resolves
  // 6. archive a field -> values still readable
  // 7. attempt hard-delete of a field with values -> 409 field-in-use
  // Assert each HTTP status and the resulting DB state, mirroring the unit tests but through the chokepoint.
});
```

- [ ] **Step 2: Run it to verify it fails, then implement nothing new** — this test exercises already-built code end-to-end; it fails only if an integration seam is wrong.

Run: `pnpm test -- custom-fields.e2e`
Expected: initially FAIL only if a wiring gap exists; fix the gap (not new features) until PASS.

- [ ] **Step 3: Write the package CLAUDE.md and the changelog/ADR docs**

- Copy `docs/conventions/area-claude-template.md` to `packages/custom-fields/CLAUDE.md`; fill Purpose (the typed-EAV engine), Key files, Local conventions (handle identity; append-and-flip; the merge `onCollision` extension lives in `@magna-carta/directory`), Invariants (exactly-one-non-null, partial-unique, no floats, reference handle validation), Gotchas (currency scaling happens at the route; Convert bulk offload threshold).
- **Changelog + ADRs (golden rule 5):** first check whether the fragment tooling exists — `ls changelog.d docs/decisions/pending 2>/dev/null`.
  - **If those directories exist** (the fragment convention has reached this branch): add `changelog.d/slice-1-4-custom-fields-build.md` and, only if the design ADRs are not already rendered, `docs/decisions/pending/slice-1-4-custom-fields.md`. Do **not** hand-edit `CHANGELOG.md` / `Decision-Log.md`.
  - **If they do not exist** (this branch's base still hand-edits): append a build entry to `CHANGELOG.md` under `[Unreleased] → Added`, exactly as the 1·3 backend-built entry did. The ADRs (0104/0105) were already recorded in the design commit; do not duplicate them.
- `STATUS.md`: set the 1·4 **Built** cell to `[x] Opus 4.8` (+ the model-attribution `*` per the STATUS legend) and **Load profile** to `[x]`; refresh the Notes with the task summary.
- `ROADMAP.md`: move slice 1·4 from _Next_ to _Now_/built per the file's narrative.
- No user docs and no owner manual-verification checklist in this slice (backend only; the checklist rides the 1·4 UI plan after 0·7a/0·7b — the 1·1/1·3 precedent).

- [ ] **Step 4: Full verification**

Run: `pnpm check && pnpm lint:process-refs && pnpm test`
Expected: PASS across TS typecheck, lint, format, the process-reference scan, and every suite (package + Miniflare worker).

- [ ] **Step 5: Commit**

```bash
git add apps/worker/test/e2e/custom-fields.e2e.test.ts packages/custom-fields/CLAUDE.md STATUS.md ROADMAP.md CHANGELOG.md changelog.d 2>/dev/null
git commit -m "test(custom-fields): end-to-end lifecycle; docs and status"
```

---

## Self-Review

**Spec coverage** (each design section → task):

- §1 package placement → Task 3. §2 data model → Task 2 (+ value/option in 6, 7). §3 identity/binding → Tasks 1, 4 (rename), 8 (resolve). §4 value lifecycle/audit → Tasks 7, 8. §5 Convert → Tasks 10, 11. §6 lifecycle/governance (archive/hard-delete/caps) → Tasks 5, 9; §6.4 Purge seam → Task 13. §7 picklist options → Task 6. §8 merge → Task 12. §9 protected seam → **none (intentional)**: §9/§15 keep the firm-facing protected toggle out of scope, so there is no protected custom field to wire or test in v1; the `protectedField` machinery already exists in `@magna-carta/data-access`. §10 API → Task 14. §11 templates seam → Task 2 (the `template_field_key` column ships; nothing else). §12 load profile → Task 16. §13 testing → woven through every task + Tasks 15, 17. §14 docs → Task 17.

**Resolved spec inconsistency:** the spec §13 integration line "a sensitive custom field round-trips through `protectedField`" is dropped — it depends on the protected toggle that §9/§15 defer. Captured here so the implementer does not chase a non-deliverable.

**Placeholder scan:** the cap numbers (Task 9) and the Convert inline-vs-Queue threshold (Tasks 11, 16) are deliberately provisional constants calibrated in Task 16, not unspecified TODOs. The `<OWNER_ROLE_ID>`/`<ADMIN_ROLE_ID>` and `rolePermission_` ids in Task 2 are explicit "copy from `0010_seed-tools-firm-usage.sql` / mint fresh" instructions, not blanks.

**Type consistency:** `CustomFieldWriteOptions` (Task 4) is the single options type threaded through every service; `CustomFieldValueInput` (Task 7) is the tagged value union used by the value service, Convert (Task 11), and the routes; `CustomFieldError.code` strings (Task 3 `CustomFieldErrorCode`) are the single source mapped at the route boundary (Task 14). `runCustomFieldEffect`'s return carries the `effect` shape the routes consume — confirm the directory route's exact wrapping level during Task 14 to avoid a double idempotency wrap (called out in Task 14 Step 3).

**Verified against the codebase (these were open assumptions, now closed):**

- **Data-access subpaths confirmed:** `@magna-carta/data-access/idempotency-statements` (`SqlDatabase`/`SqlStatement`), `/effect-batch` (`BatchDatabase`/`EffectWrite`/`composeEffectBatch`), `/audit-statements` (`domainAuditStatement`), `/run-idempotent-effect` (`runIdempotentEffect`), `/canonical` (`canonicalJsonStringify` — **not** `/canonical-json`), `/protected-fields`.
- **Idempotency is service-internal**, not route-level: the service wraps `runIdempotentEffect` (model `runCustomFieldEffect` on `runMatterEffect`); the route calls the service, reads `result.idempotentReplay`, and serializes with `c.json()` (Tasks 4, 14). This corrected a real double-wrap bug in the first draft.
- **Test harness:** `createMigratedNodeDatabase("per-firm").database` + inline write-options built from `seededRandomSource` (`@magna-carta/identifiers/random`); the local `test/helpers.ts` supplies `migratedFirmDatabase`/`fixtureWriteOptions`. Worker tests use `SELF` from `cloudflare:test` + the `test-auth` seeding helpers (`seedFirm`/`seedCredentialedUser`/`seedFirmKey`/`signInForSessionCookie`) — there is no `appForTest`.
- **Merge:** `now` is captured at `merge.ts:249`; `RepointRecord` already carries the optional `absorbed` flag (no type change); `mergeEntities(context, input)` takes a `DirectoryIdentifierContext` and no third options argument (Task 12).
