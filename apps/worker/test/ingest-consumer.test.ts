import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { commitEffectBatch } from "@magna-carta/data-access/effect-batch";
import { initiateUpload } from "@magna-carta/file-manager/file-service";
import { listFiles } from "@magna-carta/file-manager/queries";
import type { MalwareScanPort } from "@magna-carta/file-manager/scan-port";
import { inspectableSizeCapDefinition } from "@magna-carta/file-manager/upload-policy";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { FirmId, MatterId, UserId } from "@magna-carta/identifiers/types";
import { createMemoryLogger } from "@magna-carta/telemetry/logger";
import { maybeEnqueueRescanOnAccess } from "../src/files/access-rescan.ts";
import { handleIngestMessage } from "../src/files/ingest-consumer.ts";
import { resolveScanPort } from "../src/files/scan-port-binding.ts";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import { applyPerFirmMigrations } from "./support/apply-per-firm-migrations.ts";

// The files-ingest consumer over real Miniflare bindings: a synthetic R2 event (Miniflare cannot
// deliver real R2 notifications) for an object PUT into env.R2 drives the single-read pipeline to a
// clean commit or a quarantine, exactly as production's queue delivery would.

const BUCKET = "magna-carta-test-ingest-bucket";
const PDF_BYTES = new TextEncoder().encode("%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n%%EOF\n");

let firmId: FirmId;
let matterId: MatterId;
const ACTOR = "user_ingest" as UserId;
const clock = { now: () => "2026-06-13T12:00:00.000Z" };
const options = { clock, actorUserId: ACTOR };

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  await applyPerFirmMigrations(env.DB_FIRM_POOL_1);
  firmId = newIdentifier("firm");
  await env.DB_CONTROL.prepare(
    "INSERT INTO firm (id, name, database_identifier, bucket_name, status, created_at) VALUES (?1, ?2, 'DB_FIRM_POOL_1', ?3, 'active', ?4)",
  )
    .bind(firmId, "Ingest Test Firm", BUCKET, "2026-06-13T00:00:00.000Z")
    .run();
  await env.DB_FIRM_POOL_1.prepare(
    "INSERT INTO member (user_id, display_name, status, created_at) VALUES (?1, 'Ingest Actor', 'active', ?2)",
  )
    .bind(ACTOR, "2026-06-13T00:00:00.000Z")
    .run();
  matterId = newIdentifier("matter");
  await env.DB_FIRM_POOL_1.prepare(
    "INSERT INTO matter (id, title, status, responsible_member_id, created_at, updated_at) VALUES (?1, 'Ingest Matter', 'open', ?2, ?3, ?3)",
  )
    .bind(matterId, ACTOR, "2026-06-13T00:00:00.000Z")
    .run();
});

async function seedPendingVersion(
  name: string,
  declaredContentType: string,
  bytes: Uint8Array,
): Promise<{ versionId: string; r2Key: string }> {
  const initiated = await initiateUpload(
    env.DB_FIRM_POOL_1,
    {
      matterId,
      name,
      declaredSize: bytes.byteLength,
      declaredContentType,
      uploadedBy: ACTOR,
      mode: "put",
    },
    options,
  );
  await commitEffectBatch(env.DB_FIRM_POOL_1, initiated.effect, { now: clock.now });
  await env.R2.put(initiated.r2Key, bytes);
  return { versionId: initiated.versionId, r2Key: initiated.r2Key };
}

function event(bucket: string, key: string, size: number) {
  return { bucket, object: { key, size }, action: "PutObject", eventTime: clock.now() };
}

