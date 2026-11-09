# Slice 2·3 — Inline preview + safe-delivery sandbox (backend-only) — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal.** Land the backend + Worker surface for inline file preview: an additive nullable two-axis `inline_playable` verdict column on `file_version` (compute deferred), a firm-scoped preview-grant route `GET /api/v1/files/{id}/preview` that runs a pure `decidePreview` gate and mints a Worker-signed delivery token, and a host-guarded cookieless serving route `GET /api/files-preview/{token}` that streams R2 bytes with HTTP Range/206 (+ If-Range conditional resume) wrapped in the safe-delivery header set. No player UI (deferred to 0·7a/0·7b).

**Architecture.** Two hostnames, one Worker. The API origin (`app.*`) proves identity through the ADR-0067 chokepoint, reads the verdict + storage facts off the current clean version, decides inline-media vs download-only, and signs the decision into an opaque HMAC token. The cookieless files host (`files.*`) honors only that signed token — no session, no chokepoint — deriving every response header + bucket + key from the verified payload, streaming R2 bytes that can reach only a browser media decoder. Safety rests on the cookieless origin + `Content-Disposition: attachment` (honored on navigation, ignored for the `<video>` subresource) + the server-fixed sniffed `Content-Type` + the sandbox CSP — independent of verdict correctness. The verdict gates feature quality; the delivery shape gates safety.

**Tech Stack.** TypeScript, Cloudflare Workers + Hono, `@hono/zod-openapi` (OpenAPI 3.1 code-as-contract), Drizzle/D1 (per-firm schema), R2, HMAC-SHA-256 via `crypto.subtle` + `constantTimeStringEquals`, Vitest + Miniflare (`workers-pool`, `cloudflare:test` `SELF.fetch` + `env`).

## Global Constraints

- **TDD.** Every task is red → green → commit. Write the failing test first, run it, see it fail for the right reason, then implement, then see it pass.
- **Landing sequence (spec §11.4).** The additive `per-firm-schema.ts` column + its generated migration + the schema test land on **`main`** ahead of the worktrees (Task 1). Everything else lands on the **`slice-2-3-safe-delivery`** branch (Tasks 2–16).
- **Never edit `packages/file-manager/src/ingest-core.ts`** (spec §11.2). All file-manager changes are additive: a new exported read, a new `preview-policy.ts`, a new `safe-rendition-port.ts`. Do **not** edit `getCurrentCleanVersion` or `selectCurrentCleanVersionStatement`.
- **Before touching anything under `packages/file-manager/`**, sync `main` and manually diff `queries.ts` / `per-firm-schema.ts` against `C:/dev/magna-carta-2-1-dev` (the 2·1 worktree is built-but-unmerged with no active-work note, so `vp run worktrees` will miss the overlap).
- **Migration number deferred** — `0013` is the latest committed; number at land time gated on `vp run worktrees` (the placeholder `00NN` below must be replaced with whatever number `generate-per-firm-migrations` emits). Migrations are **generated, never hand-authored** (`pnpm --filter @magna-carta/database run generate-per-firm-migrations`).
- **All `/api/v1` routes ride the chokepoint** via `chokepointMiddleware(chokepoint, route)`. The cookieless route is the **named exception** — a bare host-guarded `app.get`, registered before the `/api/v1` routes and before `app.get("*")`, never via `defineOpenAPIRoute`.
- **The cookieless edge emits NO `problemJson`** — no `error_` id, no `correlationId` (spec §8). Bare non-JSON 404 with `Content-Disposition: attachment` + `nosniff`. Guard the `R2.get(...) === null` race explicitly so a `.body` deref never throws into `app.onError`.
- **Sign the token with `AUTH_SECRET`** (required binding), HMAC-SHA-256, verified constant-time via `constantTimeStringEquals` — NOT through the R2 presigner (so dev/test exercises the real sign/verify path).
- **`storage_class` stored value is `'standard'` | `'infrequent_access'` (NOT `'ia'`)**; `storage_encoding` is `'full'`; `artifact_role` is `'original'` | `'derived'`. `decidePreview` compares against these literals.
- **`inline_playable` is nullable, no `.notNull()`, no `.default()`** — NULL (never-sniffed) stays distinct from `'indeterminate'`.
- **Token TTL reuses `DOWNLOAD_TTL_SECONDS = 300`** — do NOT introduce a distinct `PREVIEW_TTL_SECONDS`.
- **`FILES_ORIGIN` is a public hostname**, added as `FILES_ORIGIN?: string` on `Bindings` and bound via `wrangler.jsonc` `vars` (NOT `.dev.vars` — that is for secrets; do not touch `.dev.vars`/`dev-vars.test.ts`). When unset, the grant degrades to `mode: "download-only"`, `reason: "host-unavailable"` (§6.11).
- **Desktop transport invariant (spec §6.9, pinned now).** The preview route is served over real HTTP(S) on both web and desktop; never a `tauri://` custom-scheme proxy (those do not honor HTTP Range, so seeking dies). The player slice inherits this contract — it is written down now in the active-work note + the safe-delivery-sandbox ADR fragment (Task 16), since no player code exists this slice to pin it in.
- **CORS posture (spec §6.10, decided).** The cookieless host sends NO `Access-Control-Allow-Origin` at launch; a native `<video src>` subresource needs none. Pinned by an assertion in the header test (Task 7) + the standing fitness guard (Task 12) so a regression that adds it is caught.
- **Naming (golden rule 12):** full names — `getCurrentCleanVersionForPreview`, `sniffedContentType`, `mintPreviewDeliveryToken`. No shorthand.
- **No process-ref citations (golden rule 13):** source/strings carry no ADR/slice/spec citation; state reasoning inline or cite `docs/conventions/security.md` by path. The one allowed exception is a forward-looking "when the player UI lands" comment. Enforced by `node tooling/lint-process-references.mjs`.
- **Run a single worker test file** with `pnpm --filter @magna-carta/worker exec vitest run <relativePath>`. Run a file-manager test with `pnpm --filter @magna-carta/file-manager exec vitest run <relativePath>`. Full gate: `pnpm check`.

---

## Task 1 — `inline_playable` column + CHECK + generated migration (on `main`)

**Files**

- Modify: `packages/database/src/per-firm-schema.ts`
- Create (generated): `packages/database/drizzle/per-firm/00NN_<slug>.sql` + `meta/00NN_snapshot.json` + `meta/_journal.json` entry (all emitted by `generate-per-firm-migrations`)
- Modify (test): `packages/database/test/matters-files-schema.test.ts` (add the column assertion)

**Interfaces**

- Produces: a nullable enum column `inlinePlayable: text("inline_playable", { enum: ["playable","download-only","indeterminate"] })` (no `.notNull()`, no `.default()`) and a CHECK `file_version_inline_playable_check`.
- Consumed by: Task 2 (`getCurrentCleanVersionForPreview`), Task 3 (`decidePreview` reads `inlinePlayable`).

Steps:

