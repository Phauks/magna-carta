import { env, runInDurableObject } from "cloudflare:test";
import { writeFirmSettingStatement } from "@magna-carta/data-access/setting-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { FirmId } from "@magna-carta/identifiers/types";
import { searchIndexingEnabledDefinition } from "@magna-carta/search/settings";
import { beforeAll, describe, expect, it } from "vitest";
import type { SearchIndexJob } from "../src/search/index-coordinator.ts";
import { searchIndexJobName } from "../src/search/index-types.ts";
import { runReextractionSweep } from "../src/search/reextraction-sweep.ts";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import { firmDatabaseHandle, type FirmDatabaseHandle } from "./support/firm-database-handle.ts";

// The repair pass that makes composite extraction retroactive. A document the old recognition-only
// extractor recorded unreadable has no live split in the catalog, and no live split is exactly what
// this sweep looks for — so the documents the fix now reads are the documents it re-enqueues, without
// any marker having had to be written at the time they failed.

const MEMBER = "user_reextract";
const NOW = "2026-06-22T12:00:00.000Z";

interface TestFirm {
  readonly firmId: FirmId;
  readonly database: FirmDatabaseHandle;
  readonly matterId: string;
}

// Each test gets its own firm, and every firm from an earlier test is suspended before it runs, so
// the pass under test walks exactly one firm and `report.enqueued` means what the assertion says it
// means. The sweep reads every reachable active firm by design — that is the behaviour being relied
// on in production, so the test narrows the fleet rather than narrowing the sweep.
async function freshFirm(name: string, indexingEnabled = true): Promise<TestFirm> {
  // The control-plane firm row carries unique database and bucket names, so earlier tests' rows are
  // cleared rather than suspended. The firm id itself is fresh every time, so each test still gets an
  // untouched per-firm database Durable Object.
  await env.DB_CONTROL.prepare("DELETE FROM firm").run();
  const firmId: FirmId = newIdentifier("firm");
  await env.DB_CONTROL.prepare(
    "INSERT INTO firm (id, name, database_identifier, bucket_name, status, created_at) VALUES (?1, ?2, 'DB_FIRM_POOL_1', 'magna-carta-test-reextract', 'active', ?3)",
  )
    .bind(firmId, name, NOW)
    .run();
  const database = firmDatabaseHandle(firmId);
  await database
    .prepare(
      "INSERT INTO member (user_id, display_name, status, created_at) VALUES (?1, 'Sweeper', 'active', ?2)",
    )
    .bind(MEMBER, NOW)
    .run();
  const matterId = newIdentifier("matter");
  await database
    .prepare(
      "INSERT INTO matter (id, title, status, responsible_member_id, created_at, updated_at) VALUES (?1, 'Reextraction Matter', 'open', ?2, ?3, ?3)",
    )
    .bind(matterId, MEMBER, NOW)
    .run();
  await writeFirmSettingStatement(
    database,
    searchIndexingEnabledDefinition,
    indexingEnabled,
    NOW,
  ).run();
  return { firmId, database, matterId };
}

async function jobStateFor(firm: TestFirm, documentId: string) {
  const stub = env.SEARCH_INDEX_JOB.get(
    env.SEARCH_INDEX_JOB.idFromName(searchIndexJobName(firm.firmId, documentId, 1)),
  );
  return runInDurableObject(stub, (instance: SearchIndexJob) => instance.status());
}

// A job that was never started reports the unknown-job sentinel, which is how a test tells "this
// document was not swept" from "this document was swept and parked".
async function wasEnqueued(firm: TestFirm, documentId: string): Promise<boolean> {
  return (await jobStateFor(firm, documentId)).reason !== "unknown job";
}