describe("handleIngestMessage", () => {
  it("commits a clean version: visible, metered, and an outbox event", async () => {
    const { versionId, r2Key } = await seedPendingVersion(
      "clean.pdf",
      "application/pdf",
      PDF_BYTES,
    );

    await handleIngestMessage(env, event(BUCKET, r2Key, PDF_BYTES.byteLength));

    const version = await env.DB_FIRM_POOL_1.prepare(
      "SELECT status, scan_verdict, content_sha256 FROM file_version WHERE id = ?1",
    )
      .bind(versionId)
      .first<{ status: string; scan_verdict: string; content_sha256: string }>();
    expect(version?.status).toBe("clean");
    expect(version?.scan_verdict).toBe("unscanned");
    expect(version?.content_sha256).toMatch(/^[0-9a-f]{64}$/);

    const files = await listFiles(env.DB_FIRM_POOL_1, { matterId });
    expect(files.data.some((f) => f.name === "clean.pdf")).toBe(true);

    const meter = await env.DB_FIRM_POOL_1.prepare(
      "SELECT bytes, object_count FROM storage_meter WHERE prefix = 'files'",
    ).first<{ bytes: number; object_count: number }>();
    expect(meter?.bytes).toBe(PDF_BYTES.byteLength);
    expect(meter?.object_count).toBe(1);

    const outbox = await env.DB_FIRM_POOL_1.prepare(
      "SELECT COUNT(*) AS n FROM outbox WHERE topic = 'file.version_committed'",
    ).first<{ n: number }>();
    expect(outbox?.n).toBe(1);
  });

  it("is replay-safe: a redelivered event does not double-commit or double-meter", async () => {
    const { versionId, r2Key } = await seedPendingVersion(
      "replay.pdf",
      "application/pdf",
      PDF_BYTES,
    );
    await handleIngestMessage(env, event(BUCKET, r2Key, PDF_BYTES.byteLength));
    const meterBefore = await env.DB_FIRM_POOL_1.prepare(
      "SELECT bytes FROM storage_meter WHERE prefix = 'files'",
    ).first<{ bytes: number }>();

    // Redeliver — the version is no longer pending, so the consumer no-ops.
    await handleIngestMessage(env, event(BUCKET, r2Key, PDF_BYTES.byteLength));

    const meterAfter = await env.DB_FIRM_POOL_1.prepare(
      "SELECT bytes FROM storage_meter WHERE prefix = 'files'",
    ).first<{ bytes: number }>();
    expect(meterAfter?.bytes).toBe(meterBefore?.bytes);
    const committedEvents = await env.DB_FIRM_POOL_1.prepare(
      "SELECT COUNT(*) AS n FROM outbox WHERE topic = 'file.version_committed' AND payload LIKE ?1",
    )
      .bind(`%${versionId}%`)
      .first<{ n: number }>();
    expect(committedEvents?.n).toBe(1);
  });

  it("is exactly-once under concurrent redelivery: two interleaved deliveries commit, meter, audit, and emit once", async () => {
    const { versionId, r2Key } = await seedPendingVersion(
      "concurrent.pdf",
      "application/pdf",
      PDF_BYTES,
    );
    const meterBefore = await env.DB_FIRM_POOL_1.prepare(
      "SELECT COALESCE(bytes, 0) AS bytes FROM storage_meter WHERE prefix = 'files'",
    ).first<{ bytes: number }>();

    // Two deliveries of the same R2 event run concurrently: both read the version while it is still
    // pending (before either commits), so only the idempotency record's UNIQUE(key) keeps the second
    // batch from double-applying the meter/audit/outbox effects.
    const evt = event(BUCKET, r2Key, PDF_BYTES.byteLength);
    await Promise.all([handleIngestMessage(env, evt), handleIngestMessage(env, evt)]);

    const version = await env.DB_FIRM_POOL_1.prepare(
      "SELECT status FROM file_version WHERE id = ?1",
    )
      .bind(versionId)
      .first<{ status: string }>();
    expect(version?.status).toBe("clean");

    // The meter moved by exactly one object's bytes.
    const meterAfter = await env.DB_FIRM_POOL_1.prepare(
      "SELECT bytes, object_count FROM storage_meter WHERE prefix = 'files'",
    ).first<{ bytes: number; object_count: number }>();
    expect((meterAfter?.bytes ?? 0) - (meterBefore?.bytes ?? 0)).toBe(PDF_BYTES.byteLength);

    // Exactly one commit audit row and exactly one committed outbox row for this version.
    const audit = await env.DB_FIRM_POOL_1.prepare(
      "SELECT COUNT(*) AS n FROM audit_log WHERE event = 'file.version_committed' AND subject_id = ?1",
    )
      .bind(versionId)
      .first<{ n: number }>();
    expect(audit?.n).toBe(1);
    const outbox = await env.DB_FIRM_POOL_1.prepare(
      "SELECT COUNT(*) AS n FROM outbox WHERE topic = 'file.version_committed' AND payload LIKE ?1",
    )
      .bind(`%${versionId}%`)
      .first<{ n: number }>();
    expect(outbox?.n).toBe(1);
  });

  it("quarantines at the gate a file whose name has a blocked extension (even if it slipped initiate)", async () => {
    // A pending version seeded directly with a blocked-extension name (bypassing initiate's policy
    // check) — the gate re-checks the real file name against the blocklist and quarantines it.
    const fileId = newIdentifier("file");
    const versionId = newIdentifier("fileVersion");
    const sessionId = newIdentifier("uploadSession");
    const r2Key = `files/${fileId}/${versionId}`;
    await env.DB_FIRM_POOL_1.prepare(
      "INSERT INTO file (id, matter_id, name, created_at, updated_at) VALUES (?1, ?2, 'payload.exe', ?3, ?3)",
    )
      .bind(fileId, matterId, clock.now())
      .run();
    await env.DB_FIRM_POOL_1.prepare(
      "INSERT INTO file_version (id, file_id, version_number, r2_key, declared_content_type, status, uploaded_by, created_at) VALUES (?1, ?2, 1, ?3, 'application/pdf', 'pending', ?4, ?5)",
    )
      .bind(versionId, fileId, r2Key, ACTOR, clock.now())
      .run();
    await env.DB_FIRM_POOL_1.prepare(
      "INSERT INTO upload_session (id, file_version_id, mode, declared_size, declared_content_type, status, created_at) VALUES (?1, ?2, 'put', ?3, 'application/pdf', 'open', ?4)",
    )
      .bind(sessionId, versionId, PDF_BYTES.byteLength, clock.now())
      .run();
    await env.R2.put(r2Key, PDF_BYTES);

    await handleIngestMessage(env, event(BUCKET, r2Key, PDF_BYTES.byteLength));

    const version = await env.DB_FIRM_POOL_1.prepare(
      "SELECT status FROM file_version WHERE id = ?1",
    )
      .bind(versionId)
      .first<{ status: string }>();
    expect(version?.status).toBe("quarantined");
    const outbox = await env.DB_FIRM_POOL_1.prepare(
      "SELECT payload FROM outbox WHERE topic = 'file.quarantined' AND payload LIKE ?1",
    )
      .bind(`%${versionId}%`)
      .first<{ payload: string }>();
    expect(outbox?.payload).toContain("policy-type");
  });

  it("quarantines a declared-type lie: invisible, with a quarantine outbox event", async () => {
    // PDF bytes declared as text/plain — the sniffed magic bytes contradict the declared type.
    const { versionId, r2Key } = await seedPendingVersion("liar.txt", "text/plain", PDF_BYTES);

    await handleIngestMessage(env, event(BUCKET, r2Key, PDF_BYTES.byteLength));

    const version = await env.DB_FIRM_POOL_1.prepare(
      "SELECT status FROM file_version WHERE id = ?1",
    )
      .bind(versionId)
      .first<{ status: string }>();
    expect(version?.status).toBe("quarantined");
    const files = await listFiles(env.DB_FIRM_POOL_1, { matterId });
    expect(files.data.some((f) => f.name === "liar.txt")).toBe(false);
    const outbox = await env.DB_FIRM_POOL_1.prepare(
      "SELECT COUNT(*) AS n FROM outbox WHERE topic = 'file.quarantined' AND payload LIKE ?1",
    )
      .bind(`%${versionId}%`)
      .first<{ n: number }>();
    expect(outbox?.n).toBe(1);
  });

  it("acks an event for an unknown key without throwing", async () => {
    await expect(
      handleIngestMessage(env, event(BUCKET, "files/file_nope/fileVersion_nope", 10)),
    ).resolves.toBeUndefined();
  });

  it("acks an event for an unknown bucket without throwing", async () => {
    const { r2Key } = await seedPendingVersion("orphan.pdf", "application/pdf", PDF_BYTES);
    await expect(
      handleIngestMessage(env, event("some-other-firms-bucket", r2Key, PDF_BYTES.byteLength)),
    ).resolves.toBeUndefined();
  });

  it("throws (transient) when the R2 object is missing for a pending version", async () => {
    const initiated = await initiateUpload(
      env.DB_FIRM_POOL_1,
      {
        matterId,
        name: "missing.pdf",
        declaredSize: PDF_BYTES.byteLength,
        declaredContentType: "application/pdf",
        uploadedBy: ACTOR,
        mode: "put",
      },
      options,
    );
    await commitEffectBatch(env.DB_FIRM_POOL_1, initiated.effect, { now: clock.now });
    // No env.R2.put — the object is absent, a transient condition the consumer must retry.
    await expect(
      handleIngestMessage(env, event(BUCKET, initiated.r2Key, PDF_BYTES.byteLength)),
    ).rejects.toThrow();
  });

  it("commits with scanDetail 'oversize' when the object exceeds the firm inspectable-size cap", async () => {
    // Write a tiny inspectable-size cap (1 byte) as JSON into the firm setting row — the real bytes
    // are larger. This verifies the consumer calls readInspectableSizeCap from the database rather
    // than using a hardcoded constant.
    await env.DB_FIRM_POOL_1.prepare(
      "INSERT OR REPLACE INTO setting (key, value, updated_at) VALUES (?1, ?2, ?3)",
    )
      .bind(inspectableSizeCapDefinition.key, "1", clock.now())
      .run();

    const { versionId, r2Key } = await seedPendingVersion(
      "oversize.pdf",
      "application/pdf",
      PDF_BYTES,
    );

    await handleIngestMessage(env, event(BUCKET, r2Key, PDF_BYTES.byteLength));

    const version = await env.DB_FIRM_POOL_1.prepare(
      "SELECT status, scan_detail FROM file_version WHERE id = ?1",
    )
      .bind(versionId)
      .first<{ status: string; scan_detail: string | null }>();
    expect(version?.status).toBe("clean");
    expect(version?.scan_detail).toBe("oversize");

    // Restore the default cap so subsequent tests are unaffected.
    await env.DB_FIRM_POOL_1.prepare("DELETE FROM setting WHERE key = ?1")
      .bind(inspectableSizeCapDefinition.key)
      .run();
  });

  it("commits with scan_verdict 'clean' when the injected scan port returns a clean verdict", async () => {
    const fakeScanPort: MalwareScanPort = {
      scan: async (_body, _meta) => ({
        engineVersion: "test-1",
        clam: { state: "clean" },
        heuristic: { kind: "none" },
        matches: [],
        timings: { clamdMs: 1, yaraMs: 1 },
      }),
    };
    const { versionId, r2Key } = await seedPendingVersion(
      "scan-clean.pdf",
      "application/pdf",
      PDF_BYTES,
    );

    await handleIngestMessage(env, event(BUCKET, r2Key, PDF_BYTES.byteLength), fakeScanPort);

    const version = await env.DB_FIRM_POOL_1.prepare(
      "SELECT status, scan_verdict, content_sha256, scan_engine_version FROM file_version WHERE id = ?1",
    )
      .bind(versionId)
      .first<{
        status: string;
        scan_verdict: string;
        content_sha256: string;
        scan_engine_version: string;
      }>();
    expect(version?.status).toBe("clean");
    expect(version?.scan_verdict).toBe("clean");

    // The clean commit repopulates the content-dedup cache (the scan-once dedup is live again). The
    // cache row's engine_version is derived from the SAME raw result that produced the committed row's
    // scan_engine_version — they must match, so a later re-scan of identical content hits this row.
    expect(version?.scan_engine_version).toBe("test-1");
    const cached = await env.DB_FIRM_POOL_1.prepare(
      "SELECT engine_version, raw_result FROM scan_cache WHERE content_sha256 = ?1",
    )
      .bind(version!.content_sha256)
      .first<{ engine_version: string; raw_result: string }>();
    expect(cached?.engine_version).toBe(version?.scan_engine_version);
    expect(JSON.parse(cached!.raw_result)).toMatchObject({
      engineVersion: "test-1",
      clam: { state: "clean" },
    });
  });

  it("quarantines with reason 'scan-flagged' when the injected scan port returns an infected verdict", async () => {
    const fakeScanPort: MalwareScanPort = {
      scan: async (_body, _meta) => ({
        engineVersion: "test-1",
        clam: { state: "infected", signature: "Test.Sig" },
        heuristic: { kind: "none" },
        matches: [],
        timings: { clamdMs: 1, yaraMs: 1 },
      }),
    };
    const fileId = newIdentifier("file");
    const versionId = newIdentifier("fileVersion");
    const sessionId = newIdentifier("uploadSession");
    const r2Key = `files/${fileId}/${versionId}`;
    await env.DB_FIRM_POOL_1.prepare(
      "INSERT INTO file (id, matter_id, name, created_at, updated_at) VALUES (?1, ?2, 'infected.pdf', ?3, ?3)",
    )
      .bind(fileId, matterId, clock.now())
      .run();
    await env.DB_FIRM_POOL_1.prepare(
      "INSERT INTO file_version (id, file_id, version_number, r2_key, declared_content_type, status, uploaded_by, created_at) VALUES (?1, ?2, 1, ?3, 'application/pdf', 'pending', ?4, ?5)",
    )
      .bind(versionId, fileId, r2Key, ACTOR, clock.now())
      .run();
    await env.DB_FIRM_POOL_1.prepare(
      "INSERT INTO upload_session (id, file_version_id, mode, declared_size, declared_content_type, status, created_at) VALUES (?1, ?2, 'put', ?3, 'application/pdf', 'open', ?4)",
    )
      .bind(sessionId, versionId, PDF_BYTES.byteLength, clock.now())
      .run();
    await env.R2.put(r2Key, PDF_BYTES);

    await handleIngestMessage(env, event(BUCKET, r2Key, PDF_BYTES.byteLength), fakeScanPort);

    const version = await env.DB_FIRM_POOL_1.prepare(
      "SELECT status FROM file_version WHERE id = ?1",
    )
      .bind(versionId)
      .first<{ status: string }>();
    expect(version?.status).toBe("quarantined");

    const quarantine = await env.DB_FIRM_POOL_1.prepare(
      "SELECT payload FROM outbox WHERE topic = 'file.quarantined' AND payload LIKE ?1",
    )
      .bind(`%${versionId}%`)
      .first<{ payload: string }>();
    expect(quarantine?.payload).toContain("scan-flagged");

    // Clean up inserted rows so subsequent tests start clean.
    await env.DB_FIRM_POOL_1.prepare("DELETE FROM upload_session WHERE id = ?1")
      .bind(sessionId)
      .run();
    await env.DB_FIRM_POOL_1.prepare("DELETE FROM file_version WHERE id = ?1")
      .bind(versionId)
      .run();
    await env.DB_FIRM_POOL_1.prepare("DELETE FROM file WHERE id = ?1").bind(fileId).run();
  });
});

