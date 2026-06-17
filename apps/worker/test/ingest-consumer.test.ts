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
      scan: async (_body, _meta) => ({ verdict: "clean", engineVersion: "test-1" }),
    };
    const { versionId, r2Key } = await seedPendingVersion(
      "scan-clean.pdf",
      "application/pdf",
      PDF_BYTES,
    );

    await handleIngestMessage(env, event(BUCKET, r2Key, PDF_BYTES.byteLength), fakeScanPort);

    const version = await env.DB_FIRM_POOL_1.prepare(
      "SELECT status, scan_verdict FROM file_version WHERE id = ?1",
    )
      .bind(versionId)
      .first<{ status: string; scan_verdict: string }>();
    expect(version?.status).toBe("clean");
    expect(version?.scan_verdict).toBe("clean");
  });

  it("quarantines with reason 'scan-infected' when the injected scan port returns an infected verdict", async () => {
    const fakeScanPort: MalwareScanPort = {
      scan: async (_body, _meta) => ({
        verdict: "infected",
        engineVersion: "test-1",
        signature: "Test.Sig",
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
    expect(quarantine?.payload).toContain("scan-infected");

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
        verdict: "infected",
        engineVersion: "test-1",
        signature: "Test.Eicar",
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
    expect(fields.quarantineReason).toBe("scan-infected");

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