- [ ] **Sync + diff guard.** On a clean checkout of `main`, run `git -C C:/dev/magna-carta-2-1-dev diff main -- packages/database/src/per-firm-schema.ts packages/file-manager/src/queries.ts` (or open both files in the 2·1 worktree) and confirm the `file_version` table column cluster and `queries.ts` reads have NOT been relocated/renamed there. If they have, reconcile before proceeding.
- [ ] **Write the failing schema test** in `packages/database/test/matters-files-schema.test.ts` (append inside the `describe("matters / locations / file-manager schema", ...)` block, using the file's existing idiom — `getTableConfig(...).columns.find(...)` and `.checks.map(...)`, the only drizzle import already present is `getTableConfig`, so NO new import is needed):
  ```ts
  it("file_version: inline_playable is a nullable enum column with no default + a matching CHECK", () => {
    const config = getTableConfig(fileVersion);
    const column = config.columns.find((c) => c.name === "inline_playable");
    expect(column).toBeDefined();
    expect(column?.notNull).toBe(false);
    expect(column?.hasDefault).toBe(false);
    expect(column?.enumValues).toEqual(["playable", "download-only", "indeterminate"]);
    expect(config.checks.map((c) => c.name)).toContain("file_version_inline_playable_check");
  });
  ```
- [ ] **Run it red:** `pnpm --filter @magna-carta/database exec vitest run test/matters-files-schema.test.ts` → expect failure: the `inline_playable` column is not found (`column` is `undefined`).
- [ ] **Add the column** to `packages/database/src/per-firm-schema.ts`, in the `fileVersion` column object, in the same metadata-seam cluster as `storage_encoding` / `artifact_role` / `storage_class` (place it immediately after the `scanEngineVersion` line):
  ```ts
    // NULL = never sniffed; set by the codec sniff when a reader first computes it. NULL must stay
    // distinct from 'indeterminate' (sniffed-but-undecidable) so a corpus roll-up can tell "never
    // looked" from "looked, can't decide". Only a positive 'playable' unlocks inline media.
    inlinePlayable: text("inline_playable", {
      enum: ["playable", "download-only", "indeterminate"],
    }),
  ```
- [ ] **Add the CHECK** to the `(table) => [ ... ]` array, after `file_version_scan_verdict_check`:
  ```ts
      check(
        "file_version_inline_playable_check",
        sql`${table.inlinePlayable} IS NULL OR ${table.inlinePlayable} IN ('playable', 'download-only', 'indeterminate')`,
      ),
  ```
- [ ] **Generate the migration:** `pnpm --filter @magna-carta/database run generate-per-firm-migrations`. Confirm it emits a one-line ``ALTER TABLE `file_version` ADD `inline_playable` text;`` migration, a `meta/00NN_snapshot.json`, and a `_journal.json` entry. **Do not hand-edit any of the three.** The emitted number is the land-time number (replace `00NN`).
- [ ] **Run green:** `pnpm --filter @magna-carta/database exec vitest run` (runs `matters-files-schema.test.ts`, `schema-conformance.test.ts`, `generated-migrations.test.ts`) → all pass.
- [ ] **Commit on `main`:**

  ```
  git add packages/database/src/per-firm-schema.ts packages/database/drizzle/per-firm packages/database/test/matters-files-schema.test.ts
  git commit -m "feat(file-version): add nullable inline_playable verdict column + CHECK + migration

  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
  ```

---

## Task 2 — `getCurrentCleanVersionForPreview` + widen `listCleanVersions` (additive)

**Files**

- Modify: `packages/file-manager/src/queries.ts`
- Create (test): `packages/file-manager/test/preview-version-read.test.ts`

**Interfaces**

- Consumes: `inline_playable` column (Task 1); `SqlDatabase`, `SqlStatement`, `FILE_TABLE`, `FILE_VERSION_TABLE`, `FileVersionId`, `FileId` (existing imports in `queries.ts`). The real file-manager test harness is `packages/file-manager/test/support.ts` (`freshDatabase()` → migrated `BatchDatabase`, assignable to `SqlDatabase`; `seedMatter(database)` → `MatterId`).
- Produces:
  ```ts
  export interface CleanVersionForPreview {
    readonly id: FileVersionId;
    readonly r2Key: string;
    readonly sizeBytes: number | null;
    readonly versionNumber: number;
    readonly inlinePlayable: "playable" | "download-only" | "indeterminate" | null;
    readonly storageClass: string;
    readonly storageEncoding: string;
    readonly sniffedContentType: string | null;
    readonly artifactRole: string;
  }
  export function selectCurrentCleanVersionForPreviewStatement(
    database: SqlDatabase,
    fileId: FileId,
  ): SqlStatement;
  export async function getCurrentCleanVersionForPreview(
    database: SqlDatabase,
    fileId: FileId,
  ): Promise<CleanVersionForPreview | undefined>;
  ```
  plus a widened `CleanVersionListItem` (add `readonly inlinePlayable: "playable" | "download-only" | "indeterminate" | null;`).
- Consumed by: Task 3 (`decidePreview(version: CleanVersionForPreview)`), Task 9 (the grant route).

Steps:

- [ ] **Write the failing test** `packages/file-manager/test/preview-version-read.test.ts` against the REAL harness (`./support.ts` — there is no `support/file-manager-db.ts`). Seed the `file` + `file_version` rows inline with a real INSERT mirroring `seedCleanFile`'s column list, setting `current_version_id`:

  ```ts
  import { describe, expect, it } from "vitest";
  import { newIdentifier } from "@magna-carta/identifiers";
  import type { BatchDatabase } from "@magna-carta/data-access/effect-batch";
  import type { FileId } from "@magna-carta/identifiers/types";
  import { freshDatabase, seedMatter } from "./support.ts";
  import { getCurrentCleanVersionForPreview } from "../src/queries.ts";

  async function seedFileWithVersion(
    db: BatchDatabase,
    matterId: string,
    overrides: {
      status?: string;
      inlinePlayable?: "playable" | "download-only" | "indeterminate" | null;
      storageClass?: string;
      storageEncoding?: string;
      artifactRole?: string;
      sniffedContentType?: string | null;
      r2Key?: string;
      sizeBytes?: number;
    } = {},
  ): Promise<FileId> {
    const fileId = newIdentifier("file");
    const versionId = newIdentifier("fileVersion");
    const status = overrides.status ?? "clean";
    const r2Key = overrides.r2Key ?? `files/${fileId}/${versionId}`;
    await db
      .prepare(
        "INSERT INTO file (id, matter_id, folder_id, name, document_type_id, current_version_id, deleted_at, created_at, updated_at) VALUES (?1, ?2, NULL, 'f', NULL, NULL, NULL, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')",
      )
      .bind(fileId, matterId)
      .run();
    await db
      .prepare(
        "INSERT INTO file_version (id, file_id, version_number, r2_key, size_bytes, declared_content_type, sniffed_content_type, content_sha256, status, uploaded_by, created_at, committed_at, inline_playable, storage_class, storage_encoding, artifact_role) " +
          "VALUES (?1, ?2, 1, ?3, ?4, 'application/octet-stream', ?5, 'hash', ?6, 'user_a', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', ?7, ?8, ?9, ?10)",
      )
      .bind(
        versionId,
        fileId,
        r2Key,
        overrides.sizeBytes ?? 1234,
        overrides.sniffedContentType === undefined ? "video/mp4" : overrides.sniffedContentType,
        status,
        overrides.inlinePlayable ?? null,
        overrides.storageClass ?? "standard",
        overrides.storageEncoding ?? "full",
        overrides.artifactRole ?? "original",
      )
      .run();
    await db
      .prepare("UPDATE file SET current_version_id = ?2 WHERE id = ?1")
      .bind(fileId, versionId)
      .run();
    return fileId as FileId;
  }

  describe("getCurrentCleanVersionForPreview", () => {
    it("projects the verdict + storage facts off the current clean version", async () => {
      const db = freshDatabase();
      const matterId = await seedMatter(db);
      const fileId = await seedFileWithVersion(db, matterId, {
        inlinePlayable: "playable",
        storageClass: "standard",
        storageEncoding: "full",
        artifactRole: "original",
        sniffedContentType: "video/mp4",
        r2Key: "files/f/v",
        sizeBytes: 1234,
      });
      const version = await getCurrentCleanVersionForPreview(db, fileId);
      expect(version).toEqual({
        id: expect.any(String),
        r2Key: "files/f/v",
        sizeBytes: 1234,
        versionNumber: 1,
        inlinePlayable: "playable",
        storageClass: "standard",
        storageEncoding: "full",
        sniffedContentType: "video/mp4",
        artifactRole: "original",
      });
    });

    it("returns undefined for a non-clean version (status gate preserved)", async () => {
      const db = freshDatabase();
      const matterId = await seedMatter(db);
      const fileId = await seedFileWithVersion(db, matterId, {
        status: "quarantined",
        r2Key: "files/q/v",
      });
      expect(await getCurrentCleanVersionForPreview(db, fileId)).toBeUndefined();
    });
  });
  ```

- [ ] **Run it red:** `pnpm --filter @magna-carta/file-manager exec vitest run test/preview-version-read.test.ts` → fails: `getCurrentCleanVersionForPreview` is not exported.
- [ ] **Add the sibling read** to `packages/file-manager/src/queries.ts`, immediately after `getCurrentCleanVersion` (after the existing `CleanVersion` block, before `listCleanVersionsStatement`):

  ```ts
  // The preview gate's single read: the same clean, non-deleted current version as the download path,
  // widened with the verdict + storage facts decidePreview keys off. A NEW sibling (not an edit to
  // getCurrentCleanVersion) so the status-gated read it mirrors stays untouched. status = 'clean' and
  // deleted_at IS NULL are preserved — a pending/quarantined/deleted version is never previewable.
  export function selectCurrentCleanVersionForPreviewStatement(
    database: SqlDatabase,
    fileId: FileId,
  ): SqlStatement {
    return database
      .prepare(
        `SELECT v.id, v.r2_key, v.size_bytes, v.version_number, v.inline_playable, v.storage_class, v.storage_encoding, v.sniffed_content_type, v.artifact_role FROM ${FILE_TABLE} f JOIN ${FILE_VERSION_TABLE} v ON v.id = f.current_version_id WHERE f.id = ?1 AND f.deleted_at IS NULL AND v.status = 'clean'`,
      )
      .bind(fileId);
  }

  export interface CleanVersionForPreview {
    readonly id: FileVersionId;
    readonly r2Key: string;
    readonly sizeBytes: number | null;
    readonly versionNumber: number;
    readonly inlinePlayable: "playable" | "download-only" | "indeterminate" | null;
    readonly storageClass: string;
    readonly storageEncoding: string;
    readonly sniffedContentType: string | null;
    readonly artifactRole: string;
  }

  export async function getCurrentCleanVersionForPreview(
    database: SqlDatabase,
    fileId: FileId,
  ): Promise<CleanVersionForPreview | undefined> {
    const { results } = await selectCurrentCleanVersionForPreviewStatement(database, fileId).all<{
      id: FileVersionId;
      r2_key: string;
      size_bytes: number | null;
      version_number: number;
      inline_playable: "playable" | "download-only" | "indeterminate" | null;
      storage_class: string;
      storage_encoding: string;
      sniffed_content_type: string | null;
      artifact_role: string;
    }>();
    const row = results[0];
    if (row === undefined) return undefined;
    return {
      id: row.id,
      r2Key: row.r2_key,
      sizeBytes: row.size_bytes,
      versionNumber: row.version_number,
      inlinePlayable: row.inline_playable,
      storageClass: row.storage_class,
      storageEncoding: row.storage_encoding,
      sniffedContentType: row.sniffed_content_type,
      artifactRole: row.artifact_role,
    };
  }
  ```

- [ ] **Widen `listCleanVersions`** (query + interface + mapper ONLY — do NOT touch `listCleanVersionR2KeysStatement`):
  - In `listCleanVersionsStatement` SELECT, add `inline_playable`: `SELECT id, version_number, r2_key, size_bytes, sniffed_content_type, content_sha256, committed_at, inline_playable FROM ${FILE_VERSION_TABLE} WHERE file_id = ?1 AND status = 'clean' ORDER BY version_number DESC`.
  - Add to `CleanVersionListItem`: `readonly inlinePlayable: "playable" | "download-only" | "indeterminate" | null;`.
  - In the `.all<{...}>()` generic add `inline_playable: "playable" | "download-only" | "indeterminate" | null;` and in the `.map` add `inlinePlayable: row.inline_playable,`.
- [ ] **Verify no FileVersionItem leak.** Confirm `apps/worker/src/routes/files/files.ts` line ~471-481 maps each `CleanVersionListItem` with EXPLICIT fields (`id`, `versionNumber`, `sizeBytes`, `sniffedContentType`, `contentSha256`, `committedAt`) and never object-spreads `...version`. (Confirmed at plan time — the handler picks fields explicitly, so `inlinePlayable` cannot leak into the `FileVersionItem` response or the OpenAPI snapshot.) If a future spread is found, leave it explicit.
- [ ] **Run green:** `pnpm --filter @magna-carta/file-manager exec vitest run` → all file-manager tests pass (the status-gate fitness function still passes — the new read keeps `status = 'clean'`).
- [ ] **Commit:**

  ```
  git commit -am "feat(file-manager): add getCurrentCleanVersionForPreview + surface inline_playable in listCleanVersions

  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
  ```

---

## Task 3 — `decidePreview` pure decision function + unit tests

**Files**

- Create: `packages/file-manager/src/preview-policy.ts`
- Create (test): `packages/file-manager/test/preview-policy.test.ts`
- Modify: `packages/file-manager/package.json` (exports map: add `"./preview-policy"`)

**Interfaces**

- Consumes: `CleanVersionForPreview` (Task 2).
- Produces:
  ```ts
  export type PreviewDecision =
    | { kind: "inline-media"; r2Key: string; sniffedContentType: string; sizeBytes: number | null }
    | {
        kind: "download-only";
        reason: "verdict" | "unknown-verdict" | "tiered" | "encoded" | "derived" | "unknown-type";
      };
  export function decidePreview(version: CleanVersionForPreview): PreviewDecision;
  ```
- Consumed by: Task 9 (grant route), Task 13 (e2e).

Steps:

- [ ] **Write the failing table test** `packages/file-manager/test/preview-policy.test.ts`:

  ```ts
  import { describe, expect, it } from "vitest";
  import { decidePreview } from "../src/preview-policy.ts";
  import type { CleanVersionForPreview } from "../src/queries.ts";

  const base: CleanVersionForPreview = {
    id: "fileVersion_x" as never,
    r2Key: "files/f/v",
    sizeBytes: 100,
    versionNumber: 1,
    inlinePlayable: "playable",
    storageClass: "standard",
    storageEncoding: "full",
    sniffedContentType: "video/mp4",
    artifactRole: "original",
  };

  describe("decidePreview", () => {
    it("unlocks inline-media only when playable + standard + full + not-derived + sniffed-type-known", () => {
      expect(decidePreview(base)).toEqual({
        kind: "inline-media",
        r2Key: "files/f/v",
        sniffedContentType: "video/mp4",
        sizeBytes: 100,
      });
    });

    it("fails closed on NULL verdict (the launch state) -> download-only/unknown-verdict", () => {
      expect(decidePreview({ ...base, inlinePlayable: null })).toEqual({
        kind: "download-only",
        reason: "unknown-verdict",
      });
    });

    it("downgrades a known non-playable verdict -> download-only/verdict", () => {
      expect(decidePreview({ ...base, inlinePlayable: "download-only" })).toEqual({
        kind: "download-only",
        reason: "verdict",
      });
      expect(decidePreview({ ...base, inlinePlayable: "indeterminate" })).toEqual({
        kind: "download-only",
        reason: "verdict",
      });
    });

    it("fails closed on an UNKNOWN out-of-enum verdict string (the stored-XSS regression guard — must never be weakened)", () => {
      expect(decidePreview({ ...base, inlinePlayable: "totally-unknown" as never })).toEqual({
        kind: "download-only",
        reason: "verdict",
      });
    });

    it("playable but sniffedContentType null/empty -> download-only/unknown-type (the single-decision guard)", () => {
      expect(decidePreview({ ...base, sniffedContentType: null })).toEqual({
        kind: "download-only",
        reason: "unknown-type",
      });
      expect(decidePreview({ ...base, sniffedContentType: "" })).toEqual({
        kind: "download-only",
        reason: "unknown-type",
      });
    });

    it("playable but tiered/encoded/derived -> download-only with the matching reason", () => {
      expect(decidePreview({ ...base, storageClass: "infrequent_access" })).toEqual({
        kind: "download-only",
        reason: "tiered",
      });
      expect(decidePreview({ ...base, storageEncoding: "delta" })).toEqual({
        kind: "download-only",
        reason: "encoded",
      });
      expect(decidePreview({ ...base, artifactRole: "derived" })).toEqual({
        kind: "download-only",
        reason: "derived",
      });
    });

    it("evaluation order: verdict is checked before content-type before tier", () => {
      expect(
        decidePreview({
          ...base,
          inlinePlayable: null,
          sniffedContentType: null,
          storageClass: "infrequent_access",
        }),
      ).toEqual({
        kind: "download-only",
        reason: "unknown-verdict",
      });
    });
  });
  ```

- [ ] **Run it red:** `pnpm --filter @magna-carta/file-manager exec vitest run test/preview-policy.test.ts` → fails: module not found.
- [ ] **Implement** `packages/file-manager/src/preview-policy.ts`:

  ```ts
  import type { CleanVersionForPreview } from "./queries.ts";

  // The shallow safe-rendition gate: a PURE decision over a clean version row, the one place where the
  // verdict AND the content-type that frames it are decided together — so the grant descriptor and the
  // cookieless header set can never disagree. Fail-safe direction is load-bearing: only a positive
  // 'playable' (with a known sniffed type, standard tier, full encoding, non-derived role) unlocks
  // inline media; a never-sniffed (NULL), undecidable, OR unrecognized verdict can never be served
  // inline. A wrong verdict degrades to "undecodable video", never "rendered active document" (the bytes
  // only ever reach the media decoder via the <video> subresource). 'derived' and non-'full' encoding
  // are inert today (the current version is original + full) but future-proof the rendition + delta seams.
  export type PreviewDecision =
    | { kind: "inline-media"; r2Key: string; sniffedContentType: string; sizeBytes: number | null }
    | {
        kind: "download-only";
        reason: "verdict" | "unknown-verdict" | "tiered" | "encoded" | "derived" | "unknown-type";
      };

  export function decidePreview(version: CleanVersionForPreview): PreviewDecision {
    if (version.inlinePlayable !== "playable") {
      return {
        kind: "download-only",
        reason: version.inlinePlayable === null ? "unknown-verdict" : "verdict",
      };
    }
    if (version.sniffedContentType === null || version.sniffedContentType === "") {
      return { kind: "download-only", reason: "unknown-type" };
    }
    if (version.storageClass !== "standard") {
      return { kind: "download-only", reason: "tiered" };
    }
    if (version.storageEncoding !== "full") {
      return { kind: "download-only", reason: "encoded" };
    }
    if (version.artifactRole === "derived") {
      return { kind: "download-only", reason: "derived" };
    }
    return {
      kind: "inline-media",
      r2Key: version.r2Key,
      sniffedContentType: version.sniffedContentType,
      sizeBytes: version.sizeBytes,
    };
  }
  ```

- [ ] **Add the export** to `packages/file-manager/package.json` `exports` map: `"./preview-policy": "./src/preview-policy.ts",`.
- [ ] **Run green:** `pnpm --filter @magna-carta/file-manager exec vitest run test/preview-policy.test.ts` → all pass.
- [ ] **Commit:**

  ```
  git commit -am "feat(file-manager): add pure decidePreview verdict gate + preview-policy export

  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
  ```

---

## Task 4 — `safeRendition` port + `nullSafeRenditionAdapter` (seam, no engine)

**Files**

- Create: `packages/file-manager/src/safe-rendition-port.ts`
- Create (test): `packages/file-manager/test/safe-rendition-port.test.ts`
- Modify: `packages/file-manager/package.json` (exports: add `"./safe-rendition-port"`)

**Interfaces**

- Produces:
  ```ts
  export interface SafeRenditionRequest {
    versionId: FileVersionId;
    r2Key: string;
    sniffedContentType: string;
    target: "rasterized-image" | "transcoded-mp4";
  }
  export interface SafeRendition {
    renditionVersionId: FileVersionId;
    r2Key: string;
    contentType: string;
  }
  export interface SafeRenditionPort {
    lookup(req: SafeRenditionRequest): Promise<SafeRendition | null>;
    request(req: SafeRenditionRequest): Promise<SafeRendition>;
  }
  export class SafeRenditionNotAvailableError extends Error {}
  export const nullSafeRenditionAdapter: SafeRenditionPort;
  ```
- Note: WIRED (exported) but the preview handler must NOT call `lookup()` in 2·3 — only a seam comment marks where the player slice adds the call.

Steps:

- [ ] **Write the failing test** `packages/file-manager/test/safe-rendition-port.test.ts`:

  ```ts
  import { describe, expect, it } from "vitest";
  import {
    nullSafeRenditionAdapter,
    SafeRenditionNotAvailableError,
  } from "../src/safe-rendition-port.ts";

  const req = {
    versionId: "fileVersion_x" as never,
    r2Key: "files/f/v",
    sniffedContentType: "text/html",
    target: "rasterized-image" as const,
  };

  describe("nullSafeRenditionAdapter", () => {
    it("returns null from lookup (no rendition exists at launch)", async () => {
      expect(await nullSafeRenditionAdapter.lookup(req)).toBeNull();
    });
    it("throws SafeRenditionNotAvailableError from request (engine deferred)", async () => {
      await expect(nullSafeRenditionAdapter.request(req)).rejects.toBeInstanceOf(
        SafeRenditionNotAvailableError,
      );
    });
  });
  ```

- [ ] **Run it red:** `pnpm --filter @magna-carta/file-manager exec vitest run test/safe-rendition-port.test.ts` → fails: module not found.
- [ ] **Implement** `packages/file-manager/src/safe-rendition-port.ts` (mirrors the `MalwareScanPort`/`unscannedAdapter` precedent):

  ```ts
  import type { FileVersionId } from "@magna-carta/identifiers/types";

  // The safe-rendition seam. The structural rule is that active formats get a derived safe rendition
  // (a rasterized image or a transcoded MP4 produced in a Container, written back to R2 as an
  // artifact_role:'derived' version). This slice honors the rule the cheap way — download-only — and
  // ships only the PORT plus an engine-less launch adapter. The rasterize/transcode engine wires in
  // when the player UI lands; until then lookup() finds nothing and request() refuses.
  export interface SafeRenditionRequest {
    readonly versionId: FileVersionId;
    readonly r2Key: string;
    readonly sniffedContentType: string;
    readonly target: "rasterized-image" | "transcoded-mp4";
  }

  export interface SafeRendition {
    readonly renditionVersionId: FileVersionId;
    readonly r2Key: string;
    readonly contentType: string;
  }

  export interface SafeRenditionPort {
    lookup(request: SafeRenditionRequest): Promise<SafeRendition | null>;
    request(request: SafeRenditionRequest): Promise<SafeRendition>;
  }

  export class SafeRenditionNotAvailableError extends Error {
    constructor(message = "No safe rendition engine is available.") {
      super(message);
      this.name = "SafeRenditionNotAvailableError";
    }
  }

  // Launch adapter: no engine yet. lookup() finds no derived rendition; request() refuses rather than
  // silently returning the active original.
  export const nullSafeRenditionAdapter: SafeRenditionPort = {
    async lookup() {
      return null;
    },
    async request() {
      throw new SafeRenditionNotAvailableError();
    },
  };
  ```

- [ ] **Add the export** to `packages/file-manager/package.json`: `"./safe-rendition-port": "./src/safe-rendition-port.ts",`.
- [ ] **Run green:** `pnpm --filter @magna-carta/file-manager exec vitest run test/safe-rendition-port.test.ts` → all pass.
- [ ] **Commit:**

  ```
  git commit -am "feat(file-manager): add safeRendition port + null launch adapter

  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
  ```

---

## Task 5 — `preview-token.ts` mint/verify (HMAC over AUTH_SECRET, constant-time)

**Files**

- Create: `apps/worker/src/files/preview-token.ts`
- Create (test): `apps/worker/test/files/preview-token.test.ts`

**Interfaces**

- Consumes: `constantTimeStringEquals` from `apps/worker/src/constant-time.ts` (async, returns `Promise<boolean>`); `crypto.subtle` (workerd).
- Produces:
  ```ts
  export interface PreviewTokenPayload {
    r2Key: string;
    bucket: string;
    sniffedContentType: string;
    verdict: "playable" | "download-only" | "indeterminate" | null;
    exp: number;
  }
  export function mintPreviewDeliveryToken(
    secret: string,
    payload: PreviewTokenPayload,
  ): Promise<string>;
  export function verifyPreviewDeliveryToken(
    secret: string,
    token: string,
    nowSeconds: number,
  ): Promise<PreviewTokenPayload | null>;
  ```
  `verify` returns `null` on any tamper/format/expiry failure (never throws). Token shape: base64url(UTF-8 JSON payload) + "." + base64url(HMAC-SHA-256 of the payload segment). Constant-time HMAC compare via `constantTimeStringEquals(presentedSignatureBase64url, recomputedSignatureBase64url)`. Decode is the exact UTF-8 inverse of the encode (TextDecoder), so a non-ASCII byte in any payload field round-trips. Expiry checked only after a valid signature.
- Consumed by: Task 9 (grant mints), Task 8 (cookieless verifies).

Steps:

- [ ] **Write the failing test** `apps/worker/test/files/preview-token.test.ts` (pure unit test — runs under the worker vitest pool, uses the `crypto` global):

  ```ts
  import { describe, expect, it } from "vitest";
  import {
    mintPreviewDeliveryToken,
    verifyPreviewDeliveryToken,
    type PreviewTokenPayload,
  } from "../../src/files/preview-token.ts";

  const SECRET = "test-secret-value";
  const payload: PreviewTokenPayload = {
    r2Key: "files/f/v",
    bucket: "R2",
    sniffedContentType: "video/mp4",
    verdict: "playable",
    exp: 2_000_000_000,
  };

  describe("preview delivery token", () => {
    it("round-trips a fresh token to the exact payload", async () => {
      const token = await mintPreviewDeliveryToken(SECRET, payload);
      expect(await verifyPreviewDeliveryToken(SECRET, token, 1_000_000_000)).toEqual(payload);
    });

    it("round-trips a payload with a non-ASCII sniffedContentType", async () => {
      const unicode = { ...payload, sniffedContentType: 'video/mp4; name="clé.mp4"' };
      const token = await mintPreviewDeliveryToken(SECRET, unicode);
      expect(await verifyPreviewDeliveryToken(SECRET, token, 1_000_000_000)).toEqual(unicode);
    });

    it("rejects a token signed with a different secret", async () => {
      const token = await mintPreviewDeliveryToken(SECRET, payload);
      expect(await verifyPreviewDeliveryToken("other-secret", token, 1_000_000_000)).toBeNull();
    });

    it("rejects a tampered payload (swapped r2Key)", async () => {
      const token = await mintPreviewDeliveryToken(SECRET, payload);
      const sig = token.slice(token.indexOf(".") + 1);
      const forgedBody = btoa(JSON.stringify({ ...payload, r2Key: "files/other/v" }))
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");
      expect(
        await verifyPreviewDeliveryToken(SECRET, `${forgedBody}.${sig}`, 1_000_000_000),
      ).toBeNull();
    });

    it("rejects a flipped signature byte", async () => {
      const token = await mintPreviewDeliveryToken(SECRET, payload);
      const flipped = token.slice(0, -1) + (token.endsWith("A") ? "B" : "A");
      expect(await verifyPreviewDeliveryToken(SECRET, flipped, 1_000_000_000)).toBeNull();
    });

    it("rejects an expired token (exp < now), only after a valid signature", async () => {
      const token = await mintPreviewDeliveryToken(SECRET, payload);
      expect(await verifyPreviewDeliveryToken(SECRET, token, 2_000_000_001)).toBeNull();
    });

    it("rejects a malformed token (no dot / bad base64)", async () => {
      expect(await verifyPreviewDeliveryToken(SECRET, "not-a-token", 1_000_000_000)).toBeNull();
      expect(await verifyPreviewDeliveryToken(SECRET, "###.###", 1_000_000_000)).toBeNull();
    });
  });
  ```

- [ ] **Run it red:** `pnpm --filter @magna-carta/worker exec vitest run test/files/preview-token.test.ts` → fails: module not found.
- [ ] **Implement** `apps/worker/src/files/preview-token.ts`:

  ```ts
  import { constantTimeStringEquals } from "../constant-time.ts";

  // A first-party, Worker-signed delivery token — NOT an R2 presign. A presigned R2 GET signs only the
  // host header and carries no Content-Disposition/nosniff/CSP, so it cannot frame untrusted bytes with
  // the safe-delivery header set; inline-preview bytes must flow through the Worker under a token it
  // signs and verifies itself. Signing with AUTH_SECRET (not a presigner adapter) means dev/test and
  // production run the identical sign+verify path, so negative tests genuinely exercise rejection.
  // Reasoning home: docs/conventions/security.md (untrusted file handling).
  export interface PreviewTokenPayload {
    readonly r2Key: string;
    readonly bucket: string;
    readonly sniffedContentType: string;
    readonly verdict: "playable" | "download-only" | "indeterminate" | null;
    readonly exp: number; // unix seconds
  }

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  function base64UrlEncode(bytes: ArrayBuffer | Uint8Array): string {
    const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    let binary = "";
    for (const byte of view) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  function base64UrlDecodeToBytes(value: string): Uint8Array | null {
    try {
      const padded = value.replace(/-/g, "+").replace(/_/g, "/");
      const binary = atob(padded);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
      return bytes;
    } catch {
      return null;
    }
  }

  async function importKey(secret: string): Promise<CryptoKey> {
    return crypto.subtle.importKey(
      "raw",
      encoder.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
  }

  async function signSegment(secret: string, segment: string): Promise<string> {
    const key = await importKey(secret);
    const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(segment));
    return base64UrlEncode(signature);
  }

  export async function mintPreviewDeliveryToken(
    secret: string,
    payload: PreviewTokenPayload,
  ): Promise<string> {
    const body = base64UrlEncode(encoder.encode(JSON.stringify(payload)));
    const signature = await signSegment(secret, body);
    return `${body}.${signature}`;
  }

  // Returns the verified payload, or null for ANY failure (format, signature, expiry). Never throws —
  // the cookieless edge maps null to a bare 404 and must never surface a server-trace handle.
  export async function verifyPreviewDeliveryToken(
    secret: string,
    token: string,
    nowSeconds: number,
  ): Promise<PreviewTokenPayload | null> {
    const dot = token.indexOf(".");
    if (dot <= 0 || dot === token.length - 1) return null;
    const body = token.slice(0, dot);
    const presentedSignature = token.slice(dot + 1);
    const recomputedSignature = await signSegment(secret, body);
    // Constant-time over the two base64url signature strings (each SHA-256-folded, fixed length).
    if (!(await constantTimeStringEquals(presentedSignature, recomputedSignature))) return null;
    const bytes = base64UrlDecodeToBytes(body);
    if (bytes === null) return null;
    let payload: PreviewTokenPayload;
    try {
      payload = JSON.parse(decoder.decode(bytes)) as PreviewTokenPayload;
    } catch {
      return null;
    }
    if (typeof payload.exp !== "number" || payload.exp < nowSeconds) return null;
    return payload;
  }
  ```

- [ ] **Run green:** `pnpm --filter @magna-carta/worker exec vitest run test/files/preview-token.test.ts` → all pass.
- [ ] **Commit:**

  ```
  git commit -am "feat(worker): add preview delivery token mint/verify (HMAC over AUTH_SECRET, constant-time)

  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
  ```

---

## Task 6 — `FILES_ORIGIN` binding + wrangler var

**Files**

- Modify: `apps/worker/src/app.ts` (the `Bindings` type)
- Modify: `apps/worker/wrangler.jsonc` (add a `vars` block)

**Interfaces**

- Produces: `FILES_ORIGIN?: string` on `Bindings` (optional — unset degrades the grant to download-only); a `wrangler.jsonc` `"vars": { "FILES_ORIGIN": "files.example.com" }` so the Miniflare test pool binds it.
- Consumed by: Task 8 (host guard), Task 9 (grant degrade + token mint), Task 13 (e2e).

Steps:

- [ ] **Add the binding field.** In `apps/worker/src/app.ts`, add to the `Bindings` type (near the other optional public-config fields, after `AUTH_SECRET`):
  ```ts
    // The cookieless files host (e.g. files.magnacarta.esq). Optional: does not exist until the apex
    // domain attaches; while unset the preview grant degrades to download-only. The cookieless serve
    // route only ever answers when the request hostname equals this value. A public hostname, not a
    // secret — bound via wrangler.jsonc vars, never .dev.vars.
    FILES_ORIGIN?: string;
  ```
- [ ] **Add the wrangler var.** In `apps/worker/wrangler.jsonc`, add a top-level `vars` block (after the `assets` block, before `d1_databases`):
  ```jsonc
    // Public, non-secret config. FILES_ORIGIN is the cookieless preview host; bound here (not .dev.vars)
    // because it is a hostname, not a credential. In production this becomes files.magnacarta.esq once
    // the apex attaches; the placeholder value lets the Miniflare test pool exercise the host branch.
    "vars": { "FILES_ORIGIN": "files.example.com" },
  ```
- [ ] **Verify the binding loads** (no behavior change yet). Run the existing worker suite smoke: `pnpm --filter @magna-carta/worker exec vitest run test/dev-vars.test.ts` → still passes (`.dev.vars` untouched). Confirm typecheck: `pnpm --filter @magna-carta/worker exec tsc --noEmit` → clean.
- [ ] **Commit:**

  ```
  git commit -am "feat(worker): add optional FILES_ORIGIN binding + wrangler var for the cookieless preview host

  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
  ```

---

## Task 7 — Safe-delivery header builder (pure) + unit tests

**Files**

- Create: `apps/worker/src/files/preview-headers.ts`
- Create (test): `apps/worker/test/files/preview-headers.test.ts`

**Interfaces**

- Consumes: nothing (pure).
- Produces:
  ```ts
  export interface SafeDeliveryHeaderInput {
    sniffedContentType: string;
    appOrigin: string;
  }
  export function buildSafeDeliveryHeaders(input: SafeDeliveryHeaderInput): Headers;
  ```
  Every returned `Headers` carries: `Content-Disposition: attachment`, `X-Content-Type-Options: nosniff`, `Content-Type: <sniffed>`, `Content-Security-Policy: sandbox; default-src 'none'; frame-ancestors <appOrigin>`, `Cache-Control: private, no-store`, `Accept-Ranges: bytes`. NEVER `Content-Disposition: inline`. NEVER `Access-Control-Allow-Origin` (the decided launch CORS posture).
- Consumed by: Task 8 (the cookieless handler stamps these on 200/206/416).

Steps:

- [ ] **Write the failing test** `apps/worker/test/files/preview-headers.test.ts`:

  ```ts
  import { describe, expect, it } from "vitest";
  import { buildSafeDeliveryHeaders } from "../../src/files/preview-headers.ts";

  describe("buildSafeDeliveryHeaders", () => {
    it("stamps the exact safe-delivery header set", () => {
      const h = buildSafeDeliveryHeaders({
        sniffedContentType: "video/mp4",
        appOrigin: "https://app.example.com",
      });
      expect(h.get("Content-Disposition")).toBe("attachment");
      expect(h.get("X-Content-Type-Options")).toBe("nosniff");
      expect(h.get("Content-Type")).toBe("video/mp4");
      expect(h.get("Content-Security-Policy")).toBe(
        "sandbox; default-src 'none'; frame-ancestors https://app.example.com",
      );
      expect(h.get("Cache-Control")).toBe("private, no-store");
      expect(h.get("Accept-Ranges")).toBe("bytes");
    });

    it("uses the sniffed type verbatim (never declared, never octet-stream fallback)", () => {
      const h = buildSafeDeliveryHeaders({
        sniffedContentType: "audio/mpeg",
        appOrigin: "https://app.example.com",
      });
      expect(h.get("Content-Type")).toBe("audio/mpeg");
    });

    it("never emits Content-Disposition: inline", () => {
      const h = buildSafeDeliveryHeaders({
        sniffedContentType: "video/mp4",
        appOrigin: "https://app.example.com",
      });
      expect(h.get("Content-Disposition")).not.toContain("inline");
    });

    it("sends NO Access-Control-Allow-Origin (the decided launch CORS posture)", () => {
      const h = buildSafeDeliveryHeaders({
        sniffedContentType: "video/mp4",
        appOrigin: "https://app.example.com",
      });
      expect(h.get("Access-Control-Allow-Origin")).toBeNull();
    });
  });
  ```

- [ ] **Run it red:** `pnpm --filter @magna-carta/worker exec vitest run test/files/preview-headers.test.ts` → fails: module not found.
- [ ] **Implement** `apps/worker/src/files/preview-headers.ts`:

  ```ts
  // The safe-delivery header set stamped on every cookieless preview 200/206/416. Untrusted bytes are
  // served from a cookieless origin so a malicious file reaches only the media decoder, never a
  // privileged origin or an HTML/script parser. Content-Disposition: attachment is a no-op for a
  // <video>/<audio> subresource (so the file plays) yet honored for a top-level navigation (so a direct
  // hit downloads) — kept verbatim, never relaxed to inline. The Content-Type is the SERVER-sniffed
  // type, never the attacker-controlled declared type, and never an octet-stream fallback. No
  // Access-Control-Allow-Origin is sent: a native <video src> subresource needs no CORS, so the host
  // grants none. Reasoning home: docs/conventions/security.md (untrusted file handling).
  export interface SafeDeliveryHeaderInput {
    readonly sniffedContentType: string;
    readonly appOrigin: string;
  }

  export function buildSafeDeliveryHeaders(input: SafeDeliveryHeaderInput): Headers {
    const headers = new Headers();
    headers.set("Content-Disposition", "attachment");
    headers.set("X-Content-Type-Options", "nosniff");
    headers.set("Content-Type", input.sniffedContentType);
    headers.set(
      "Content-Security-Policy",
      `sandbox; default-src 'none'; frame-ancestors ${input.appOrigin}`,
    );
    headers.set("Cache-Control", "private, no-store");
    headers.set("Accept-Ranges", "bytes");
    return headers;
  }
  ```

- [ ] **Run green:** `pnpm --filter @magna-carta/worker exec vitest run test/files/preview-headers.test.ts` → all pass.
- [ ] **Commit:**

  ```
  git commit -am "feat(worker): add pure safe-delivery header builder for cookieless preview

  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
  ```

---

## Task 8 — Cookieless serve route `GET /api/files-preview/{token}` (Range/206, If-Range, 416, null-object, host guard)

**Files**

- Create: `apps/worker/src/files/preview-serve.ts` (the bare-route registrar + handler)
- Modify: `apps/worker/src/app.ts` (call `registerPreviewServeRoute(app)` before the `/api/v1` routes)
- Create (test): `apps/worker/test/files/preview-range.test.ts` (Range-parser table test; the handler's wiring is covered end-to-end by Task 13).

**Interfaces**

- Consumes: `verifyPreviewDeliveryToken` (Task 5), `buildSafeDeliveryHeaders` (Task 7), `Bindings` (`R2`, `AUTH_SECRET`, `FILES_ORIGIN`).
- Produces: `export function registerPreviewServeRoute(app: OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>): void;` — a bare `app.get("/api/files-preview/:token", ...)` host-guarded on `hostname === env.FILES_ORIGIN`, terminal.
- Range parsing helper (exported for the table test): `export function parseSingleByteRange(rangeHeader: string | null, totalSize: number): { offset: number; length: number } | "unsatisfiable" | null;` (`null` = no Range → full body; `"unsatisfiable"` = malformed/multi/out-of-range → 416).

Steps:

- [ ] **Write the failing Range-parser unit test** `apps/worker/test/files/preview-range.test.ts`:

  ```ts
  import { describe, expect, it } from "vitest";
  import { parseSingleByteRange } from "../../src/files/preview-serve.ts";

  describe("parseSingleByteRange", () => {
    it("returns null for no Range header (full body)", () => {
      expect(parseSingleByteRange(null, 1000)).toBeNull();
    });
    it("parses bytes=0-99 to offset 0 length 100", () => {
      expect(parseSingleByteRange("bytes=0-99", 1000)).toEqual({ offset: 0, length: 100 });
    });
    it("parses an open-ended bytes=500- to the remainder", () => {
      expect(parseSingleByteRange("bytes=500-", 1000)).toEqual({ offset: 500, length: 500 });
    });
    it("parses a suffix bytes=-100 to the last 100 bytes", () => {
      expect(parseSingleByteRange("bytes=-100", 1000)).toEqual({ offset: 900, length: 100 });
    });
    it("rejects a multi-range / malformed / out-of-range as unsatisfiable", () => {
      expect(parseSingleByteRange("bytes=0-10,20-30", 1000)).toBe("unsatisfiable");
      expect(parseSingleByteRange("items=0-99", 1000)).toBe("unsatisfiable");
      expect(parseSingleByteRange("bytes=2000-3000", 1000)).toBe("unsatisfiable");
    });
  });
  ```

- [ ] **Run it red:** `pnpm --filter @magna-carta/worker exec vitest run test/files/preview-range.test.ts` → fails: module not found.
- [ ] **Implement** `apps/worker/src/files/preview-serve.ts`:

  ```ts
  import type { OpenAPIHono } from "@hono/zod-openapi";
  import type { Bindings } from "../app.ts";
  import type { AppVariables } from "../chokepoint/ports.ts";
  import { buildSafeDeliveryHeaders } from "./preview-headers.ts";
  import { verifyPreviewDeliveryToken } from "./preview-token.ts";

  // Parse a single byte range against the object size. null = no Range header (serve the full body);
  // "unsatisfiable" = malformed, multi-range, or out-of-bounds (-> 416). Only the simple single-range
  // forms a media element issues for seeking are honored.
  export function parseSingleByteRange(
    rangeHeader: string | null,
    totalSize: number,
  ): { offset: number; length: number } | "unsatisfiable" | null {
    if (rangeHeader === null || rangeHeader === "") return null;
    const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
    if (match === null) return "unsatisfiable";
    const startRaw = match[1];
    const endRaw = match[2];
    if (startRaw === "" && endRaw === "") return "unsatisfiable";
    let offset: number;
    let endInclusive: number;
    if (startRaw === "") {
      // Suffix range: last N bytes.
      const suffix = Number(endRaw);
      if (suffix <= 0) return "unsatisfiable";
      offset = Math.max(0, totalSize - suffix);
      endInclusive = totalSize - 1;
    } else {
      offset = Number(startRaw);
      endInclusive = endRaw === "" ? totalSize - 1 : Number(endRaw);
    }
    if (offset < 0 || offset >= totalSize || endInclusive < offset) return "unsatisfiable";
    if (endInclusive > totalSize - 1) endInclusive = totalSize - 1;
    return { offset, length: endInclusive - offset + 1 };
  }

  function appOriginFor(filesOrigin: string): string {
    // The app origin frame-ancestors entry: the trusted sibling host. files.<rest> -> app.<rest>.
    return `https://${filesOrigin.replace(/^files\./, "app.")}`;
  }

  // A minimal, non-JSON edge response for tamper/expiry/missing-object. 404 is used UNIFORMLY for every
  // invalid-token and missing-object case (no 410 for verified-but-expired) so the edge never exposes an
  // expiry/existence oracle: an unauthenticated caller cannot distinguish "tampered", "expired", and
  // "reaped" from one another. NO error_ id, NO correlation surface, but still attachment + nosniff so
  // even this body cannot be coaxed into an active document. Reasoning home: docs/conventions/security.md.
  function previewNoLongerValid(): Response {
    return new Response("This preview link is no longer valid.", {
      status: 404,
      headers: {
        "Content-Disposition": "attachment",
        "X-Content-Type-Options": "nosniff",
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "private, no-store",
      },
    });
  }

  export function registerPreviewServeRoute(
    app: OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>,
  ): void {
    // A bare, host-guarded route — deliberately OUTSIDE the chokepoint (no session exists on the
    // cookieless host; authorization already happened at the API origin and is carried by the signed
    // token). It must register before the /api/v1 routes and before the ASSETS fallthrough, match only
    // on the files host, and return terminally — a files.* request that is not this path must never
    // fall through to the SPA shell. Reasoning home: docs/conventions/security.md.
    app.get("/api/files-preview/:token", async (c) => {
      const filesOrigin = c.env.FILES_ORIGIN;
      const hostname = new URL(c.req.url).hostname;
      // Host guard: only answer on the files host. Anything else on this path 404s terminally (never
      // falls through to /api/v1 or ASSETS) so the SPA shell never leaks onto the untrusted host.
      if (filesOrigin === undefined || hostname !== filesOrigin) {
        return previewNoLongerValid();
      }
      const token = c.req.param("token");
      const nowSeconds = Math.floor(Date.now() / 1000);
      const payload = await verifyPreviewDeliveryToken(c.env.AUTH_SECRET, token, nowSeconds);
      if (payload === null) return previewNoLongerValid();

      // Derive EVERY response header + bucket + key ONLY from the verified payload, never the URL/query.
      const appOrigin = appOriginFor(filesOrigin);
      const rangeHeader = c.req.header("range") ?? null;
      const ifRange = c.req.header("if-range") ?? null;

      // Resolve the object. The null-object race (reaped between mint and fetch) is guarded explicitly
      // so a .body deref never throws into the telemetry error boundary (which would emit an error_ id
      // on the untrusted edge).
      const head = await c.env.R2.head(payload.r2Key);
      if (head === null) return previewNoLongerValid();
      const totalSize = head.size;

      // If-Range conditional resume: when the client presents If-Range and it does not match the current
      // strong ETag, the object changed under the resume — ignore the Range and serve the full 200, so
      // the player re-fetches from a consistent body rather than splicing a stale range. Matching (or
      // absent) If-Range proceeds to the normal range/full path.
      const ifRangeMatches = ifRange === null || ifRange === head.httpEtag;
      const range = ifRangeMatches ? parseSingleByteRange(rangeHeader, totalSize) : null;

      const headers = buildSafeDeliveryHeaders({
        sniffedContentType: payload.sniffedContentType,
        appOrigin,
      });
      headers.set("ETag", head.httpEtag);

      if (range === "unsatisfiable") {
        headers.set("Content-Range", `bytes */${totalSize}`);
        return new Response(null, { status: 416, headers });
      }

      if (range === null) {
        const object = await c.env.R2.get(payload.r2Key);
        if (object === null) return previewNoLongerValid();
        headers.set("Content-Length", String(totalSize));
        return new Response(object.body, { status: 200, headers });
      }

      const object = await c.env.R2.get(payload.r2Key, {
        range: { offset: range.offset, length: range.length },
      });
      if (object === null) return previewNoLongerValid();
      headers.set("Content-Length", String(range.length));
      headers.set(
        "Content-Range",
        `bytes ${range.offset}-${range.offset + range.length - 1}/${totalSize}`,
      );
      return new Response(object.body, { status: 206, headers });
    });
  }
  ```

- [ ] **Run the Range parser test green:** `pnpm --filter @magna-carta/worker exec vitest run test/files/preview-range.test.ts` → all pass.
- [ ] **Wire into `app.ts`.** In `apps/worker/src/app.ts`, import `registerPreviewServeRoute` and call it by STRUCTURAL ANCHOR (not an absolute line number — Task 6 already mutated this file): immediately after the Better-Auth `app.on(["GET","POST"], "/api/auth/*", ...)` registration and BEFORE the first `/api/v1` registration (`registerMeRoute(app, chokepoint)`), so it precedes the chokepoint routes and the `app.get("*")` ASSETS fallthrough:
  ```ts
  // The cookieless preview serve route: a bare, host-guarded route on the files host, OUTSIDE the
  // chokepoint (no session on files.*), under /api/ so it reaches the Worker (run_worker_first). It
  // must precede the /api/v1 routes and the ASSETS fallthrough and return terminally on the files host.
  registerPreviewServeRoute(app);
  ```
  (Add `import { registerPreviewServeRoute } from "./files/preview-serve.ts";` to the imports.)
- [ ] **Typecheck:** `pnpm --filter @magna-carta/worker exec tsc --noEmit` → clean.
- [ ] **Commit:**

  ```
  git commit -am "feat(worker): add host-guarded cookieless preview serve route (Range/206, If-Range, 416, null-object, safe headers)

  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
  ```

---

## Task 9 — Grant route `GET /api/v1/files/{id}/preview` + `PreviewGrant` schema + RouteMeta + wiring

**Files**

- Modify: `apps/worker/src/routes/files/files.ts`
- Modify (test): `apps/worker/test/files-routes.test.ts` (append a minimal grant happy-path RED test; the full e2e block lands in Task 13). Requires the `seedCleanFile` overrides from Task 10 — **do Task 10 before this task's red step** (resequenced from the original order so the red test can seed a `playable` version).

**Interfaces**

- Consumes: `getCurrentCleanVersionForPreview` (Task 2), `decidePreview` (Task 3), `mintPreviewDeliveryToken` (Task 5), `requireChokepointFirmContext`, `requireBucket`, `DOWNLOAD_TTL_SECONDS`, `authErrors`, `fileParam`, `problemJson`, `defineOpenAPIRoute`, `chokepointMiddleware`.
- Produces: the `PreviewGrant` zod component, `previewFileMeta`, `previewFileRoute`, and the registered handler in `registerFilesRoutes`. A `200` JSON descriptor with `Cache-Control: private, no-store`; `mode: "inline-media"` carries `streamUrl` + `contentType` + `sizeBytes`; `mode: "download-only"` carries `reason`; `downloadUrl` always present pointing at `/api/v1/files/{id}/download`.
- Consumed by: Task 13 (e2e), Task 11 (conformance + snapshot).

Steps:

- [ ] **Write the RED grant happy-path test FIRST** (TDD red for this task, depends on Task 10's `seedCleanFile` overrides). Append a focused case to `apps/worker/test/files-routes.test.ts` near the other file-route cases:
  ```ts
  it("files.preview: a playable/standard/full/original version yields inline-media + a files-host streamUrl", async () => {
    const { fileId } = await seedCleanFile("clip.mp4", null, "0123456789".repeat(50), ISO, {
      inlinePlayable: "playable",
      sniffedContentType: "video/mp4",
    });
    const res = await get(`/api/v1/files/${fileId}/preview`);
    expect(res.status).toBe(200);
    const body = await res.json<{ mode: string; streamUrl: string }>();
    expect(body.mode).toBe("inline-media");
    expect(body.streamUrl).toContain(`https://${env.FILES_ORIGIN}/api/files-preview/`);
  });
  ```
- [ ] **Run it red:** `pnpm --filter @magna-carta/worker exec vitest run test/files-routes.test.ts` → fails (the `/api/v1/files/{id}/preview` route is not registered, so the chokepoint/router returns a 404, not a 200).
- [ ] **Add imports** to `apps/worker/src/routes/files/files.ts`:
  - Extend the `@magna-carta/file-manager/queries` import to add `getCurrentCleanVersionForPreview`.
  - Add `import { decidePreview } from "@magna-carta/file-manager/preview-policy";`.
  - Add `import { mintPreviewDeliveryToken } from "../files/preview-token.ts";`.
- [ ] **Add the `PreviewGrant` schema** after `FileVersionsResponse`. The `reason` enum adds `host-unavailable` (distinct from `unknown-verdict`) so the pre-apex degrade of a genuinely-playable file is not mislabeled (§6.11):
  ```ts
  const PreviewGrant = z
    .object({
      mode: z.enum(["inline-media", "download-only"]),
      // The stored verdict, READ not computed (the sniffer is deferred). NULL = never sniffed; at
      // launch the whole corpus is NULL so every grant is download-only / unknown-verdict.
      verdict: z.enum(["playable", "download-only", "indeterminate"]).nullable(),
      // Present iff mode === "inline-media": the cookieless files-host URL the player loads as a
      // <video>/<audio> subresource. The transcode rendition wires in here when the player UI lands.
      streamUrl: z.string().optional(),
      contentType: z.string().optional(), // the SNIFFED type, echoed for the player
      sizeBytes: z.number().int().nullable().optional(),
      // Present iff mode === "download-only". "host-unavailable" = the files host is not yet bound
      // (the verdict may have been playable); distinct from "unknown-verdict" (never-sniffed).
      reason: z
        .enum([
          "verdict",
          "unknown-verdict",
          "tiered",
          "encoded",
          "derived",
          "unknown-type",
          "host-unavailable",
        ])
        .optional(),
      // ALWAYS present, download-intent only — the AUDITED /download path (302), never a raw inline URL,
      // so an active format can only ever reach an explicit download, never an auto-embedding context.
      downloadUrl: z.string(),
    })
    .openapi("PreviewGrant");
  ```
- [ ] **Add `previewFileMeta`** after `downloadFileMeta`:
  ```ts
  // The preview grant is a GET that exports a delivery DECISION (and, for inline media, a signed
  // delivery credential) — no body to fingerprint, harmless to re-issue, so idempotency is "optional".
  // permission: null is the files.list/get/download read posture — the registry deliberately has no
  // read-only files capability; access is gated by which matter the member can reach, enforced by the
  // firm-scoped query against the session firm's physically-isolated D1. audited: false because inline
  // preview is a cheap, high-frequency in-place view (no per-view logging); the moment the user pulls
  // the full file, the audited /download path records it. Reasoning home: docs/conventions/security.md.
  const previewFileMeta: RouteMeta = {
    operationId: "files.preview",
    surface: "app",
    authenticated: true,
    permission: null,
    resource: "matter",
    audited: false,
    idempotency: "optional",
    rateLimit: "default",
  };
  ```
- [ ] **Add `previewFileRoute`** after `downloadFileRoute`:
  ```ts
  const previewFileRoute = defineOpenAPIRoute(previewFileMeta, {
    method: "get",
    path: "/api/v1/files/{id}/preview",
    description:
      "Authorizes inline preview of the file's current clean version and returns a delivery " +
      "descriptor. When the verdict + storage facts permit inline media, the descriptor carries a " +
      "short-lived signed streamUrl on the cookieless files host the player loads as a <video>/<audio> " +
      "subresource; otherwise it carries download-only with a reason. downloadUrl (the audited " +
      "download path) is always present. Untrusted bytes are served cookieless so a malicious file " +
      "reaches only the media decoder, never a privileged origin. 404 when the file has no clean " +
      "current version.",
    request: { params: fileParam },
    responses: {
      200: {
        description: "The preview delivery descriptor",
        content: { "application/json": { schema: PreviewGrant } },
      },
      401: authErrors[401],
      404: authErrors[404],
      429: authErrors[429],
    },
  });
  ```
- [ ] **Register the handler** inside `registerFilesRoutes`, after the download handler, before the closing `}`. Build each response body as an EXPLICIT typed local (`const grant: z.infer<typeof PreviewGrant> = {...}`) — no `as` cast — so reason-union drift between `decidePreview` and `PreviewGrant` surfaces at compile time:

  ```ts
  // GET /api/v1/files/{id}/preview — authorize inline preview; mint a signed cookieless streamUrl
  app.openapi(
    {
      ...previewFileRoute,
      middleware: chokepointMiddleware(chokepoint, previewFileRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const bucket = requireBucket(firm.bucketName);
      const { id } = c.req.valid("param");
      const version = await getCurrentCleanVersionForPreview(firm.firmDatabase, id);
      if (version === undefined) {
        return problemJson(c, {
          type: "not-found",
          title: "Not found",
          status: 404,
          detail: "No such file with a previewable version in this firm.",
        });
      }
      const downloadUrl = `/api/v1/files/${id}/download`;
      const decision = decidePreview(version);
      const filesOrigin = c.env.FILES_ORIGIN;

      // Degrade to download-only when inline is not warranted OR the files host is not yet bound. The
      // reason distinguishes the two: a real decidePreview reason when the gate refused, else
      // "host-unavailable" when the gate WOULD have served inline but the cookieless host is unbound.
      if (decision.kind === "download-only" || filesOrigin === undefined) {
        const grant: z.infer<typeof PreviewGrant> = {
          mode: "download-only",
          verdict: version.inlinePlayable,
          reason: decision.kind === "download-only" ? decision.reason : "host-unavailable",
          downloadUrl,
        };
        return c.json(grant, 200, { "Cache-Control": "private, no-store" });
      }

      const exp = Math.floor(Date.now() / 1000) + DOWNLOAD_TTL_SECONDS;
      const token = await mintPreviewDeliveryToken(c.env.AUTH_SECRET, {
        r2Key: decision.r2Key,
        bucket,
        sniffedContentType: decision.sniffedContentType,
        verdict: version.inlinePlayable,
        exp,
      });
      const grant: z.infer<typeof PreviewGrant> = {
        mode: "inline-media",
        verdict: version.inlinePlayable,
        streamUrl: `https://${filesOrigin}/api/files-preview/${token}`,
        contentType: decision.sniffedContentType,
        sizeBytes: decision.sizeBytes,
        downloadUrl,
      };
      return c.json(grant, 200, { "Cache-Control": "private, no-store" });
    },
  );
  ```

- [ ] **Run green:** `pnpm --filter @magna-carta/worker exec vitest run test/files-routes.test.ts` → the grant happy-path case passes. Then `pnpm --filter @magna-carta/worker exec tsc --noEmit` → clean.
- [ ] **Commit** (conformance + snapshot follow in Task 11):

  ```
  git commit -am "feat(worker): add files.preview grant route + PreviewGrant descriptor + token mint + pre-apex degrade

  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
  ```

---

## Task 10 — Extend `seedCleanFile` to set the four verdict/storage columns (do BEFORE Task 9's red step)

**Files**

- Modify: `apps/worker/test/files-routes.test.ts` (the `seedCleanFile` helper)

**Interfaces**

- Produces: `seedCleanFile(name, folderId, bytes, createdAt?, options?)` where `options` overrides `inlinePlayable` / `storageClass` / `storageEncoding` / `artifactRole` / `sniffedContentType` (defaults preserve the current behavior).
- Consumed by: Task 9 (grant red test), Task 13 (all e2e cases).

Steps:

- [ ] **Modify `seedCleanFile`** to accept overridable columns and write them into the `file_version` INSERT:

  ```ts
  interface SeedVersionOptions {
    inlinePlayable?: "playable" | "download-only" | "indeterminate" | null;
    storageClass?: "standard" | "infrequent_access";
    storageEncoding?: string;
    artifactRole?: "original" | "derived";
    sniffedContentType?: string;
  }

  async function seedCleanFile(
    name: string,
    folderId: FolderId | null,
    bytes: string,
    createdAt = ISO,
    options: SeedVersionOptions = {},
  ): Promise<{ fileId: FileId; versionId: FileVersionId; r2Key: string }> {
    const fileId = newIdentifier("file");
    const versionId = newIdentifier("fileVersion");
    const r2Key = `files/${fileId}/${versionId}`;
    await env.DB_FIRM_POOL_1.prepare(
      "INSERT INTO file (id, matter_id, folder_id, name, document_type_id, current_version_id, deleted_at, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, NULL, NULL, NULL, ?5, ?5)",
    )
      .bind(fileId, matterId, folderId, name, createdAt)
      .run();
    await env.DB_FIRM_POOL_1.prepare(
      "INSERT INTO file_version (id, file_id, version_number, r2_key, size_bytes, declared_content_type, sniffed_content_type, content_sha256, status, uploaded_by, created_at, committed_at, inline_playable, storage_class, storage_encoding, artifact_role) " +
        "VALUES (?1, ?2, 1, ?3, ?4, 'application/octet-stream', ?7, 'hash', 'clean', ?5, ?6, ?6, ?8, ?9, ?10, ?11)",
    )
      .bind(
        versionId,
        fileId,
        r2Key,
        bytes.length,
        ownerUserId,
        createdAt,
        options.sniffedContentType ?? "text/plain",
        options.inlinePlayable ?? null,
        options.storageClass ?? "standard",
        options.storageEncoding ?? "full",
        options.artifactRole ?? "original",
      )
      .run();
    await env.DB_FIRM_POOL_1.prepare("UPDATE file SET current_version_id = ?2 WHERE id = ?1")
      .bind(fileId, versionId)
      .run();
    await env.R2.put(r2Key, bytes);
    return { fileId, versionId, r2Key };
  }
  ```

  (Note `declared_content_type` is now `'application/octet-stream'` so the e2e can prove the SNIFFED type wins over the declared one. The existing download/versions tests that asserted `sniffed_content_type='text/plain'` keep passing — the default sniffed stays `'text/plain'`.)

- [ ] **Run the existing file-routes suite** to confirm no regression: `pnpm --filter @magna-carta/worker exec vitest run test/files-routes.test.ts` → all existing cases pass.
- [ ] **Commit:**

  ```
  git commit -am "test(worker): extend seedCleanFile with overridable verdict/storage columns

  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
  ```

---

## Task 11 — Conformance committed-operations + OpenAPI snapshot regen

**Files**

- Modify: `apps/worker/test/conformance.test.ts` (insert `"files.preview"`)
- Modify (regenerated): `apps/worker/openapi/openapi.json`

**Interfaces**

- Consumes: the `previewFileRoute` registered in Task 9.
- Produces: a passing conformance committed-operations array + a byte-exact snapshot carrying the `PreviewGrant` component + the `/api/v1/files/{id}/preview` operation.

Steps:

- [ ] **Run conformance red first:** `pnpm --filter @magna-carta/worker exec vitest run test/conformance.test.ts` → the committed-operations array test fails (the emitted document now contains `files.preview`, not in the hardcoded array). The structural gates (audited/permission/surface/operationId/errorId/component-collision/chokepoint-composition) should all be GREEN already — if any fail, the RouteMeta in Task 9 is wrong; fix it.
- [ ] **Insert `"files.preview"`** into the sorted array in `apps/worker/test/conformance.test.ts`, between `"files.list"` and `"files.update"`:
  ```ts
        "files.list",
        "files.preview",
        "files.update",
  ```
- [ ] **Run conformance green:** `pnpm --filter @magna-carta/worker exec vitest run test/conformance.test.ts` → all pass.
- [ ] **Regenerate the snapshot:** `pnpm --filter @magna-carta/worker run emit-openapi`. Confirm `apps/worker/openapi/openapi.json` now contains a `PreviewGrant` component schema and the `/api/v1/files/{id}/preview` GET operation, and that `FileVersionItem` did NOT gain `inlinePlayable` (the Task 2 verify step). Do NOT hand-edit.
- [ ] **Run the drift test green:** `pnpm --filter @magna-carta/worker exec vitest run test/contracts/openapi-snapshot.test.ts` → both the byte-for-byte and the live `SELF.fetch` assertions pass.
- [ ] **Commit:**

  ```
  git add apps/worker/test/conformance.test.ts apps/worker/openapi/openapi.json
  git commit -m "feat(worker): register files.preview in conformance + regenerate OpenAPI snapshot

  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
  ```

---

## Task 12 — Standing fitness guard for the cookieless surface

**Files**

- Create (test): `apps/worker/test/files/preview-serve-fitness.test.ts`

**Interfaces**

- Consumes: the registered cookieless route (Task 8); `createApp` from `apps/worker/src/app.ts`; `SELF`/`env` from `cloudflare:test`.
- Produces: a non-skippable guard pinning: (1) the `/api/files-preview/:token` route is registered exactly once; (2) the files-host branch is host-guarded (only answers when `hostname === FILES_ORIGIN`) and terminal (a non-preview files-host path never returns the SPA shell); (3) `Content-Disposition: inline` is never emitted; (4) NO `Access-Control-Allow-Origin` is sent; (5) the host branch emits no `error_` id / correlation handle on any error.

Steps:

- [ ] **Write the guard** `apps/worker/test/files/preview-serve-fitness.test.ts`:

  ```ts
  import { env, SELF } from "cloudflare:test";
  import { describe, expect, it } from "vitest";
  import { createApp } from "../../src/app.ts";
  import { buildSafeDeliveryHeaders } from "../../src/files/preview-headers.ts";

  describe("cookieless preview surface — standing fitness guard", () => {
    it("registers the cookieless route exactly once", () => {
      const app = createApp();
      const matches = app.routes.filter((r) => r.path === "/api/files-preview/:token");
      expect(matches.length).toBe(1);
    });

    it("never emits Content-Disposition: inline from the header builder", () => {
      const h = buildSafeDeliveryHeaders({
        sniffedContentType: "video/mp4",
        appOrigin: "https://app.example.com",
      });
      expect(h.get("Content-Disposition")).toBe("attachment");
    });

    it("a non-preview path on the files host does not leak the SPA shell", async () => {
      const res = await SELF.fetch(`https://${env.FILES_ORIGIN}/some/other/path`);
      const body = await res.text();
      expect(body).not.toContain("<!doctype html");
      expect(body).not.toContain("<html");
    });

    it("a forged token on the files host returns a bare 404 with no error_ id / correlation surface, no ACAO", async () => {
      const res = await SELF.fetch(`https://${env.FILES_ORIGIN}/api/files-preview/forged.token`);
      expect(res.status).toBe(404);
      const body = await res.text();
      expect(body).not.toMatch(/error_/);
      expect(res.headers.get("correlation-id")).toBeNull();
      expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
      expect(res.headers.get("Content-Disposition")).toBe("attachment");
      expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
      expect(res.headers.get("Content-Type")).not.toContain("application/problem+json");
    });

    it("the preview path on a non-files host returns the bare 404, not a privileged handler", async () => {
      const res = await SELF.fetch("https://example.com/api/files-preview/anything");
      expect(res.status).toBe(404);
      const body = await res.text();
      expect(body).not.toMatch(/error_/);
    });
  });
  ```

  (If `app.routes` entries normalize the path differently, adjust the filter predicate to the normalized form; the requirement is exactly one matching registration.)

- [ ] **Run it:** `pnpm --filter @magna-carta/worker exec vitest run test/files/preview-serve-fitness.test.ts` → all pass (the implementation from Task 8 already satisfies these).
- [ ] **Commit:**

  ```
  git commit -am "test(worker): standing fitness guard for the cookieless preview surface

  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
  ```

---

## Task 13 — Miniflare e2e: grant → cookieless fetch, Range/206, If-Range, isolation, degrade

**Files**

- Modify: `apps/worker/test/files-routes.test.ts` (append a `preview` describe block)

**Interfaces**

- Consumes: `seedCleanFile` (Task 10), the grant route (Task 9), the cookieless route (Task 8), `FILES_ORIGIN` (Task 6), `env`/`SELF`, `ownerCookie`/`readOnlyCookie`, `createApp`.
- Produces: full coverage of spec §9.2 — auth→grant, cookieless fetch with full headers + sniffed-wins, forged/expired→404, Range/206, 416, If-Range stale→200, download-only, cross-firm isolation, read-only member, pre-apex degrade, and the no-audit-row assertion.

Steps:

- [ ] **Append the e2e describe block** to `apps/worker/test/files-routes.test.ts`:

  ```ts
  describe("inline preview grant + cookieless delivery", () => {
    const MP4_BYTES = "0123456789".repeat(50); // 500 bytes of deterministic content

    it("auth -> grant: a playable/standard/full/original version yields inline-media + a files-host streamUrl, no audit row", async () => {
      const { fileId } = await seedCleanFile("clip.mp4", null, MP4_BYTES, ISO, {
        inlinePlayable: "playable",
        sniffedContentType: "video/mp4",
      });
      const res = await get(`/api/v1/files/${fileId}/preview`);
      expect(res.status).toBe(200);
      expect(res.headers.get("Cache-Control")).toBe("private, no-store");
      const body = await res.json<{
        mode: string;
        verdict: string;
        streamUrl: string;
        contentType: string;
        downloadUrl: string;
      }>();
      expect(body.mode).toBe("inline-media");
      expect(body.verdict).toBe("playable");
      expect(body.contentType).toBe("video/mp4");
      expect(body.streamUrl).toContain(`https://${env.FILES_ORIGIN}/api/files-preview/`);
      expect(body.downloadUrl).toBe(`/api/v1/files/${fileId}/download`);
      const audit = await env.DB_FIRM_POOL_1.prepare(
        "SELECT event FROM audit_log WHERE event = 'file.downloaded' AND subject_id IN (SELECT id FROM file_version WHERE file_id = ?1)",
      )
        .bind(fileId)
        .all();
      expect(audit.results).toHaveLength(0);
    });

    it("cookieless fetch: full safe-header set, sniffed type wins over declared, no session consulted", async () => {
      const { fileId } = await seedCleanFile("clip2.mp4", null, MP4_BYTES, ISO, {
        inlinePlayable: "playable",
        sniffedContentType: "video/mp4", // declared_content_type is application/octet-stream
      });
      const grant = await (
        await get(`/api/v1/files/${fileId}/preview`)
      ).json<{ streamUrl: string }>();
      const res = await SELF.fetch(grant.streamUrl); // NO cookie
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Disposition")).toBe("attachment");
      expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
      expect(res.headers.get("Content-Type")).toBe("video/mp4"); // sniffed wins over octet-stream
      expect(res.headers.get("Content-Security-Policy")).toContain("sandbox");
      expect(res.headers.get("Accept-Ranges")).toBe("bytes");
      expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
      expect(await res.text()).toBe(MP4_BYTES);
    });

    it("Range/206: a byte-range request yields 206 + correct Content-Range/ETag and the safe headers", async () => {
      const { fileId } = await seedCleanFile("clip3.mp4", null, MP4_BYTES, ISO, {
        inlinePlayable: "playable",
        sniffedContentType: "video/mp4",
      });
      const grant = await (
        await get(`/api/v1/files/${fileId}/preview`)
      ).json<{ streamUrl: string }>();
      const res = await SELF.fetch(grant.streamUrl, { headers: { Range: "bytes=0-99" } });
      expect(res.status).toBe(206);
      expect(res.headers.get("Content-Range")).toBe("bytes 0-99/500");
      expect(res.headers.get("Content-Length")).toBe("100");
      expect(res.headers.get("Content-Disposition")).toBe("attachment");
      expect(res.headers.get("ETag")).toBeTruthy();
      expect((await res.text()).length).toBe(100);
    });

    it("Range/416: an unsatisfiable range yields 416 with the safe headers and no body", async () => {
      const { fileId } = await seedCleanFile("clip4.mp4", null, MP4_BYTES, ISO, {
        inlinePlayable: "playable",
        sniffedContentType: "video/mp4",
      });
      const grant = await (
        await get(`/api/v1/files/${fileId}/preview`)
      ).json<{ streamUrl: string }>();
      const res = await SELF.fetch(grant.streamUrl, { headers: { Range: "bytes=9000-9999" } });
      expect(res.status).toBe(416);
      expect(res.headers.get("Content-Range")).toBe("bytes */500");
      expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    });

    it("If-Range: a stale If-Range ETag ignores the Range and serves the full 200; a matching If-Range serves 206", async () => {
      const { fileId } = await seedCleanFile("clip5.mp4", null, MP4_BYTES, ISO, {
        inlinePlayable: "playable",
        sniffedContentType: "video/mp4",
      });
      const grant = await (
        await get(`/api/v1/files/${fileId}/preview`)
      ).json<{ streamUrl: string }>();
      // Discover the real ETag.
      const probe = await SELF.fetch(grant.streamUrl, { headers: { Range: "bytes=0-99" } });
      const etag = probe.headers.get("ETag");
      expect(etag).toBeTruthy();
      // Matching If-Range -> 206.
      const matched = await SELF.fetch(grant.streamUrl, {
        headers: { Range: "bytes=0-99", "If-Range": etag as string },
      });
      expect(matched.status).toBe(206);
      // Stale If-Range -> ignore the Range, full 200.
      const stale = await SELF.fetch(grant.streamUrl, {
        headers: { Range: "bytes=0-99", "If-Range": '"a-stale-etag"' },
      });
      expect(stale.status).toBe(200);
      expect((await stale.text()).length).toBe(500);
    });

    it("forged / expired token on the files host -> bare 404, no error_ id", async () => {
      const res = await SELF.fetch(`https://${env.FILES_ORIGIN}/api/files-preview/forged.token`);
      expect(res.status).toBe(404);
      expect(await res.text()).not.toMatch(/error_/);
    });

    it("download-only: a NULL-verdict (never sniffed) version -> mode download-only, no streamUrl", async () => {
      const { fileId } = await seedCleanFile("doc.bin", null, "data", ISO, {
        inlinePlayable: null,
      });
      const body = await (
        await get(`/api/v1/files/${fileId}/preview`)
      ).json<{ mode: string; reason: string; streamUrl?: string; downloadUrl: string }>();
      expect(body.mode).toBe("download-only");
      expect(body.reason).toBe("unknown-verdict");
      expect(body.streamUrl).toBeUndefined();
      expect(body.downloadUrl).toBe(`/api/v1/files/${fileId}/download`);
    });

    it("download-only: a playable-but-IA version -> mode download-only/tiered", async () => {
      const { fileId } = await seedCleanFile("ia.mp4", null, MP4_BYTES, ISO, {
        inlinePlayable: "playable",
        sniffedContentType: "video/mp4",
        storageClass: "infrequent_access",
      });
      const body = await (
        await get(`/api/v1/files/${fileId}/preview`)
      ).json<{ mode: string; reason: string }>();
      expect(body.mode).toBe("download-only");
      expect(body.reason).toBe("tiered");
    });

    it("read-only member: a Read-only cookie still gets a read grant (permission: null)", async () => {
      const { fileId } = await seedCleanFile("ro.mp4", null, MP4_BYTES, ISO, {
        inlinePlayable: "playable",
        sniffedContentType: "video/mp4",
      });
      const res = await get(`/api/v1/files/${fileId}/preview`, readOnlyCookie);
      expect(res.status).toBe(200);
    });

    it("cookieless tenant isolation: a token presented cold serves only what the signed bucket/key names", async () => {
      // A grant minted for a firm-1 file is honored cold (no cookie) — proving the SIGNED key/bucket,
      // not session/firm-D1 visibility, scopes the byte fetch.
      const { fileId } = await seedCleanFile("iso.mp4", null, MP4_BYTES, ISO, {
        inlinePlayable: "playable",
        sniffedContentType: "video/mp4",
      });
      const grant = await (
        await get(`/api/v1/files/${fileId}/preview`)
      ).json<{ streamUrl: string }>();
      const cold = await SELF.fetch(grant.streamUrl); // no session at all
      expect(cold.status).toBe(200);
    });

    it("pre-apex degrade: with FILES_ORIGIN unset the grant is download-only/host-unavailable, downloadUrl only", async () => {
      // Construct an app whose env omits FILES_ORIGIN and call it directly with the owner session, so the
      // binding is genuinely absent (the shared SELF pool binds it via wrangler.jsonc vars).
      const { fileId } = await seedCleanFile("degrade.mp4", null, MP4_BYTES, ISO, {
        inlinePlayable: "playable",
        sniffedContentType: "video/mp4",
      });
      const app = createApp();
      const envWithoutFilesOrigin = {
        ...(env as Record<string, unknown>),
        FILES_ORIGIN: undefined,
      };
      const res = await app.fetch(
        new Request(`https://example.com/api/v1/files/${fileId}/preview`, {
          headers: { cookie: ownerCookie, origin: "https://example.com" },
        }),
        envWithoutFilesOrigin as never,
      );
      expect(res.status).toBe(200);
      const body = await res.json<{
        mode: string;
        reason: string;
        streamUrl?: string;
        downloadUrl: string;
      }>();
      expect(body.mode).toBe("download-only");
      expect(body.reason).toBe("host-unavailable");
      expect(body.streamUrl).toBeUndefined();
      expect(body.downloadUrl).toBe(`/api/v1/files/${fileId}/download`);
    });
  });
  ```

  (`ownerCookie` and `readOnlyCookie` are the existing shared-rig session cookies used by the surrounding file-route cases; reuse them as-is. The degrade case overrides `FILES_ORIGIN` to `undefined` on a shallow-cloned `env` and drives a freshly built `createApp()` directly, since the shared `SELF` pool binds `FILES_ORIGIN` via `wrangler.jsonc`. The handler's degrade branch keys off `c.env.FILES_ORIGIN === undefined`, which the explicit `FILES_ORIGIN: undefined` override sets.)

- [ ] **Run the suite:** `pnpm --filter @magna-carta/worker exec vitest run test/files-routes.test.ts` → all pass. If the grant case fails, fix Task 9; if the cookieless case fails, fix Task 8.
- [ ] **Commit:**

  ```
  git commit -am "test(worker): e2e for inline preview grant + cookieless delivery (Range/206, If-Range, isolation, degrade, no-audit)

  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
  ```

---

## Task 14 — Additive `security.md` amendment (cross-cutting — gate on `vp run worktrees`)

**Files**

- Modify: `docs/conventions/security.md` (Untrusted file handling, threat #3)

**Interfaces**

- Produces: a second sanctioned inline-render mechanism (the `<video>`/`<audio>` subresource), strictly narrower in privilege, leaving the active-format clause untouched.

Steps:

- [ ] **Run `vp run worktrees`** before editing this cross-cutting file. If `main` is more than a handful of merges ahead, sync first.
- [ ] **Locate** the Untrusted file handling threat #3 clause naming `<iframe sandbox>` as the inline-render mechanism in `docs/conventions/security.md`.
- [ ] **Replace** "and `<iframe sandbox>` for inline render" with:
  > and — for inline render — exactly two mechanisms: an `<iframe sandbox>` (bare `sandbox`, never `allow-scripts`) for document formats, or a native `<video>`/`<audio>` **subresource** for verdict-confirmed inert media (`Content-Disposition: attachment` is still honored for a top-level navigation and ignored for the media subresource, so the file plays in place yet a direct hit on the raw bytes downloads).
- [ ] **Confirm** the clause "never hand active formats raw to the browser — preview a derived safe rendition" stays untouched.
- [ ] **Run the docs/process-ref lint:** `node tooling/lint-process-references.mjs` → clean.
- [ ] **Commit:**

  ```
  git commit -am "docs(security): add the media-subresource inline-render mechanism (additive)

  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
  ```

---

## Task 15 — STATUS.md row + changelog fragment + ADR fragments (incl. desktop-transport invariant) verified; full gate

**Files**

- Modify: `STATUS.md` (the 2·3 row ONLY)
- Create: `changelog.d/slice-2-3-safe-delivery.md`
- Modify/Verify: `docs/decisions/pending/slice-2-3-safe-delivery-sandbox.md`, `docs/decisions/pending/slice-2-3-inline-playable-verdict-seam.md`
- Modify: `docs/active-work/slice-2-3-safe-delivery.md` (record the desktop-transport invariant as a forward dependency + mark the touch list complete at merge)

**Interfaces**

- Produces: docs current in the same stream (golden rule 5). CHANGELOG + ADRs go through fragments, never a direct rendered-file edit. The desktop real-HTTP / no-`tauri://`-scheme transport invariant (spec §6.9) is written down here, since no player code exists this slice to pin it in.

Steps:

- [ ] **Confirm the two pending ADR fragments exist** (`docs/decisions/pending/slice-2-3-safe-delivery-sandbox.md` and `docs/decisions/pending/slice-2-3-inline-playable-verdict-seam.md`). If frontmatter is incomplete, fill it to the fragment convention. Do NOT touch the rendered Decision-Log register (it is a build output assembled on `main`).
- [ ] **Pin the desktop transport invariant.** In `docs/decisions/pending/slice-2-3-safe-delivery-sandbox.md`, add a line to the consequences/contract section recording that the preview route is served over real HTTP(S) on both web and desktop and MUST NOT be routed through a `tauri://` custom-scheme proxy (those transports do not honor HTTP Range, so seeking dies) — a contract the deferred player slice inherits. Mirror this as a forward-dependency item in `docs/active-work/slice-2-3-safe-delivery.md` so a future desktop config edit cannot silently strand it.
- [ ] **Add the changelog fragment** `changelog.d/slice-2-3-safe-delivery.md`:

  ```md
  ### Added

  - Inline file preview backend: a firm-scoped preview-grant route that authorizes a clean version and
    returns a delivery descriptor, and a host-guarded cookieless serving route that streams the bytes
    with HTTP Range support wrapped in a safe-delivery header set, so untrusted media reaches only the
    browser's media decoder. The `inline_playable` verdict column lands as a nullable seam (compute
    deferred); previews currently resolve to download-only until a codec sniffer populates verdicts.
  ```

- [ ] **Update the 2·3 row in `STATUS.md`** (edit ONLY that row — do not "correct" the stale 2·1 row) to reflect spec → plan → built → tested.
- [ ] **Run the full quality gate:** `pnpm check` → fmt + lint + TS typecheck + svelte-check all clean. Then `node tooling/lint-process-references.mjs` → clean. Then `pnpm --filter @magna-carta/worker exec vitest run` and `pnpm --filter @magna-carta/file-manager exec vitest run` and `pnpm --filter @magna-carta/database exec vitest run` → all green.
- [ ] **Commit:**

  ```
  git add STATUS.md changelog.d/slice-2-3-safe-delivery.md docs/active-work/slice-2-3-safe-delivery.md docs/decisions/pending
  git commit -m "docs(slice-2-3): STATUS row + changelog fragment + ADR fragments (incl. desktop-transport invariant) for inline preview safe delivery

  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
  ```

---

## Landing / merge checklist

- [ ] Task 1 is committed to **`main`** (the schema column + generated migration + schema test) ahead of the worktrees; its migration number is whatever `generate-per-firm-migrations` emitted at land time (gated on `vp run worktrees`).
- [ ] Tasks 2–15 are committed on **`slice-2-3-safe-delivery`**, rebased on the updated `main`.
- [ ] `ingest-core.ts` was never edited; all file-manager changes are additive (a new read, `preview-policy.ts`, `safe-rendition-port.ts`); `getCurrentCleanVersion`/`selectCurrentCleanVersionStatement` untouched.
- [ ] `FileVersionItem` did not gain `inlinePlayable` (only the package `CleanVersionListItem` widened); `PreviewGrant` is the slice's only OpenAPI delta.
- [ ] The desktop real-HTTP / no-`tauri://`-scheme transport invariant (§6.9) and the launch CORS posture (§6.10) are written down (ADR fragment / active-work / header test + fitness guard).
- [ ] The `security.md` amendment was preceded by `vp run worktrees`.
- [ ] At merge: edit only the 2·3 `STATUS.md` row; CHANGELOG + ADRs assemble from fragments on `main`; remove the worktree, delete the branch, and delete `docs/active-work/slice-2-3-safe-delivery.md`.
