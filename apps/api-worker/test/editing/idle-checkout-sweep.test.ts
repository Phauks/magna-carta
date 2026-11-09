import { env } from "cloudflare:test";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import { beforeAll, expect, it } from "vitest";
import { runIdleCheckoutSweep } from "../../src/background/editing/idle-checkout-sweep.ts";
import { applyControlPlaneMigrations } from "../support/apply-control-plane-migrations.ts";
import { firmDatabaseHandle } from "../support/firm-database-handle.ts";

// The idle-checkout auto-release sweep: an active checkout idle past the firm window moves to 'stale'
// (with a grace), and a stale checkout past its grace is released — and an exclusive lock release frees
// the document (edit_state -> idle). Recent and within-grace checkouts are untouched.

const BUCKET = "magna-carta-test-idle-bucket";
const MEMBER = "user_idle";
const NOW_MS = Date.parse("2026-06-22T12:00:00.000Z");
const hoursAgo = (h: number) => new Date(NOW_MS - h * 60 * 60 * 1000).toISOString();
const hoursAhead = (h: number) => new Date(NOW_MS + h * 60 * 60 * 1000).toISOString();

let matterId: string;
let baseVersionId: string;
let firmDb: ReturnType<typeof firmDatabaseHandle>;

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  const firmId = newIdentifier("firm");
  firmDb = firmDatabaseHandle(firmId);
  await env.DB_CONTROL.prepare(
    "INSERT INTO firm (id, name, database_identifier, bucket_name, status, created_at) VALUES (?1, 'Idle Firm', 'DB_FIRM_POOL_1', ?2, 'active', ?3)",
  )
    .bind(firmId, BUCKET, hoursAgo(1000))
    .run();
  await firmDb
    .prepare(
      "INSERT INTO member (user_id, display_name, status, created_at) VALUES (?1, 'Idler', 'active', ?2)",
    )
    .bind(MEMBER, hoursAgo(1000))
    .run();
  matterId = newIdentifier("matter");
  await firmDb
    .prepare(
      "INSERT INTO matter (id, title, status, responsible_member_id, created_at, updated_at) VALUES (?1, 'M', 'open', ?2, ?3, ?3)",
    )
    .bind(matterId, MEMBER, hoursAgo(1000))
    .run();
});

async function seedFileWithVersion(editState: string): Promise<string> {
  const fileId = newIdentifier("file");
  await firmDb
    .prepare(
      "INSERT INTO file (id, matter_id, name, edit_state, created_at, updated_at) VALUES (?1, ?2, 'D.docx', ?3, ?4, ?4)",
    )
    .bind(fileId, matterId, editState, hoursAgo(1000))
    .run();
  baseVersionId = newIdentifier("fileVersion");
  await firmDb
    .prepare(
      "INSERT INTO file_version (id, file_id, version_number, r2_key, size_bytes, content_sha256, status, uploaded_by, created_at, committed_at) VALUES (?1, ?2, 1, ?3, 10, 'h', 'clean', ?4, ?5, ?5)",
    )
    .bind(baseVersionId, fileId, `files/${fileId}/${baseVersionId}`, MEMBER, hoursAgo(1000))
    .run();
  await firmDb
    .prepare("UPDATE file SET current_version_id = ?2 WHERE id = ?1")
    .bind(fileId, baseVersionId)
    .run();
  return fileId;
}

async function seedCheckout(
  fileId: string,
  lockType: string,
  status: string,
  lastActivityAt: string,
  idleReleaseAt: string | null,
): Promise<string> {
  const id = newIdentifier("documentCheckout");
  await firmDb
    .prepare(
      "INSERT INTO document_checkout (id, file_id, holder_member_id, lock_type, base_version_id, acquired_at, last_activity_at, status, idle_release_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6, ?7, ?8)",
    )
    .bind(id, fileId, MEMBER, lockType, baseVersionId, lastActivityAt, status, idleReleaseAt)
    .run();
  return id;
}

async function statusOf(checkoutId: string): Promise<string | undefined> {
  const row = await firmDb
    .prepare("SELECT status FROM document_checkout WHERE id = ?1")
    .bind(checkoutId)
    .first<{ status: string }>();
  return row?.status;
}

it("moves idle active checkouts to stale, releases stale ones past grace, frees an exclusive lock", async () => {
  const offlineFile = await seedFileWithVersion("idle");
  const exclusiveFile = await seedFileWithVersion("checked_out");

  // Active but idle 8 days (> the 7-day default) -> should go stale.
  const idleActive = await seedCheckout(
    offlineFile,
    "offline_working_copy",
    "active",
    hoursAgo(192),
    null,
  );
  // Active and recent -> stays active.
  const freshActive = await seedCheckout(
    offlineFile,
    "offline_working_copy",
    "active",
    hoursAgo(1),
    null,
  );
  // Stale, grace elapsed -> released (exclusive, so the document frees).
  const releasable = await seedCheckout(
    exclusiveFile,
    "exclusive",
    "stale",
    hoursAgo(200),
    hoursAgo(1),
  );
  // Stale, still in grace -> stays stale.
  const inGrace = await seedCheckout(
    offlineFile,
    "offline_working_copy",
    "stale",
    hoursAgo(200),
    hoursAhead(1),
  );

  const report = await runIdleCheckoutSweep(env, { now: NOW_MS });
  expect(report.marked).toBe(1);
  expect(report.released).toBe(1);

  expect(await statusOf(idleActive)).toBe("stale");
  expect(await statusOf(freshActive)).toBe("active");
  expect(await statusOf(releasable)).toBe("released");
  expect(await statusOf(inGrace)).toBe("stale");

  // The newly-stale checkout got a release schedule.
  const scheduled = await firmDb
    .prepare("SELECT idle_release_at FROM document_checkout WHERE id = ?1")
    .bind(idleActive)
    .first<{ idle_release_at: string | null }>();
  expect(scheduled?.idle_release_at).not.toBeNull();

  // Releasing the exclusive lock freed the document.
  const editState = await firmDb
    .prepare("SELECT edit_state FROM file WHERE id = ?1")
    .bind(exclusiveFile)
    .first<{ edit_state: string }>();
  expect(editState?.edit_state).toBe("idle");
});
