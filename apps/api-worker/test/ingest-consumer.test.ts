import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { commitEffectBatch } from "@magna-carta/data-access/effect-batch";
import { initiateCheckin, initiateUpload } from "@magna-carta/file-manager/file-service";
import { listFiles } from "@magna-carta/file-manager/queries";
import type { MalwareScanPort } from "@magna-carta/file-manager/scan-port";
import { flaggedTreatmentDefinition } from "@magna-carta/file-manager/scan-policy-settings";
import {
  IN_MEMORY_INSPECTION_CEILING_BYTES,
  inspectableSizeCapDefinition,
} from "@magna-carta/file-manager/upload-policy";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { FirmId, MatterId, UserId } from "@magna-carta/identifiers/types";
import { createMemoryLogger } from "@magna-carta/telemetry/logger";
import { maybeEnqueueRescanOnAccess } from "../src/files/access-rescan.ts";
import {
  firmDatabaseFor as resolveFirmDatabaseProxy,
  type ProxyBatchDatabase,
} from "../src/firm-database/firm-database-proxy.ts";
import { handleIngestMessage } from "../src/files/ingest-consumer.ts";
import { resolveScanPort } from "../src/files/scan-port-binding.ts";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";

// The files-ingest consumer over real Miniflare bindings: a synthetic R2 event (Miniflare cannot
// deliver real R2 notifications) for an object PUT into env.R2 drives the single-read pipeline to a
// clean commit or a quarantine, exactly as production's queue delivery would. Per-firm data lives in
// the firm's FirmDatabase Durable Object (addressed by firmId), the same store the consumer resolves.

const BUCKET = "magna-carta-test-ingest-bucket";
const PDF_BYTES = new TextEncoder().encode("%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n%%EOF\n");

let firmId: FirmId;
let matterId: MatterId;
const ACTOR = "user_ingest" as UserId;
const clock = { now: () => "2026-06-13T12:00:00.000Z" };
const options = { clock, actorUserId: ACTOR };

