import { env, runInDurableObject } from "cloudflare:test";
import { writeFirmSettingStatement } from "@magna-carta/data-access/setting-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { FirmId } from "@magna-carta/identifiers/types";
import { searchIndexingEnabledDefinition } from "@magna-carta/search/settings";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { SearchIndexJob } from "../src/search/index-coordinator.ts";
import {
  SEARCH_INDEX_MAXIMUM_ATTEMPTS_PER_GENERATION,
  searchIndexJobName,
} from "../src/search/index-types.ts";
import { searchEngineGeneration } from "../src/search/engine-generation.ts";
import { runReextractionSweep } from "../src/background/search/reextraction-sweep.ts";
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

// THE SEARCH-INDEX QUEUE CONSUMER IS LIVE UNDER THE TEST POOL. Every message a sweep enqueues is
// delivered to the real consumer about a second later (immediately once five stack up), which finds
// no bytes at the message's sourceKey — these fixtures store none in R2 — and honestly records
// `failed` ("source bytes not found"). That write is concurrent with the test body, so two rules
// hold everywhere below: never assert `queued` after a sweep (assert `wasEnqueued`, which no verdict
// can un-set), and never write a simulated verdict until the in-flight message's real one has
// landed. The coordinator itself is behaving exactly as designed — a consumer verdict may overwrite
// a prior failed/deferred because queue redelivery legitimately re-verdicts a job the consumer's
// catch path markFailed-ed before retrying — so the sequencing burden is this file's, not the
// state machine's.
async function verdictLanded(firm: TestFirm, documentId: string): Promise<void> {
  await vi.waitFor(
    async () => {
      const { status } = await jobStateFor(firm, documentId);
      expect(status === "failed" || status === "deferred" || status === "indexed").toBe(true);
    },
    { timeout: 20_000, interval: 50 },
  );
}

