import { commitEffectBatch } from "@magna-carta/data-access/effect-batch";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type {
  DocumentCheckoutId,
  FileId,
  FileVersionId,
  UserId,
} from "@magna-carta/identifiers/types";
import { describe, expect, it } from "vitest";
import {
  commitCheckinVersion,
  commitVersion,
  initiateCheckin,
  initiateUpload,
} from "../src/file-service.ts";
import { ACTOR, freshDatabase, now, options, seedMatter } from "./support.ts";

// A policy-allowed fixture — the divergence logic under test is content-type-agnostic; the default
// upload policy does not allow the .docx type, and seedBase uses the real initiateUpload gate.
const docx = {
  name: "brief.pdf",
  declaredSize: 2048,
  declaredContentType: "application/pdf",
};

type Db = ReturnType<typeof freshDatabase>;

// The node-sqlite batch database exposes all()/run() (not first()), matching the other unit tests.
async function firstRow<T>(
  database: Db,
  sql: string,
  ...params: unknown[]
): Promise<T | undefined> {
  const { results } = await database
    .prepare(sql)
    .bind(...params)
    .all<T>();
  return results[0];
}

// A clean v1 on a fresh file — the base an offline checkout is taken against.
async function seedBase(database: Db): Promise<{ fileId: FileId; baseVersionId: FileVersionId }> {
  const matterId = await seedMatter(database);
  const initiated = await initiateUpload(
    database,
    {
      matterId: matterId as never,
      name: docx.name,
      declaredSize: docx.declaredSize,
      declaredContentType: docx.declaredContentType,
      uploadedBy: ACTOR,
      mode: "put",
    },
    options,
  );
  await commitEffectBatch(database, initiated.effect, { now });
  const committed = await commitVersion(
    database,
    {
      versionId: initiated.versionId,
      sizeBytes: docx.declaredSize,
      sniffedContentType: docx.declaredContentType,
      contentSha256: "hash-base",
      scanVerdict: "clean",
      scanEngineVersion: "test-1",
      scanDetail: null,
      now: now(),
    },
    options,
  );
  await commitEffectBatch(database, committed.effect, { now });
  return { fileId: initiated.fileId, baseVersionId: initiated.versionId };
}

// An active offline-working-copy checkout against a base version.
async function seedCheckout(
  database: Db,
  fileId: FileId,
  baseVersionId: FileVersionId,
): Promise<DocumentCheckoutId> {
  const checkoutId = newIdentifier("documentCheckout");
  await database
    .prepare(
      "INSERT INTO document_checkout (id, file_id, holder_member_id, lock_type, base_version_id, acquired_at, last_activity_at, status, idle_release_at) VALUES (?1, ?2, ?3, 'offline_working_copy', ?4, ?5, ?5, 'active', NULL)",
    )
    .bind(checkoutId, fileId, ACTOR as UserId, baseVersionId, now())
    .run();
  return checkoutId;
}

// Mint the pending check-in version (via the production initiate path) and commit it through the
// quarantine-ingest commit hook with the given clean facts.
async function checkinAndCommit(
  database: Db,
  fileId: FileId,
  checkoutId: DocumentCheckoutId,
  contentSha256: string,
) {
  const initiated = await initiateCheckin(
    database,
    {
      fileId,
      checkoutId,
      declaredSize: docx.declaredSize,
      declaredContentType: docx.declaredContentType,
      uploadedBy: ACTOR,
    },
    options,
  );
  await commitEffectBatch(database, initiated.effect, { now });
  const result = await commitCheckinVersion(
    database,
    {
      versionId: initiated.versionId,
      checkoutId,
      sizeBytes: docx.declaredSize,
      sniffedContentType: docx.declaredContentType,
      contentSha256,
      scanVerdict: "clean",
      scanEngineVersion: "test-1",
      scanDetail: null,
      now: now(),
    },
    options,
  );
  await commitEffectBatch(database, result.effect, { now });
  return { versionId: initiated.versionId, result };
}