// The firm's per-firm database handle plus a `.first()` convenience over the proxy's `.all()` — the
// proxy mirrors the SqlDatabase the statement modules use (run/all), and these tests read single rows.
// The wrapper carries sql/bindings forward so a wrapped statement still flows correctly through
// commitEffectBatch's batch() (which reads s.sql/s.bindings off each statement).
type ProxyStatement = ReturnType<ProxyBatchDatabase["prepare"]>;
interface FirstStatement {
  readonly sql: string;
  readonly bindings: readonly unknown[];
  bind(...values: unknown[]): FirstStatement;
  run(): Promise<{ meta: { changes: number } }>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
}
function firmDatabaseFor(id: FirmId): { prepare(sql: string): FirstStatement; batch: ProxyBatch } {
  const proxy = resolveFirmDatabaseProxy(env.FIRM_DATABASE, id);
  const wrap = (statement: ProxyStatement): FirstStatement => ({
    sql: statement.sql,
    bindings: statement.bindings,
    bind: (...values: unknown[]) => wrap(statement.bind(...values)),
    run: () => statement.run(),
    all: <T>() => statement.all<T>(),
    first: async <T>() => ((await statement.all<T>()).results[0] ?? null) as T | null,
  });
  return {
    prepare: (sql: string) => wrap(proxy.prepare(sql)),
    batch: proxy.batch.bind(proxy),
  };
}
type ProxyBatch = ProxyBatchDatabase["batch"];
let firmDatabase: ReturnType<typeof firmDatabaseFor>;

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  firmId = newIdentifier("firm");
  firmDatabase = firmDatabaseFor(firmId);
  await env.DB_CONTROL.prepare(
    "INSERT INTO firm (id, name, bucket_name, status, created_at) VALUES (?1, ?2, ?3, 'active', ?4)",
  )
    .bind(firmId, "Ingest Test Firm", BUCKET, "2026-06-13T00:00:00.000Z")
    .run();
  await firmDatabase
    .prepare(
      "INSERT INTO member (user_id, display_name, status, created_at) VALUES (?1, 'Ingest Actor', 'active', ?2)",
    )
    .bind(ACTOR, "2026-06-13T00:00:00.000Z")
    .run();
  matterId = newIdentifier("matter");
  await firmDatabase
    .prepare(
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
    firmDatabase,
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
  await commitEffectBatch(firmDatabase, initiated.effect, { now: clock.now });
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

    const version = await firmDatabase
      .prepare("SELECT status, scan_verdict, content_sha256 FROM file_version WHERE id = ?1")
      .bind(versionId)
      .first<{ status: string; scan_verdict: string; content_sha256: string }>();
    expect(version?.status).toBe("clean");
    expect(version?.scan_verdict).toBe("unscanned");
    expect(version?.content_sha256).toMatch(/^[0-9a-f]{64}$/);

    const files = await listFiles(firmDatabase, { matterId });
    expect(files.data.some((f) => f.name === "clean.pdf")).toBe(true);

    const meter = await firmDatabase
      .prepare("SELECT bytes, object_count FROM storage_meter WHERE prefix = 'files'")
      .first<{ bytes: number; object_count: number }>();
    expect(meter?.bytes).toBe(PDF_BYTES.byteLength);
    expect(meter?.object_count).toBe(1);

    const outbox = await firmDatabase
      .prepare("SELECT COUNT(*) AS n FROM outbox WHERE topic = 'file.version_committed'")
      .first<{ n: number }>();
    expect(outbox?.n).toBe(1);
  });

  it("is replay-safe: a redelivered event does not double-commit or double-meter", async () => {
    const { versionId, r2Key } = await seedPendingVersion(
      "replay.pdf",
      "application/pdf",
      PDF_BYTES,
    );
    await handleIngestMessage(env, event(BUCKET, r2Key, PDF_BYTES.byteLength));
    const meterBefore = await firmDatabase
      .prepare("SELECT bytes FROM storage_meter WHERE prefix = 'files'")
      .first<{ bytes: number }>();

    // Redeliver — the version is no longer pending, so the consumer no-ops.
    await handleIngestMessage(env, event(BUCKET, r2Key, PDF_BYTES.byteLength));

    const meterAfter = await firmDatabase
      .prepare("SELECT bytes FROM storage_meter WHERE prefix = 'files'")
      .first<{ bytes: number }>();
    expect(meterAfter?.bytes).toBe(meterBefore?.bytes);
    const committedEvents = await firmDatabase
      .prepare(
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
    const meterBefore = await firmDatabase
      .prepare("SELECT COALESCE(bytes, 0) AS bytes FROM storage_meter WHERE prefix = 'files'")
      .first<{ bytes: number }>();

    // Two deliveries of the same R2 event run concurrently: both read the version while it is still
    // pending (before either commits), so only the idempotency record's UNIQUE(key) keeps the second
    // batch from double-applying the meter/audit/outbox effects.
    const evt = event(BUCKET, r2Key, PDF_BYTES.byteLength);
    await Promise.all([handleIngestMessage(env, evt), handleIngestMessage(env, evt)]);

    const version = await firmDatabase
      .prepare("SELECT status FROM file_version WHERE id = ?1")
      .bind(versionId)
      .first<{ status: string }>();
    expect(version?.status).toBe("clean");

    // The meter moved by exactly one object's bytes.
    const meterAfter = await firmDatabase
      .prepare("SELECT bytes, object_count FROM storage_meter WHERE prefix = 'files'")
      .first<{ bytes: number; object_count: number }>();
    expect((meterAfter?.bytes ?? 0) - (meterBefore?.bytes ?? 0)).toBe(PDF_BYTES.byteLength);

    // Exactly one commit audit row and exactly one committed outbox row for this version.
    const audit = await firmDatabase
      .prepare(
        "SELECT COUNT(*) AS n FROM audit_log WHERE event = 'file.version_committed' AND subject_id = ?1",
      )
      .bind(versionId)
      .first<{ n: number }>();
    expect(audit?.n).toBe(1);
    const outbox = await firmDatabase
      .prepare(
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
    await firmDatabase
      .prepare(
        "INSERT INTO file (id, matter_id, name, created_at, updated_at) VALUES (?1, ?2, 'payload.exe', ?3, ?3)",
      )
      .bind(fileId, matterId, clock.now())
      .run();
    await firmDatabase
      .prepare(
        "INSERT INTO file_version (id, file_id, version_number, r2_key, declared_content_type, status, uploaded_by, created_at) VALUES (?1, ?2, 1, ?3, 'application/pdf', 'pending', ?4, ?5)",
      )
      .bind(versionId, fileId, r2Key, ACTOR, clock.now())
      .run();
    await firmDatabase
      .prepare(
        "INSERT INTO upload_session (id, file_version_id, mode, declared_size, declared_content_type, status, created_at) VALUES (?1, ?2, 'put', ?3, 'application/pdf', 'open', ?4)",
      )
      .bind(sessionId, versionId, PDF_BYTES.byteLength, clock.now())
      .run();
    await env.R2.put(r2Key, PDF_BYTES);

    await handleIngestMessage(env, event(BUCKET, r2Key, PDF_BYTES.byteLength));

    const version = await firmDatabase
      .prepare("SELECT status FROM file_version WHERE id = ?1")
      .bind(versionId)
      .first<{ status: string }>();
    expect(version?.status).toBe("quarantined");
    const outbox = await firmDatabase
      .prepare("SELECT payload FROM outbox WHERE topic = 'file.quarantined' AND payload LIKE ?1")
      .bind(`%${versionId}%`)
      .first<{ payload: string }>();
    expect(outbox?.payload).toContain("policy-type");
  });

  it("quarantines a declared-type lie: invisible, with a quarantine outbox event", async () => {
    // PDF bytes declared as text/plain — the sniffed magic bytes contradict the declared type.
    const { versionId, r2Key } = await seedPendingVersion("liar.txt", "text/plain", PDF_BYTES);

    await handleIngestMessage(env, event(BUCKET, r2Key, PDF_BYTES.byteLength));

    const version = await firmDatabase
      .prepare("SELECT status FROM file_version WHERE id = ?1")
      .bind(versionId)
      .first<{ status: string }>();
    expect(version?.status).toBe("quarantined");
    const files = await listFiles(firmDatabase, { matterId });
    expect(files.data.some((f) => f.name === "liar.txt")).toBe(false);
    const outbox = await firmDatabase
      .prepare(
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
      firmDatabase,
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
    await commitEffectBatch(firmDatabase, initiated.effect, { now: clock.now });
    // No env.R2.put — the object is absent, a transient condition the consumer must retry.
    await expect(
      handleIngestMessage(env, event(BUCKET, initiated.r2Key, PDF_BYTES.byteLength)),
    ).rejects.toThrow();
  });

  it("commits with scanDetail 'oversize' when the object exceeds the firm inspectable-size cap", async () => {
    // Write a tiny inspectable-size cap (1 byte) as JSON into the firm setting row — the real bytes
    // are larger. This verifies the consumer calls readInspectableSizeCap from the database rather
    // than using a hardcoded constant.
    await firmDatabase
      .prepare("INSERT OR REPLACE INTO setting (key, value, updated_at) VALUES (?1, ?2, ?3)")
      .bind(inspectableSizeCapDefinition.key, "1", clock.now())
      .run();

    const { versionId, r2Key } = await seedPendingVersion(
      "oversize.pdf",
      "application/pdf",
      PDF_BYTES,
    );

    await handleIngestMessage(env, event(BUCKET, r2Key, PDF_BYTES.byteLength));

    const version = await firmDatabase
      .prepare("SELECT status, scan_detail FROM file_version WHERE id = ?1")
      .bind(versionId)
      .first<{ status: string; scan_detail: string | null }>();
    expect(version?.status).toBe("clean");
    expect(version?.scan_detail).toBe("oversize");

    // Restore the default cap so subsequent tests are unaffected.
    await firmDatabase
      .prepare("DELETE FROM setting WHERE key = ?1")
      .bind(inspectableSizeCapDefinition.key)
      .run();
  });

  // A Worker isolate has 128 MB, and an hour of meeting audio is about 345 MB. An object past the
  // in-memory inspection ceiling must stream through the digest and commit with an honest
  // unscanned/oversize verdict — even for a firm whose stored cap predates the ceiling and names a
  // figure far above it — rather than run the isolate out of memory on every delivery and never commit.
  it("commits an object above the in-memory ceiling as oversize through the streaming digest", async () => {
    await firmDatabase
      .prepare("INSERT OR REPLACE INTO setting (key, value, updated_at) VALUES (?1, ?2, ?3)")
      .bind(inspectableSizeCapDefinition.key, String(2 * 1024 * 1024 * 1024), clock.now())
      .run();

    const bytes = new Uint8Array(IN_MEMORY_INSPECTION_CEILING_BYTES + 1024 * 1024);
    bytes.set(new TextEncoder().encode("RIFF"), 0);
    const expectedSha256 = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
    const { versionId, r2Key } = await seedPendingVersion("recording.wav", "audio/wav", bytes);

    let scanCalled = false;
    const refusingScanPort: MalwareScanPort = {
      scan: () => {
        scanCalled = true;
        return Promise.reject(new Error("an oversize object must never reach the scan port"));
      },
    };
    await handleIngestMessage(env, event(BUCKET, r2Key, bytes.byteLength), refusingScanPort);

    const version = await firmDatabase
      .prepare(
        "SELECT status, scan_verdict, scan_detail, size_bytes, content_sha256 FROM file_version WHERE id = ?1",
      )
      .bind(versionId)
      .first<{
        status: string;
        scan_verdict: string;
        scan_detail: string | null;
        size_bytes: number;
        content_sha256: string;
      }>();
    expect(scanCalled).toBe(false);
    expect(version).toEqual({
      status: "clean",
      scan_verdict: "unscanned",
      scan_detail: "oversize",
      size_bytes: bytes.byteLength,
      content_sha256: expectedSha256,
    });

    await firmDatabase
      .prepare("DELETE FROM setting WHERE key = ?1")
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

    const version = await firmDatabase
      .prepare(
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
    const cached = await firmDatabase
      .prepare("SELECT engine_version, raw_result FROM scan_cache WHERE content_sha256 = ?1")
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
    await firmDatabase
      .prepare(
        "INSERT INTO file (id, matter_id, name, created_at, updated_at) VALUES (?1, ?2, 'infected.pdf', ?3, ?3)",
      )
      .bind(fileId, matterId, clock.now())
      .run();
    await firmDatabase
      .prepare(
        "INSERT INTO file_version (id, file_id, version_number, r2_key, declared_content_type, status, uploaded_by, created_at) VALUES (?1, ?2, 1, ?3, 'application/pdf', 'pending', ?4, ?5)",
      )
      .bind(versionId, fileId, r2Key, ACTOR, clock.now())
      .run();
    await firmDatabase
      .prepare(
        "INSERT INTO upload_session (id, file_version_id, mode, declared_size, declared_content_type, status, created_at) VALUES (?1, ?2, 'put', ?3, 'application/pdf', 'open', ?4)",
      )
      .bind(sessionId, versionId, PDF_BYTES.byteLength, clock.now())
      .run();
    await env.R2.put(r2Key, PDF_BYTES);

    await handleIngestMessage(env, event(BUCKET, r2Key, PDF_BYTES.byteLength), fakeScanPort);

    const version = await firmDatabase
      .prepare("SELECT status FROM file_version WHERE id = ?1")
      .bind(versionId)
      .first<{ status: string }>();
    expect(version?.status).toBe("quarantined");

    const quarantine = await firmDatabase
      .prepare("SELECT payload FROM outbox WHERE topic = 'file.quarantined' AND payload LIKE ?1")
      .bind(`%${versionId}%`)
      .first<{ payload: string }>();
    expect(quarantine?.payload).toContain("scan-flagged");

    // Clean up inserted rows so subsequent tests start clean.
    await firmDatabase.prepare("DELETE FROM upload_session WHERE id = ?1").bind(sessionId).run();
    await firmDatabase.prepare("DELETE FROM file_version WHERE id = ?1").bind(versionId).run();
    await firmDatabase.prepare("DELETE FROM file WHERE id = ?1").bind(fileId).run();
  });
});

describe("handleIngestMessage — offline check-in routing", () => {
  // A pending version carrying a checkout_id is the return leg of an offline edit: the consumer routes
  // it through commitCheckinVersion (divergence-aware) instead of a plain commit. The bytes still pass
  // the full ingest gate first — the routing only changes how a cleared version lands.

  async function seedCleanVersion(
    fileId: string,
    versionNumber: number,
    hash: string,
  ): Promise<string> {
    const versionId = newIdentifier("fileVersion");
    await firmDatabase
      .prepare(
        "INSERT INTO file_version (id, file_id, version_number, r2_key, size_bytes, content_sha256, status, uploaded_by, created_at, committed_at) VALUES (?1, ?2, ?3, ?4, 10, ?5, 'clean', ?6, ?7, ?7)",
      )
      .bind(
        versionId,
        fileId,
        versionNumber,
        `files/${fileId}/${versionId}`,
        hash,
        ACTOR,
        clock.now(),
      )
      .run();
    return versionId;
  }

  async function seedCheckedOutFile(currentHash: string): Promise<{
    fileId: string;
    baseVersionId: string;
    checkoutId: string;
  }> {
    const fileId = newIdentifier("file");
    await firmDatabase
      .prepare(
        "INSERT INTO file (id, matter_id, name, created_at, updated_at) VALUES (?1, ?2, 'checkin.pdf', ?3, ?3)",
      )
      .bind(fileId, matterId, clock.now())
      .run();
    const baseVersionId = await seedCleanVersion(fileId, 1, currentHash);
    await firmDatabase
      .prepare("UPDATE file SET current_version_id = ?2 WHERE id = ?1")
      .bind(fileId, baseVersionId)
      .run();
    const checkoutId = newIdentifier("documentCheckout");
    await firmDatabase
      .prepare(
        "INSERT INTO document_checkout (id, file_id, holder_member_id, lock_type, base_version_id, acquired_at, last_activity_at, status, idle_release_at) VALUES (?1, ?2, ?3, 'offline_working_copy', ?4, ?5, ?5, 'active', NULL)",
      )
      .bind(checkoutId, fileId, ACTOR, baseVersionId, clock.now())
      .run();
    return { fileId, baseVersionId, checkoutId };
  }

  async function mintCheckin(fileId: string, checkoutId: string): Promise<string> {
    const initiated = await initiateCheckin(
      firmDatabase,
      {
        fileId: fileId as never,
        checkoutId: checkoutId as never,
        declaredSize: PDF_BYTES.byteLength,
        declaredContentType: "application/pdf",
        uploadedBy: ACTOR,
      },
      options,
    );
    await commitEffectBatch(firmDatabase, initiated.effect, { now: clock.now });
    await env.R2.put(initiated.r2Key, PDF_BYTES);
    return initiated.versionId;
  }

  it("fast-forwards a clean check-in: advances current and releases the checkout", async () => {
    const { fileId, checkoutId } = await seedCheckedOutFile("seed-hash");
    const versionId = await mintCheckin(fileId, checkoutId);

    await handleIngestMessage(
      env,
      event(BUCKET, `files/${fileId}/${versionId}`, PDF_BYTES.byteLength),
    );

    const version = await firmDatabase
      .prepare("SELECT status, reconciliation_status FROM file_version WHERE id = ?1")
      .bind(versionId)
      .first<{ status: string; reconciliation_status: string }>();
    expect(version).toEqual({ status: "clean", reconciliation_status: "clean" });

    const file = await firmDatabase
      .prepare("SELECT current_version_id FROM file WHERE id = ?1")
      .bind(fileId)
      .first<{ current_version_id: string }>();
    expect(file?.current_version_id).toBe(versionId);

    const checkout = await firmDatabase
      .prepare("SELECT status FROM document_checkout WHERE id = ?1")
      .bind(checkoutId)
      .first<{ status: string }>();
    expect(checkout?.status).toBe("released");
  });

  it("conflicts a check-in whose base advanced: flags the version, leaves current untouched, sets the checkout reconciling", async () => {
    const { fileId, baseVersionId, checkoutId } = await seedCheckedOutFile("seed-hash");
    // current advances to v2 while the offline copy is out.
    const v2 = await seedCleanVersion(fileId, 2, "hash-v2");
    await firmDatabase
      .prepare("UPDATE file SET current_version_id = ?2 WHERE id = ?1")
      .bind(fileId, v2)
      .run();
    const versionId = await mintCheckin(fileId, checkoutId);

    await handleIngestMessage(
      env,
      event(BUCKET, `files/${fileId}/${versionId}`, PDF_BYTES.byteLength),
    );

    const version = await firmDatabase
      .prepare(
        "SELECT status, reconciliation_status, diverged_from_version_id FROM file_version WHERE id = ?1",
      )
      .bind(versionId)
      .first<{
        status: string;
        reconciliation_status: string;
        diverged_from_version_id: string | null;
      }>();
    expect(version).toEqual({
      status: "clean",
      reconciliation_status: "conflict_pending",
      diverged_from_version_id: baseVersionId,
    });

    const file = await firmDatabase
      .prepare("SELECT current_version_id FROM file WHERE id = ?1")
      .bind(fileId)
      .first<{ current_version_id: string }>();
    expect(file?.current_version_id).toBe(v2);

    const checkout = await firmDatabase
      .prepare("SELECT status FROM document_checkout WHERE id = ?1")
      .bind(checkoutId)
      .first<{ status: string }>();
    expect(checkout?.status).toBe("reconciling");
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
    await firmDatabase
      .prepare(
        "INSERT INTO file (id, matter_id, name, created_at, updated_at) VALUES (?1, ?2, 'infected-telemetry.pdf', ?3, ?3)",
      )
      .bind(fileId, matterId, clock.now())
      .run();
    await firmDatabase
      .prepare(
        "INSERT INTO file_version (id, file_id, version_number, r2_key, declared_content_type, status, uploaded_by, created_at) VALUES (?1, ?2, 1, ?3, 'application/pdf', 'pending', ?4, ?5)",
      )
      .bind(versionId, fileId, r2Key, ACTOR, clock.now())
      .run();
    await firmDatabase
      .prepare(
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
    await firmDatabase.prepare("DELETE FROM upload_session WHERE id = ?1").bind(sessionId).run();
    await firmDatabase.prepare("DELETE FROM file_version WHERE id = ?1").bind(versionId).run();
    await firmDatabase.prepare("DELETE FROM file WHERE id = ?1").bind(fileId).run();
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
    const row = await firmDatabase
      .prepare("SELECT content_sha256 FROM file_version WHERE id = ?1")
      .bind(versionId)
      .first<{ content_sha256: string }>();
    return { versionId, r2Key, contentSha256: row?.content_sha256 as string };
  }
  async function setCurrentEngine(version: string) {
    await firmDatabase
      .prepare(
        "INSERT INTO setting (key, value, updated_at) VALUES ('fileManager.scanEngineVersion', ?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      )
      .bind(JSON.stringify(version), clock.now())
      .run();
  }
  async function clearCurrentEngine() {
    await firmDatabase
      .prepare("DELETE FROM setting WHERE key = 'fileManager.scanEngineVersion'")
      .run();
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
    await firmDatabase
      .prepare(
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
    const v = await firmDatabase
      .prepare("SELECT scan_verdict, scan_engine_version, status FROM file_version WHERE id = ?1")
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
    const v = await firmDatabase
      .prepare("SELECT scan_verdict, status FROM file_version WHERE id = ?1")
      .bind(versionId)
      .first<{ scan_verdict: string; status: string }>();
    // Informed access: flagged but still committed/visible.
    expect(v).toMatchObject({ scan_verdict: "flagged", status: "clean" });
    // The fresh scan's raw facts are cached under the current engine — the dedup row the next re-scan
    // of identical content reuses. The cache stores the full RawScanResult, not a pre-decided verdict.
    const cached = await firmDatabase
      .prepare(
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
    const v = await firmDatabase
      .prepare("SELECT scan_verdict FROM file_version WHERE id = ?1")
      .bind(versionId)
      .first<{ scan_verdict: string }>();
    expect(v?.scan_verdict).toBe("unscanned"); // unchanged — never downgraded or fabricated
  });

  it("a deployed-engine UNAVAILABLE on re-scan throws (retry) and leaves the prior committed verdict untouched", async () => {
    const { versionId, r2Key } = await seedCommittedVersion("fault.pdf", uniqueBytes(7));
    // Give the version a DEFINITIVE prior verdict under an OLD engine so the re-scan sees it as stale.
    await firmDatabase
      .prepare(
        "UPDATE file_version SET scan_verdict = 'flagged', scan_engine_version = 'clamav/old', scan_detail = 'Prior.Sig' WHERE id = ?1",
      )
      .bind(versionId)
      .run();
    await setCurrentEngine("clamav/3.0");

    // A deployed engine (engineVersion non-null) reporting `unavailable` is a transient FAULT, not a
    // verdict — computeVerdict throws ScanFaultError, which must propagate so the queue retries.
    const faultingPort: MalwareScanPort = {
      async scan(body) {
        await body.cancel();
        return {
          engineVersion: "clamav/3.0",
          clam: { state: "unavailable" },
          heuristic: { kind: "none" },
          matches: [],
          timings: { clamdMs: 0, yaraMs: 0 },
        };
      },
    };
    await expect(
      handleIngestMessage(env, event(BUCKET, r2Key, uniqueBytes(7).byteLength), faultingPort),
    ).rejects.toThrow();

    // The prior verdict is NEVER silently cleaned on a fault.
    const v = await firmDatabase
      .prepare("SELECT scan_verdict, scan_engine_version FROM file_version WHERE id = ?1")
      .bind(versionId)
      .first<{ scan_verdict: string; scan_engine_version: string }>();
    expect(v).toMatchObject({ scan_verdict: "flagged", scan_engine_version: "clamav/old" });
  });

  it("an UNSCANNED re-scan result (encrypted) leaves the prior verdict untouched — never restamped to clean", async () => {
    const { versionId, r2Key } = await seedCommittedVersion("encrypted.pdf", uniqueBytes(8));
    await firmDatabase
      .prepare(
        "UPDATE file_version SET scan_verdict = 'flagged', scan_engine_version = 'clamav/old', scan_detail = 'Prior.Sig' WHERE id = ?1",
      )
      .bind(versionId)
      .run();
    await setCurrentEngine("clamav/3.0");

    // An encrypted file yields an `unscanned` verdict — not definitive, so the version's prior verdict
    // must stay as-is (never downgraded to clean without a real scan).
    const encryptedPort: MalwareScanPort = {
      async scan(body) {
        await body.cancel();
        return {
          engineVersion: "clamav/3.0",
          clam: { state: "clean" },
          heuristic: { kind: "encrypted" },
          matches: [],
          timings: { clamdMs: 1, yaraMs: 0 },
        };
      },
    };
    await handleIngestMessage(env, event(BUCKET, r2Key, uniqueBytes(8).byteLength), encryptedPort);

    const v = await firmDatabase
      .prepare("SELECT scan_verdict, scan_engine_version FROM file_version WHERE id = ?1")
      .bind(versionId)
      .first<{ scan_verdict: string; scan_engine_version: string }>();
    expect(v?.scan_verdict).not.toBe("clean");
    expect(v).toMatchObject({ scan_verdict: "flagged", scan_engine_version: "clamav/old" });
  });

  it("a clean re-scan of a version holding PDF JavaScript KEEPS its active-content badge", async () => {
    // The re-scan sets scan_detail unconditionally. It once set it to the flagged signature, which is
    // null for a clean verdict — so the first engine-version bump erased the badge on any file the
    // re-scan reached. Three ways in, not one: access (access-rescan.ts enqueues on download or
    // preview), a member re-scanning a matter, and the nightly storage passes, which re-put objects at
    // the same key and so raise an ingest notification for versions nobody has opened. The badge is
    // the same fact the fresh-ingest path records; a re-scan re-derives it. No surface shows a member
    // an active-content badge today — every path that renders scan_detail is gated on flagged or
    // quarantined, which the badge cannot be — so what this protects is the stored fact, ahead of the
    // surface that will read it.
    const { versionId, r2Key } = await seedCommittedVersion("macro.pdf", uniqueBytes(9));
    await firmDatabase
      .prepare(
        "UPDATE file_version SET scan_verdict = 'clean', scan_engine_version = 'clamav/old', scan_detail = 'active-content' WHERE id = ?1",
      )
      .bind(versionId)
      .run();
    await setCurrentEngine("clamav/4.0");

    // Nothing hostile, but the bytes still carry document JavaScript — clean WITH active content.
    const activeContentPort: MalwareScanPort = {
      async scan(body) {
        await body.cancel();
        return {
          engineVersion: "clamav/4.0",
          clam: { state: "clean" },
          heuristic: { kind: "active-content" },
          matches: [],
          timings: { clamdMs: 1, yaraMs: 1 },
        };
      },
    };
    await handleIngestMessage(
      env,
      event(BUCKET, r2Key, uniqueBytes(9).byteLength),
      activeContentPort,
    );

    const v = await firmDatabase
      .prepare(
        "SELECT scan_verdict, scan_engine_version, scan_detail FROM file_version WHERE id = ?1",
      )
      .bind(versionId)
      .first<{ scan_verdict: string; scan_engine_version: string; scan_detail: string | null }>();
    expect(v).toMatchObject({
      scan_verdict: "clean",
      scan_engine_version: "clamav/4.0",
      scan_detail: "active-content",
    });
  });

  it("a clean re-scan of ordinary bytes clears a stale active-content badge", async () => {
    // The other direction, and the reason the badge is re-derived rather than preserved: a version whose
    // bytes were replaced, or whose earlier engine over-read them, must lose the badge when the current
    // engine finds nothing executable. Recording the verdict's own answer does both.
    const { versionId, r2Key } = await seedCommittedVersion("was-macro.pdf", uniqueBytes(10));
    await firmDatabase
      .prepare(
        "UPDATE file_version SET scan_verdict = 'clean', scan_engine_version = 'clamav/old', scan_detail = 'active-content' WHERE id = ?1",
      )
      .bind(versionId)
      .run();
    await setCurrentEngine("clamav/4.0");

    const quietPort: MalwareScanPort = {
      async scan(body) {
        await body.cancel();
        return {
          engineVersion: "clamav/4.0",
          clam: { state: "clean" },
          heuristic: { kind: "none" },
          matches: [],
          timings: { clamdMs: 1, yaraMs: 1 },
        };
      },
    };
    await handleIngestMessage(env, event(BUCKET, r2Key, uniqueBytes(10).byteLength), quietPort);

    const v = await firmDatabase
      .prepare("SELECT scan_verdict, scan_detail FROM file_version WHERE id = ?1")
      .bind(versionId)
      .first<{ scan_verdict: string; scan_detail: string | null }>();
    expect(v).toMatchObject({ scan_verdict: "clean", scan_detail: null });
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
    await maybeEnqueueRescanOnAccess(queue, firmDatabase, BUCKET, r2Key, 100);
    expect(captured).toHaveLength(0);

    // Current engine set + the version is stale (its scan_engine_version is null) → enqueues.
    await setCurrentEngine("clamav/9.0");
    await maybeEnqueueRescanOnAccess(queue, firmDatabase, BUCKET, r2Key, 100);
    expect(captured).toHaveLength(1);
    expect(captured[0]).toMatchObject({ bucket: BUCKET, object: { key: r2Key } });

    // An unbound queue is a no-op.
    await maybeEnqueueRescanOnAccess(undefined, firmDatabase, BUCKET, r2Key, 100);
    expect(captured).toHaveLength(1);

    // Once the version is current (scanned under the engine), it is no longer stale → no-op.
    await firmDatabase
      .prepare("UPDATE file_version SET scan_engine_version = 'clamav/9.0' WHERE id = ?1")
      .bind(versionId)
      .run();
    await maybeEnqueueRescanOnAccess(queue, firmDatabase, BUCKET, r2Key, 100);
    expect(captured).toHaveLength(1);
  });
});

describe("handleIngestMessage — post-commit byte swap (custody)", () => {
  // The presigned PUT that delivered an upload stays valid for the rest of its TTL, so the same URL
  // can overwrite the object after ingest already committed the version clean. The overwrite's own
  // object-create event lands here with the version no longer pending: it must re-measure the stored
  // bytes against the hash recorded at commit and withdraw the version when they differ. A clean
  // verdict over bytes nobody inspected is the failure this guards.

  const OTHER_PDF_BYTES = new TextEncoder().encode(
    "%PDF-1.4\n1 0 obj\n<< /Swapped true >>\nendobj\ntrailer\n%%EOF\n",
  );

  async function seedCommittedCleanVersion(name: string, bytes: Uint8Array) {
    const { versionId, r2Key } = await seedPendingVersion(name, "application/pdf", bytes);
    await handleIngestMessage(env, event(BUCKET, r2Key, bytes.byteLength));
    const row = await firmDatabase
      .prepare("SELECT status, content_sha256 FROM file_version WHERE id = ?1")
      .bind(versionId)
      .first<{ status: string; content_sha256: string }>();
    expect(row?.status).toBe("clean");
    return { versionId, r2Key, contentSha256: row!.content_sha256 };
  }

  it("quarantines the committed version when the object is overwritten after the clean commit", async () => {
    const { versionId, r2Key, contentSha256 } = await seedCommittedCleanVersion(
      "swapped.pdf",
      PDF_BYTES,
    );

    // The attack: re-use the still-valid presigned PUT to replace the bytes behind the committed key.
    await env.R2.put(r2Key, OTHER_PDF_BYTES);
    await handleIngestMessage(env, event(BUCKET, r2Key, OTHER_PDF_BYTES.byteLength));

    const version = await firmDatabase
      .prepare(
        "SELECT status, scan_verdict, scan_detail, content_sha256 FROM file_version WHERE id = ?1",
      )
      .bind(versionId)
      .first<{
        status: string;
        scan_verdict: string;
        scan_detail: string;
        content_sha256: string;
      }>();
    // Withdrawn behind the status gate — no read path serves a non-clean version.
    expect(version?.status).toBe("quarantined");
    expect(version?.scan_verdict).not.toBe("clean");
    expect(version?.scan_detail).toContain("content-drift");
    // The recorded hash is untouched: it is the evidence of what was measured, not a live mirror of
    // whatever now sits at the key.
    expect(version?.content_sha256).toBe(contentSha256);

    // The swapped-over version is no longer visible to a status-gated listing.
    const files = await listFiles(firmDatabase, { matterId });
    expect(files.data.some((f) => f.name === "swapped.pdf")).toBe(false);

    const quarantined = await firmDatabase
      .prepare(
        "SELECT COUNT(*) AS n FROM outbox WHERE topic = 'file.quarantined' AND payload LIKE ?1",
      )
      .bind(`%${versionId}%`)
      .first<{ n: number }>();
    expect(quarantined?.n).toBe(1);
  });

  it("scans the replacement bytes and records what they were", async () => {
    const { versionId, r2Key } = await seedCommittedCleanVersion("swapped-malware.pdf", PDF_BYTES);
    const infectedPort: MalwareScanPort = {
      scan: async (body) => {
        await body.cancel();
        return {
          engineVersion: "test-drift-1",
          clam: { state: "infected", signature: "Eicar-Swapped" },
          heuristic: { kind: "none" },
          matches: [],
          timings: { clamdMs: 1, yaraMs: 1 },
        };
      },
    };

    await env.R2.put(r2Key, OTHER_PDF_BYTES);
    await handleIngestMessage(env, event(BUCKET, r2Key, OTHER_PDF_BYTES.byteLength), infectedPort);

    const version = await firmDatabase
      .prepare("SELECT status, scan_detail FROM file_version WHERE id = ?1")
      .bind(versionId)
      .first<{ status: string; scan_detail: string }>();
    expect(version?.status).toBe("quarantined");
    expect(version?.scan_detail).toContain("content-drift");
    expect(version?.scan_detail).toContain("Eicar-Swapped");
  });

  it("withdraws even when the scan of the replacement bytes cannot run", async () => {
    // A scan that cannot run must never be a reason to leave swapped bytes servable.
    const { versionId, r2Key } = await seedCommittedCleanVersion("swapped-nolook.pdf", PDF_BYTES);
    const brokenPort: MalwareScanPort = {
      scan: async () => {
        throw new Error("scan service unreachable");
      },
    };

    await env.R2.put(r2Key, OTHER_PDF_BYTES);
    await handleIngestMessage(env, event(BUCKET, r2Key, OTHER_PDF_BYTES.byteLength), brokenPort);

    const version = await firmDatabase
      .prepare("SELECT status, scan_detail FROM file_version WHERE id = ?1")
      .bind(versionId)
      .first<{ status: string; scan_detail: string }>();
    expect(version?.status).toBe("quarantined");
    expect(version?.scan_detail).toContain("content-drift");
  });

  it("leaves the version clean when a redelivered event finds the very same bytes", async () => {
    // At-least-once delivery means the original create event can arrive again after the commit. The
    // bytes still hash to the recorded value, so nothing drifted and the verdict stands.
    const { versionId, r2Key } = await seedCommittedCleanVersion("redelivered.pdf", PDF_BYTES);

    await handleIngestMessage(env, event(BUCKET, r2Key, PDF_BYTES.byteLength));

    const version = await firmDatabase
      .prepare("SELECT status, scan_detail FROM file_version WHERE id = ?1")
      .bind(versionId)
      .first<{ status: string; scan_detail: string | null }>();
    expect(version?.status).toBe("clean");
    expect(version?.scan_detail ?? "").not.toContain("content-drift");
  });

  it("emits one quarantine verdict event and is idempotent across redeliveries of the overwrite", async () => {
    const { versionId, r2Key } = await seedCommittedCleanVersion("swapped-twice.pdf", PDF_BYTES);
    await env.R2.put(r2Key, OTHER_PDF_BYTES);

    const logger = createMemoryLogger();
    const evt = event(BUCKET, r2Key, OTHER_PDF_BYTES.byteLength);
    await handleIngestMessage(env, evt, undefined, logger);
    // The overwrite's event is redelivered: the version is already quarantined, so there is no second
    // withdrawal and no second audit/outbox pair.
    await handleIngestMessage(env, evt, undefined, logger);

    const verdictEvents = logger.events.filter((e) => e.name === "ingest.verdict");
    expect(verdictEvents).toHaveLength(1);
    expect(verdictEvents[0]!.fields.outcome).toBe("quarantine");
    expect(verdictEvents[0]!.fields.quarantineReason).toBe("content-drift");

    const audit = await firmDatabase
      .prepare(
        "SELECT COUNT(*) AS n FROM audit_log WHERE event = 'file.quarantined' AND subject_id = ?1",
      )
      .bind(versionId)
      .first<{ n: number }>();
    expect(audit?.n).toBe(1);
  });

  it("does not re-measure for a platform-enqueued re-scan message (no write happened)", async () => {
    // Only an action R2 reports for a real write is an overwrite signal; the platform's own re-scan
    // enqueues move no bytes, so they go straight to the staleness check.
    const { versionId, r2Key } = await seedCommittedCleanVersion("access-path.pdf", PDF_BYTES);
    await env.R2.put(r2Key, OTHER_PDF_BYTES);

    await handleIngestMessage(env, {
      bucket: BUCKET,
      object: { key: r2Key, size: OTHER_PDF_BYTES.byteLength },
      action: "AccessRescan",
    });

    const version = await firmDatabase
      .prepare("SELECT status FROM file_version WHERE id = ?1")
      .bind(versionId)
      .first<{ status: string }>();
    expect(version?.status).toBe("clean");
  });
});

describe("handleIngestMessage — firm flagged-treatment policy", () => {
  // Verifies that the consumer honours the firm's scan.flagged_treatment setting: an infected file
  // should be committed as flagged (status='clean', scan_verdict='flagged') when the firm opts in to
  // informed-access, and quarantined under the default block treatment.

  const infectedPort: MalwareScanPort = {
    scan: async (_body, _meta) => ({
      engineVersion: "test-treatment-1",
      clam: { state: "infected", signature: "Eicar-Treatment-Test" },
      heuristic: { kind: "none" },
      matches: [],
      timings: { clamdMs: 1, yaraMs: 1 },
    }),
  };

  async function seedInfectedPendingVersion(name: string): Promise<{
    fileId: string;
    versionId: string;
    sessionId: string;
    r2Key: string;
  }> {
    const fileId = newIdentifier("file");
    const versionId = newIdentifier("fileVersion");
    const sessionId = newIdentifier("uploadSession");
    const r2Key = `files/${fileId}/${versionId}`;
    await firmDatabase
      .prepare(
        "INSERT INTO file (id, matter_id, name, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?4)",
      )
      .bind(fileId, matterId, name, clock.now())
      .run();
    await firmDatabase
      .prepare(
        "INSERT INTO file_version (id, file_id, version_number, r2_key, declared_content_type, status, uploaded_by, created_at) VALUES (?1, ?2, 1, ?3, 'application/pdf', 'pending', ?4, ?5)",
      )
      .bind(versionId, fileId, r2Key, ACTOR, clock.now())
      .run();
    await firmDatabase
      .prepare(
        "INSERT INTO upload_session (id, file_version_id, mode, declared_size, declared_content_type, status, created_at) VALUES (?1, ?2, 'put', ?3, 'application/pdf', 'open', ?4)",
      )
      .bind(sessionId, versionId, PDF_BYTES.byteLength, clock.now())
      .run();
    await env.R2.put(r2Key, PDF_BYTES);
    return { fileId, versionId, sessionId, r2Key };
  }

  async function cleanupInfectedVersion(
    fileId: string,
    versionId: string,
    sessionId: string,
  ): Promise<void> {
    await firmDatabase.prepare("DELETE FROM upload_session WHERE id = ?1").bind(sessionId).run();
    // Nullify the FK on `file` before removing `file_version`: a committed version sets
    // `current_version_id`, which would block the file_version delete otherwise.
    await firmDatabase
      .prepare("UPDATE file SET current_version_id = NULL WHERE id = ?1")
      .bind(fileId)
      .run();
    await firmDatabase.prepare("DELETE FROM file_version WHERE id = ?1").bind(versionId).run();
    await firmDatabase.prepare("DELETE FROM file WHERE id = ?1").bind(fileId).run();
  }

  it("commits as flagged (status='clean', scan_verdict='flagged') when treatment is 'informed-access'", async () => {
    await firmDatabase
      .prepare("INSERT OR REPLACE INTO setting (key, value, updated_at) VALUES (?1, ?2, ?3)")
      .bind(flaggedTreatmentDefinition.key, JSON.stringify("informed-access"), clock.now())
      .run();

    const { fileId, versionId, sessionId, r2Key } =
      await seedInfectedPendingVersion("informed.pdf");
    await handleIngestMessage(env, event(BUCKET, r2Key, PDF_BYTES.byteLength), infectedPort);

    const version = await firmDatabase
      .prepare("SELECT status, scan_verdict FROM file_version WHERE id = ?1")
      .bind(versionId)
      .first<{ status: string; scan_verdict: string }>();
    // Committed (not quarantined) — visible behind the access gate.
    expect(version?.status).toBe("clean");
    expect(version?.scan_verdict).toBe("flagged");

    await firmDatabase
      .prepare("DELETE FROM setting WHERE key = ?1")
      .bind(flaggedTreatmentDefinition.key)
      .run();
    await cleanupInfectedVersion(fileId, versionId, sessionId);
  });

  it("quarantines (status='quarantined') when no treatment setting is present (default 'block')", async () => {
    // Ensure no residual setting from a prior test.
    await firmDatabase
      .prepare("DELETE FROM setting WHERE key = ?1")
      .bind(flaggedTreatmentDefinition.key)
      .run();

    const { fileId, versionId, sessionId, r2Key } = await seedInfectedPendingVersion("blocked.pdf");
    await handleIngestMessage(env, event(BUCKET, r2Key, PDF_BYTES.byteLength), infectedPort);

    const version = await firmDatabase
      .prepare("SELECT status FROM file_version WHERE id = ?1")
      .bind(versionId)
      .first<{ status: string }>();
    expect(version?.status).toBe("quarantined");

    await cleanupInfectedVersion(fileId, versionId, sessionId);
  });
});
