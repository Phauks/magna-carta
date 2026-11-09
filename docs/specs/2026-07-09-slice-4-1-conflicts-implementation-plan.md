# Slice 4·1 Conflicts Matching Engine — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a firm-wide conflicts check that surfaces and explains every candidate the Directory corpus can produce, records what was searched in an append-only log, and lets a reviewer disposition each hit — with no scorer and no suppression.

**Architecture:** A new `@magna-carta/conflicts` domain package mirroring `packages/directory`: it validates in memory, composes statements into `composeEffectBatch`, holds no D1 binding, and performs no I/O. It reads the corpus through `packages/directory`'s existing readers, extended additively on the read path only. Three append-only per-firm tables hold the log, enforced by SQLite `RAISE(ABORT)` triggers.

**Tech Stack:** TypeScript, Drizzle ORM (per-firm schema), SQLite/D1, Vitest, Hono (worker routes), `@magna-carta/data-access` effect batches.

## Global Constraints

- **Golden rule 12 — no shorthand.** `newIdentifier`, not `newId`. "the data-access layer", never "the DAL". Spell every name out.
- **Golden rule 13 — no process references in source.** No `ADR-NNNN`, no "spec §N", no "slice 4·1" in code, tests, or OpenAPI `description`s. State the reasoning inline, or cite a concrete file path. The one exception is a forward-looking schedule reference (e.g. "the Content class lands with Discovery").
- **Golden rule 2 — no emojis** anywhere: code, docs, commit messages.
- **Golden rule 7 — no shell for file operations.** Dedicated file tools only.
- **Every mutation writes an `audit_log` row in the same atomic batch**, via a `conflictsAuditStatement` helper mirroring `directoryAuditStatement` (`packages/directory/src/audit.ts:26`).
- **All writes compose the atomic batch.** Never raw D1 outside a statement builder. D1 has no interactive transactions — read everything you need _before_ composing the batch; never plan logic between statements.
- **Idempotency on all write routes**, threaded through a `runConflictsEffect` that delegates to the shared `runDomainEffect` (Task 9B) — never a re-copied seam.
- **No plaintext identifiers ever enter the log.** Identifiers are recorded by `directory_identifier.id` reference only.
- **Soft-delete never applies here.** The three conflicts tables are append-only: no `UPDATE`, no `DELETE`, ever.
- **Test determinism:** inject `clock` and `seededRandomSource`. Note `readEdges` (`packages/directory/src/edges.ts:127`) reads an ambient `new Date()`; the expansion code must not depend on that for determinism — see Task 7.

## Interface Summary

Defined in Task 3, consumed everywhere after. Copied here so any task can be implemented standalone.

```ts
export type SourceClass = "party" | "graph" | "imputation" | "content";
export type Strictness = "balanced" | "over_inclusive";
export type ConflictsTrigger = "preliminary" | "comprehensive" | "new_party" | "periodic_rescan";
export type DispositionKind =
  | "cleared"
  | "waiver_obtained"
  | "wall_erected"
  | "representation_declined";
export type SourceAvailability = "searched" | "unavailable";
export type EvidenceTier = 1 | 2 | 3 | 4;

export interface MatchEvidence {
  readonly identifierTypes: readonly string[]; // blind-index equality hits
  readonly exactNormalizedName: boolean;
  readonly phoneticMatch: boolean;
  readonly trigramMatch: boolean;
}

export interface EdgeStep {
  readonly edgeId: string;
  readonly edgeType: string;
  readonly fromEntityId: string;
  readonly toEntityId: string;
}
```

---

## File Structure

**Create:**

- `packages/conflicts/package.json` — workspace package, exports map mirroring `packages/directory/package.json`
- `packages/conflicts/CLAUDE.md` — area rules
- `packages/conflicts/src/types.ts` — catalogs and shared types (no logic)
- `packages/conflicts/src/settings.ts` — firm policy read + `resolveScope` (the floor)
- `packages/conflicts/src/evidence.ts` — `assignTier` (pure)
- `packages/conflicts/src/expansion.ts` — graph traversal, cycle-safe, path capture
- `packages/conflicts/src/imputation.ts` — identity joins, no similarity
- `packages/conflicts/src/matching.ts` — exact-name probe + adapts directory channels into `MatchEvidence`
- `packages/conflicts/src/statements.ts` — SQL statement builders
- `packages/conflicts/src/audit.ts` — `ConflictsWriteOptions` + `conflictsAuditStatement`
- `packages/conflicts/src/run-conflicts-effect.ts` — the idempotency seam
- `packages/conflicts/src/run-check.ts` — orchestration
- `packages/conflicts/src/disposition.ts` — append-only adjudication writes
- `packages/conflicts/src/fitness.ts` — `assertConflictsFitness`
- `packages/conflicts/src/index.ts` — barrel
- `apps/worker/src/routes/directory/conflicts.ts` — routes
- `packages/database/drizzle/per-firm/<timestamp>_conflicts.sql` — tables + append-only triggers

**Modify:**

- `packages/identifiers/src/registry.ts`, `packages/identifiers/src/types.ts` — three new handle prefixes
- `packages/database/src/per-firm-schema.ts` — three tables (append at end)
- `packages/directory/src/search.ts` — **additive read-path only**: channel provenance + `MatchOptions`
- `packages/directory/package.json` — no change (search already exported)
- `apps/worker/src/app.ts`, `apps/worker/src/per-firm-migrations.ts`
- `packages/access-control/src/registry.ts` — `conflicts:run`, `conflicts:read`, `conflicts:dispose`
- `packages/directory/CLAUDE.md:60` — stale gotcha fix
- `ROADMAP.md`, `status.d/`, `changelog.d/`

---

### Task 1: Identifier handles

**Files:**

- Modify: `packages/identifiers/src/registry.ts:66` (insert alphabetically near `directoryEdge`)
- Modify: `packages/identifiers/src/types.ts:61`
- Test: `packages/identifiers/test/registry.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces: `ConflictsCheckId`, `ConflictsHitId`, `ConflictsDispositionId` branded types; `newIdentifier("conflictsCheck" | "conflictsHit" | "conflictsDisposition", randomSource)`.

- [ ] **Step 1: Write the failing test**

Append to `packages/identifiers/test/registry.test.ts`:

```ts
import { seededRandomSource } from "../src/random.ts";
import { newIdentifier } from "../src/generate.ts";