describe("resolveScanPort", () => {
  it("returns the unscanned adapter when no Container binding is present", () => {
    const port: MalwareScanPort = resolveScanPort(env);
    // The adapter is the engine-less launch adapter: drains the stream and returns `unscanned`.
    expect(port).toBeDefined();
    expect(typeof port.scan).toBe("function");
  });
});

describe("handleIngestMessage — verdict telemetry", () => {
  // Verdict observability: one scan-verdict telemetry event per terminal outcome (commit or quarantine),
  // structural redaction enforced (no file-identifying fields in the allowlist).

  it("emits exactly one ingest.verdict event on a clean commit", async () => {
    const logger = createMemoryLogger();
    const { r2Key } = await seedPendingVersion("telemetry-clean.pdf", "application/pdf", PDF_BYTES);

    await handleIngestMessage(env, event(BUCKET, r2Key, PDF_BYTES.byteLength), undefined, logger);

    const verdictEvents = logger.events.filter((e) => e.name === "ingest.verdict");
    expect(verdictEvents).toHaveLength(1);

    const fields = verdictEvents[0]!.fields;
    expect(fields.outcome).toBe("commit");
    expect(fields.scanVerdict).toBe("unscanned");
    // scanDetail and quarantineReason are present in the allowlist (null is a legal FieldValue)
    expect(Object.prototype.hasOwnProperty.call(fields, "scanDetail")).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(fields, "quarantineReason")).toBe(true);

    // Structural redaction: no file-identifying fields are present
    expect(fields).not.toHaveProperty("id");
    expect(fields).not.toHaveProperty("name");
    expect(fields).not.toHaveProperty("key");
    expect(fields).not.toHaveProperty("content");
    expect(fields).not.toHaveProperty("versionId");
    expect(fields).not.toHaveProperty("fileId");
    expect(fields).not.toHaveProperty("r2Key");
    expect(fields).not.toHaveProperty("fileName");
  });

  it("emits exactly one ingest.verdict event on a quarantine outcome", async () => {
    const fakeScanPort: MalwareScanPort = {
      scan: async (_body, _meta) => ({
        engineVersion: "test-1",
        clam: { state: "infected", signature: "Test.Eicar" },
        heuristic: { kind: "none" },
        matches: [],
        timings: { clamdMs: 1, yaraMs: 1 },
      }),
    };
    const fileId = newIdentifier("file");
    const versionId = newIdentifier("fileVersion");
    const sessionId = newIdentifier("uploadSession");
    const r2Key = `files/${fileId}/${versionId}`;
    await env.DB_FIRM_POOL_1.prepare(
      "INSERT INTO file (id, matter_id, name, created_at, updated_at) VALUES (?1, ?2, 'infected-telemetry.pdf', ?3, ?3)",
    )
      .bind(fileId, matterId, clock.now())
      .run();
    await env.DB_FIRM_POOL_1.prepare(
      "INSERT INTO file_version (id, file_id, version_number, r2_key, declared_content_type, status, uploaded_by, created_at) VALUES (?1, ?2, 1, ?3, 'application/pdf', 'pending', ?4, ?5)",
    )
      .bind(versionId, fileId, r2Key, ACTOR, clock.now())
      .run();
    await env.DB_FIRM_POOL_1.prepare(
      "INSERT INTO upload_session (id, file_version_id, mode, declared_size, declared_content_type, status, created_at) VALUES (?1, ?2, 'put', ?3, 'application/pdf', 'open', ?4)",
    )
      .bind(sessionId, versionId, PDF_BYTES.byteLength, clock.now())
      .run();
    await env.R2.put(r2Key, PDF_BYTES);

    const logger = createMemoryLogger();
    await handleIngestMessage(
      env,
      event(BUCKET, r2Key, PDF_BYTES.byteLength),
      fakeScanPort,
      logger,
    );

    const verdictEvents = logger.events.filter((e) => e.name === "ingest.verdict");
    expect(verdictEvents).toHaveLength(1);

    const fields = verdictEvents[0]!.fields;
    expect(fields.outcome).toBe("quarantine");
    expect(fields.quarantineReason).toBe("scan-flagged");

    // Structural redaction: no file-identifying fields are present
    expect(fields).not.toHaveProperty("id");
    expect(fields).not.toHaveProperty("name");
    expect(fields).not.toHaveProperty("key");
    expect(fields).not.toHaveProperty("content");
    expect(fields).not.toHaveProperty("versionId");
    expect(fields).not.toHaveProperty("fileId");
    expect(fields).not.toHaveProperty("r2Key");
    expect(fields).not.toHaveProperty("fileName");

    // Clean up
    await env.DB_FIRM_POOL_1.prepare("DELETE FROM upload_session WHERE id = ?1")
      .bind(sessionId)
      .run();
    await env.DB_FIRM_POOL_1.prepare("DELETE FROM file_version WHERE id = ?1")
      .bind(versionId)
      .run();
    await env.DB_FIRM_POOL_1.prepare("DELETE FROM file WHERE id = ?1").bind(fileId).run();
  });

  it("emits exactly one ingest.verdict event across two sequential deliveries of the same message (replay path emits nothing)", async () => {
    // The idempotency loser returns kind "replayed" rather than throwing, so without a guard the
    // verdict event would fire twice — once on the first delivery and once on the replay. This test
    // delivers the same message twice and asserts the event fires only once (on the executed delivery).
    const { r2Key } = await seedPendingVersion("dedup-telemetry.pdf", "application/pdf", PDF_BYTES);
    const evt = event(BUCKET, r2Key, PDF_BYTES.byteLength);

    const logger = createMemoryLogger();
    // First delivery: the effect is applied and the idempotency record is written.
    await handleIngestMessage(env, evt, undefined, logger);
    // Second delivery: the version is no longer pending so the consumer no-ops before reaching
    // runIdempotentEffect — the status-first guard catches it, no verdict event emitted.
    await handleIngestMessage(env, evt, undefined, logger);

    const verdictEvents = logger.events.filter((e) => e.name === "ingest.verdict");
    expect(verdictEvents).toHaveLength(1);
  });

  it("emits no ingest.verdict event for a no-op (unknown bucket)", async () => {
    const logger = createMemoryLogger();
    const { r2Key } = await seedPendingVersion("noop-telemetry.pdf", "application/pdf", PDF_BYTES);

    await handleIngestMessage(
      env,
      event("unknown-bucket", r2Key, PDF_BYTES.byteLength),
      undefined,
      logger,
    );

    const verdictEvents = logger.events.filter((e) => e.name === "ingest.verdict");
    expect(verdictEvents).toHaveLength(0);
  });
});

