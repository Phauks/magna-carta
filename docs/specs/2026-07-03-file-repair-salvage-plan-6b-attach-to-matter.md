# File Repair & Salvage — Plan 6b: attach-to-matter (implementation plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user save the repair tool's output into a matter — a repaired file as a new version (or new file), carved files as N new files — with the honest loss manifest persisted per version.

**Architecture:** Attach is a _server-side upload_. The worker sends the uploaded corrupt bytes to the `magna-carta-recovery` container, then for each output file calls the existing `initiateUpload` (pending version + R2 key), writes the bytes to R2 with `bucket.put`, and returns 202. The **existing async ingest queue consumer** (`ingest-consumer.ts` → `runIngest` → `commitVersion`/`quarantineVersion`) applies the scan gate + firm `flaggedTreatment` — `ingest-core.ts` and `ingest-consumer.ts` are never edited. The loss manifest is persisted in a new per-firm `file_repair_provenance` table in the same atomic batch that initiates the version.

**Tech Stack:** TypeScript; Hono + `@hono/zod-openapi` routes; Drizzle per-firm schema (D1/DO-SQLite); `@magna-carta/file-manager` service functions; `@magna-carta/data-access` statement builders; Vitest (Miniflare worker pool). Design: `docs/specs/2026-07-03-file-repair-salvage-plan-6b-attach-to-matter-design.md`.

## Global Constraints

- **Never edit** `packages/file-manager/src/ingest-core.ts` or `apps/worker/src/files/ingest-consumer.ts`. Attach composes them from the outside.
- **Never use `commitEditedVersion`** for repaired output (it is the trusted `scanVerdict:"unscanned"` path). Untrusted repaired bytes ride `commitVersion`/`quarantineVersion` via the ingest gate — which the worker triggers only by `bucket.put` to a pending version's key.
- **Crown rule:** the loss manifest crosses to `file_repair_provenance` verbatim; `fully_recovered` is the engine's value, never fabricated; no route logic softens an honest loss.
- **Log-safety (golden rule 4):** manifest item names/details live only in `file_repair_provenance` (firm data) and the 200 response — never in an audit payload, error, log, or Problem. Audit metadata is counts only.
- **Firm-scoped DAL (golden rule 3):** all persistence through the firm-scoped data-access layer; no query crosses firms.
- **No process-doc citations in source (golden rule 13);** full names, no shorthand (golden rule 12).
- **Migration number:** this branch's next free per-firm migration is `0036` (6a took `0035`). Run `vp run worktrees` and check `main` immediately before Task 1; if a concurrent stream claimed `0036`, use the next free number and record the renumber in `docs/active-work/file-repair-salvage.md`.

---

## File structure

- `packages/identifiers/src/types.ts` — add `RepairProvenanceId` alias.
- `packages/identifiers/src/registry.ts` — add the `repairProvenance` prefix entry.
- `packages/database/src/per-firm-schema.ts` — add the `fileRepairProvenance` table.
- `packages/database/drizzle/per-firm/0036_file-repair-provenance.sql` (+ `meta/0036_snapshot.json`, `meta/_journal.json`) — the CREATE TABLE migration (drizzle-generated).
- `apps/worker/src/per-firm-migrations.ts` — import + map the new migration.
- `packages/data-access/src/file-repair-provenance-statements.ts` — insert statement + `readRepairProvenance`.
- `packages/data-access/package.json` — export the new module.
- `packages/data-access/test/file-repair-provenance-statements.test.ts` — statement/read test.
- `apps/worker/src/chokepoint/context-accessors.ts` — add `requireChokepointPermissions(c)` (exposes the set the chokepoint already computed).
- `apps/worker/src/chokepoint/register.ts` (or wherever the middleware sets context) — stash the resolved permission set on context.
- `apps/worker/src/routes/files/file-repair.ts` — export `dispatchToRecovery` + `RepairResultSchema`; add the two attach routes + the attach helper.
- `apps/worker/test/file-repair-attach.test.ts` — attach route + provenance + flagged tests.
- `apps/worker/vitest.config.ts` — no change if the R2 bucket + RECOVERY_SERVICE/SCAN stubs already boot; confirm a bucket binding exists in the pool.
- `changelog.d/file-repair-attach.md`, `STATUS.md`, `ROADMAP.md`, `docs/active-work/file-repair-salvage.md` — docs.

---

## Task 1: Provenance identifier, table, and migration

**Files:**

- Modify: `packages/identifiers/src/types.ts`, `packages/identifiers/src/registry.ts`
- Modify: `packages/database/src/per-firm-schema.ts`
- Create: `packages/database/drizzle/per-firm/0036_file-repair-provenance.sql` (+ snapshot + journal via generate)
- Modify: `apps/worker/src/per-firm-migrations.ts`