test("conflicts handles mint with their registered prefixes", () => {
  const randomSource = seededRandomSource("conflicts-handles");
  expect(newIdentifier("conflictsCheck", randomSource)).toMatch(/^conflictsCheck_/);
  expect(newIdentifier("conflictsHit", randomSource)).toMatch(/^conflictsHit_/);
  expect(newIdentifier("conflictsDisposition", randomSource)).toMatch(/^conflictsDisposition_/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @magna-carta/identifiers exec vitest run test/registry.test.ts -t "conflicts handles"`
Expected: FAIL — TypeScript rejects `"conflictsCheck"` as not assignable to the registry key union.

- [ ] **Step 3: Write minimal implementation**

In `packages/identifiers/src/registry.ts`, alongside the existing `directoryEdge: "directoryEdge",` entry:

```ts
  conflictsCheck: "conflictsCheck",
  conflictsHit: "conflictsHit",
  conflictsDisposition: "conflictsDisposition",
```

In `packages/identifiers/src/types.ts`, alongside `DirectoryEdgeId`:

```ts
export type ConflictsCheckId = Identifier<"conflictsCheck">;
export type ConflictsHitId = Identifier<"conflictsHit">;
export type ConflictsDispositionId = Identifier<"conflictsDisposition">;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @magna-carta/identifiers exec vitest run test/registry.test.ts -t "conflicts handles"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/identifiers/src/registry.ts packages/identifiers/src/types.ts packages/identifiers/test/registry.test.ts
git commit -F- <<'EOF'
feat(identifiers): register the three conflicts handle prefixes

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
```

---

### Task 2: The three append-only tables

**Files:**

- Modify: `packages/database/src/per-firm-schema.ts` (append at end of file)
- Create: `packages/database/drizzle/per-firm/20260908T000000_baseline.sql`
- Modify: `apps/worker/src/per-firm-migrations.ts` (register the migration)
- Test: `packages/database/test/conflicts-append-only.test.ts`

**Interfaces:**

- Consumes: Task 1's handle prefixes.
- Produces: tables `conflicts_check`, `conflicts_hit`, `conflicts_disposition`; six `RAISE(ABORT)` triggers named `conflicts_<table>_no_update` / `conflicts_<table>_no_delete`.

**Context:** Drizzle-kit cannot model triggers — the same constraint that forced the FTS5 triggers into hand-written SQL (`packages/directory/CLAUDE.md:57`). Write the migration `.sql` by hand, separating statements with `--> statement-breakpoint`, matching `20260704T041516_baseline.sql`.

`monotonic-migration-ids` is already merged into `main`, so timestamp IDs are the live convention — no restamping risk.

- [ ] **Step 1: Write the failing test**

Create `packages/database/test/conflicts-append-only.test.ts`:

```ts
import { createMigratedNodeDatabase } from "../src/node-sqlite.ts";
import { expect, test } from "vitest";

const INSERT_CHECK = `INSERT INTO conflicts_check
  (id, trigger, subject_matter_id, subject_parties_json, scope_json, strictness, depth, inputs_json, floor_raised, actor_user_id, created_at)
  VALUES ('conflictsCheck_1', 'comprehensive', NULL, '[]', '{}', 'balanced', 1, '{}', 0, NULL, '2026-07-09T00:00:00.000Z')`;

test("conflicts_check rejects UPDATE", () => {
  const { database } = createMigratedNodeDatabase("per-firm");
  database.exec(INSERT_CHECK);
  expect(() =>
    database.exec(`UPDATE conflicts_check SET depth = 2 WHERE id = 'conflictsCheck_1'`),
  ).toThrow(/append-only/);
});

test("conflicts_check rejects DELETE", () => {
  const { database } = createMigratedNodeDatabase("per-firm");
  database.exec(INSERT_CHECK);
  expect(() => database.exec(`DELETE FROM conflicts_check WHERE id = 'conflictsCheck_1'`)).toThrow(
    /append-only/,
  );
});

test("conflicts_hit and conflicts_disposition reject UPDATE and DELETE", () => {
  const { database } = createMigratedNodeDatabase("per-firm");
  database.exec(INSERT_CHECK);
  database.exec(`INSERT INTO conflicts_hit
    (id, check_id, entity_id, source_class, evidence_tier, matched_fields_json, graph_path_json, created_at)
    VALUES ('conflictsHit_1', 'conflictsCheck_1', 'directoryPerson_1', 'party', 1, '{}', '[]', '2026-07-09T00:00:00.000Z')`);
  database.exec(`INSERT INTO conflicts_disposition
    (id, hit_id, kind, rationale, reviewer_user_id, created_at)
    VALUES ('conflictsDisposition_1', 'conflictsHit_1', 'cleared', 'unrelated party', 'user_1', '2026-07-09T00:00:00.000Z')`);

  expect(() => database.exec(`UPDATE conflicts_hit SET evidence_tier = 4`)).toThrow(/append-only/);
  expect(() => database.exec(`DELETE FROM conflicts_hit`)).toThrow(/append-only/);
  expect(() => database.exec(`UPDATE conflicts_disposition SET kind = 'cleared'`)).toThrow(
    /append-only/,
  );
  expect(() => database.exec(`DELETE FROM conflicts_disposition`)).toThrow(/append-only/);
});

test("a reversal is a second disposition row, not an update", () => {
  const { database } = createMigratedNodeDatabase("per-firm");
  database.exec(INSERT_CHECK);
  database.exec(`INSERT INTO conflicts_hit
    (id, check_id, entity_id, source_class, evidence_tier, matched_fields_json, graph_path_json, created_at)
    VALUES ('conflictsHit_1', 'conflictsCheck_1', 'directoryPerson_1', 'party', 1, '{}', '[]', '2026-07-09T00:00:00.000Z')`);
  database.exec(`INSERT INTO conflicts_disposition (id, hit_id, kind, rationale, reviewer_user_id, created_at)
    VALUES ('conflictsDisposition_1', 'conflictsHit_1', 'cleared', 'looked unrelated', 'user_1', '2026-07-09T00:00:00.000Z')`);
  database.exec(`INSERT INTO conflicts_disposition (id, hit_id, kind, rationale, reviewer_user_id, created_at)
    VALUES ('conflictsDisposition_2', 'conflictsHit_1', 'representation_declined', 'on review, adverse', 'user_1', '2026-07-09T01:00:00.000Z')`);

  const rows = database
    .prepare(
      `SELECT kind FROM conflicts_disposition WHERE hit_id = 'conflictsHit_1' ORDER BY created_at ASC`,
    )
    .all() as Array<{ kind: string }>;
  expect(rows.map((r) => r.kind)).toEqual(["cleared", "representation_declined"]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @magna-carta/database exec vitest run test/conflicts-append-only.test.ts`
Expected: FAIL — `no such table: conflicts_check`

- [ ] **Step 3: Write the schema and migration**

Append to `packages/database/src/per-firm-schema.ts`:

```ts
// The conflicts log. Three append-only tables: no UPDATE and no DELETE ever touches them, enforced
// by RAISE(ABORT) triggers in the migration. The log is the compliance artifact a malpractice defense
// rests on — a reviewer who clears a hit and later reverses must leave both acts visible, so a
// reversal is a second disposition row rather than an edit.
export const conflictsCheck = sqliteTable("conflicts_check", {
  id: text("id").primaryKey().$type<ConflictsCheckId>(),
  trigger: text("trigger").notNull(),
  // Null for a pre-consult check against a prospective party set that has no matter yet.
  subjectMatterId: text("subject_matter_id").$type<MatterId>(),
  subjectPartiesJson: text("subject_parties_json").notNull(), // JSON array of entity ids
  // The scope in force: each source class with its availability. An auditor must be able to tell
  // "searched and clean" apart from "never searched".
  scopeJson: text("scope_json").notNull(),
  strictness: text("strictness").notNull(),
  depth: integer("depth").notNull(),
  // Identifiers recorded BY REFERENCE (directory_identifier.id) — never a plaintext value.
  // Also records identifier types skipped as non-indexable, so the log never implies they were searched.
  inputsJson: text("inputs_json").notNull(),
  // 1 when the requested scope fell below the firm floor and was raised to it.
  floorRaised: integer("floor_raised", { mode: "boolean" }).notNull().default(false),
  actorUserId: text("actor_user_id").$type<UserId>(),
  createdAt: text("created_at").notNull(),
});

export const conflictsHit = sqliteTable(
  "conflicts_hit",
  {
    id: text("id").primaryKey().$type<ConflictsHitId>(),
    checkId: text("check_id")
      .notNull()
      .$type<ConflictsCheckId>()
      .references(() => conflictsCheck.id),
    // The merge-resolved master entity, never an archived subordinate.
    entityId: text("entity_id").notNull(),
    sourceClass: text("source_class").notNull(),
    // 1 exact identifier, 2 exact normalized name, 3 phonetic code, 4 trigram overlap only.
    // Ordering only — never a threshold. Nothing is suppressed by tier.
    evidenceTier: integer("evidence_tier").notNull(),
    matchedFieldsJson: text("matched_fields_json").notNull(),
    // The connecting edge path, '[]' when the entity was reached directly.
    graphPathJson: text("graph_path_json").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [index("conflicts_hit_check_id_index").on(table.checkId)],
);

export const conflictsDisposition = sqliteTable(
  "conflicts_disposition",
  {
    id: text("id").primaryKey().$type<ConflictsDispositionId>(),
    hitId: text("hit_id")
      .notNull()
      .$type<ConflictsHitId>()
      .references(() => conflictsHit.id),
    kind: text("kind").notNull(),
    rationale: text("rationale").notNull(),
    reviewerUserId: text("reviewer_user_id").notNull().$type<UserId>(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("conflicts_disposition_hit_id_created_at_index").on(table.hitId, table.createdAt),
  ],
);
```

Import the three branded id types at the top of `per-firm-schema.ts` alongside the existing identifier imports.

Create `packages/database/drizzle/per-firm/20260908T000000_baseline.sql`:

```sql
CREATE TABLE `conflicts_check` (
	`id` text PRIMARY KEY NOT NULL,
	`trigger` text NOT NULL,
	`subject_matter_id` text,
	`subject_parties_json` text NOT NULL,
	`scope_json` text NOT NULL,
	`strictness` text NOT NULL,
	`depth` integer NOT NULL,
	`inputs_json` text NOT NULL,
	`floor_raised` integer DEFAULT 0 NOT NULL,
	`actor_user_id` text,
	`created_at` text NOT NULL,
	CONSTRAINT `conflicts_check_trigger_check` CHECK (length(`trigger`) > 0),
	CONSTRAINT `conflicts_check_strictness_check` CHECK (`strictness` IN ('balanced', 'over_inclusive')),
	CONSTRAINT `conflicts_check_depth_check` CHECK (`depth` >= 0)
);
--> statement-breakpoint
CREATE TABLE `conflicts_hit` (
	`id` text PRIMARY KEY NOT NULL,
	`check_id` text NOT NULL,
	`entity_id` text NOT NULL,
	`source_class` text NOT NULL,
	`evidence_tier` integer NOT NULL,
	`matched_fields_json` text NOT NULL,
	`graph_path_json` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`check_id`) REFERENCES `conflicts_check`(`id`),
	CONSTRAINT `conflicts_hit_tier_check` CHECK (`evidence_tier` BETWEEN 1 AND 4),
	CONSTRAINT `conflicts_hit_source_class_check` CHECK (`source_class` IN ('party', 'graph', 'imputation', 'content'))
);
--> statement-breakpoint
CREATE INDEX `conflicts_hit_check_id_index` ON `conflicts_hit` (`check_id`);
--> statement-breakpoint
CREATE TABLE `conflicts_disposition` (
	`id` text PRIMARY KEY NOT NULL,
	`hit_id` text NOT NULL,
	`kind` text NOT NULL,
	`rationale` text NOT NULL,
	`reviewer_user_id` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`hit_id`) REFERENCES `conflicts_hit`(`id`),
	CONSTRAINT `conflicts_disposition_kind_check` CHECK (`kind` IN ('cleared', 'waiver_obtained', 'wall_erected', 'representation_declined'))
);
--> statement-breakpoint
CREATE INDEX `conflicts_disposition_hit_id_created_at_index` ON `conflicts_disposition` (`hit_id`,`created_at`);
--> statement-breakpoint
CREATE TRIGGER `conflicts_check_no_update` BEFORE UPDATE ON `conflicts_check` BEGIN
  SELECT RAISE(ABORT, 'conflicts_check is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `conflicts_check_no_delete` BEFORE DELETE ON `conflicts_check` BEGIN
  SELECT RAISE(ABORT, 'conflicts_check is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `conflicts_hit_no_update` BEFORE UPDATE ON `conflicts_hit` BEGIN
  SELECT RAISE(ABORT, 'conflicts_hit is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `conflicts_hit_no_delete` BEFORE DELETE ON `conflicts_hit` BEGIN
  SELECT RAISE(ABORT, 'conflicts_hit is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `conflicts_disposition_no_update` BEFORE UPDATE ON `conflicts_disposition` BEGIN
  SELECT RAISE(ABORT, 'conflicts_disposition is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `conflicts_disposition_no_delete` BEFORE DELETE ON `conflicts_disposition` BEGIN
  SELECT RAISE(ABORT, 'conflicts_disposition is append-only');
END;
```

Register the migration in `apps/worker/src/per-firm-migrations.ts`, following the existing entries.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @magna-carta/database exec vitest run test/conflicts-append-only.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/database/src/per-firm-schema.ts packages/database/drizzle/per-firm/20260908T000000_baseline.sql apps/worker/src/per-firm-migrations.ts packages/database/test/conflicts-append-only.test.ts
git commit -F- <<'EOF'
feat(conflicts): add the three append-only log tables

RAISE(ABORT) triggers on UPDATE and DELETE make the log structurally
immutable. A reviewer who clears a hit and later reverses leaves both
acts visible: a reversal is a second disposition row.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
```

---

### Task 3: Package scaffold and catalogs

**Files:**

- Create: `packages/conflicts/package.json`, `packages/conflicts/src/types.ts`, `packages/conflicts/src/index.ts`
- Test: `packages/conflicts/test/types.test.ts`

**Interfaces:**

- Consumes: Task 1's branded ids.
- Produces: every type in the **Interface Summary** above, plus the const catalogs `SOURCE_CLASSES`, `STRICTNESS_LEVELS`, `CONFLICTS_TRIGGERS`, `DISPOSITION_KINDS`.

- [ ] **Step 1: Write the failing test**

Create `packages/conflicts/test/types.test.ts`:

```ts
import { expect, test } from "vitest";
import {
  SOURCE_CLASSES,
  STRICTNESS_LEVELS,
  CONFLICTS_TRIGGERS,
  DISPOSITION_KINDS,
} from "../src/types.ts";

test("the source-class catalog matches the four classes", () => {
  expect([...SOURCE_CLASSES]).toEqual(["party", "graph", "imputation", "content"]);
});

test("the disposition catalog covers every terminal outcome", () => {
  expect([...DISPOSITION_KINDS]).toEqual([
    "cleared",
    "waiver_obtained",
    "wall_erected",
    "representation_declined",
  ]);
});

test("the trigger catalog matches the four documented triggers", () => {
  expect([...CONFLICTS_TRIGGERS]).toEqual([
    "preliminary",
    "comprehensive",
    "new_party",
    "periodic_rescan",
  ]);
});

test("strictness has exactly two levels", () => {
  expect([...STRICTNESS_LEVELS]).toEqual(["balanced", "over_inclusive"]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @magna-carta/conflicts exec vitest run test/types.test.ts`
Expected: FAIL — package does not exist.

- [ ] **Step 3: Write minimal implementation**

Create `packages/conflicts/package.json`:

```json
{
  "name": "@magna-carta/conflicts",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "sideEffects": false,
  "exports": {
    "./types": "./src/types.ts",
    "./settings": "./src/settings.ts",
    "./evidence": "./src/evidence.ts",
    "./expansion": "./src/expansion.ts",
    "./imputation": "./src/imputation.ts",
    "./matching": "./src/matching.ts",
    "./run-check": "./src/run-check.ts",
    "./disposition": "./src/disposition.ts",
    "./statements": "./src/statements.ts",
    "./audit": "./src/audit.ts",
    "./fitness": "./src/fitness.ts"
  },
  "scripts": {
    "test": "vp test run"
  },
  "dependencies": {
    "@magna-carta/access-control": "workspace:*",
    "@magna-carta/data-access": "workspace:*",
    "@magna-carta/database": "workspace:*",
    "@magna-carta/directory": "workspace:*",
    "@magna-carta/identifiers": "workspace:*"
  },
  "devDependencies": {
    "@magna-carta/tsconfig": "workspace:*",
    "@types/node": "catalog:",
    "@magna-carta/encryption": "workspace:*",
    "drizzle-orm": "catalog:",
    "vitest": "catalog:"
  }
}
```

Create `packages/conflicts/src/types.ts`:

```ts
export type {
  ConflictsCheckId,
  ConflictsHitId,
  ConflictsDispositionId,
} from "@magna-carta/identifiers/types";

// The four classes of thing a check can search. They differ in HOW they match, not only in what
// they search: party and graph match by similarity, imputation matches by identity only, and content
// is exact-address equality (email participants) or unstructured mention (bodies, document text).
export const SOURCE_CLASSES = ["party", "graph", "imputation", "content"] as const;
export type SourceClass = (typeof SOURCE_CLASSES)[number];

// Strictness is a recall knob, not a threshold: it selects which channels run and which name rows
// they see. It never suppresses a hit. over_inclusive returns a strict superset of balanced.
export const STRICTNESS_LEVELS = ["balanced", "over_inclusive"] as const;
export type Strictness = (typeof STRICTNESS_LEVELS)[number];

export const CONFLICTS_TRIGGERS = [
  "preliminary",
  "comprehensive",
  "new_party",
  "periodic_rescan",
] as const;
export type ConflictsTrigger = (typeof CONFLICTS_TRIGGERS)[number];

export const DISPOSITION_KINDS = [
  "cleared",
  "waiver_obtained",
  "wall_erected",
  "representation_declined",
] as const;
export type DispositionKind = (typeof DISPOSITION_KINDS)[number];

// "unavailable" is not "clean". A source that could not run must never read as searched-and-empty.
export const SOURCE_AVAILABILITIES = ["searched", "unavailable"] as const;
export type SourceAvailability = (typeof SOURCE_AVAILABILITIES)[number];

// Ordering only. 1 is the strongest evidence. No tier is ever filtered out.
export type EvidenceTier = 1 | 2 | 3 | 4;

// What matched, per candidate. Drives tier assignment and is stored verbatim as the hit's explanation.
export interface MatchEvidence {
  readonly identifierTypes: readonly string[];
  readonly exactNormalizedName: boolean;
  readonly phoneticMatch: boolean;
  readonly trigramMatch: boolean;
}

// One hop of the connecting path from a subject party to a surfaced entity.
export interface EdgeStep {
  readonly edgeId: string;
  readonly edgeType: string;
  readonly fromEntityId: string;
  readonly toEntityId: string;
}
```

Create `packages/conflicts/src/index.ts` re-exporting `./types.ts`.

Run `vp install` to link the new workspace package.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @magna-carta/conflicts exec vitest run test/types.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/conflicts pnpm-lock.yaml
git commit -F- <<'EOF'
feat(conflicts): scaffold the package and its catalogs

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
```

---

### Task 4: Evidence tiering

**Files:**

- Create: `packages/conflicts/src/evidence.ts`
- Test: `packages/conflicts/test/evidence.test.ts`

**Interfaces:**

- Consumes: `MatchEvidence`, `EvidenceTier` from Task 3.
- Produces: `assignTier(evidence: MatchEvidence): EvidenceTier`, `describeEvidence(evidence: MatchEvidence): string[]`.

**Context:** Pure function, no database. This is the whole of what replaced the scorer.

- [ ] **Step 1: Write the failing test**

Create `packages/conflicts/test/evidence.test.ts`:

```ts
import { expect, test } from "vitest";
import { assignTier, describeEvidence } from "../src/evidence.ts";
import type { MatchEvidence } from "../src/types.ts";

const none: MatchEvidence = {
  identifierTypes: [],
  exactNormalizedName: false,
  phoneticMatch: false,
  trigramMatch: false,
};

test("an exact identifier match is tier 1", () => {
  expect(assignTier({ ...none, identifierTypes: ["ssn"] })).toBe(1);
});

test("an exact normalized name is tier 2", () => {
  expect(assignTier({ ...none, exactNormalizedName: true })).toBe(2);
});

test("a phonetic match is tier 3", () => {
  expect(assignTier({ ...none, phoneticMatch: true })).toBe(3);
});

test("trigram overlap alone is tier 4", () => {
  expect(assignTier({ ...none, trigramMatch: true })).toBe(4);
});

test("the strongest evidence wins when several channels agree", () => {
  expect(
    assignTier({
      identifierTypes: ["ein"],
      exactNormalizedName: true,
      phoneticMatch: true,
      trigramMatch: true,
    }),
  ).toBe(1);
});

test("evidence with no signal is tier 4 — a surfaced candidate is never dropped", () => {
  expect(assignTier(none)).toBe(4);
});

test("the explanation lists every channel that matched", () => {
  const description = describeEvidence({
    identifierTypes: ["ssn"],
    exactNormalizedName: false,
    phoneticMatch: true,
    trigramMatch: true,
  });
  expect(description).toEqual([
    "exact identifier match: ssn",
    "phonetic code match",
    "trigram overlap",
  ]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @magna-carta/conflicts exec vitest run test/evidence.test.ts`
Expected: FAIL — `Cannot find module '../src/evidence.ts'`

- [ ] **Step 3: Write minimal implementation**

Create `packages/conflicts/src/evidence.ts`:

```ts
import type { EvidenceTier, MatchEvidence } from "./types.ts";

// Rank a candidate by WHAT KIND of thing matched, not by how probable the match is. A conflicts
// check surfaces candidates for a human to adjudicate; it does not decide. So the ordinal orders the
// reviewer's queue and nothing more — no tier is a threshold, and a candidate with no recorded signal
// still lands at tier 4 rather than disappearing. Suppressing a weak match would convert a missed
// conflict into an invisible one, which is the failure this system exists to prevent.
export function assignTier(evidence: MatchEvidence): EvidenceTier {
  if (evidence.identifierTypes.length > 0) return 1;
  if (evidence.exactNormalizedName) return 2;
  if (evidence.phoneticMatch) return 3;
  return 4;
}

// The human-readable explanation stored on every hit. A reviewer adjudicates on this, and an auditor
// reads it years later, so it lists every channel that fired rather than only the tier-setting one.
export function describeEvidence(evidence: MatchEvidence): string[] {
  const parts: string[] = [];
  for (const identifierType of evidence.identifierTypes) {
    parts.push(`exact identifier match: ${identifierType}`);
  }
  if (evidence.exactNormalizedName) parts.push("exact normalized name match");
  if (evidence.phoneticMatch) parts.push("phonetic code match");
  if (evidence.trigramMatch) parts.push("trigram overlap");
  return parts;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @magna-carta/conflicts exec vitest run test/evidence.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/conflicts/src/evidence.ts packages/conflicts/test/evidence.test.ts
git commit -F- <<'EOF'
feat(conflicts): tier hits by evidence kind, never by score

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
```

---

### Task 5: The firm floor

**Files:**

- Create: `packages/conflicts/src/settings.ts`
- Test: `packages/conflicts/test/settings.test.ts`

**Interfaces:**

- Consumes: `SourceClass`, `Strictness` from Task 3.
- Produces:
  - `interface ConflictsPolicy { readonly floorSources: readonly SourceClass[]; readonly floorStrictness: Strictness; readonly defaultDepth: number }`
  - `interface ScopeRequest { readonly sources: readonly SourceClass[]; readonly strictness: Strictness; readonly depth: number }`
  - `interface ResolvedScope { readonly sources: readonly SourceClass[]; readonly strictness: Strictness; readonly depth: number; readonly floorRaised: boolean }`
  - `resolveScope(policy: ConflictsPolicy, request: ScopeRequest): ResolvedScope`
  - `readConflictsPolicy(database: SqlDatabase): Promise<ConflictsPolicy>` — reads key `conflicts.policy` from the flat `setting` table (`packages/database/src/per-firm-schema.ts:839`), falling back to `DEFAULT_CONFLICTS_POLICY`.
  - `DEFAULT_CONFLICTS_POLICY` — `{ floorSources: ["party"], floorStrictness: "balanced", defaultDepth: 1 }`

**Context:** The floor is the guardrail that makes user-selectable scope safe. Without it, narrowing scope manufactures a clean check. `party` is always in the floor.

- [ ] **Step 1: Write the failing test**

Create `packages/conflicts/test/settings.test.ts`:

```ts
import { expect, test } from "vitest";
import { DEFAULT_CONFLICTS_POLICY, resolveScope, type ConflictsPolicy } from "../src/settings.ts";

const policy: ConflictsPolicy = {
  floorSources: ["party", "graph"],
  floorStrictness: "balanced",
  defaultDepth: 1,
};

test("a request above the floor passes through untouched", () => {
  const resolved = resolveScope(policy, {
    sources: ["party", "graph", "imputation"],
    strictness: "over_inclusive",
    depth: 2,
  });
  expect(resolved.sources).toEqual(["party", "graph", "imputation"]);
  expect(resolved.strictness).toBe("over_inclusive");
  expect(resolved.depth).toBe(2);
  expect(resolved.floorRaised).toBe(false);
});

test("a request below the floor is raised and the raise is recorded", () => {
  const resolved = resolveScope(policy, { sources: ["party"], strictness: "balanced", depth: 1 });
  expect(resolved.sources).toEqual(["party", "graph"]);
  expect(resolved.floorRaised).toBe(true);
});

test("strictness below the floor is raised to the floor", () => {
  const strictPolicy: ConflictsPolicy = { ...policy, floorStrictness: "over_inclusive" };
  const resolved = resolveScope(strictPolicy, {
    sources: ["party", "graph"],
    strictness: "balanced",
    depth: 1,
  });
  expect(resolved.strictness).toBe("over_inclusive");
  expect(resolved.floorRaised).toBe(true);
});

test("party is always in scope even when a caller omits it", () => {
  const resolved = resolveScope(DEFAULT_CONFLICTS_POLICY, {
    sources: [],
    strictness: "balanced",
    depth: 1,
  });
  expect(resolved.sources).toContain("party");
  expect(resolved.floorRaised).toBe(true);
});

test("resolved sources are deterministically ordered", () => {
  const a = resolveScope(policy, {
    sources: ["imputation", "party"],
    strictness: "balanced",
    depth: 1,
  });
  const b = resolveScope(policy, {
    sources: ["party", "imputation"],
    strictness: "balanced",
    depth: 1,
  });
  expect(a.sources).toEqual(b.sources);
});

test("depth below zero is clamped to zero", () => {
  const resolved = resolveScope(policy, {
    sources: ["party", "graph"],
    strictness: "balanced",
    depth: -1,
  });
  expect(resolved.depth).toBe(0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @magna-carta/conflicts exec vitest run test/settings.test.ts`
Expected: FAIL — `Cannot find module '../src/settings.ts'`

- [ ] **Step 3: Write minimal implementation**

Create `packages/conflicts/src/settings.ts`:

```ts
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import { SOURCE_CLASSES, type SourceClass, type Strictness } from "./types.ts";

// The firm's mandatory minimum. A per-run selection may only ADD sources above this floor, never
// subtract below it — otherwise narrowing the scope manufactures a clean check, and the log would
// faithfully record a clean result for a search that never ran. The party class is always in the
// floor: conflicts impute across the whole firm, so the party corpus is not optional.
export interface ConflictsPolicy {
  readonly floorSources: readonly SourceClass[];
  readonly floorStrictness: Strictness;
  readonly defaultDepth: number;
}

export interface ScopeRequest {
  readonly sources: readonly SourceClass[];
  readonly strictness: Strictness;
  readonly depth: number;
}

export interface ResolvedScope {
  readonly sources: readonly SourceClass[];
  readonly strictness: Strictness;
  readonly depth: number;
  // True when the request fell below the floor and was raised. Recorded on the check row so an
  // auditor sees that a narrower scope was asked for and refused.
  readonly floorRaised: boolean;
}

export const DEFAULT_CONFLICTS_POLICY: ConflictsPolicy = {
  floorSources: ["party"],
  floorStrictness: "balanced",
  defaultDepth: 1,
};

const SETTING_KEY = "conflicts.policy";

// over_inclusive is a strict superset of balanced, so it is the higher floor.
const STRICTNESS_RANK: Record<Strictness, number> = { balanced: 0, over_inclusive: 1 };

// Sort by the catalog order so an identical scope always serializes identically into the log.
function orderSources(sources: Iterable<SourceClass>): SourceClass[] {
  const present = new Set(sources);
  return SOURCE_CLASSES.filter((sourceClass) => present.has(sourceClass));
}

export function resolveScope(policy: ConflictsPolicy, request: ScopeRequest): ResolvedScope {
  const requested = new Set(request.sources);
  let floorRaised = false;

  for (const required of policy.floorSources) {
    if (!requested.has(required)) {
      requested.add(required);
      floorRaised = true;
    }
  }

  let strictness = request.strictness;
  if (STRICTNESS_RANK[strictness] < STRICTNESS_RANK[policy.floorStrictness]) {
    strictness = policy.floorStrictness;
    floorRaised = true;
  }

  return {
    sources: orderSources(requested),
    strictness,
    depth: Math.max(0, request.depth),
    floorRaised,
  };
}

// Reads the firm's policy from the flat firm-level setting table, falling back to the in-code default
// when the firm has never configured one.
export async function readConflictsPolicy(database: SqlDatabase): Promise<ConflictsPolicy> {
  const { results } = await database
    .prepare(`SELECT value FROM setting WHERE key = ?1`)
    .bind(SETTING_KEY)
    .all<{ value: string }>();

  const row = results[0];
  if (row === undefined) return DEFAULT_CONFLICTS_POLICY;

  const parsed = JSON.parse(row.value) as Partial<ConflictsPolicy>;
  return {
    floorSources: orderSources(parsed.floorSources ?? DEFAULT_CONFLICTS_POLICY.floorSources),
    floorStrictness: parsed.floorStrictness ?? DEFAULT_CONFLICTS_POLICY.floorStrictness,
    defaultDepth: parsed.defaultDepth ?? DEFAULT_CONFLICTS_POLICY.defaultDepth,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @magna-carta/conflicts exec vitest run test/settings.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/conflicts/src/settings.ts packages/conflicts/test/settings.test.ts
git commit -F- <<'EOF'
feat(conflicts): resolve scope against a firm floor

A per-run selection may only add sources above the floor. Without this,
narrowing the scope manufactures a clean check.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
```

---

### Task 6: Directory read-path extension — channel provenance and match options

**Files:**

- Modify: `packages/directory/src/search.ts:185-206` (`FindDuplicateCandidatesInput`, `DuplicateCandidate`), `:235-323` (the two name channels), `:412-457` (`findDuplicateCandidates`)
- Test: `packages/directory/test/duplicate-candidates.test.ts` (append)

**Interfaces:**

- Consumes: nothing new.
- Produces:
  - `type MatchChannel = "phonetic" | "trigram" | "identifier"`
  - `interface MatchOptions { readonly schemes?: readonly string[]; readonly nameRoles?: readonly string[] }`
  - `DuplicateCandidate` gains `readonly channels: readonly MatchChannel[]` and `readonly identifierTypes: readonly string[]`. `signalCount` stays and equals `channels.length` — existing callers are unaffected.
  - `FindDuplicateCandidatesInput` gains `readonly matchOptions?: MatchOptions`.

**Context — why this task exists.** The spec says the engine consumes the Directory corpus without changing it. That is true of the _write_ path, but two additive _read_-path changes are required:

1. `findDuplicateCandidates` returns only `{entityId, signalCount}` (`search.ts:203-206`). Evidence tiering needs to know _which_ channel matched, so provenance must come back.
2. `phoneticChannel` matches `pc.code IN (...)` with **no scheme filter** (`search.ts:264`), and neither name channel filters `is_current` — so primary and secondary Double Metaphone are already blended, and alias/former names are already always included. Balanced strictness needs both filters, which do not exist today.

Both changes are backward compatible. Omitting `matchOptions` preserves today's behaviour exactly, so `merge.ts` and the entry-time duplicate check keep working unchanged.

- [ ] **Step 1: Write the failing test**

Append to `packages/directory/test/duplicate-candidates.test.ts`:

```ts
test("a candidate reports which channels matched it", async () => {
  const { ctx } = await directoryTestContext("provenance");
  await createPerson(ctx.database, { given: "Catherine", family: "Smith" }, ctx);

  const candidates = await findDuplicateCandidates(ctx, {
    kind: "person",
    given: "Catherine",
    family: "Smith",
  });

  expect(candidates).toHaveLength(1);
  expect(candidates[0].channels).toEqual(expect.arrayContaining(["phonetic", "trigram"]));
  expect(candidates[0].signalCount).toBe(candidates[0].channels.length);
});

test("an identifier hit reports its identifier type", async () => {
  const { ctx } = await directoryTestContext("identifier-provenance");
  const personId = await createPerson(ctx.database, { given: "Jane", family: "Roe" }, ctx);
  await addIdentifier(ctx, { entityId: personId, type: "ssn", value: "123-45-6789" });

  const candidates = await findDuplicateCandidates(ctx, {
    kind: "person",
    given: "Unrelated",
    family: "Name",
    identifiers: [{ type: "ssn", value: "123456789" }],
  });

  const hit = candidates.find((candidate) => candidate.entityId === personId);
  expect(hit?.channels).toContain("identifier");
  expect(hit?.identifierTypes).toEqual(["ssn"]);
});

test("restricting schemes narrows the phonetic channel", async () => {
  const { ctx } = await directoryTestContext("scheme-filter");
  await createPerson(ctx.database, { given: "Jon", family: "Smyth" }, ctx);

  const wide = await findDuplicateCandidates(ctx, {
    kind: "person",
    given: "John",
    family: "Smith",
  });
  const narrow = await findDuplicateCandidates(ctx, {
    kind: "person",
    given: "John",
    family: "Smith",
    matchOptions: { schemes: ["double_metaphone_primary"] },
  });

  // Narrowing can only remove candidates, never add them.
  const wideIds = new Set(wide.map((candidate) => candidate.entityId));
  for (const candidate of narrow) expect(wideIds.has(candidate.entityId)).toBe(true);
});

test("omitting matchOptions preserves the existing behaviour", async () => {
  const { ctx } = await directoryTestContext("backward-compatible");
  await createPerson(ctx.database, { given: "Catherine", family: "Smith" }, ctx);

  const candidates = await findDuplicateCandidates(ctx, {
    kind: "person",
    given: "Cathrine",
    family: "Smith",
  });
  expect(candidates.length).toBeGreaterThan(0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @magna-carta/directory exec vitest run test/duplicate-candidates.test.ts -t "channels"`
Expected: FAIL — `channels` is `undefined` on `DuplicateCandidate`.

- [ ] **Step 3: Write minimal implementation**

In `packages/directory/src/search.ts`:

Add the types near `DuplicateCandidate`:

```ts
// Which blocking channel surfaced a candidate. Consumers rank a candidate by what kind of thing
// matched — an exact identifier is categorically stronger evidence than trigram overlap — so the
// channel that fired travels with the result rather than being collapsed into a count.
export type MatchChannel = "phonetic" | "trigram" | "identifier";

// Narrows the name channels. Omitted means "every scheme, every name role", which is the behaviour
// this function has always had: all phonetic schemes are blended and alias/former names are always
// searched. Supplying these restricts recall — it can only remove candidates, never add them.
export interface MatchOptions {
  readonly schemes?: readonly string[];
  readonly nameRoles?: readonly string[];
}
```

Extend `DuplicateCandidate`:

```ts
export interface DuplicateCandidate {
  readonly entityId: string;
  readonly signalCount: number;
  readonly channels: readonly MatchChannel[];
  readonly identifierTypes: readonly string[];
}
```

Extend `FindDuplicateCandidatesInput` with `readonly matchOptions?: MatchOptions;`.

In `phoneticChannel`, when `input.matchOptions?.schemes` is present, add `AND pc.scheme IN (...)` with bound placeholders. When `input.matchOptions?.nameRoles` is present, add `AND dn.name_role IN (...)` to both `phoneticChannel` and `trigramChannel`.

Change `identifierChannel` to return `Map<string, string[]>` (entity id to matched identifier types) rather than `Set<string>`, so the type survives to the result.

In `findDuplicateCandidates`, replace the `signalCounts: Map<string, number>` tally with a `Map<string, { channels: Set<MatchChannel>; identifierTypes: Set<string> }>`, then project:

```ts
const candidates: DuplicateCandidate[] = [...signals.entries()]
  .map(([entityId, signal]) => ({
    entityId,
    signalCount: signal.channels.size,
    channels: [...signal.channels].sort(),
    identifierTypes: [...signal.identifierTypes].sort(),
  }))
  .sort((a, b) => b.signalCount - a.signalCount || a.entityId.localeCompare(b.entityId));
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @magna-carta/directory exec vitest run test/duplicate-candidates.test.ts test/merge.test.ts test/search.test.ts`
Expected: PASS — including every pre-existing test, proving backward compatibility.

- [ ] **Step 5: Commit**

```bash
git add packages/directory/src/search.ts packages/directory/test/duplicate-candidates.test.ts
git commit -F- <<'EOF'
feat(directory): return channel provenance from duplicate candidates

A consumer ranking a candidate needs to know what kind of thing matched,
not just how many channels fired. Adds an optional MatchOptions to
restrict phonetic schemes and name roles; omitting it preserves the
existing behaviour exactly.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
```

---

### Task 7: Graph expansion

**Files:**

- Create: `packages/conflicts/src/expansion.ts`
- Test: `packages/conflicts/test/expansion.test.ts`

**Interfaces:**

- Consumes: `readEdges` (`packages/directory/src/edges.ts:123`), `EdgeStep` from Task 3.
- Produces:
  - `interface ExpandedEntity { readonly entityId: string; readonly path: readonly EdgeStep[] }`
  - `expandGraph(database: BatchDatabase, seedEntityIds: readonly string[], depth: number): Promise<ExpandedEntity[]>`
  - `CORPORATE_EDGE_TYPES` — `["corporate_parent", "corporate_subsidiary", "corporate_successor"]`

**Context:** Breadth-first, cycle-safe. Seeds are returned at depth 0 with an empty path. Corporate-family edges are traversed **transitively regardless of the depth limit** — a rename, merger, or successor must still match, and stopping a corporate chain at one hop would miss exactly the entity a conflicts check exists to find. Every other edge type obeys `depth`.

`readEdges` reads an ambient `new Date()` (`packages/directory/src/edges.ts:127`); tests must therefore not create edges with a `valid_to` near the test instant.

- [ ] **Step 1: Write the failing test**

Create `packages/conflicts/test/expansion.test.ts`:

```ts
import { createMigratedNodeDatabase } from "@magna-carta/database/node-sqlite";
import type { BatchDatabase } from "@magna-carta/data-access/effect-batch";
import { seededRandomSource } from "@magna-carta/identifiers/random";
import type { UserId } from "@magna-carta/identifiers/types";
import { createPerson } from "@magna-carta/directory/person";
import { createOrganization } from "@magna-carta/directory/organization";
import { createEdge } from "@magna-carta/directory/edges";
import { expect, test } from "vitest";
import { expandGraph } from "../src/expansion.ts";

const clock = { now: () => "2026-07-09T00:00:00.000Z" };
const ACTOR = "user_actor" as UserId;

function writeOptions(seed: string) {
  return { clock, actorUserId: ACTOR, randomSource: seededRandomSource(seed) };
}

async function graphDatabase(): Promise<BatchDatabase> {
  const { database } = createMigratedNodeDatabase("per-firm");
  return database as unknown as BatchDatabase;
}

test("a seed with no edges expands to itself at depth zero", async () => {
  const database = await graphDatabase();
  const options = writeOptions("solo");
  const personId = await createPerson(database, { given: "Solo", family: "Party" }, options);

  const expanded = await expandGraph(database, [personId], 1);
  expect(expanded).toEqual([{ entityId: personId, path: [] }]);
});

test("depth one reaches an org's principal and records the connecting path", async () => {
  const database = await graphDatabase();
  const options = writeOptions("principal");
  const orgId = await createOrganization(database, { legalName: "ABC Holdings" }, options);
  const principalId = await createPerson(database, { given: "Ada", family: "Principal" }, options);
  await createEdge(
    database,
    {
      from: principalId,
      to: orgId,
      edgeType: "affiliation",
      role: "principal",
      note: null,
      validFrom: null,
      validTo: null,
    },
    options,
  );

  const expanded = await expandGraph(database, [orgId], 1);
  const reached = expanded.find((entity) => entity.entityId === principalId);
  expect(reached).toBeDefined();
  expect(reached?.path).toHaveLength(1);
  expect(reached?.path[0].edgeType).toBe("affiliation");
});

test("depth zero expands to the seeds only", async () => {
  const database = await graphDatabase();
  const options = writeOptions("depth-zero");
  const orgId = await createOrganization(database, { legalName: "ABC Holdings" }, options);
  const principalId = await createPerson(database, { given: "Ada", family: "Principal" }, options);
  await createEdge(
    database,
    {
      from: principalId,
      to: orgId,
      edgeType: "affiliation",
      role: "principal",
      note: null,
      validFrom: null,
      validTo: null,
    },
    options,
  );

  const expanded = await expandGraph(database, [orgId], 0);
  expect(expanded.map((entity) => entity.entityId)).toEqual([orgId]);
});

test("corporate-family edges traverse transitively past the depth limit", async () => {
  const database = await graphDatabase();
  const options = writeOptions("corporate-closure");
  const parentId = await createOrganization(database, { legalName: "Parent Co" }, options);
  const childId = await createOrganization(database, { legalName: "Child Co" }, options);
  const grandchildId = await createOrganization(database, { legalName: "Grandchild Co" }, options);
  await createEdge(
    database,
    {
      from: parentId,
      to: childId,
      edgeType: "corporate_subsidiary",
      role: null,
      note: null,
      validFrom: null,
      validTo: null,
    },
    options,
  );
  await createEdge(
    database,
    {
      from: childId,
      to: grandchildId,
      edgeType: "corporate_subsidiary",
      role: null,
      note: null,
      validFrom: null,
      validTo: null,
    },
    options,
  );

  // depth 1 would stop at childId for an ordinary edge type; corporate closure reaches the grandchild.
  const expanded = await expandGraph(database, [parentId], 1);
  expect(expanded.map((entity) => entity.entityId)).toContain(grandchildId);
});

test("a cycle terminates and records the first path found", async () => {
  const database = await graphDatabase();
  const options = writeOptions("cycle");
  const a = await createOrganization(database, { legalName: "Alpha" }, options);
  const b = await createOrganization(database, { legalName: "Beta" }, options);
  await createEdge(
    database,
    {
      from: a,
      to: b,
      edgeType: "corporate_subsidiary",
      role: null,
      note: null,
      validFrom: null,
      validTo: null,
    },
    options,
  );
  await createEdge(
    database,
    {
      from: b,
      to: a,
      edgeType: "corporate_parent",
      role: null,
      note: null,
      validFrom: null,
      validTo: null,
    },
    options,
  );

  const expanded = await expandGraph(database, [a], 5);
  expect(expanded.map((entity) => entity.entityId).sort()).toEqual([a, b].sort());
});

test("expansion is deterministic across runs", async () => {
  const database = await graphDatabase();
  const options = writeOptions("determinism");
  const orgId = await createOrganization(database, { legalName: "ABC Holdings" }, options);
  const first = await createPerson(database, { given: "Ada", family: "One" }, options);
  const second = await createPerson(database, { given: "Bea", family: "Two" }, options);
  await createEdge(
    database,
    {
      from: first,
      to: orgId,
      edgeType: "affiliation",
      role: null,
      note: null,
      validFrom: null,
      validTo: null,
    },
    options,
  );
  await createEdge(
    database,
    {
      from: second,
      to: orgId,
      edgeType: "affiliation",
      role: null,
      note: null,
      validFrom: null,
      validTo: null,
    },
    options,
  );

  const a = await expandGraph(database, [orgId], 1);
  const b = await expandGraph(database, [orgId], 1);
  expect(a.map((entity) => entity.entityId)).toEqual(b.map((entity) => entity.entityId));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @magna-carta/conflicts exec vitest run test/expansion.test.ts`
Expected: FAIL — `Cannot find module '../src/expansion.ts'`

- [ ] **Step 3: Write minimal implementation**

Create `packages/conflicts/src/expansion.ts`:

```ts
import type { BatchDatabase } from "@magna-carta/data-access/effect-batch";
import { readEdges } from "@magna-carta/directory/edges";
import type { EdgeStep } from "./types.ts";

// An entity reached from a subject party, with the edges that connected it. The path is the hit's
// explanation: a reviewer must see WHY an entity surfaced, not merely that it did.
export interface ExpandedEntity {
  readonly entityId: string;
  readonly path: readonly EdgeStep[];
}

// Corporate-family edges are traversed transitively, regardless of the depth limit. A rename, merger,
// or successor entity must still match — stopping a corporate chain at the hop limit would miss
// exactly the entity the search exists to find. Every other edge type obeys depth.
export const CORPORATE_EDGE_TYPES: readonly string[] = [
  "corporate_parent",
  "corporate_subsidiary",
  "corporate_successor",
];

export async function expandGraph(
  database: BatchDatabase,
  seedEntityIds: readonly string[],
  depth: number,
): Promise<ExpandedEntity[]> {
  const visited = new Map<string, readonly EdgeStep[]>();
  // Breadth-first so the first path found to an entity is a shortest one.
  const queue: Array<{ entityId: string; path: readonly EdgeStep[]; hops: number }> = [];

  for (const seedEntityId of seedEntityIds) {
    if (visited.has(seedEntityId)) continue;
    visited.set(seedEntityId, []);
    queue.push({ entityId: seedEntityId, path: [], hops: 0 });
  }

  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) break;

    const edges = await readEdges(database, current.entityId as never);
    // Sort so traversal order does not depend on the database's row order.
    const ordered = [...edges].sort((a, b) => a.id.localeCompare(b.id));

    for (const edge of ordered) {
      const isCorporate = CORPORATE_EDGE_TYPES.includes(edge.edgeType);
      // A non-corporate edge may only be walked while hops remain.
      if (!isCorporate && current.hops >= depth) continue;

      const neighbourId =
        edge.fromEntityId === current.entityId ? edge.toEntityId : edge.fromEntityId;
      if (visited.has(neighbourId)) continue;

      const step: EdgeStep = {
        edgeId: edge.id,
        edgeType: edge.edgeType,
        fromEntityId: edge.fromEntityId,
        toEntityId: edge.toEntityId,
      };
      const path = [...current.path, step];
      visited.set(neighbourId, path);
      // A corporate hop does not consume the depth budget; every other hop does.
      queue.push({
        entityId: neighbourId,
        path,
        hops: isCorporate ? current.hops : current.hops + 1,
      });
    }
  }

  return [...visited.entries()]
    .map(([entityId, path]) => ({ entityId, path }))
    .sort((a, b) => a.path.length - b.path.length || a.entityId.localeCompare(b.entityId));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @magna-carta/conflicts exec vitest run test/expansion.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/conflicts/src/expansion.ts packages/conflicts/test/expansion.test.ts
git commit -F- <<'EOF'
feat(conflicts): expand the related-party graph, cycle-safe

Corporate-family edges traverse transitively past the depth limit: a
successor or renamed entity must still match.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
```

---

### Task 8: Imputation by identity join

**Files:**

- Create: `packages/conflicts/src/imputation.ts`
- Test: `packages/conflicts/test/imputation.test.ts`

**Interfaces:**

- Consumes: nothing from earlier tasks beyond types.
- Produces:
  - `interface ImputationHit { readonly memberUserId: string; readonly entityId: string; readonly matterId: string; readonly role: string }`
  - `findImputationHits(database: SqlDatabase, subjectMatterIds: readonly string[]): Promise<ImputationHit[]>`

**Context — the most important test in this plan.** Firm personnel are not Directory entities: `member` carries a flat `display_name` (`packages/database/src/per-firm-schema.ts:118`) with no `directory_name` row, no phonetic code, and no FTS entry. They are structurally invisible to the similarity channels, and that is correct. A partner sharing a surname with a client is not a conflict — a firm named "Smith Law" would otherwise hit every client named Smith on every check, forever.

The real question is an identity question: _is one of our own people a party to some matter?_ That resolves by join — `member.user_id` to `directory_person.member_id` to `matter_party`. A lawyer who is genuinely a party already exists as an ordinary Directory entity with an optional `member_id` link, and is matched by the party class like anyone else.

**This module must never call `findDuplicateCandidates`, `phoneticCodes`, or `normalizeName`.**

- [ ] **Step 1: Write the failing test**

Create `packages/conflicts/test/imputation.test.ts`:

```ts
import { createMigratedNodeDatabase } from "@magna-carta/database/node-sqlite";
import type { BatchDatabase } from "@magna-carta/data-access/effect-batch";
import { seededRandomSource } from "@magna-carta/identifiers/random";
import type { UserId } from "@magna-carta/identifiers/types";
import { createPerson } from "@magna-carta/directory/person";
import { linkMatterParty } from "@magna-carta/directory/party";
import { expect, test } from "vitest";
import { findImputationHits } from "../src/imputation.ts";

const clock = { now: () => "2026-07-09T00:00:00.000Z" };
const ACTOR = "user_actor" as UserId;
const MATTER = "matter_1";

function writeOptions(seed: string) {
  return { clock, actorUserId: ACTOR, randomSource: seededRandomSource(seed) };
}

async function imputationDatabase(): Promise<BatchDatabase> {
  const { database } = createMigratedNodeDatabase("per-firm");
  database.exec(
    `INSERT INTO matter (id, title, status, created_at, updated_at) VALUES ('${MATTER}', 'Test Matter', 'open', '${clock.now()}', '${clock.now()}')`,
  );
  return database as unknown as BatchDatabase;
}

test("a member linked to a matter party surfaces as an imputation hit", async () => {
  const database = await imputationDatabase();
  const options = writeOptions("member-is-party");
  database.exec(
    `INSERT INTO member (user_id, display_name, status, created_at) VALUES ('user_partner', 'Ada Partner', 'active', '${clock.now()}')`,
  );
  const personId = await createPerson(database, { given: "Ada", family: "Partner" }, options);
  database.exec(`UPDATE directory_person SET member_id = 'user_partner' WHERE id = '${personId}'`);
  await linkMatterParty(
    database,
    { matterId: MATTER, entityId: personId, role: "opposing_party" },
    options,
  );

  const hits = await findImputationHits(database, [MATTER]);
  expect(hits).toHaveLength(1);
  expect(hits[0].memberUserId).toBe("user_partner");
  expect(hits[0].role).toBe("opposing_party");
});

// The "Smith Law" regression: a firm partner sharing a surname with a client is not a conflict.
// Imputation matches by identity, never by name similarity.
test("a member whose name merely resembles a party produces no imputation hit", async () => {
  const database = await imputationDatabase();
  const options = writeOptions("smith-law");
  database.exec(
    `INSERT INTO member (user_id, display_name, status, created_at) VALUES ('user_founder', 'John Smith', 'active', '${clock.now()}')`,
  );
  // A client with the same surname, NOT linked to any member.
  const clientId = await createPerson(database, { given: "Jane", family: "Smith" }, options);
  await linkMatterParty(
    database,
    { matterId: MATTER, entityId: clientId, role: "client" },
    options,
  );

  const hits = await findImputationHits(database, [MATTER]);
  expect(hits).toEqual([]);
});

test("a deactivated member still imputes", async () => {
  const database = await imputationDatabase();
  const options = writeOptions("deactivated");
  database.exec(
    `INSERT INTO member (user_id, display_name, status, created_at) VALUES ('user_former', 'Bea Former', 'deactivated', '${clock.now()}')`,
  );
  const personId = await createPerson(database, { given: "Bea", family: "Former" }, options);
  database.exec(`UPDATE directory_person SET member_id = 'user_former' WHERE id = '${personId}'`);
  await linkMatterParty(
    database,
    { matterId: MATTER, entityId: personId, role: "witness" },
    options,
  );

  // Rule 1.10 imputation does not lapse when a lawyer leaves; the conflict remains the firm's.
  const hits = await findImputationHits(database, [MATTER]);
  expect(hits).toHaveLength(1);
});

test("a soft-deleted matter party does not impute", async () => {
  const database = await imputationDatabase();
  const options = writeOptions("soft-deleted");
  database.exec(
    `INSERT INTO member (user_id, display_name, status, created_at) VALUES ('user_partner', 'Ada Partner', 'active', '${clock.now()}')`,
  );
  const personId = await createPerson(database, { given: "Ada", family: "Partner" }, options);
  database.exec(`UPDATE directory_person SET member_id = 'user_partner' WHERE id = '${personId}'`);
  await linkMatterParty(
    database,
    { matterId: MATTER, entityId: personId, role: "client" },
    options,
  );
  database.exec(
    `UPDATE matter_party SET deleted_at = '${clock.now()}' WHERE matter_id = '${MATTER}'`,
  );

  const hits = await findImputationHits(database, [MATTER]);
  expect(hits).toEqual([]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @magna-carta/conflicts exec vitest run test/imputation.test.ts`
Expected: FAIL — `Cannot find module '../src/imputation.ts'`

- [ ] **Step 3: Write minimal implementation**

Create `packages/conflicts/src/imputation.ts`:

```ts
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";

// One of the firm's own people, found on a matter as a party. This is what imputation means: the
// conflict belongs to the firm, not to the individual lawyer.
export interface ImputationHit {
  readonly memberUserId: string;
  readonly entityId: string;
  readonly matterId: string;
  readonly role: string;
}

// Imputation matches by IDENTITY, never by name similarity.
//
// Firm personnel carry a flat display name with no phonetic code and no full-text index entry, so they
// are invisible to the similarity channels by construction. Fuzzy-matching them would be pure noise: a
// firm named "Smith Law" would hit every client named Smith, on every check, forever, and a partner
// sharing a surname with a client is not a conflict. The conflict is the partner BEING a party — which
// is an identity join through the optional member_id link on the directory entity.
//
// A lawyer who is genuinely a party is an ordinary directory entity, matched by the party class like
// anyone else. This function must never call the similarity matchers.
//
// A deactivated member still imputes: a conflict does not lapse when a lawyer leaves the firm.
export async function findImputationHits(
  database: SqlDatabase,
  subjectMatterIds: readonly string[],
): Promise<ImputationHit[]> {
  if (subjectMatterIds.length === 0) return [];

  const placeholders = subjectMatterIds.map((_, index) => `?${index + 1}`).join(", ");
  const { results } = await database
    .prepare(
      `SELECT m.user_id AS member_user_id, dp.id AS entity_id, mp.matter_id AS matter_id, mp.role AS role
       FROM matter_party AS mp
       JOIN directory_person AS dp ON dp.id = mp.entity_id
       JOIN member AS m ON m.user_id = dp.member_id
       WHERE mp.matter_id IN (${placeholders})
         AND mp.deleted_at IS NULL
         AND dp.deleted_at IS NULL
       ORDER BY m.user_id ASC, mp.matter_id ASC, mp.role ASC`,
    )
    .bind(...subjectMatterIds)
    .all<{ member_user_id: string; entity_id: string; matter_id: string; role: string }>();

  return results.map((row) => ({
    memberUserId: row.member_user_id,
    entityId: row.entity_id,
    matterId: row.matter_id,
    role: row.role,
  }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @magna-carta/conflicts exec vitest run test/imputation.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/conflicts/src/imputation.ts packages/conflicts/test/imputation.test.ts
git commit -F- <<'EOF'
feat(conflicts): impute through identity joins, never name similarity

A firm named "Smith Law" must not hit every client named Smith. Personnel
carry no phonetic code by construction; the real question is whether one
of our own people IS a party, which is a join.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
```

---

### Task 9: Matching adapter — exact-name probe and strictness

**Files:**

- Create: `packages/conflicts/src/matching.ts`
- Test: `packages/conflicts/test/matching.test.ts`

**Interfaces:**

- Consumes: `findDuplicateCandidates` + `MatchOptions` (Task 6), `normalizeName` (`packages/directory/src/normalize-name.ts`), `MatchEvidence` (Task 3), `Strictness` (Task 3).
- Produces:
  - `interface CandidateMatch { readonly entityId: string; readonly evidence: MatchEvidence }`
  - `matchOptionsFor(strictness: Strictness): MatchOptions`
  - `matchParty(context: DirectoryIdentifierContext, input: MatchPartyInput, strictness: Strictness): Promise<CandidateMatch[]>`
  - `interface MatchPartyInput { readonly kind: "person" | "organization"; readonly given?: string; readonly family?: string; readonly legalName?: string; readonly identifiers?: ReadonlyArray<{ type: string; value: string }>; readonly excludeEntityId?: string }`

**Context:** `balanced` restricts the phonetic channel to `double_metaphone_primary` and the name channels to the `current` name role. `over_inclusive` passes no restriction, which is today's always-on behaviour: both metaphone schemes and every name role. This makes `over_inclusive` a **strict superset** of `balanced` by construction — the invariant tested below, and the structural guarantee that no strictness setting can hide a hit.

Tier 2 (exact normalized name) has no channel in the Directory package, so this module probes `directory_name.normalized_display` directly.

- [ ] **Step 1: Write the failing test**

Create `packages/conflicts/test/matching.test.ts`:

```ts
import { expect, test } from "vitest";
import { matchOptionsFor } from "../src/matching.ts";

test("balanced restricts to the primary metaphone scheme and current names", () => {
  const options = matchOptionsFor("balanced");
  expect(options.schemes).toEqual(["double_metaphone_primary"]);
  expect(options.nameRoles).toEqual(["current"]);
});

test("over_inclusive restricts nothing, so it is a strict superset of balanced", () => {
  const options = matchOptionsFor("over_inclusive");
  expect(options.schemes).toBeUndefined();
  expect(options.nameRoles).toBeUndefined();
});
```

Create the integration half in the same file (requires the directory test harness — copy `directoryTestContext` from `packages/directory/test/duplicate-candidates.test.ts:33-56`):

```ts
test("over_inclusive returns a superset of balanced for the same corpus", async () => {
  const { ctx } = await conflictsTestContext("superset");
  await createPerson(ctx.database, { given: "Catherine", family: "Smith" }, ctx);
  const renamed = await createPerson(ctx.database, { given: "Mary", family: "Jones" }, ctx);
  await changeName(
    ctx.database,
    { entityId: renamed, given: "Mary", family: "Smith", nameRole: "former" },
    ctx,
  );

  const balanced = await matchParty(
    ctx,
    { kind: "person", given: "Catherine", family: "Smith" },
    "balanced",
  );
  const wide = await matchParty(
    ctx,
    { kind: "person", given: "Catherine", family: "Smith" },
    "over_inclusive",
  );

  const wideIds = new Set(wide.map((match) => match.entityId));
  for (const match of balanced) {
    expect(wideIds.has(match.entityId)).toBe(true);
  }
  expect(wide.length).toBeGreaterThanOrEqual(balanced.length);
});

test("an exact normalized-name match is reported as such", async () => {
  const { ctx } = await conflictsTestContext("exact-name");
  await createPerson(ctx.database, { given: "Catherine", family: "Smith" }, ctx);

  const matches = await matchParty(
    ctx,
    { kind: "person", given: "Catherine", family: "Smith" },
    "balanced",
  );
  expect(matches[0].evidence.exactNormalizedName).toBe(true);
});

test("a weak trigram-only match still appears at every strictness", async () => {
  const { ctx } = await conflictsTestContext("no-suppression");
  await createPerson(ctx.database, { given: "Bartholomew", family: "Cathermore" }, ctx);

  for (const strictness of ["balanced", "over_inclusive"] as const) {
    const matches = await matchParty(
      ctx,
      { kind: "person", given: "Cather", family: "More" },
      strictness,
    );
    // Nothing is ever suppressed by tier — a weak candidate is surfaced, not dropped.
    expect(matches.length).toBeGreaterThan(0);
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @magna-carta/conflicts exec vitest run test/matching.test.ts`
Expected: FAIL — `Cannot find module '../src/matching.ts'`

- [ ] **Step 3: Write minimal implementation**

Create `packages/conflicts/src/matching.ts`:

```ts
import { findDuplicateCandidates, type MatchOptions } from "@magna-carta/directory/search";
import type { DirectoryIdentifierContext } from "@magna-carta/directory/identifiers";
import { normalizeName } from "@magna-carta/directory/normalize-name";
import type { MatchEvidence, Strictness } from "./types.ts";

export interface MatchPartyInput {
  readonly kind: "person" | "organization";
  readonly given?: string;
  readonly family?: string;
  readonly legalName?: string;
  readonly identifiers?: ReadonlyArray<{ type: string; value: string }>;
  readonly excludeEntityId?: string;
}

export interface CandidateMatch {
  readonly entityId: string;
  readonly evidence: MatchEvidence;
}

// Strictness selects which channels run and which name rows they see. It NEVER filters results by
// score — there is no score. over_inclusive restricts nothing, so its candidate set is a strict
// superset of balanced's by construction. That is the structural guarantee that raising strictness
// can only add hits, never hide one.
export function matchOptionsFor(strictness: Strictness): MatchOptions {
  if (strictness === "balanced") {
    return { schemes: ["double_metaphone_primary"], nameRoles: ["current"] };
  }
  return {};
}

function displayNameOf(input: MatchPartyInput): string {
  if (input.kind === "organization") return (input.legalName ?? "").trim();
  return [input.given ?? "", input.family ?? ""]
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .join(" ");
}

// Tier 2 (exact normalized name) has no blocking channel of its own: the directory's channels are
// phonetic, trigram, and blind-index. Probe normalized_display directly for the entities the channels
// already surfaced, rather than adding a fourth channel to the shared corpus reader.
async function exactNameMatches(
  context: DirectoryIdentifierContext,
  normalizedQuery: string,
): Promise<Set<string>> {
  if (normalizedQuery.length === 0) return new Set();
  const { results } = await context.database
    .prepare(
      `SELECT DISTINCT COALESCE(dp.merged_into_id, do.merged_into_id, dn.entity_id) AS entity_id
       FROM directory_name AS dn
       LEFT JOIN directory_person AS dp ON dn.entity_kind = 'person' AND dp.id = dn.entity_id
       LEFT JOIN directory_organization AS do ON dn.entity_kind = 'organization' AND do.id = dn.entity_id
       WHERE dn.normalized_display = ?1
         AND dn.deleted_at IS NULL
         AND (
           (dn.entity_kind = 'person' AND dp.deleted_at IS NULL)
           OR (dn.entity_kind = 'organization' AND do.deleted_at IS NULL)
         )`,
    )
    .bind(normalizedQuery)
    .all<{ entity_id: string }>();
  return new Set(results.map((row) => row.entity_id));
}

export async function matchParty(
  context: DirectoryIdentifierContext,
  input: MatchPartyInput,
  strictness: Strictness,
): Promise<CandidateMatch[]> {
  const normalizedQuery = normalizeName(displayNameOf(input));

  const [candidates, exactNames] = await Promise.all([
    findDuplicateCandidates(context, {
      kind: input.kind,
      given: input.given,
      family: input.family,
      legalName: input.legalName,
      identifiers: input.identifiers as never,
      excludeEntityId: input.excludeEntityId,
      matchOptions: matchOptionsFor(strictness),
    }),
    exactNameMatches(context, normalizedQuery),
  ]);

  return candidates.map((candidate) => ({
    entityId: candidate.entityId,
    evidence: {
      identifierTypes: candidate.identifierTypes,
      exactNormalizedName: exactNames.has(candidate.entityId),
      phoneticMatch: candidate.channels.includes("phonetic"),
      trigramMatch: candidate.channels.includes("trigram"),
    },
  }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @magna-carta/conflicts exec vitest run test/matching.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/conflicts/src/matching.ts packages/conflicts/test/matching.test.ts
git commit -F- <<'EOF'
feat(conflicts): make strictness a recall knob, not a threshold

over_inclusive restricts nothing, so it is a strict superset of balanced
by construction. Raising strictness can only add hits, never hide one.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
```

---

### Task 9B: Shared domain-effect seam

**Files:**

- Create: `packages/data-access/src/run-domain-effect.ts`
- Modify: `packages/data-access/package.json` (add the `./run-domain-effect` export)
- Modify: `packages/directory/src/run-directory-effect.ts` (delegate to the shared seam)
- Modify: `packages/matters/src/matter-service.ts` (delegate `runMatterEffect` to the shared seam; leave `runMatterDraw` untouched)
- Test: `packages/data-access/test/run-domain-effect.test.ts`

**Interfaces:**

- Consumes: `runIdempotentEffect` + `IdempotentEffectResult` (`packages/data-access/src/run-idempotent-effect.ts`), `canonicalJsonStringify` (`@magna-carta/data-access/canonical`).
- Produces:
  - `interface DomainIdempotencyContext { readonly key: string | undefined; readonly fingerprint: string; readonly newRecordId?: () => IdempotencyRecordId }`
  - `class IdempotencyConflictError extends Error { readonly domain: string; readonly kind: "in-progress" | "fingerprint-mismatch" }`
  - `interface BuiltEffect<T> { readonly statements; readonly outboxMessages; readonly responseCode: number; readonly responseBody: unknown; readonly value: T; readonly fromBody: (body: unknown) => T }`
  - `interface DomainEffectOutcome<T> { readonly value: T; readonly idempotentReplay: boolean }`
  - `runDomainEffect<T>(database: BatchDatabase, idempotency: DomainIdempotencyContext | undefined, clock: { now(): string }, domain: string, build: () => BuiltEffect<T>): Promise<DomainEffectOutcome<T>>`

**Context — why this task exists.** Three packages need the same ~40-line single-mutation idempotency seam: `runIdempotentEffect` call + serialize the response body + translate the 4-way result (`executed`/`replayed`/`in-progress`/`fingerprint-mismatch`) into a value or a thrown conflict. Directory and matters each carry a copy today; conflicts would make a third. The reusable core is hoisted here. The per-package wrappers stay — but shrink to thin delegates that keep their exact public signatures, so **no call site in directory or matters changes** and their existing tests must stay green.

The wrappers differ only at the edges, all preserved by delegation:

- **Directory** returns a bare `T` (discards the replay flag) and uses `fromBody` to recover a bare id from a `{id}` wire body.
- **Matters** returns `T & ReplayFlag` (keeps the flag); its `value` _is_ the wire body, so its `fromBody` is identity. Its `responseCode` is a call parameter, not a built field.
- Each rethrows its own domain-named conflict error, so route `instanceof` checks are unaffected.

`runMatterDraw` (the numbering-counter draw with bounded retry and out-of-band counter advance) is a genuinely different, matters-only seam — leave it and `finishMatterResult` exactly as they are. Only `runMatterEffect` delegates.

- [ ] **Step 1: Write the failing test**

Create `packages/data-access/test/run-domain-effect.test.ts`:

```ts
import { createMigratedNodeDatabase } from "@magna-carta/database/node-sqlite";
import type { BatchDatabase } from "../src/effect-batch.ts";
import { expect, test } from "vitest";
import { IdempotencyConflictError, runDomainEffect } from "../src/run-domain-effect.ts";

const clock = { now: () => "2026-07-09T00:00:00.000Z" };

function database(): BatchDatabase {
  const { database } = createMigratedNodeDatabase("per-firm");
  return database as unknown as BatchDatabase;
}

// A minimal writable table exists in the per-firm schema; use `setting` as an inert write target.
function build(value: { id: string }) {
  return () => ({
    statements: [
      {
        // A no-op-safe insert into the flat setting table.
        __test: true,
      } as never,
    ],
    outboxMessages: [] as never,
    responseCode: 201,
    responseBody: value,
    value: value.id,
    fromBody: (body: unknown) => (body as { id: string }).id,
  });
}

test("an executed effect returns the built value and idempotentReplay false", async () => {
  const outcome = await runDomainEffect(database(), undefined, clock, "test", () => ({
    statements: [],
    outboxMessages: [],
    responseCode: 201,
    responseBody: { id: "x_1" },
    value: "x_1",
    fromBody: (body) => (body as { id: string }).id,
  }));
  expect(outcome.value).toBe("x_1");
  expect(outcome.idempotentReplay).toBe(false);
});

test("a replayed key recovers the value through fromBody and flags the replay", async () => {
  const db = database();
  const idempotency = { key: "firm:k:1", fingerprint: "fp" };
  const first = await runDomainEffect(db, idempotency, clock, "test", () => ({
    statements: [],
    outboxMessages: [],
    responseCode: 201,
    responseBody: { id: "x_1" },
    value: "x_1",
    fromBody: (body) => (body as { id: string }).id,
  }));
  const second = await runDomainEffect(db, idempotency, clock, "test", () => ({
    statements: [],
    outboxMessages: [],
    responseCode: 201,
    responseBody: { id: "x_1" },
    value: "x_1",
    fromBody: (body) => (body as { id: string }).id,
  }));
  expect(first.idempotentReplay).toBe(false);
  expect(second.idempotentReplay).toBe(true);
  expect(second.value).toBe("x_1");
});

test("a fingerprint mismatch throws IdempotencyConflictError carrying the domain", async () => {
  const db = database();
  await runDomainEffect(db, { key: "firm:k:1", fingerprint: "fp-a" }, clock, "test", () => ({
    statements: [],
    outboxMessages: [],
    responseCode: 201,
    responseBody: { id: "x_1" },
    value: "x_1",
    fromBody: (body) => (body as { id: string }).id,
  }));
  await expect(
    runDomainEffect(db, { key: "firm:k:1", fingerprint: "fp-b" }, clock, "test", () => ({
      statements: [],
      outboxMessages: [],
      responseCode: 201,
      responseBody: { id: "x_2" },
      value: "x_2",
      fromBody: (body) => (body as { id: string }).id,
    })),
  ).rejects.toMatchObject({ domain: "test", kind: "fingerprint-mismatch" });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @magna-carta/data-access exec vitest run test/run-domain-effect.test.ts`
Expected: FAIL — `Cannot find module '../src/run-domain-effect.ts'`

- [ ] **Step 3: Write the shared seam**

Create `packages/data-access/src/run-domain-effect.ts`:

```ts
import { canonicalJsonStringify } from "./canonical.ts";
import type { BatchDatabase, EffectWrite } from "./effect-batch.ts";
import { runIdempotentEffect, type IdempotentEffectResult } from "./run-idempotent-effect.ts";
import type { IdempotencyRecordId } from "@magna-carta/identifiers/types";

// The route's idempotency context. key === undefined means "no Idempotency-Key" — execute once, store
// no record. The route supplies the chokepoint's already-firm-scoped derived key and the fingerprint.
export interface DomainIdempotencyContext {
  readonly key: string | undefined;
  readonly fingerprint: string;
  readonly newRecordId?: () => IdempotencyRecordId;
}

// Raised on a same-key retry that loses the commit race: a concurrent in-progress request (→ 409) or a
// key reused with a different payload (→ 422). Carries the domain so a package wrapper can rethrow its
// own domain-named error and preserve route instanceof checks.
export class IdempotencyConflictError extends Error {
  constructor(
    readonly domain: string,
    readonly kind: "in-progress" | "fingerprint-mismatch",
  ) {
    super(`${domain} mutation idempotency conflict: ${kind}`);
    this.name = "IdempotencyConflictError";
  }
}

// What a built mutation contributes to its batch: the statements + outbox, the response code and wire
// body stored on the idempotency record, the value the caller receives on an executed commit, and a
// parser that recovers that value from the stored body on a replay. When a package's value already IS
// its wire body, fromBody is the identity.
export interface BuiltEffect<T> {
  readonly statements: EffectWrite["statements"];
  readonly outboxMessages: EffectWrite["outboxMessages"];
  readonly responseCode: number;
  readonly responseBody: unknown;
  readonly value: T;
  readonly fromBody: (body: unknown) => T;
}

export interface DomainEffectOutcome<T> {
  readonly value: T;
  readonly idempotentReplay: boolean;
}

// The single non-drawing-mutation seam shared by every domain package. Commits [idempotency record,
// business write] in one atomic batch through runIdempotentEffect when a key is present, or commits
// with no record when absent. On an executed commit it returns the freshly-built value; on a replay it
// recovers the winner's value from the stored body via fromBody, so a retry returns what the first
// commit recorded rather than this loser's freshly-minted value.
export async function runDomainEffect<T>(
  database: BatchDatabase,
  idempotency: DomainIdempotencyContext | undefined,
  clock: { now(): string },
  domain: string,
  build: () => BuiltEffect<T>,
): Promise<DomainEffectOutcome<T>> {
  const built = build();
  const result: IdempotentEffectResult = await runIdempotentEffect({
    database,
    key: idempotency?.key,
    fingerprint: idempotency?.fingerprint ?? "",
    newRecordId: idempotency?.newRecordId,
    now: () => clock.now(),
    effect: () =>
      Promise.resolve({
        write: { statements: built.statements, outboxMessages: built.outboxMessages },
        responseCode: built.responseCode,
        responseBody: canonicalJsonStringify(built.responseBody),
      }),
  });

  switch (result.kind) {
    case "executed":
      return { value: built.value, idempotentReplay: false };
    case "replayed":
      return {
        value: built.fromBody(JSON.parse(result.responseBody ?? "{}")),
        idempotentReplay: true,
      };
    case "in-progress":
      throw new IdempotencyConflictError(domain, "in-progress");
    case "fingerprint-mismatch":
      throw new IdempotencyConflictError(domain, "fingerprint-mismatch");
  }
}
```

Add to `packages/data-access/package.json` exports: `"./run-domain-effect": "./src/run-domain-effect.ts"`.

- [ ] **Step 4: Run the shared-seam test**

Run: `pnpm --filter @magna-carta/data-access exec vitest run test/run-domain-effect.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Delegate the directory wrapper**

Rewrite the body of `runDirectoryEffect` in `packages/directory/src/run-directory-effect.ts` to delegate, keeping the exported signature, the `BuiltDirectoryMutation<T>` interface (now structurally a `BuiltEffect<T>`), the `DirectoryIdempotencyContext` interface, and the `DirectoryIdempotencyConflictError` class exactly as they are:

```ts
import {
  runDomainEffect,
  IdempotencyConflictError,
} from "@magna-carta/data-access/run-domain-effect";
// ...keep DirectoryIdempotencyContext, DirectoryIdempotencyConflictError, BuiltDirectoryMutation...

export async function runDirectoryEffect<T>(
  database: BatchDatabase,
  idempotency: DirectoryIdempotencyContext | undefined,
  clock: { now(): string },
  build: () => BuiltDirectoryMutation<T>,
): Promise<T> {
  try {
    const { value } = await runDomainEffect(database, idempotency, clock, "directory", build);
    return value;
  } catch (error) {
    if (error instanceof IdempotencyConflictError) {
      throw new DirectoryIdempotencyConflictError(error.kind);
    }
    throw error;
  }
}
```

Delete the now-dead `finishDirectoryResult` and the direct `runIdempotentEffect`/`canonicalJsonStringify` imports if nothing else uses them.

- [ ] **Step 6: Run the directory suite**

Run: `pnpm --filter @magna-carta/directory exec vitest run`
Expected: PASS — the full directory suite, unchanged behaviour.

- [ ] **Step 7: Delegate the matters wrapper**

Rewrite only `runMatterEffect` in `packages/matters/src/matter-service.ts` to delegate. Keep its signature `(database, options, responseCode, build) => Promise<T & ReplayFlag>`, the `MatterIdempotencyConflictError` class, `runMatterDraw`, and `finishMatterResult` (still used by `runMatterDraw`) exactly as they are:

```ts
import {
  runDomainEffect,
  IdempotencyConflictError,
} from "@magna-carta/data-access/run-domain-effect";

async function runMatterEffect<T>(
  database: BatchDatabase,
  options: MatterServiceOptions,
  responseCode: number,
  build: () => BuiltMutation<T>,
): Promise<T & ReplayFlag> {
  try {
    const { value, idempotentReplay } = await runDomainEffect(
      database,
      options.idempotency,
      { now: () => options.clock.now() },
      "matter",
      () => {
        const built = build();
        // The matters value IS its wire body, so responseBody = value and fromBody is identity.
        return {
          statements: built.statements,
          outboxMessages: built.outboxMessages,
          responseCode,
          responseBody: built.value,
          value: built.value,
          fromBody: (body: unknown) => body as T,
        };
      },
    );
    return { ...(value as object), idempotentReplay } as T & ReplayFlag;
  } catch (error) {
    if (error instanceof IdempotencyConflictError) {
      throw new MatterIdempotencyConflictError(error.kind);
    }
    throw error;
  }
}
```

- [ ] **Step 8: Run the matters suite**

Run: `pnpm --filter @magna-carta/matters exec vitest run`
Expected: PASS — including the replay-flag and conflict-mapping tests, proving delegation preserved behaviour.

- [ ] **Step 9: Commit**

```bash
git add packages/data-access/src/run-domain-effect.ts packages/data-access/package.json packages/data-access/test/run-domain-effect.test.ts packages/directory/src/run-directory-effect.ts packages/matters/src/matter-service.ts
git commit -F- <<'EOF'
refactor(data-access): hoist the shared domain-effect seam

The single-mutation idempotency seam was copied in directory and matters
and would be copied a third time in conflicts. Hoist the ~40-line core
into runDomainEffect; the per-package wrappers keep their exact
signatures and delegate, so no call site changes. The bespoke matters
number-draw seam stays where it is.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
```

---

### Task 10: Write path — statements, audit, effect seam, orchestration

**Files:**

- Create: `packages/conflicts/src/audit.ts`, `packages/conflicts/src/statements.ts`, `packages/conflicts/src/run-conflicts-effect.ts`, `packages/conflicts/src/run-check.ts`
- Test: `packages/conflicts/test/run-check.test.ts`

**Interfaces:**

- Consumes: everything from Tasks 3-9.
- Produces:
  - `interface ConflictsWriteOptions { readonly clock: { now(): string }; readonly actorUserId: UserId | null; readonly randomSource?: RandomSource; readonly idempotency?: ConflictsIdempotencyContext }`
  - `conflictsAuditStatement(database, options, event, subjectId): SqlStatement`
  - `runConflictsEffect<T>(database, idempotency, clock, build): Promise<T>` — a thin delegate over `runDomainEffect` (Task 9B), exactly like the directory wrapper: returns the bare value and rethrows the shared `IdempotencyConflictError` as a `ConflictsIdempotencyConflictError`. Do NOT reimplement the seam.
  - `insertCheckStatement`, `insertHitStatement`, `insertDispositionStatement`
  - `interface RunCheckInput { readonly trigger: ConflictsTrigger; readonly matterId?: string; readonly subjectEntityIds: readonly string[]; readonly scope: ScopeRequest }`
  - `runConflictsCheck(context: DirectoryIdentifierContext, input: RunCheckInput, options: ConflictsWriteOptions): Promise<ConflictsCheckId>`

**Context:** `runConflictsCheck` reads everything first (policy, expansion, matches, imputation), then composes ONE atomic batch: the check row, every hit row, and the audit row. D1 has no interactive transactions.

The `scope_json` records **per-source availability**. `content` and prior-firm history record `unavailable` — never `searched`. A source that could not run must never read as searched-and-clean.

`inputs_json` records identifier ids by reference and the identifier types skipped as non-indexable (`dob`, `ssn_last_four`). It must never contain a plaintext identifier value.

- [ ] **Step 1: Write the failing test**

Create `packages/conflicts/test/run-check.test.ts` (reuse the `conflictsTestContext` harness from Task 9):

```ts
test("a check writes one row recording the trigger, scope, strictness and depth", async () => {
  const { ctx, options } = await conflictsTestContext("run-basic");
  const clientId = await createPerson(ctx.database, { given: "Jane", family: "Roe" }, options);

  const checkId = await runConflictsCheck(
    ctx,
    {
      trigger: "comprehensive",
      subjectEntityIds: [clientId],
      scope: { sources: ["party"], strictness: "balanced", depth: 1 },
    },
    options,
  );

  const row = await readCheck(ctx.database, checkId);
  expect(row.trigger).toBe("comprehensive");
  expect(row.strictness).toBe("balanced");
  expect(row.depth).toBe(1);
});

test("a matter with no parties produces an empty run, not an error", async () => {
  const { ctx, options } = await conflictsTestContext("empty");
  const checkId = await runConflictsCheck(
    ctx,
    {
      trigger: "preliminary",
      subjectEntityIds: [],
      scope: { sources: ["party"], strictness: "balanced", depth: 1 },
    },
    options,
  );
  const hits = await readHits(ctx.database, checkId);
  expect(hits).toEqual([]);
});

test("a source that cannot run records as unavailable, never as clean", async () => {
  const { ctx, options } = await conflictsTestContext("unavailable");
  const checkId = await runConflictsCheck(
    ctx,
    {
      trigger: "comprehensive",
      subjectEntityIds: [],
      scope: { sources: ["party", "content"], strictness: "balanced", depth: 1 },
    },
    options,
  );
  const row = await readCheck(ctx.database, checkId);
  const scope = JSON.parse(row.scope_json) as Record<string, string>;
  expect(scope.content).toBe("unavailable");
  expect(scope.party).toBe("searched");
});

test("a scope below the floor is raised and the raise is recorded on the row", async () => {
  const { ctx, options } = await conflictsTestContext("floor");
  ctx.database.exec(
    `INSERT INTO setting (key, value, updated_at) VALUES ('conflicts.policy', '{"floorSources":["party","graph"],"floorStrictness":"balanced","defaultDepth":1}', '2026-07-09T00:00:00.000Z')`,
  );
  const checkId = await runConflictsCheck(
    ctx,
    {
      trigger: "comprehensive",
      subjectEntityIds: [],
      scope: { sources: ["party"], strictness: "balanced", depth: 1 },
    },
    options,
  );
  const row = await readCheck(ctx.database, checkId);
  expect(row.floor_raised).toBe(1);
  expect(JSON.parse(row.scope_json).graph).toBe("searched");
});

test("no plaintext identifier value reaches the log", async () => {
  const { ctx, options } = await conflictsTestContext("no-plaintext");
  const personId = await createPerson(ctx.database, { given: "Jane", family: "Roe" }, options);
  await addIdentifier(ctx, { entityId: personId, type: "ssn", value: "123-45-6789" });

  const checkId = await runConflictsCheck(
    ctx,
    {
      trigger: "comprehensive",
      subjectEntityIds: [personId],
      scope: { sources: ["party"], strictness: "balanced", depth: 1 },
    },
    options,
  );
  const row = await readCheck(ctx.database, checkId);
  expect(row.inputs_json).not.toContain("123456789");
  expect(row.inputs_json).not.toContain("123-45-6789");
});

test("a merged-away former name still surfaces the surviving master", async () => {
  const { ctx, options } = await conflictsTestContext("merged");
  const master = await createPerson(ctx.database, { given: "Jane", family: "Roe" }, options);
  const subordinate = await createPerson(ctx.database, { given: "Jane", family: "Doe" }, options);
  await mergeEntities(ctx.database, { masterId: master, subordinateId: subordinate }, options);

  const checkId = await runConflictsCheck(
    ctx,
    {
      trigger: "new_party",
      subjectEntityIds: [],
      scope: { sources: ["party"], strictness: "over_inclusive", depth: 0 },
    },
    options,
  );
  // Match against the merged-away name; the master must surface, never the subordinate.
  const matches = await matchParty(
    ctx,
    { kind: "person", given: "Jane", family: "Doe" },
    "over_inclusive",
  );
  expect(matches.map((match) => match.entityId)).toContain(master);
  expect(matches.map((match) => match.entityId)).not.toContain(subordinate);
  expect(checkId).toBeDefined();
});

test("every hit carries its evidence tier and connecting graph path", async () => {
  const { ctx, options } = await conflictsTestContext("hit-shape");
  const orgId = await createOrganization(ctx.database, { legalName: "ABC Holdings" }, options);
  const principalId = await createPerson(
    ctx.database,
    { given: "Ada", family: "Principal" },
    options,
  );
  await createEdge(
    ctx.database,
    {
      from: principalId,
      to: orgId,
      edgeType: "affiliation",
      role: "principal",
      note: null,
      validFrom: null,
      validTo: null,
    },
    options,
  );
  await createPerson(ctx.database, { given: "Ada", family: "Principal" }, options); // a second, unrelated Ada

  const checkId = await runConflictsCheck(
    ctx,
    {
      trigger: "comprehensive",
      subjectEntityIds: [orgId],
      scope: { sources: ["party", "graph"], strictness: "balanced", depth: 1 },
    },
    options,
  );

  const hits = await readHits(ctx.database, checkId);
  expect(hits.length).toBeGreaterThan(0);
  for (const hit of hits) {
    expect(hit.evidence_tier).toBeGreaterThanOrEqual(1);
    expect(hit.evidence_tier).toBeLessThanOrEqual(4);
    expect(() => JSON.parse(hit.graph_path_json)).not.toThrow();
  }
});

test("a replayed idempotency key writes exactly one check", async () => {
  const { ctx, options } = await conflictsTestContext("idempotent");
  const idempotency = { key: "firm:check:1", fingerprint: "fp" };
  const input = {
    trigger: "comprehensive" as const,
    subjectEntityIds: [],
    scope: { sources: ["party"] as const, strictness: "balanced" as const, depth: 1 },
  };

  const first = await runConflictsCheck(ctx, input, { ...options, idempotency });
  const second = await runConflictsCheck(ctx, input, { ...options, idempotency });

  expect(second).toBe(first);
  const { results } = await ctx.database
    .prepare(`SELECT COUNT(*) AS count FROM conflicts_check`)
    .all();
  expect(results[0].count).toBe(1);
});
```

Add `readCheck` and `readHits` helpers in the test file that select the raw rows.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @magna-carta/conflicts exec vitest run test/run-check.test.ts`
Expected: FAIL — `Cannot find module '../src/run-check.ts'`

- [ ] **Step 3: Write minimal implementation**

Create `packages/conflicts/src/audit.ts` mirroring `packages/directory/src/audit.ts` exactly, renaming `Directory` to `Conflicts`.

Create `packages/conflicts/src/run-conflicts-effect.ts` as a thin delegate over `runDomainEffect` (Task 9B), following the directory wrapper's shape: keep a `ConflictsIdempotencyContext` interface and a `ConflictsIdempotencyConflictError` class, call `runDomainEffect(database, idempotency, clock, "conflicts", build)`, return the bare `value`, and rethrow the shared `IdempotencyConflictError` as `ConflictsIdempotencyConflictError`. Do not reimplement the seam.

Create `packages/conflicts/src/statements.ts` with three insert-statement builders binding the columns declared in Task 2.

Create `packages/conflicts/src/run-check.ts`:

```ts
import type { DirectoryIdentifierContext } from "@magna-carta/directory/identifiers";
import { readMatterParties } from "@magna-carta/directory/party";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { ConflictsCheckId } from "@magna-carta/identifiers/types";
import { conflictsAuditStatement, type ConflictsWriteOptions } from "./audit.ts";
import { assignTier, describeEvidence } from "./evidence.ts";
import { expandGraph } from "./expansion.ts";
import { findImputationHits } from "./imputation.ts";
import { matchParty } from "./matching.ts";
import { runConflictsEffect } from "./run-conflicts-effect.ts";
import { readConflictsPolicy, resolveScope, type ScopeRequest } from "./settings.ts";
import { insertCheckStatement, insertHitStatement } from "./statements.ts";
import type { ConflictsTrigger, SourceAvailability, SourceClass } from "./types.ts";

export interface RunCheckInput {
  readonly trigger: ConflictsTrigger;
  readonly matterId?: string;
  readonly subjectEntityIds: readonly string[];
  readonly scope: ScopeRequest;
}

// The content class has no corpus yet: nothing indexes document text, and the email parse core is not
// wired to a consumer. Recording it as unavailable rather than omitting it keeps the log honest — an
// auditor must be able to tell "searched and clean" apart from "never searched".
const AVAILABLE_SOURCES: ReadonlySet<SourceClass> = new Set(["party", "graph", "imputation"]);

function availabilityOf(sourceClass: SourceClass): SourceAvailability {
  return AVAILABLE_SOURCES.has(sourceClass) ? "searched" : "unavailable";
}

export async function runConflictsCheck(
  context: DirectoryIdentifierContext,
  input: RunCheckInput,
  options: ConflictsWriteOptions,
): Promise<ConflictsCheckId> {
  // Read everything before composing the batch: D1 has no interactive transactions.
  const policy = await readConflictsPolicy(context.database);
  const scope = resolveScope(policy, input.scope);
  const inScope = new Set(scope.sources);

  // Seed the search from the explicit subject parties plus, when a matter is supplied, its live parties.
  const seedIds = new Set(input.subjectEntityIds);
  if (input.matterId !== undefined) {
    for (const party of await readMatterParties(context.database, input.matterId)) {
      seedIds.add(party.entityId);
    }
  }

  const expanded = inScope.has("graph")
    ? await expandGraph(context.database, [...seedIds], scope.depth)
    : [...seedIds].map((entityId) => ({ entityId, path: [] as never[] }));

  // Match every entity in the expanded set. A seed carries an empty path; an expanded entity carries
  // the edges that reached it, which is the hit's explanation.
  const hits: Array<{
    entityId: string;
    sourceClass: SourceClass;
    tier: number;
    matchedFields: string[];
    path: unknown;
  }> = [];

  for (const entity of expanded) {
    const subject = await readSubjectFacts(context, entity.entityId);
    if (subject === null) continue;
    const matches = await matchParty(context, subject, scope.strictness);
    for (const match of matches) {
      if (seedIds.has(match.entityId)) continue; // a party never conflicts with itself
      hits.push({
        entityId: match.entityId,
        sourceClass: entity.path.length === 0 ? "party" : "graph",
        tier: assignTier(match.evidence),
        matchedFields: describeEvidence(match.evidence),
        path: entity.path,
      });
    }
  }

  if (inScope.has("imputation") && input.matterId !== undefined) {
    for (const imputed of await findImputationHits(context.database, [input.matterId])) {
      hits.push({
        entityId: imputed.entityId,
        sourceClass: "imputation",
        // Identity, not similarity: an exact join is the strongest evidence there is.
        tier: 1,
        matchedFields: [`firm member ${imputed.memberUserId} is a party (${imputed.role})`],
        path: [],
      });
    }
  }

  const scopeRecord: Record<string, SourceAvailability> = {};
  for (const sourceClass of scope.sources) scopeRecord[sourceClass] = availabilityOf(sourceClass);
  // Prior-firm lateral history is a registered source with no table. Record it, never omit it.
  scopeRecord["prior_firm_history"] = "unavailable";

  const checkId = newIdentifier("conflictsCheck", options.randomSource);
  const now = options.clock.now();

  // Identifiers are recorded BY REFERENCE. No plaintext value ever enters the log.
  const inputs = {
    subjectEntityIds: [...seedIds].sort(),
    expandedEntityIds: expanded.map((entity) => entity.entityId).sort(),
    identifierRefs: await readIdentifierReferences(context, [...seedIds]),
    skippedIdentifierTypes: ["dob", "ssn_last_four"],
  };

  return runConflictsEffect(context.database, options.idempotency, options.clock, () => ({
    statements: [
      insertCheckStatement(context.database, {
        id: checkId,
        trigger: input.trigger,
        subjectMatterId: input.matterId ?? null,
        subjectPartiesJson: JSON.stringify(inputs.subjectEntityIds),
        scopeJson: JSON.stringify(scopeRecord),
        strictness: scope.strictness,
        depth: scope.depth,
        inputsJson: JSON.stringify(inputs),
        floorRaised: scope.floorRaised,
        actorUserId: options.actorUserId,
        createdAt: now,
      }),
      ...hits.map((hit) =>
        insertHitStatement(context.database, {
          id: newIdentifier("conflictsHit", options.randomSource),
          checkId,
          entityId: hit.entityId,
          sourceClass: hit.sourceClass,
          evidenceTier: hit.tier,
          matchedFieldsJson: JSON.stringify(hit.matchedFields),
          graphPathJson: JSON.stringify(hit.path),
          createdAt: now,
        }),
      ),
      conflictsAuditStatement(context.database, options, "conflicts.check.run", checkId),
    ],
    outboxMessages: [],
    responseCode: 201,
    responseBody: { id: checkId },
    value: checkId,
    fromBody: (body) => (body as { id: ConflictsCheckId }).id,
  }));
}
```

Implement the two private readers in the same file: `readSubjectFacts` (selects the entity's kind and current name parts, returning a `MatchPartyInput`) and `readIdentifierReferences` (selects `directory_identifier.id` and `identifier_type` for the seed entities — **ids and types only, never `value_ciphertext` or `value_blind_index`**).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @magna-carta/conflicts exec vitest run test/run-check.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/conflicts/src/audit.ts packages/conflicts/src/statements.ts packages/conflicts/src/run-conflicts-effect.ts packages/conflicts/src/run-check.ts packages/conflicts/test/run-check.test.ts
git commit -F- <<'EOF'
feat(conflicts): orchestrate the check and write the immutable log

Reads everything before composing one atomic batch. A source that cannot
run records as unavailable, never as searched-and-clean. Identifiers are
recorded by reference; no plaintext value enters the log.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
```

---

### Task 11: Dispositions

**Files:**

- Create: `packages/conflicts/src/disposition.ts`
- Test: `packages/conflicts/test/disposition.test.ts`

**Interfaces:**

- Consumes: `insertDispositionStatement` (Task 10), `DispositionKind` (Task 3).
- Produces:
  - `interface RecordDispositionInput { readonly hitId: string; readonly kind: DispositionKind; readonly rationale: string; readonly reviewerUserId: UserId }`
  - `recordDisposition(database: BatchDatabase, input: RecordDispositionInput, options: ConflictsWriteOptions): Promise<ConflictsDispositionId>`
  - `readCurrentDisposition(database: SqlDatabase, hitId: string): Promise<DispositionRow | null>` — the latest row by `created_at`, then `id` as tiebreak
  - `class EmptyRationaleError extends Error` with `readonly code = "empty-rationale"`
  - `class UnknownHitError extends Error` with `readonly code = "unknown-hit"`

**Context:** `wall_erected` is a recordable outcome, not a wall implementation — nothing enforces access restriction here.

- [ ] **Step 1: Write the failing test**

Create `packages/conflicts/test/disposition.test.ts`:

```ts
test("a disposition is recorded against a hit", async () => {
  const { ctx, options, hitId } = await hitFixture("record");
  const dispositionId = await recordDisposition(
    ctx.database,
    { hitId, kind: "cleared", rationale: "unrelated party", reviewerUserId: ACTOR },
    options,
  );
  expect(dispositionId).toMatch(/^conflictsDisposition_/);
});

test("a reversal appends a second row and becomes the current disposition", async () => {
  const { ctx, options, hitId } = await hitFixture("reversal");
  await recordDisposition(
    ctx.database,
    { hitId, kind: "cleared", rationale: "looked unrelated", reviewerUserId: ACTOR },
    options,
  );
  await recordDisposition(
    ctx.database,
    {
      hitId,
      kind: "representation_declined",
      rationale: "on review, adverse",
      reviewerUserId: ACTOR,
    },
    { ...options, clock: { now: () => "2026-07-09T01:00:00.000Z" } },
  );

  const current = await readCurrentDisposition(ctx.database, hitId);
  expect(current?.kind).toBe("representation_declined");

  const { results } = await ctx.database
    .prepare(`SELECT COUNT(*) AS count FROM conflicts_disposition`)
    .all();
  expect(results[0].count).toBe(2); // the cleared row survives — the audit trail is the point
});

test("an empty rationale is rejected", async () => {
  const { ctx, options, hitId } = await hitFixture("empty-rationale");
  await expect(
    recordDisposition(
      ctx.database,
      { hitId, kind: "cleared", rationale: "   ", reviewerUserId: ACTOR },
      options,
    ),
  ).rejects.toThrow(/empty-rationale/);
});

test("a disposition against an unknown hit is rejected before any write", async () => {
  const { ctx, options } = await hitFixture("unknown-hit");
  await expect(
    recordDisposition(
      ctx.database,
      { hitId: "conflictsHit_missing", kind: "cleared", rationale: "x", reviewerUserId: ACTOR },
      options,
    ),
  ).rejects.toThrow(/unknown-hit/);
});

test("every disposition kind is accepted", async () => {
  for (const kind of DISPOSITION_KINDS) {
    const { ctx, options, hitId } = await hitFixture(`kind-${kind}`);
    await expect(
      recordDisposition(
        ctx.database,
        { hitId, kind, rationale: "reason", reviewerUserId: ACTOR },
        options,
      ),
    ).resolves.toBeDefined();
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @magna-carta/conflicts exec vitest run test/disposition.test.ts`
Expected: FAIL — `Cannot find module '../src/disposition.ts'`

- [ ] **Step 3: Write minimal implementation**

Create `packages/conflicts/src/disposition.ts`. Validate the rationale is non-blank and the hit exists (both before composing the batch — D1 has no interactive transactions), then compose one batch: the disposition insert plus the audit row, through `runConflictsEffect`.

`readCurrentDisposition` selects `ORDER BY created_at DESC, id DESC LIMIT 1`. The rows are never updated, so the latest row IS the current disposition, and the earlier ones remain as the audit trail.

Add a comment stating that `wall_erected` records an outcome and enforces nothing.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @magna-carta/conflicts exec vitest run test/disposition.test.ts`
Expected: PASS (5 tests + 4 parameterized kinds)

- [ ] **Step 5: Commit**

```bash
git add packages/conflicts/src/disposition.ts packages/conflicts/test/disposition.test.ts
git commit -F- <<'EOF'
feat(conflicts): append dispositions, never update them

A reviewer who clears a hit and later reverses must leave both acts
visible. The latest row is the current disposition.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
```

---

### Task 12: Fitness probes

**Files:**

- Create: `packages/conflicts/src/fitness.ts`
- Test: `packages/conflicts/test/fitness.test.ts`

**Interfaces:**

- Consumes: the three tables.
- Produces: `assertConflictsFitness(database: SqlDatabase): Promise<void>`, `class ConflictsFitnessError extends Error` with `readonly code = "conflicts-fitness"`.

**Context:** Mirror `packages/directory/src/fitness.ts:226` — aggregate every violation across all probes before throwing, so one run surfaces the full damage.

Probes:

1. **Append-only triggers exist** — all six named triggers present in `sqlite_master`.
2. **No orphan hit** — every `conflicts_hit.check_id` resolves.
3. **No orphan disposition** — every `conflicts_disposition.hit_id` resolves.
4. **No plaintext identifier in the log** — no `conflicts_check.inputs_json` contains a nine-consecutive-digit run. This is the structural guard on the "identifiers by reference" rule.
5. **Every hit's tier is 1-4** and its `graph_path_json` parses as an array.

- [ ] **Step 1: Write the failing test**

Create `packages/conflicts/test/fitness.test.ts` with one test per probe: a sound log resolves silently; each individually-corrupted log throws `ConflictsFitnessError` naming the offending row. Corrupt the log by dropping a trigger (`DROP TRIGGER conflicts_hit_no_update`) and by inserting a check row whose `inputs_json` contains `"123456789"`.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @magna-carta/conflicts exec vitest run test/fitness.test.ts`
Expected: FAIL — `Cannot find module '../src/fitness.ts'`

- [ ] **Step 3: Write minimal implementation**

Create `packages/conflicts/src/fitness.ts` following the aggregate-then-throw shape of `packages/directory/src/fitness.ts`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @magna-carta/conflicts exec vitest run test/fitness.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/conflicts/src/fitness.ts packages/conflicts/test/fitness.test.ts
git commit -F- <<'EOF'
feat(conflicts): prove the log invariants with fitness probes

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
```

---

### Task 13: Worker routes and permissions

**Files:**

- Create: `apps/worker/src/routes/directory/conflicts.ts`
- Modify: `apps/worker/src/app.ts`, `packages/access-control/src/registry.ts`
- Create: `packages/database/drizzle/per-firm/20260908T000000_baseline.sql`
- Test: `apps/worker/test/conflicts-routes.test.ts`

**Interfaces:**

- Consumes: `runConflictsCheck`, `recordDisposition`, `readCurrentDisposition`.
- Produces: three routes.
  - `POST /conflicts/checks` — body `{ trigger, matterId?, subjectEntityIds, scope: { sources, strictness, depth } }` → `201 { id }`. Permission `conflicts:run`.
  - `GET /conflicts/checks/:checkId` — → `200 { check, hits }`. Permission `conflicts:read`.
  - `POST /conflicts/hits/:hitId/dispositions` — body `{ kind, rationale }` → `201 { id }`. Permission `conflicts:dispose`.

**Context:** Mirror `apps/worker/src/routes/directory/directory.ts` for env, actor, and crypto-context threading. The route is the only caller that owns those. Idempotency threads through the chokepoint middleware, as in the directory routes.

`trigger` is **required** on the check request — nothing auto-fires in this slice. Do not add a queue consumer or a Cron binding.

Golden rule 13: OpenAPI `description` strings must not reference a slice, phase, ADR, or spec.

- [ ] **Step 1: Write the failing test**

Create `apps/worker/test/conflicts-routes.test.ts`: a check POST returns 201 and a handle; a GET returns the check with its hits; a disposition POST returns 201; a caller lacking `conflicts:run` gets 403; a request omitting `trigger` gets 422; a repeated `Idempotency-Key` returns the first check's id.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @magna-carta/worker exec vitest run test/conflicts-routes.test.ts`
Expected: FAIL — 404 on `/conflicts/checks`

- [ ] **Step 3: Write minimal implementation**

Add `conflicts:run`, `conflicts:read`, `conflicts:dispose` to `packages/access-control/src/registry.ts`. Seed them onto the appropriate default roles in the new migration — grant `conflicts:run` and `conflicts:read` broadly, and `conflicts:dispose` only to roles that may accept or decline a representation.

Create `apps/worker/src/routes/directory/conflicts.ts` mirroring `routes/directory/directory.ts`. Mount it in `apps/worker/src/app.ts`.

Regenerate the contract: `pnpm --filter @magna-carta/worker run emit-openapi`, then regenerate `packages/api-client/src/*`. Commit both — they are generated but tracked.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @magna-carta/worker exec vitest run test/conflicts-routes.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/routes/directory/conflicts.ts apps/worker/src/app.ts packages/access-control/src/registry.ts packages/database/drizzle/per-firm/20260908T000000_baseline.sql apps/worker/test/conflicts-routes.test.ts apps/worker/openapi/openapi.json packages/api-client/src
git commit -F- <<'EOF'
feat(conflicts): expose run, read, and disposition routes

The trigger is a required request parameter; nothing auto-fires.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
```

---

### Task 14: Documentation and close-out

**Files:**

- Create: `packages/conflicts/CLAUDE.md`
- Create: `changelog.d/conflicts-matching-engine.md`
- Create: `status.d/slice-4-1-conflicts.md`
- Modify: `ROADMAP.md:97`, `packages/directory/CLAUDE.md:60`
- Modify: `docs/active-work/slice-4-1-conflicts.md` (status → built)

**Context:** Golden rule 5 — no feature is done until its docs, `ROADMAP.md`, and the changelog fragment are updated in the same commit. Never hand-edit `CHANGELOG.md`, `STATUS.md`, or the Decision-Log register on a branch; write fragments only.

- [ ] **Step 1: Write `packages/conflicts/CLAUDE.md`**

Mirror `packages/directory/CLAUDE.md`: purpose, key files, invariants, dependencies, gotchas. The invariants section must state:

- The three log tables are append-only. No `UPDATE`, no `DELETE`, ever. Triggers enforce it; `assertConflictsFitness` proves the triggers exist.
- Nothing is ever suppressed by tier. Tiers order; they do not filter.
- `over_inclusive` is a strict superset of `balanced`. Any change to `matchOptionsFor` must preserve this, and the superset test guards it.
- Imputation matches by identity only. `imputation.ts` must never import `findDuplicateCandidates`, `phoneticCodes`, or `normalizeName`.
- No plaintext identifier value enters the log. Identifiers are recorded by `directory_identifier.id` reference.
- A source that cannot run records `unavailable`, never `searched`.

Gotchas:

- `readEdges` (`packages/directory/src/edges.ts:127`) reads an ambient `new Date()`. Do not depend on it for deterministic expansion tests.
- Corporate-family edges bypass the depth budget in `expandGraph` deliberately. A successor entity must still match.
- Drizzle-kit cannot model triggers; they live in the hand-written migration `.sql`, like the FTS5 triggers.

- [ ] **Step 2: Fix the stale directory gotcha**

In `packages/directory/CLAUDE.md:60`, the gotcha claims `findDuplicateCandidates` tie-ordering is insertion-order and suggests adding a `localeCompare` secondary sort. `packages/directory/src/search.ts` already has that tiebreak. Replace the gotcha with a statement of the invariant: candidates sort by signal count descending, then entity id ascending, so ordering is stable across database row orders. Note that `channels` and `identifierTypes` now travel with each candidate.

- [ ] **Step 3: Update ROADMAP and write the fragments**

`ROADMAP.md:97` currently gates slice 4·1 on "needs its own research + spec." Both now exist. Change the gate to reflect the built state and link the spec.

Write `changelog.d/conflicts-matching-engine.md` and `status.d/slice-4-1-conflicts.md`. Do not touch `CHANGELOG.md` or `STATUS.md` directly.

- [ ] **Step 4: Run the full quality gate**

Run: `pnpm check`
Expected: PASS — formatting, lint, TypeScript project-references typecheck, and `svelte-check`.

Run: `vp test`
Expected: PASS — the full unit and integration suite, including the Miniflare worker integration test.

Run: `pnpm run lint:process-refs`
Expected: PASS — no `ADR-NNNN`, "spec §N", or "slice 4·1" string in any source, test, or OpenAPI description.

- [ ] **Step 5: Commit**

```bash
git add packages/conflicts/CLAUDE.md packages/directory/CLAUDE.md changelog.d/conflicts-matching-engine.md status.d/slice-4-1-conflicts.md ROADMAP.md docs/active-work/slice-4-1-conflicts.md
git commit -F- <<'EOF'
docs(conflicts): document the package, fix a stale directory gotcha

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
```

---

## Self-Review

**Spec coverage.** Every spec section maps to a task: no-scorer/evidence tiers → Task 4; strictness as recall knob → Tasks 6 and 9; source registry and floor → Task 5; graph expansion and depth → Task 7; imputation by identity → Task 8; three append-only tables → Task 2; orchestration and the log's contents → Task 10; dispositions appended not updated → Tasks 2 and 11; append-only enforcement → Tasks 2 and 12; error handling (empty run, cycle, non-indexable identifier, unavailable source, idempotency) → Tasks 7, 10, 11; every named test in the spec's Testing section appears in Tasks 4, 5, 8, 9, 10, or 12 — including the "Smith Law" regression (Task 8) and the merged-alias case (Task 10). Triggers as API-only → Task 13. Deferred items are built nowhere, by construction.

**Deviation from the spec, discovered while reading the code.** The spec claims the engine "consumes the Directory corpus without changing it." That holds for the _write_ path but not the _read_ path: `findDuplicateCandidates` returns no channel provenance, its phonetic channel applies no scheme filter, and neither name channel filters `is_current`. Balanced strictness is therefore unbuildable on top of the current signature. Task 6 adds both, additively and backward-compatibly. The spec's architecture section should be amended to say "without changing its write path."

**Stale blocker removed.** The active-work note and the design conversation both flagged `monotonic-migration-ids` as blocking migration authoring. It is fully merged into `main` (`git merge-base --is-ancestor monotonic-migration-ids main`), and migrations already use timestamp ids. Task 2 proceeds immediately. The active-work overlap note should be corrected in Task 14.

**Type consistency.** `MatchEvidence`, `EdgeStep`, `SourceClass`, `Strictness`, `EvidenceTier`, `DispositionKind` are defined once in Task 3 and used with identical names in Tasks 4, 7, 8, 9, 10, 11. `MatchChannel` and `MatchOptions` are defined in Task 6 (directory) and consumed in Task 9. `ConflictsWriteOptions` and `runConflictsEffect` are defined in Task 10 and consumed in Task 11. `assignTier` / `describeEvidence` names match between Tasks 4 and 10. `resolveScope` / `readConflictsPolicy` match between Tasks 5 and 10. `expandGraph` matches between Tasks 7 and 10. `findImputationHits` matches between Tasks 8 and 10. `matchParty` / `matchOptionsFor` match between Tasks 9 and 10.

**Open item for the implementer.** Task 10's `readSubjectFacts` needs the entity's current name parts. `packages/directory` exports `readPerson` and `readOrganization`; prefer those over a hand-rolled query if their return shape carries the given/family/legal-name fields. Check before writing SQL.
