import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { commitEffectBatch } from "@magna-carta/data-access/effect-batch";
import { writeFirmSettingStatement } from "@magna-carta/data-access/setting-statements";
import { initiateUpload } from "@magna-carta/file-manager/file-service";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { FileVersionId, FirmId, MatterId, UserId } from "@magna-carta/identifiers/types";
import { searchIndexingEnabledDefinition } from "@magna-carta/search/settings";
import { handleIngestMessage } from "../src/background/files/ingest-consumer.ts";
import { firmDatabaseFor } from "../src/firm-database/firm-database-proxy.ts";
import { enqueueVersionForIndexing } from "../src/search/enqueue-index.ts";
import { searchIndexJobName } from "../src/search/index-types.ts";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";

// The enqueue seam: a version that commits clean on the ingest path joins the matter's searchable
// corpus, but only for a firm that has turned indexing on. Real Miniflare bindings throughout — the
// firm's FirmDatabase DO, R2, and the SearchIndexJob DO — so the gate is exercised where it actually
// runs rather than against a mock.

const BUCKET = "magna-carta-test-search-enqueue-bucket";
const PDF_BYTES = new TextEncoder().encode("%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n%%EOF\n");
const ACTOR = "user_search_enqueue" as UserId;
const clock = { now: () => "2026-08-04T12:00:00.000Z" };

let firmId: FirmId;
let matterId: MatterId;

function database() {
  return firmDatabaseFor(env.FIRM_DATABASE, firmId);
}

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  firmId = newIdentifier("firm");
  await env.DB_CONTROL.prepare(
    "INSERT INTO firm (id, name, bucket_name, status, created_at) VALUES (?1, ?2, ?3, 'active', ?4)",
  )
    .bind(firmId, "Search Enqueue Firm", BUCKET, clock.now())
    .run();
  await database()
    .prepare(
      "INSERT INTO member (user_id, display_name, status, created_at) VALUES (?1, 'Enqueue Actor', 'active', ?2)",
    )
    .bind(ACTOR, clock.now())
    .run();
  matterId = newIdentifier("matter");
  await database()
    .prepare(
      "INSERT INTO matter (id, title, status, responsible_member_id, created_at, updated_at) VALUES (?1, 'Enqueue Matter', 'open', ?2, ?3, ?3)",
    )
    .bind(matterId, ACTOR, clock.now())
    .run();
});

async function setIndexingEnabled(enabled: boolean) {
  await database().batch([
    writeFirmSettingStatement(database(), searchIndexingEnabledDefinition, enabled, clock.now()),
  ]);
}

async function seedAndCommitVersion(name: string): Promise<FileVersionId> {
  const initiated = await initiateUpload(
    database(),
    {
      matterId,
      name,
      declaredSize: PDF_BYTES.byteLength,
      declaredContentType: "application/pdf",
      uploadedBy: ACTOR,
      mode: "put",
    },
    { clock, actorUserId: ACTOR },
  );
  await commitEffectBatch(database(), initiated.effect, { now: clock.now });
  await env.R2.put(initiated.r2Key, PDF_BYTES);
  // Drive the real ingest consumer so the version reaches `clean` exactly as production does — this is
  // the path the enqueue hangs off.
  await handleIngestMessage(env, {
    bucket: BUCKET,
    object: { key: initiated.r2Key, size: PDF_BYTES.byteLength },
    action: "PutObject",
  });
  return initiated.versionId;
}

describe("the search-index enqueue gate", () => {
  it("enqueues nothing while the firm has indexing off — the safe default", async () => {
    await setIndexingEnabled(false);
    const versionId = await seedAndCommitVersion("gate-off.pdf");

    const message = await enqueueVersionForIndexing(env, firmId, versionId);
    expect(message).toBeUndefined();
  });

  it("enqueues a committed clean version once the firm turns indexing on", async () => {
    await setIndexingEnabled(true);
    const versionId = await seedAndCommitVersion("gate-on.pdf");

    const outcome = await enqueueVersionForIndexing(env, firmId, versionId);
    expect(outcome).toBeDefined();
    // The version resolves to indexable work — but `seedAndCommitVersion` drove the real ingest
    // consumer, which already enqueued it, so this call started nothing. That is the same no-op the
    // Durable Object assertion below states, read from the enqueue's own answer.
    expect(outcome?.started).toBe(false);
    const message = outcome?.message;
    expect(message?.matterId).toBe(matterId);
    expect(message?.version).toBe(1);
    expect(message?.contentType).toBe("application/pdf");

    // The job's Durable Object holds the work, which is what makes a second enqueue a no-op rather
    // than a second build.
    const stub = env.SEARCH_INDEX_JOB.get(
      env.SEARCH_INDEX_JOB.idFromName(
        searchIndexJobName(firmId, message!.documentId, message!.version),
      ),
    );
    expect((await stub.status()).status).toBe("queued");
  });

  it("resolves the document, matter, and version number the index is keyed on", async () => {
    await setIndexingEnabled(true);
    const versionId = await seedAndCommitVersion("resolves.pdf");
    const message = (await enqueueVersionForIndexing(env, firmId, versionId))?.message;

    expect(message?.documentId).toMatch(/^file_/u);
    expect(message?.matterId).toBe(matterId);
    expect(message?.sourceKey).toBeTruthy();
  });

  it("declines a version that is not committed clean", async () => {
    await setIndexingEnabled(true);
    // A pending version — uploaded but never ingested, so nothing has cleared its bytes.
    const initiated = await initiateUpload(
      database(),
      {
        matterId,
        name: "still-pending.pdf",
        declaredSize: PDF_BYTES.byteLength,
        declaredContentType: "application/pdf",
        uploadedBy: ACTOR,
        mode: "put",
      },
      { clock, actorUserId: ACTOR },
    );
    await commitEffectBatch(database(), initiated.effect, { now: clock.now });

    expect(await enqueueVersionForIndexing(env, firmId, initiated.versionId)).toBeUndefined();
  });

  it("the ingest consumer itself enqueues on a clean commit when the gate is on", async () => {
    await setIndexingEnabled(true);
    // seedAndCommitVersion runs the real ingest consumer, which calls the enqueue internally. Prove the
    // wiring by finding the job the consumer's own call created.
    const versionId = await seedAndCommitVersion("wired.pdf");
    const version = await database()
      .prepare("SELECT file_id, version_number FROM file_version WHERE id = ?1")
      .bind(versionId)
      .all<{ file_id: string; version_number: number }>();
    const row = version.results[0]!;

    const stub = env.SEARCH_INDEX_JOB.get(
      env.SEARCH_INDEX_JOB.idFromName(searchIndexJobName(firmId, row.file_id, row.version_number)),
    );
    expect((await stub.status()).status).toBe("queued");
  });
});