**Interfaces:**

- Produces: `RepairProvenanceId` (`Identifier<"repairProvenance">`); the `file_repair_provenance` table with columns `id, file_version_id, operation, fully_recovered, manifest_json, source_media_type, created_at`.

- [ ] **Step 1: Run `vp run worktrees` and confirm the migration number.** Verify `0036` is free on `main`; if not, use the next free number throughout this task and note it in the active-work file.

- [ ] **Step 2: Add the identifier alias.** In `packages/identifiers/src/types.ts`, beside `AiDetectionUsageId`:

```ts
export type RepairProvenanceId = Identifier<"repairProvenance">;
```

- [ ] **Step 3: Register the prefix.** In `packages/identifiers/src/registry.ts` `ENTITY_PREFIXES`, beside `aiDetectionUsage`:

```ts
  repairProvenance: "repairProvenance",
```

- [ ] **Step 4: Run the identifiers tests.** Run: `pnpm --filter @magna-carta/identifiers test run`. Expected: PASS (the registry/type round-trip test picks up the new entry; if the test enumerates prefixes, add `repairProvenance`).

- [ ] **Step 5: Add the table to the per-firm schema.** In `packages/database/src/per-firm-schema.ts`, after `aiDetectionUsage` (import `RepairProvenanceId` from `@magna-carta/identifiers/types` at the top with the other id types):

```ts
// The honest provenance of a machine-reconstructed file version: the operation and the verbatim loss
// manifest, so viewing the file surfaces "reconstructed — here is what was lost/synthesized". Firm
// data (access-gated like the version it describes), never the redacted log pipeline. Keyed by the
// file version it belongs to; a row's existence IS the "this version is a reconstruction" marker.
export const fileRepairProvenance = sqliteTable(
  "file_repair_provenance",
  {
    id: text("id").primaryKey().$type<RepairProvenanceId>(),
    fileVersionId: text("file_version_id").notNull().$type<FileVersionId>(),
    operation: text("operation", { enum: ["repair", "carve"] }).notNull(),
    fullyRecovered: integer("fully_recovered").notNull(),
    manifestJson: text("manifest_json").notNull(),
    sourceMediaType: text("source_media_type"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [index("file_repair_provenance_version_index").on(table.fileVersionId)],
);
```

- [ ] **Step 6: Generate the migration.** Run the repo's per-firm drizzle generate script (confirm the exact invocation from `packages/database/package.json` scripts — the same one that produced `0033_ai-detection-usage.sql`; typically `pnpm --filter @magna-carta/database generate` or a `vp run` wrapper). It emits `drizzle/per-firm/0036_file-repair-provenance.sql`, `meta/0036_snapshot.json`, and the `_journal.json` idx-36 entry. The SQL must be:

```sql
CREATE TABLE `file_repair_provenance` (
	`id` text PRIMARY KEY NOT NULL,
	`file_version_id` text NOT NULL,
	`operation` text NOT NULL,
	`fully_recovered` integer NOT NULL,
	`manifest_json` text NOT NULL,
	`source_media_type` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `file_repair_provenance_version_index` ON `file_repair_provenance` (`file_version_id`);
```

If generate is unavailable, hand-write the `.sql` exactly as above, add the `meta/0036_snapshot.json` mirroring `0033`'s snapshot shape for the new table, and append the idx-36 entry to `_journal.json`.

- [ ] **Step 7: Wire the migration into the loader.** In `apps/worker/src/per-firm-migrations.ts`, import the `.sql` and add the map entry (mirror the `0035` wiring exactly):

```ts
import migration0036 from "@magna-carta/database/drizzle/per-firm/0036_file-repair-provenance.sql";
// ...in the map:
  "0036_file-repair-provenance": migration0036,
```

- [ ] **Step 8: Typecheck + migration-application test.** Run: `pnpm --filter @magna-carta/database test run` and `pnpm --filter @magna-carta/worker test run per-firm-migrations` (or the migration-application test that walks the journal). Expected: PASS — the new table creates cleanly on a fresh firm DB.

- [ ] **Step 9: Commit.**

```bash
git add packages/identifiers/src packages/database/src/per-firm-schema.ts packages/database/drizzle/per-firm apps/worker/src/per-firm-migrations.ts
git commit -m "feat(database): file_repair_provenance per-firm table + repairProvenance identifier"
```

---

## Task 2: Data-access provenance statements

**Files:**

- Create: `packages/data-access/src/file-repair-provenance-statements.ts`
- Modify: `packages/data-access/package.json` (exports)
- Test: `packages/data-access/test/file-repair-provenance-statements.test.ts`

**Interfaces:**