describe("handleIngestMessage — access-triggered re-scan", () => {
  async function seedCommittedVersion(name: string, bytes: Uint8Array) {
    const { versionId, r2Key } = await seedPendingVersion(name, "application/pdf", bytes);
    // Commit it as unscanned (the default engine-less adapter) — the stale starting state.
    await handleIngestMessage(env, event(BUCKET, r2Key, bytes.byteLength));
    const row = await env.DB_FIRM_POOL_1.prepare(
      "SELECT content_sha256 FROM file_version WHERE id = ?1",
    )
      .bind(versionId)
      .first<{ content_sha256: string }>();
    return { versionId, r2Key, contentSha256: row?.content_sha256 as string };
  }
  async function setCurrentEngine(version: string) {
    await env.DB_FIRM_POOL_1.prepare(
      "INSERT INTO setting (key, value, updated_at) VALUES ('fileManager.scanEngineVersion', ?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    )
      .bind(JSON.stringify(version), clock.now())
      .run();
  }
  async function clearCurrentEngine() {
    await env.DB_FIRM_POOL_1.prepare(
      "DELETE FROM setting WHERE key = 'fileManager.scanEngineVersion'",
    ).run();
  }
  const uniqueBytes = (tag: number) => new Uint8Array([...PDF_BYTES, tag]);

  it("re-scans a stale committed version FROM THE CACHE without calling the engine", async () => {
    const { versionId, r2Key, contentSha256 } = await seedCommittedVersion(
      "dup.pdf",
      uniqueBytes(1),
    );
    await setCurrentEngine("clamav/1.0");
    const cleanRaw = {
      engineVersion: "clamav/1.0",
      clam: { state: "clean" },
      heuristic: { kind: "none" },
      matches: [],
      timings: { clamdMs: 0, yaraMs: 0 },
    };
    await env.DB_FIRM_POOL_1.prepare(
      "INSERT INTO scan_cache (content_sha256, engine_version, raw_result, scanned_at) VALUES (?1, 'clamav/1.0', ?2, ?3)",
    )
      .bind(contentSha256, JSON.stringify(cleanRaw), clock.now())
      .run();

    let scanCalls = 0;
    const stub: MalwareScanPort = {
      async scan(body) {
        scanCalls++;
        await body.cancel();
        return {
          engineVersion: "clamav/1.0",
          clam: { state: "clean" },
          heuristic: { kind: "none" },
          matches: [],
          timings: { clamdMs: 0, yaraMs: 0 },
        };
      },
    };
    await handleIngestMessage(env, event(BUCKET, r2Key, uniqueBytes(1).byteLength), stub);

    expect(scanCalls).toBe(0); // cache hit → no engine call
    const v = await env.DB_FIRM_POOL_1.prepare(
      "SELECT scan_verdict, scan_engine_version, status FROM file_version WHERE id = ?1",
    )
      .bind(versionId)
      .first<{ scan_verdict: string; scan_engine_version: string; status: string }>();
    expect(v).toMatchObject({
      scan_verdict: "clean",
      scan_engine_version: "clamav/1.0",
      status: "clean",
    });
  });

  it("re-scans on a cache MISS; an infected finding stays VISIBLE (informed access) + is cached", async () => {
    const { versionId, r2Key, contentSha256 } = await seedCommittedVersion(
      "bad.pdf",
      uniqueBytes(2),
    );
    await setCurrentEngine("clamav/2.0");

    let scanCalls = 0;
    const stub: MalwareScanPort = {
      async scan(body) {
        scanCalls++;
        await body.cancel();
        return {
          engineVersion: "clamav/2.0",
          clam: { state: "infected", signature: "Eicar-Test" },
          heuristic: { kind: "none" },
          matches: [],
          timings: { clamdMs: 2, yaraMs: 1 },
        };
      },
    };
    await handleIngestMessage(env, event(BUCKET, r2Key, uniqueBytes(2).byteLength), stub);

    expect(scanCalls).toBe(1);
    const v = await env.DB_FIRM_POOL_1.prepare(
      "SELECT scan_verdict, status FROM file_version WHERE id = ?1",
    )
      .bind(versionId)
      .first<{ scan_verdict: string; status: string }>();
    // Informed access: flagged but still committed/visible.
    expect(v).toMatchObject({ scan_verdict: "infected", status: "clean" });
    // The fresh scan's raw facts are cached under the current engine — the dedup row the next re-scan
    // of identical content reuses. The cache stores the full RawScanResult, not a pre-decided verdict.
    const cached = await env.DB_FIRM_POOL_1.prepare(
      "SELECT raw_result FROM scan_cache WHERE content_sha256 = ?1 AND engine_version = 'clamav/2.0'",
    )
      .bind(contentSha256)
      .first<{ raw_result: string }>();
    expect(cached?.raw_result).toBeDefined();
    const cachedRaw = JSON.parse(cached!.raw_result);
    expect(cachedRaw).toMatchObject({
      engineVersion: "clamav/2.0",
      clam: { state: "infected", signature: "Eicar-Test" },
    });
  });

  it("does NOT re-scan when no current engine version is set (never fabricates a verdict)", async () => {
    const { versionId, r2Key } = await seedCommittedVersion("noeng.pdf", uniqueBytes(3));
    await clearCurrentEngine();

    let scanCalls = 0;
    const stub: MalwareScanPort = {
      async scan(body) {
        scanCalls++;
        await body.cancel();
        return {
          engineVersion: "x",
          clam: { state: "clean" },
          heuristic: { kind: "none" },
          matches: [],
          timings: { clamdMs: 0, yaraMs: 0 },
        };
      },
    };
    await handleIngestMessage(env, event(BUCKET, r2Key, uniqueBytes(3).byteLength), stub);

    expect(scanCalls).toBe(0);
    const v = await env.DB_FIRM_POOL_1.prepare(
      "SELECT scan_verdict FROM file_version WHERE id = ?1",
    )
      .bind(versionId)
      .first<{ scan_verdict: string }>();
    expect(v?.scan_verdict).toBe("unscanned"); // unchanged — never downgraded or fabricated
  });

  it("maybeEnqueueRescanOnAccess enqueues only for a STALE version, with a current engine, bound queue", async () => {
    const { versionId, r2Key } = await seedCommittedVersion("access.pdf", uniqueBytes(4));
    const captured: Array<{ bucket: string; object: { key: string } }> = [];
    const queue = {
      async send(message: { bucket: string; object: { key: string } }) {
        captured.push(message);
      },
    } as unknown as Queue;

    // No current engine recorded → no-op (never fabricate).
    await clearCurrentEngine();
    await maybeEnqueueRescanOnAccess(queue, env.DB_FIRM_POOL_1, BUCKET, r2Key, 100);
    expect(captured).toHaveLength(0);

    // Current engine set + the version is stale (its scan_engine_version is null) → enqueues.
    await setCurrentEngine("clamav/9.0");
    await maybeEnqueueRescanOnAccess(queue, env.DB_FIRM_POOL_1, BUCKET, r2Key, 100);
    expect(captured).toHaveLength(1);
    expect(captured[0]).toMatchObject({ bucket: BUCKET, object: { key: r2Key } });

    // An unbound queue is a no-op.
    await maybeEnqueueRescanOnAccess(undefined, env.DB_FIRM_POOL_1, BUCKET, r2Key, 100);
    expect(captured).toHaveLength(1);

    // Once the version is current (scanned under the engine), it is no longer stale → no-op.
    await env.DB_FIRM_POOL_1.prepare(
      "UPDATE file_version SET scan_engine_version = 'clamav/9.0' WHERE id = ?1",
    )
      .bind(versionId)
      .run();
    await maybeEnqueueRescanOnAccess(queue, env.DB_FIRM_POOL_1, BUCKET, r2Key, 100);
    expect(captured).toHaveLength(1);
  });
});