async function seedCommittedDocument(
  firm: TestFirm,
  name: string,
  options: { readonly deleted?: boolean; readonly committedAt?: string } = {},
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
    .bind(
      versionId,
      fileId,
      `files/${fileId}/${versionId}`,
      `hash-${fileId}`,
      MEMBER,
      options.committedAt ?? NOW,
    )
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

    expect(report).toEqual({ firmsProcessed: 1, enqueued: 1, examined: 1 });
    expect(await wasEnqueued(firm, missing)).toBe(true);
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
    const documents: string[] = [];
    for (const name of ["Exhibit A.pdf", "Exhibit B.pdf", "Exhibit C.pdf"]) {
      documents.push(await seedCommittedDocument(firm, name));
    }

    expect((await runReextractionSweep(env, { perFirmCap: 2 })).enqueued).toBe(2);
    // The second pass walks PAST the two it already queued and reaches the third, rather than
    // re-enqueuing the same two — the cap bounds new work, not the distance the walk travels.
    expect((await runReextractionSweep(env, { perFirmCap: 2 })).enqueued).toBe(1);
    for (const documentId of documents) {
      expect(await wasEnqueued(firm, documentId)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------------------------
// Convergence over FAILURES, not only over successes
// ---------------------------------------------------------------------------------------------
//
// A document whose job ends `failed` or `deferred` leaves no split row, so it stays a candidate for
// every future pass. Ordered from the catalogue's head with a per-firm cap, a firm whose oldest
// documents are all unreadable would have every pass spent re-reading exactly those documents — the
// repair sweep unable to reach the rest of the catalogue at all. These are the cases that would not
// hold before the cursor advanced past a candidate whatever its outcome.

describe("runReextractionSweep over a catalogue whose head cannot be repaired", () => {
  // Drive each of the head documents to a terminal state that leaves no split behind, exactly as the
  // consumer's `unextractable` and `engine-not-implemented` branches do. The live consumer holds the
  // in-flight message and will record its own verdict for it; wait that verdict out first, so the
  // write below is the LAST write for this attempt rather than a competitor racing the delivery.
  async function markTerminal(
    firm: TestFirm,
    documentId: string,
    outcome: "failed" | "deferred",
  ): Promise<void> {
    await verdictLanded(firm, documentId);
    const stub = env.SEARCH_INDEX_JOB.get(
      env.SEARCH_INDEX_JOB.idFromName(searchIndexJobName(firm.firmId, documentId, 1)),
    );
    await runInDurableObject(stub, async (instance: SearchIndexJob) => {
      if (outcome === "failed") await instance.markFailed("document yielded no indexable text");
      else await instance.markDeferred("text extraction engine not deployed");
    });
  }

  it("reaches the tail of a catalogue whose entire head is permanently failed", async () => {
    const firm = await freshFirm("Failed Head Firm");
    // Distinct commit timestamps, ascending, so these really are the HEAD of the committed_at ordering
    // the candidate query walks — the decade of scanned correspondence loaded before the contract.
    const head: string[] = [];
    for (let index = 0; index < 6; index += 1) {
      head.push(
        await seedCommittedDocument(firm, `Scanned Correspondence ${index}.pdf`, {
          committedAt: `2026-06-0${index + 1}T00:00:00.000Z`,
        }),
      );
    }
    const tail = await seedCommittedDocument(firm, "Born Digital Contract.pdf", {
      committedAt: "2026-06-20T00:00:00.000Z",
    });

    // Spend every head document's attempts against the current engine generation, the way repeated
    // daily passes against an unbound recognition engine would.
    for (let pass = 0; pass < SEARCH_INDEX_MAXIMUM_ATTEMPTS_PER_GENERATION; pass += 1) {
      await runReextractionSweep(env, { perFirmCap: head.length });
      for (const documentId of head) await markTerminal(firm, documentId, "failed");
    }

    // The tail has never been reached: every pass so far was spent on the head, which is precisely the
    // starvation being fixed. With a cap of exactly the head's size, the old walk could never get past it.
    const report = await runReextractionSweep(env, { perFirmCap: head.length });

    expect(await wasEnqueued(firm, tail)).toBe(true);
    expect(report.enqueued).toBe(1);
    // Every head document was still looked at — the walk goes through them, it does not skip the query.
    expect(report.examined).toBe(head.length + 1);
  }, 30_000);

  it("stops paying for a document that cannot be read, once its attempts are spent", async () => {
    const firm = await freshFirm("Permanent Failure Firm");
    const unreadable = await seedCommittedDocument(firm, "Corrupt Scan.pdf");

    for (let pass = 0; pass < SEARCH_INDEX_MAXIMUM_ATTEMPTS_PER_GENERATION; pass += 1) {
      expect((await runReextractionSweep(env)).enqueued).toBe(1);
      await markTerminal(firm, unreadable, "failed");
    }

    // Still a candidate — the catalog holds no split for it and never will — but no longer work.
    const report = await runReextractionSweep(env);
    expect(report.examined).toBe(1);
    expect(report.enqueued).toBe(0);
    expect((await jobStateFor(firm, unreadable)).status).toBe("failed");
  }, 30_000);

  it("picks a deferred backlog back up when an engine deploy changes the generation", async () => {
    // The bound must not strand work the platform can now do: a document deferred because no
    // recognition engine was bound was never really tried against a pipeline that has one. Driven at
    // the coordinator, which is where the generation comparison lives — the sweep only passes the
    // token through, and `searchEngineGeneration` derives it from the bindings.
    const firm = await freshFirm("Engine Deploy Firm");
    const scanned = await seedCommittedDocument(firm, "Deferred Scan.pdf");

    for (let pass = 0; pass < SEARCH_INDEX_MAXIMUM_ATTEMPTS_PER_GENERATION; pass += 1) {
      await runReextractionSweep(env);
      await markTerminal(firm, scanned, "deferred");
    }
    expect((await runReextractionSweep(env)).enqueued).toBe(0);
    expect((await jobStateFor(firm, scanned)).status).toBe("deferred");

    const stub = env.SEARCH_INDEX_JOB.get(
      env.SEARCH_INDEX_JOB.idFromName(searchIndexJobName(firm.firmId, scanned, 1)),
    );
    const message = {
      firmId: firm.firmId,
      matterId: firm.matterId,
      documentId: scanned,
      version: 1,
      sourceKey: `files/${scanned}/v1`,
      contentType: "application/pdf",
      engineGeneration: searchEngineGeneration(env),
    };

    // Same generation: still refused, which is the bound doing its job.
    const refused = await runInDurableObject(stub, (instance: SearchIndexJob) =>
      instance.start(message),
    );
    expect(refused.started).toBe(false);

    // A deploy binds the recognition engine, so the generation differs and the count starts again.
    const afterDeploy = await runInDurableObject(stub, (instance: SearchIndexJob) =>
      instance.start({ ...message, engineGeneration: `${searchEngineGeneration(env)}|redeployed` }),
    );
    expect(afterDeploy.started).toBe(true);
    expect(afterDeploy.state.status).toBe("queued");
    expect(afterDeploy.state.attempts).toBe(1);
  }, 30_000);
});