async function seedCommittedDocument(
  firm: TestFirm,
  name: string,
  options: { readonly deleted?: boolean } = {},
): Promise<string> {
  const fileId = newIdentifier("file");
  const versionId = newIdentifier("fileVersion");
  // The file row lands first with no current version, because that column points at a version row
  // that does not exist yet; the commit pointer is set once the version is in, as ingest does it.
  await firm.database
    .prepare(
      "INSERT INTO file (id, matter_id, name, current_version_id, created_at, updated_at, deleted_at) VALUES (?1, ?2, ?3, NULL, ?4, ?4, ?5)",
    )
    .bind(fileId, firm.matterId, name, NOW, options.deleted === true ? NOW : null)
    .run();
  await firm.database
    .prepare(
      "INSERT INTO file_version (id, file_id, version_number, r2_key, size_bytes, content_sha256, storage_class, status, uploaded_by, created_at, committed_at, sniffed_content_type) VALUES (?1, ?2, 1, ?3, 100, ?4, 'standard', 'clean', ?5, ?6, ?6, 'application/pdf')",
    )
    .bind(versionId, fileId, `files/${fileId}/${versionId}`, `hash-${fileId}`, MEMBER, NOW)
    .run();
  await firm.database
    .prepare("UPDATE file SET current_version_id = ?2 WHERE id = ?1")
    .bind(fileId, versionId)
    .run();
  return fileId;
}

async function recordSplitFor(firm: TestFirm, fileId: string): Promise<void> {
  await firm.database
    .prepare(
      "INSERT INTO index_split (id, matter_id, document_id, version, object_key, document_count, size_bytes, schema_generation, created_at, superseded_at) VALUES (?1, ?2, ?3, 1, ?4, 2, 2048, 1, ?5, NULL)",
    )
    .bind(newIdentifier("indexSplit"), firm.matterId, fileId, `splits/${fileId}`, NOW)
    .run();
}

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
});

describe("runReextractionSweep", () => {
  it("re-enqueues a committed document the catalog holds no split for, and leaves indexed ones alone", async () => {
    // `missing` is the shape of every document the old extractor recorded unreadable: committed,
    // clean, current — and absent from the corpus.
    const firm = await freshFirm("Missing Split Firm");
    const missing = await seedCommittedDocument(firm, "Purchase Agreement.pdf");
    const alreadyIndexed = await seedCommittedDocument(firm, "Closing Statement.pdf");
    await recordSplitFor(firm, alreadyIndexed);

    const report = await runReextractionSweep(env);

    expect(report).toEqual({ firmsProcessed: 1, enqueued: 1 });
    expect((await jobStateFor(firm, missing)).status).toBe("queued");
    expect(await wasEnqueued(firm, alreadyIndexed)).toBe(false);
  });

  it("converges: a second pass after the split lands finds nothing to do", async () => {
    // The pass runs daily and must not re-enqueue work it has already had done. Convergence comes
    // from the catalog itself, not from remembering what was swept last time.
    const firm = await freshFirm("Converging Firm");
    const repaired = await seedCommittedDocument(firm, "Deed of Trust.pdf");

    expect((await runReextractionSweep(env)).enqueued).toBe(1);
    await recordSplitFor(firm, repaired);
    expect((await runReextractionSweep(env)).enqueued).toBe(0);
  });

  it("never sweeps a deleted file, whatever the catalog says about it", async () => {
    const firm = await freshFirm("Deleted File Firm");
    const deleted = await seedCommittedDocument(firm, "Withdrawn Exhibit.pdf", { deleted: true });

    const report = await runReextractionSweep(env);

    expect(report.enqueued).toBe(0);
    expect(await wasEnqueued(firm, deleted)).toBe(false);
  });

  it("enqueues nothing for a firm that has not turned indexing on", async () => {
    // The same gate the ingest path reads. A firm that has not opted in must not have its corpus
    // extracted and written into R2 as a side effect of a repair pass it never asked for.
    const firm = await freshFirm("Opted Out Firm", false);
    const untouched = await seedCommittedDocument(firm, "Opt Out Memo.pdf");

    const report = await runReextractionSweep(env);

    expect(report.enqueued).toBe(0);
    expect(await wasEnqueued(firm, untouched)).toBe(false);
  });

  it("bounds one pass per firm, so a whole back catalogue drains over several passes", async () => {
    // After this fix a firm's ENTIRE corpus can be missing from the index. The cap is what keeps one
    // daily fire bounded instead of flooding the queue with every document a firm has ever loaded.
    const firm = await freshFirm("Backlog Firm");
    for (const name of ["Exhibit A.pdf", "Exhibit B.pdf", "Exhibit C.pdf"]) {
      await seedCommittedDocument(firm, name);
    }

    expect((await runReextractionSweep(env, { perFirmCap: 2 })).enqueued).toBe(2);
    expect((await runReextractionSweep(env, { perFirmCap: 2 })).enqueued).toBe(2);
  });
});