describe("initiateCheckin", () => {
  it("mints a pending version carrying the checkout id and an upload session for the ingest gate", async () => {
    const database = freshDatabase();
    const { fileId, baseVersionId } = await seedBase(database);
    const checkoutId = await seedCheckout(database, fileId, baseVersionId);

    const initiated = await initiateCheckin(
      database,
      {
        fileId,
        checkoutId,
        declaredSize: docx.declaredSize,
        declaredContentType: docx.declaredContentType,
        uploadedBy: ACTOR,
      },
      options,
    );
    await commitEffectBatch(database, initiated.effect, { now });

    const version = await firstRow<{
      version_number: number;
      status: string;
      checkout_id: string;
    }>(
      database,
      "SELECT version_number, status, checkout_id FROM file_version WHERE id = ?1",
      initiated.versionId,
    );
    expect(version).toEqual({ version_number: 2, status: "pending", checkout_id: checkoutId });

    const session = await firstRow<{ status: string }>(
      database,
      "SELECT status FROM upload_session WHERE file_version_id = ?1",
      initiated.versionId,
    );
    expect(session?.status).toBe("open");
  });
});

describe("commitCheckinVersion", () => {
  it("fast-forwards when the base is still current: commits, advances the pointer, releases the checkout", async () => {
    const database = freshDatabase();
    const { fileId, baseVersionId } = await seedBase(database);
    const checkoutId = await seedCheckout(database, fileId, baseVersionId);

    const { versionId, result } = await checkinAndCommit(
      database,
      fileId,
      checkoutId,
      "hash-edited",
    );

    expect(result.skipped).toBe(false);
    expect(result.diverged).toBe(false);

    const version = await firstRow<{
      status: string;
      reconciliation_status: string;
      diverged_from_version_id: string | null;
    }>(
      database,
      "SELECT status, reconciliation_status, diverged_from_version_id FROM file_version WHERE id = ?1",
      versionId,
    );
    expect(version).toEqual({
      status: "clean",
      reconciliation_status: "clean",
      diverged_from_version_id: null,
    });

    const file = await firstRow<{ current_version_id: string }>(
      database,
      "SELECT current_version_id FROM file WHERE id = ?1",
      fileId,
    );
    expect(file?.current_version_id).toBe(versionId);

    const checkout = await firstRow<{ status: string }>(
      database,
      "SELECT status FROM document_checkout WHERE id = ?1",
      checkoutId,
    );
    expect(checkout?.status).toBe("released");
  });

  it("produces a conflicting copy when the base has advanced: never overwrites current, flags the version, sets the checkout reconciling", async () => {
    const database = freshDatabase();
    const { fileId, baseVersionId } = await seedBase(database);
    const checkoutId = await seedCheckout(database, fileId, baseVersionId);

    // The document advances while the offline copy is out: a deliberate save cuts v2 → current.
    const advance = await initiateUpload(
      database,
      {
        matterId: "matter_a" as never,
        name: docx.name,
        declaredSize: docx.declaredSize,
        declaredContentType: docx.declaredContentType,
        uploadedBy: ACTOR,
        mode: "put",
        fileId,
      },
      options,
    );
    await commitEffectBatch(database, advance.effect, { now });
    const advanceCommit = await commitVersion(
      database,
      {
        versionId: advance.versionId,
        sizeBytes: docx.declaredSize,
        sniffedContentType: docx.declaredContentType,
        contentSha256: "hash-v2",
        scanVerdict: "clean",
        scanEngineVersion: "test-1",
        scanDetail: null,
        now: now(),
      },
      options,
    );
    await commitEffectBatch(database, advanceCommit.effect, { now });
    const v2 = advance.versionId;

    const { versionId, result } = await checkinAndCommit(
      database,
      fileId,
      checkoutId,
      "hash-offline-edit",
    );

    expect(result.skipped).toBe(false);
    expect(result.diverged).toBe(true);

    const version = await firstRow<{
      status: string;
      reconciliation_status: string;
      diverged_from_version_id: string | null;
    }>(
      database,
      "SELECT status, reconciliation_status, diverged_from_version_id FROM file_version WHERE id = ?1",
      versionId,
    );
    expect(version).toEqual({
      status: "clean",
      reconciliation_status: "conflict_pending",
      diverged_from_version_id: baseVersionId,
    });

    // current never regressed to (or advanced past) the conflicting copy — it still points at v2.
    const file = await firstRow<{ current_version_id: string }>(
      database,
      "SELECT current_version_id FROM file WHERE id = ?1",
      fileId,
    );
    expect(file?.current_version_id).toBe(v2);

    const checkout = await firstRow<{ status: string }>(
      database,
      "SELECT status FROM document_checkout WHERE id = ?1",
      checkoutId,
    );
    expect(checkout?.status).toBe("reconciling");
  });

  it("seeds the content-dedup cache for a flagged-but-committed check-in (same rule as commitVersion)", async () => {
    // A flagged file returned through an offline check-in (informed-access / allow-and-flag treatment
    // commits rather than quarantines) must still populate scan_cache, exactly as commitVersion does —
    // otherwise an access-triggered re-scan of identical content needlessly re-runs the engine.
    const database = freshDatabase();
    const { fileId, baseVersionId } = await seedBase(database);
    const checkoutId = await seedCheckout(database, fileId, baseVersionId);

    const initiated = await initiateCheckin(
      database,
      {
        fileId,
        checkoutId,
        declaredSize: docx.declaredSize,
        declaredContentType: docx.declaredContentType,
        uploadedBy: ACTOR,
      },
      options,
    );
    await commitEffectBatch(database, initiated.effect, { now });
    const result = await commitCheckinVersion(
      database,
      {
        versionId: initiated.versionId,
        checkoutId,
        sizeBytes: docx.declaredSize,
        sniffedContentType: docx.declaredContentType,
        contentSha256: "hash-flagged-checkin",
        scanVerdict: "flagged",
        scanEngineVersion: "test-1",
        scanDetail: "Eicar-Test",
        rawScanResult: {
          engineVersion: "test-1",
          clam: { state: "infected", signature: "Eicar-Test" },
          heuristic: { kind: "none" },
          matches: [],
          timings: { clamdMs: 1, yaraMs: 1 },
        },
        now: now(),
      },
      options,
    );
    await commitEffectBatch(database, result.effect, { now });

    const cached = await firstRow<{ engine_version: string }>(
      database,
      "SELECT engine_version FROM scan_cache WHERE content_sha256 = ?1",
      "hash-flagged-checkin",
    );
    expect(cached?.engine_version).toBe("test-1");
  });

  it("fast-forward no-op: an unchanged check-in cuts no version and releases the checkout", async () => {
    const database = freshDatabase();
    const { fileId, baseVersionId } = await seedBase(database);
    const checkoutId = await seedCheckout(database, fileId, baseVersionId);

    // The offline copy comes back byte-identical to the base (still current) — nothing to commit.
    const { versionId, result } = await checkinAndCommit(database, fileId, checkoutId, "hash-base");

    expect(result.skipped).toBe(true);

    const version = await firstRow<{ status: string }>(
      database,
      "SELECT status FROM file_version WHERE id = ?1",
      versionId,
    );
    expect(version?.status).toBe("abandoned");

    const file = await firstRow<{ current_version_id: string }>(
      database,
      "SELECT current_version_id FROM file WHERE id = ?1",
      fileId,
    );
    expect(file?.current_version_id).toBe(baseVersionId);

    const checkout = await firstRow<{ status: string }>(
      database,
      "SELECT status FROM document_checkout WHERE id = ?1",
      checkoutId,
    );
    expect(checkout?.status).toBe("released");
  });
});