- Consumes: `RepairProvenanceId`, `FileVersionId`.
- Produces:
  - `recordRepairProvenanceStatement(database, row: RepairProvenanceInsert): SqlStatement`
  - `readRepairProvenance(database, fileVersionId: string): Promise<RepairProvenance | null>`
  - `RepairProvenanceInsert` = `{ id, fileVersionId, operation: "repair"|"carve", fullyRecovered: boolean, manifestJson: string, sourceMediaType: string | null, createdAt: string }`
  - `RepairProvenance` = the parsed row: `{ operation, fullyRecovered: boolean, manifest: LossManifest, sourceMediaType, createdAt }` where `LossManifest` is imported from the file-manager wire type.

- [ ] **Step 1: Write the failing test.** Create `packages/data-access/test/file-repair-provenance-statements.test.ts` (mirror `ai-detection-usage-statements.test.ts`'s harness — an in-memory SQLite firm DB with the migration applied):

```ts
import { describe, expect, it } from "vitest";
import { freshFirmDatabase } from "./support/fresh-firm-database.ts"; // mirror the ai-detection test's DB helper
import {
  recordRepairProvenanceStatement,
  readRepairProvenance,
} from "../src/file-repair-provenance-statements.ts";

describe("file_repair_provenance statements", () => {
  it("records a repair provenance row and reads it back parsed", async () => {
    const db = await freshFirmDatabase();
    const manifest = {
      items: [{ name: "body", recovered: true, detail: "" }],
      fullyRecovered: true,
      synthesized: [],
    };
    await db.batch([
      recordRepairProvenanceStatement(db, {
        id: "repairProvenance_test0000000000000000001",
        fileVersionId: "fileVersion_test0000000000000000001",
        operation: "repair",
        fullyRecovered: true,
        manifestJson: JSON.stringify(manifest),
        sourceMediaType: "application/pdf",
        createdAt: "2026-07-03T00:00:00.000Z",
      }),
    ]);
    const read = await readRepairProvenance(db, "fileVersion_test0000000000000000001");
    expect(read).not.toBeNull();
    expect(read?.operation).toBe("repair");
    expect(read?.fullyRecovered).toBe(true);
    expect(read?.manifest).toEqual(manifest);
  });

  it("returns null when a version has no provenance", async () => {
    const db = await freshFirmDatabase();
    expect(await readRepairProvenance(db, "fileVersion_absent00000000000000001")).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails.** Run: `pnpm --filter @magna-carta/data-access test run file-repair-provenance`. Expected: FAIL (module not found).

- [ ] **Step 3: Implement the statements** in `packages/data-access/src/file-repair-provenance-statements.ts` (mirror `ai-detection-usage-statements.ts`):

```ts
import type { FileVersionId, RepairProvenanceId } from "@magna-carta/identifiers/types";
import type { LossManifest } from "@magna-carta/file-manager/recovery-wire"; // the TS mirror of the container DTO; if absent, define the interface inline here
import type { SqlDatabase, SqlStatement } from "./idempotency-statements.ts";

export const FILE_REPAIR_PROVENANCE_TABLE = "file_repair_provenance";

export type RepairOperation = "repair" | "carve";

export interface RepairProvenanceInsert {
  readonly id: RepairProvenanceId;
  readonly fileVersionId: FileVersionId;
  readonly operation: RepairOperation;
  readonly fullyRecovered: boolean;
  readonly manifestJson: string;
  readonly sourceMediaType: string | null;
  readonly createdAt: string;
}

export function recordRepairProvenanceStatement(
  database: SqlDatabase,
  row: RepairProvenanceInsert,
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${FILE_REPAIR_PROVENANCE_TABLE} (id, file_version_id, operation, fully_recovered, manifest_json, source_media_type, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
    )
    .bind(
      row.id,
      row.fileVersionId,
      row.operation,
      row.fullyRecovered ? 1 : 0,
      row.manifestJson,
      row.sourceMediaType,
      row.createdAt,
    );
}

export interface RepairProvenance {
  readonly operation: RepairOperation;
  readonly fullyRecovered: boolean;
  readonly manifest: LossManifest;
  readonly sourceMediaType: string | null;
  readonly createdAt: string;
}

export async function readRepairProvenance(
  database: SqlDatabase,
  fileVersionId: string,
): Promise<RepairProvenance | null> {
  const { results } = await database
    .prepare(
      `SELECT operation, fully_recovered, manifest_json, source_media_type, created_at FROM ${FILE_REPAIR_PROVENANCE_TABLE} WHERE file_version_id = ?1 LIMIT 1`,
    )
    .bind(fileVersionId)
    .all<{
      operation: RepairOperation;
      fully_recovered: number;
      manifest_json: string;
      source_media_type: string | null;
      created_at: string;
    }>();
  const row = results[0];
  if (row === undefined) return null;
  return {
    operation: row.operation,
    fullyRecovered: row.fully_recovered === 1,
    manifest: JSON.parse(row.manifest_json) as LossManifest,
    sourceMediaType: row.source_media_type,
    createdAt: row.created_at,
  };
}
```

- [ ] **Step 4: Export the module.** In `packages/data-access/package.json` `exports`, add (mirror the ai-detection entry):

```json
    "./file-repair-provenance-statements": "./src/file-repair-provenance-statements.ts",
```

Run `pnpm install` if the workspace needs to re-link exports.

- [ ] **Step 5: Run the test.** Run: `pnpm --filter @magna-carta/data-access test run file-repair-provenance`. Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add packages/data-access/src/file-repair-provenance-statements.ts packages/data-access/package.json packages/data-access/test/file-repair-provenance-statements.test.ts
git commit -m "feat(data-access): file_repair_provenance record + read statements"
```

---

## Task 3: `repair/attach` route (new version + new file) with provenance + audit

**Files:**

- Modify: `apps/worker/src/routes/files/file-repair.ts` (export `dispatchToRecovery`, `RepairResultSchema`; add the attach helper + `repair/attach` route)
- Modify: `apps/worker/src/chokepoint/context-accessors.ts` (add `requireChokepointPermissions`)
- Modify: the chokepoint middleware to stash the resolved permission set on context (near `chokepoint.ts:195`)
- Test: `apps/worker/test/file-repair-attach.test.ts`

**Interfaces:**

- Consumes: `dispatchToRecovery(c, "repair")` (from Task's own export), `RepairResultSchema`, `initiateUpload` + `InitiateUploadInput` (`@magna-carta/file-manager/file-service`), `recordRepairProvenanceStatement` (Task 2), `fileAuditStatement` (`@magna-carta/file-manager/audit`), `runIdempotentEffect`, `requireBucket`, `requireChokepointFirmContext`, `requireChokepointUserId`, `newIdentifier`.
- Produces: `POST /api/v1/file-repair/repair/attach` → 202 `{ fileId, versionId }`; the shared `attachOneFile(...)` helper reused by Task 4.

- [ ] **Step 1: Expose the resolved permission set on context.** At the chokepoint middleware site that computes `permissions` (around `apps/worker/src/chokepoint/chokepoint.ts:194`), store it: `c.set("permissions", permissions)` (add `permissions` to the context `Variables` type if not present). Then in `apps/worker/src/chokepoint/context-accessors.ts`:

```ts
import { assertPermission } from "@magna-carta/access-control/registry";
// ...
export function requireChokepointPermissions(c: AppContext): ReadonlySet<string> {
  const permissions = c.get("permissions");
  if (permissions === undefined) {
    throw new Error("chokepoint permission set missing from context");
  }
  return permissions;
}

// Assert a SECOND capability inside a handler whose RouteMeta.permission named the first.
export function assertAlsoHasPermission(c: AppContext, permission: string): void {
  const required = assertPermission(permission);
  if (!requireChokepointPermissions(c).has(required)) {
    throw new ForbiddenError(`missing ${permission}`); // mirror the chokepoint's own 403 throw shape
  }
}
```

(Confirm the exact 403 throw the chokepoint uses at `chokepoint.ts:195` and reuse it, so the handler's second-gate 403 is identical to the primary gate's.)

- [ ] **Step 2: Write the failing tests.** Create `apps/worker/test/file-repair-attach.test.ts` (mirror `file-repair.test.ts`'s auth/seed harness; seed a matter + folder; grant `tools:fileRepair` and `files:upload`):

```ts
it("repair/attach creates a NEW FILE and persists provenance", async () => {
  const cookie = await ownerCookie("attach-newfile@example.com", "Attach NewFile");
  const res = await postAttach("repair/attach", cookie, "a corrupt but recoverable pdf", {
    matterId: poolMatterId,
    folderId: poolFolderId,
    fileName: "recovered.pdf",
  });
  expect(res.status).toBe(202);
  const body = (await res.json()) as { fileId: string; versionId: string };
  expect(body.fileId).toMatch(/^file_/);
  expect(body.versionId).toMatch(/^fileVersion_/);
  const prov = await readRepairProvenance(firmDb, body.versionId);
  expect(prov?.operation).toBe("repair");
  expect(typeof prov?.fullyRecovered).toBe("boolean");
});

it("repair/attach adds a NEW VERSION to an existing file", async () => {
  const cookie = await ownerCookie("attach-newver@example.com", "Attach NewVer");
  const existing = await seedCommittedFile(poolMatterId, poolFolderId); // helper: a normal committed file
  const res = await postAttach("repair/attach", cookie, "a corrupt but recoverable pdf", {
    matterId: poolMatterId,
    fileId: existing.fileId,
  });
  expect(res.status).toBe(202);
  const body = (await res.json()) as { fileId: string; versionId: string };
  expect(body.fileId).toBe(existing.fileId);
});

it("repair/attach rejects without files:upload even with tools:fileRepair", async () => {
  const cookie = await toolOnlyCookie("attach-noupload@example.com"); // tools:fileRepair but NOT files:upload
  const res = await postAttach("repair/attach", cookie, "bytes", { matterId: poolMatterId });
  expect(res.status).toBe(403);
});

it("repair/attach 422 when the engine cannot reconstruct", async () => {
  const cookie = await ownerCookie("attach-unrep@example.com", "Attach Unrep");
  const res = await postAttach("repair/attach", cookie, "hopeless UNREPAIRABLE bytes", {
    matterId: poolMatterId,
  });
  expect(res.status).toBe(422);
});
```

`postAttach(path, cookie, body, query)` posts the octet-stream body with the target as query params. Provide `firmDb` (the pool firm DB) + `seedCommittedFile` + `toolOnlyCookie` helpers in the test support.

- [ ] **Step 3: Run to verify failure.** Run: `pnpm --filter @magna-carta/worker test run file-repair-attach`. Expected: FAIL (route 404).

- [ ] **Step 4: Export the reused pieces** in `apps/worker/src/routes/files/file-repair.ts`: change `async function dispatchToRecovery` → `export async function dispatchToRecovery`, and `const RepairResultSchema` → `export const RepairResultSchema`.

- [ ] **Step 5: Add the attach meta + helper + route** in `apps/worker/src/routes/files/file-repair.ts`:

```ts
const attachBaseMeta = {
  surface: "app",
  authenticated: true,
  permission: "files:upload", // the matter-write gate; tools:fileRepair is asserted in-handler (dual gate)
  resource: "matter",
  audited: true,
  idempotency: "optional",
  rateLimit: "expensive",
} as const satisfies Omit<RouteMeta, "operationId">;

export const fileRepairRepairAttachMeta: RouteMeta = {
  ...attachBaseMeta,
  operationId: "fileRepair.repairAttach",
};

// One salvaged file -> one attached version, riding the ingest gate. Returns the ids; the async ingest
// consumer commits or quarantines the pending version. The provenance + audit commit atomically with the
// pending version so the honest manifest is durable even if ingest later quarantines the reconstruction.
async function attachOneFile(
  c: AppContext,
  file: { name: string; mediaType: string | null; contentBase64: string },
  manifest: unknown,
  operation: "repair" | "carve",
  target: { matterId: MatterId; fileId?: FileId; folderId?: FolderId | null; fileName: string },
): Promise<{ fileId: string; versionId: string }> {
  const firm = requireChokepointFirmContext(c);
  const userId = requireChokepointUserId(c);
  const bucket = requireBucket(firm.bucketName);
  const bytes = decodeBase64(file.contentBase64);
  const now = () => new Date().toISOString();
  const options = { clock: { now }, actorUserId: userId, randomSource: undefined };

  const result = await runIdempotentEffectOrPlain(c, firm.firmDatabase, async () => {
    const initiated = await initiateUpload(
      firm.firmDatabase,
      {
        matterId: target.matterId,
        fileId: target.fileId,
        folderId: target.folderId ?? null,
        name: target.fileName,
        declaredSize: bytes.length,
        declaredContentType: file.mediaType,
        uploadedBy: userId,
        mode: "put",
        uploadKind: "interactive",
      },
      options,
    );
    const provenanceId = newIdentifier("repairProvenance", undefined);
    const lm = manifest as {
      fullyRecovered: boolean;
      items: { recovered: boolean }[];
      synthesized: unknown[];
    };
    return {
      write: {
        statements: [
          ...initiated.effect.statements,
          recordRepairProvenanceStatement(firm.firmDatabase, {
            id: provenanceId,
            fileVersionId: initiated.versionId,
            operation,
            fullyRecovered: lm.fullyRecovered,
            manifestJson: JSON.stringify(manifest),
            sourceMediaType: file.mediaType,
            createdAt: now(),
          }),
          fileAuditStatement(
            firm.firmDatabase,
            options,
            operation === "repair" ? "file.repaired" : "file.carved",
            initiated.versionId,
            {
              operation,
              fullyRecovered: lm.fullyRecovered,
              lostCount: lm.items.filter((i) => !i.recovered).length,
              synthesizedCount: lm.synthesized.length,
            },
          ),
        ],
        outboxMessages: initiated.effect.outboxMessages,
      },
      value: { fileId: initiated.fileId, versionId: initiated.versionId, r2Key: initiated.r2Key },
    };
  });

  // The metadata batch is committed; now put the bytes so the R2 event drives ingest.
  await bucket.put(result.r2Key, bytes);
  return { fileId: result.fileId, versionId: result.versionId };
}
```

Implement `runIdempotentEffectOrPlain(c, db, effect)` as a thin wrapper: if the request carries an idempotency key, use `runIdempotentEffect`; else execute the effect's `write` through the chokepoint's plain effect writer (mirror how another `idempotency:"optional"` mutating route writes its effect). Return `value`.

Then register the route in `registerFileRepairRoutes`:

```ts
const repairAttachRoute = defineOpenAPIRoute(fileRepairRepairAttachMeta, {
  method: "post",
  path: "/api/v1/file-repair/repair/attach",
  description:
    "Repair the uploaded corrupt file and save the result into a matter: a new version of an existing " +
    "file (when fileId is given) or a new file. The reconstruction rides the ingest malware gate; the " +
    "honest loss manifest is stored with the version. Returns 202 — the version is pending until ingest resolves.",
  request: {
    query: z.object({
      matterId: z.string(),
      fileId: z.string().optional(),
      folderId: z.string().optional(),
      fileName: z.string().optional(),
    }),
    body: { content: { "application/octet-stream": { schema: z.any() } }, required: true },
  },
  responses: {
    202: {
      description: "Attaching; version pending",
      content: {
        "application/json": { schema: z.object({ fileId: z.string(), versionId: z.string() }) },
      },
    },
    422: salvageResponses[422],
    ...problemResponses,
  },
});

app.openapi(
  { ...repairAttachRoute, middleware: chokepointMiddleware(chokepoint, repairAttachRoute) },
  async (c) => {
    assertAlsoHasPermission(c, "tools:fileRepair");
    const dispatched = await dispatchToRecovery(c, "repair");
    if (!dispatched.ok) return dispatched.problem;
    const { containerResponse } = dispatched;
    if (containerResponse.status === 422) {
      return problemJson(c, {
        type: "validation",
        title: "The file could not be repaired",
        status: 422,
        detail: "The recovery engine could not reconstruct usable content from this file.",
      });
    }
    if (containerResponse.status !== 200) {
      return problemJson(c, {
        type: "service-unavailable",
        title: "Recovery failed",
        status: 503,
        detail: "The recovery engine returned an error. Try again shortly.",
      });
    }
    const result = RepairResultSchema.parse(await containerResponse.json());
    const q = c.req.valid("query");
    const file = result.files[0];
    const attached = await attachOneFile(c, file, result.loss, "repair", {
      matterId: q.matterId as MatterId,
      fileId: q.fileId as FileId | undefined,
      folderId: (q.folderId as FolderId | undefined) ?? null,
      fileName: q.fileName ?? file.name,
    });
    return c.json(attached, 202);
  },
);
```

- [ ] **Step 6: Run the tests.** Run: `pnpm --filter @magna-carta/worker test run file-repair-attach`. Expected: PASS (new-file, new-version, 403-without-upload, 422-unrepairable). Fix the RECOVERY_SERVICE stub if the new-version path needs a distinct output.

- [ ] **Step 7: Commit.**

```bash
git add apps/worker/src/routes/files/file-repair.ts apps/worker/src/chokepoint apps/worker/test/file-repair-attach.test.ts
git commit -m "feat(worker): repair/attach route — new version or new file via the ingest gate, provenance persisted"
```

---

## Task 4: `carve/attach` route (N new files)

**Files:**

- Modify: `apps/worker/src/routes/files/file-repair.ts` (add `carve/attach` route + a name sanitizer)
- Test: extend `apps/worker/test/file-repair-attach.test.ts`

**Interfaces:**

- Consumes: `attachOneFile` (Task 3), `dispatchToRecovery(c, "carve")`.
- Produces: `POST /api/v1/file-repair/carve/attach` → 202 `{ files: { fileId, versionId, name }[] }`.

- [ ] **Step 1: Write the failing test.**

```ts
it("carve/attach creates N new files, each with provenance", async () => {
  const cookie = await ownerCookie("attach-carve@example.com", "Attach Carve");
  const res = await postAttach("carve/attach", cookie, "junk with an embedded jpeg", {
    matterId: poolMatterId,
    folderId: poolFolderId,
  });
  expect(res.status).toBe(202);
  const body = (await res.json()) as {
    files: { fileId: string; versionId: string; name: string }[];
  };
  expect(body.files.length).toBeGreaterThan(0);
  for (const f of body.files) {
    expect(await readRepairProvenance(firmDb, f.versionId)).not.toBeNull();
  }
});
```

- [ ] **Step 2: Run to verify failure.** Run: `pnpm --filter @magna-carta/worker test run file-repair-attach`. Expected: FAIL (carve/attach 404).

- [ ] **Step 3: Add a filename sanitizer + the route.**

```ts
// Carved names come from the engine's SalvagedFile.name; strip any path separators / traversal so a
// carved fragment can never write outside its folder or collide with a control name.
function sanitizeCarvedName(name: string, index: number): string {
  const base = name.replace(/[/\\]/g, "_").replace(/^\.+/, "").trim();
  return base.length > 0 ? base : `carved-${index + 1}`;
}
```

```ts
export const fileRepairCarveAttachMeta: RouteMeta = {
  ...attachBaseMeta,
  operationId: "fileRepair.carveAttach",
};

const carveAttachRoute = defineOpenAPIRoute(fileRepairCarveAttachMeta, {
  method: "post",
  path: "/api/v1/file-repair/carve/attach",
  description:
    "Carve embedded files out of the uploaded input and save each as a new file in the matter folder. " +
    "Each carved file rides the ingest malware gate and carries the honest carve manifest. Returns 202.",
  request: {
    query: z.object({ matterId: z.string(), folderId: z.string().optional() }),
    body: { content: { "application/octet-stream": { schema: z.any() } }, required: true },
  },
  responses: {
    202: {
      description: "Attaching carved files; versions pending",
      content: {
        "application/json": {
          schema: z.object({
            files: z.array(
              z.object({ fileId: z.string(), versionId: z.string(), name: z.string() }),
            ),
          }),
        },
      },
    },
    422: salvageResponses[422],
    ...problemResponses,
  },
});

app.openapi(
  { ...carveAttachRoute, middleware: chokepointMiddleware(chokepoint, carveAttachRoute) },
  async (c) => {
    assertAlsoHasPermission(c, "tools:fileRepair");
    const dispatched = await dispatchToRecovery(c, "carve");
    if (!dispatched.ok) return dispatched.problem;
    const { containerResponse } = dispatched;
    if (containerResponse.status === 422) {
      return problemJson(c, {
        type: "validation",
        title: "Nothing could be carved",
        status: 422,
        detail: "The recovery engine could not carve any valid embedded file from this input.",
      });
    }
    if (containerResponse.status !== 200) {
      return problemJson(c, {
        type: "service-unavailable",
        title: "Recovery failed",
        status: 503,
        detail: "The recovery engine returned an error. Try again shortly.",
      });
    }
    const result = RepairResultSchema.parse(await containerResponse.json());
    const q = c.req.valid("query");
    const attached: { fileId: string; versionId: string; name: string }[] = [];
    for (const [index, file] of result.files.entries()) {
      const name = sanitizeCarvedName(file.name, index);
      const one = await attachOneFile(c, file, result.loss, "carve", {
        matterId: q.matterId as MatterId,
        folderId: (q.folderId as FolderId | undefined) ?? null,
        fileName: name,
      });
      attached.push({ ...one, name });
    }
    return c.json({ files: attached }, 202);
  },
);
```

- [ ] **Step 4: Run the tests.** Run: `pnpm --filter @magna-carta/worker test run file-repair-attach`. Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add apps/worker/src/routes/files/file-repair.ts apps/worker/test/file-repair-attach.test.ts
git commit -m "feat(worker): carve/attach route — N carved files into a matter folder, provenance per file"
```

---

## Task 5: Flagged-via-ingest integration test + contract regen

**Files:**

- Test: `apps/worker/test/file-repair-attach.test.ts` (add the flagged + quarantine assertions)
- Modify: regenerated OpenAPI contract artifacts

**Interfaces:** none new.

- [ ] **Step 1: Write the flagged test.** Drive the ingest consumer directly over the attached pending version (the R2-event→queue chain is not automatic under the test pool). Use the 6a `RECOVERY_SERVICE` stub's `TRIGGERMALWARE` marker so the container output carries the `MALWARE_EICAR` marker, then invoke `handleIngestMessage` for the pending version and assert it is quarantined (under the default `flaggedTreatment` = block):

```ts
it("a flagged reconstruction is quarantined by the ingest gate (firm policy = block)", async () => {
  const cookie = await ownerCookie("attach-flagged@example.com", "Attach Flagged");
  const res = await postAttach("repair/attach", cookie, "corrupt pdf TRIGGERMALWARE payload", {
    matterId: poolMatterId,
    folderId: poolFolderId,
    fileName: "suspect.pdf",
  });
  expect(res.status).toBe(202);
  const { versionId, r2Key } = (await res.json()) as any; // r2Key exposed only in the test build, or look it up
  await driveIngestForVersion(firmDb, env, versionId, r2Key); // helper: builds the R2EventMessage + calls handleIngestMessage
  const version = await loadVersionStatus(firmDb, versionId);
  expect(version.status).toBe("quarantined");
  // Provenance persists on the quarantined version too (chain of custody).
  expect(await readRepairProvenance(firmDb, versionId)).not.toBeNull();
});
```

Provide `driveIngestForVersion` (mirror how `ingest-consumer` tests build an `R2EventMessage` and call `handleIngestMessage`) and `loadVersionStatus`.

- [ ] **Step 2: Run it.** Run: `pnpm --filter @magna-carta/worker test run file-repair-attach`. Expected: PASS.

- [ ] **Step 3: Regenerate the OpenAPI contract.** Run the repo's emit script (`vp run emit-openapi` + `generate-client`, the same as 6a Task 6). Commit the regenerated artifacts with the routes.

- [ ] **Step 4: Full worker gate.** Run: `pnpm --filter @magna-carta/worker test run` and `pnpm check` (fmt+lint+typecheck). Expected: PASS. Run the process-ref citation grep on the changed source: `git grep -nE "golden rule|ADR-[0-9]|spec §|slice [0-9]|Plan [0-9]" -- apps/worker/src/routes/files/file-repair.ts packages/data-access/src/file-repair-provenance-statements.ts` — expected: no matches.

- [ ] **Step 5: Commit.**

```bash
git add apps/worker/test/file-repair-attach.test.ts apps/worker/src/contracts # + regenerated contract
git commit -m "test(worker): flagged reconstruction quarantines via the ingest gate; regen contract"
```

---

## Task 6: Docs, fragments, status

**Files:** `changelog.d/file-repair-attach.md`, `STATUS.md`, `ROADMAP.md`, `docs/active-work/file-repair-salvage.md`

- [ ] **Step 1: Changelog fragment.** Create `changelog.d/file-repair-attach.md`:

```markdown
---
category: Added
---

File Repair & Salvage can now save its output into a matter: repair a file as a
new version (or a new file), or carve embedded files into a matter folder as new
files. Reconstructed output passes the same malware gate as any upload, and each
saved version carries an honest record of what the recovery could and could not
reconstruct.
```

- [ ] **Step 2: STATUS + ROADMAP.** Update the File Repair rows: attach-to-matter built/tested; note the stateless + attach surfaces are complete, UI deferred to 0·7a.

- [ ] **Step 3: Active-work note.** Update `docs/active-work/file-repair-salvage.md` to reflect 6b built; confirm the `0036` migration number and flag renumber-at-merge if a concurrent stream landed a `0036` first.

- [ ] **Step 4: Commit.**

```bash
git add changelog.d/file-repair-attach.md STATUS.md ROADMAP.md docs/active-work/file-repair-salvage.md
git commit -m "docs(file-repair): attach-to-matter changelog + status"
```

---

## Whole-plan review (before merge)

- [ ] Opus adversarial review of the full 6b change set, load-bearing checks: (1) the loss manifest reaches `file_repair_provenance` verbatim and `fully_recovered` is never fabricated; (2) `commitEditedVersion` is never used for repaired output; (3) the dual permission gate (`files:upload` + `tools:fileRepair`) cannot be bypassed on any attach path; (4) no manifest names/content in any audit/log/Problem (only counts); (5) a flagged reconstruction quarantines (or commits-flagged per firm policy) and never silently commits clean; (6) `ingest-core.ts` / `ingest-consumer.ts` untouched; (7) the carve name sanitizer blocks path traversal; (8) cross-matter `folderId` is rejected (inherited from `initiateUpload`). Then a sonnet re-review confirming fixes hold.
- [ ] At SP2 merge: `vp run decisions-build` + `vp run changelog-build`; renumber `0036` if a tools/schema stream merged first; remove the worktree + branch + `docs/active-work/file-repair-salvage.md`.

## Self-review notes (author)

- **Spec coverage:** routes (T3/T4), server-side-upload reuse (T3 `attachOneFile`), provenance table + persistence (T1/T2/T3), audit (T3), flagged→firm-policy (T5), authorization dual-gate (T1 accessor + T3/T4), never-edit-ingest (constraint), testing (T3/T4/T5), docs (T6). All covered.
- **Deferred-to-executor (not placeholders):** the exact drizzle-generate invocation (Task 1 Step 6, with the exact SQL given as the target), the exact `runIdempotentEffectOrPlain` plain-writer branch (Task 3 Step 5, mirror an existing optional-idempotency route), and the exact chokepoint 403 throw to reuse (Task 3 Step 1). Each names the precedent to mirror and the fixed contract.
- **Type consistency:** `attachOneFile` / `recordRepairProvenanceStatement` / `readRepairProvenance` signatures match across T2–T4; `operation` union `"repair"|"carve"` consistent; `RepairProvenanceId` used in schema + statements.
