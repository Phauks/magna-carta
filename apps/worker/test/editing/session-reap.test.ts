import { env, runInDurableObject } from "cloudflare:test";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import { beforeAll, describe, expect, it } from "vitest";
import type { DocumentSession } from "../../src/editing/document-session.ts";
import { applyControlPlaneMigrations } from "../support/apply-control-plane-migrations.ts";
import { applyPerFirmMigrations } from "../support/apply-per-firm-migrations.ts";

// The per-document session coordinator reaps a dead co-editing session: when the idle window elapses
// with no activity the alarm fires, frees the document (file.edit_state -> idle in the firm database),
// and clears the live session state. The DO reaches the firm database by resolving its bucket through
// the control plane (the same seam the ingest consumer uses), so the binding survives the alarm being a
// fresh invocation.

const BUCKET = "magna-carta-test-reap-bucket";
const ISO = "2026-06-22T00:00:00.000Z";
const MEMBER = "user_reap";

function sessionStub(name: string): DurableObjectStub<DocumentSession> {
  return env.DOCUMENT_SESSION.get(
    env.DOCUMENT_SESSION.idFromName(name),
  ) as DurableObjectStub<DocumentSession>;
}

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  await applyPerFirmMigrations(env.DB_FIRM_POOL_1);
  await env.DB_CONTROL.prepare(
    "INSERT INTO firm (id, name, database_identifier, bucket_name, status, created_at) VALUES (?1, 'Reap Firm', 'DB_FIRM_POOL_1', ?2, 'active', ?3)",
  )
    .bind(newIdentifier("firm"), BUCKET, ISO)
    .run();
  await env.DB_FIRM_POOL_1.prepare(
    "INSERT INTO member (user_id, display_name, status, created_at) VALUES (?1, 'Reaper', 'active', ?2)",
  )
    .bind(MEMBER, ISO)
    .run();
});

async function seedCoeditingFile(): Promise<string> {
  const matterId = newIdentifier("matter");
  await env.DB_FIRM_POOL_1.prepare(
    "INSERT INTO matter (id, title, status, responsible_member_id, created_at, updated_at) VALUES (?1, 'M', 'open', ?2, ?3, ?3)",
  )
    .bind(matterId, MEMBER, ISO)
    .run();
  const fileId = newIdentifier("file");
  await env.DB_FIRM_POOL_1.prepare(
    "INSERT INTO file (id, matter_id, name, edit_state, created_at, updated_at) VALUES (?1, ?2, 'Brief.docx', 'coediting', ?3, ?3)",
  )
    .bind(fileId, matterId, ISO)
    .run();
  return fileId;
}

// A co-editing file that already has one committed clean version (the base the reap cut advances past).
async function seedCoeditingFileWithVersion(): Promise<{ fileId: string; versionId: string }> {
  const fileId = await seedCoeditingFile();
  const versionId = newIdentifier("fileVersion");
  await env.DB_FIRM_POOL_1.prepare(
    "INSERT INTO file_version (id, file_id, version_number, r2_key, size_bytes, content_sha256, status, uploaded_by, created_at, committed_at) VALUES (?1, ?2, 1, ?3, 10, 'v1-hash', 'clean', ?4, ?5, ?5)",
  )
    .bind(versionId, fileId, `files/${fileId}/${versionId}`, MEMBER, ISO)
    .run();
  await env.DB_FIRM_POOL_1.prepare("UPDATE file SET current_version_id = ?2 WHERE id = ?1")
    .bind(fileId, versionId)
    .run();
  return { fileId, versionId };
}

async function editStateOf(fileId: string): Promise<string | undefined> {
  const row = await env.DB_FIRM_POOL_1.prepare("SELECT edit_state FROM file WHERE id = ?1")
    .bind(fileId)
    .first<{ edit_state: string }>();
  return row?.edit_state;
}

describe("DocumentSession idle reap", () => {
  it("frees the document and clears the session when the idle alarm fires", async () => {
    const fileId = await seedCoeditingFile();
    const stub = sessionStub(fileId);

    await runInDurableObject(stub, async (instance: DocumentSession) => {
      await instance.joinEditor(MEMBER, { fileId, bucketName: BUCKET });
      expect((await instance.getState()).sessionId).toMatch(/.+/);

      // The idle window elapsed with no further activity — the alarm reaps the session.
      await instance.alarm();

      const state = await instance.getState();
      expect(state.participants).toEqual({});
      expect(state.sessionId).toBeNull();
      expect(state.wopiLock).toBeNull();
    });

    // The document is freed in the firm database, so a fresh edit launch is unobstructed.
    expect(await editStateOf(fileId)).toBe("idle");
  });

  it("cuts a version from the live `current` working copy before freeing on reap", async () => {
    const { fileId, versionId: v1 } = await seedCoeditingFileWithVersion();
    // The container would have written `current` via PutFile; seed it + its recorded session meta.
    await env.R2.put(`files/${fileId}/current`, "reaped working copy bytes");
    const stub = sessionStub(fileId);

    await runInDurableObject(stub, async (instance: DocumentSession) => {
      await instance.joinEditor(MEMBER, { fileId, bucketName: BUCKET });
      await instance.setCurrentMeta({ sha256: "reaped-hash", sizeBytes: 24, wopiTimestamp: ISO });
      // The idle window elapsed with unsaved working-copy changes still live — the reap preserves them.
      await instance.alarm();
      expect((await instance.getState()).participants).toEqual({});
    });

    // A new immutable version was cut from `current`, and the file's current pointer advanced to it.
    const versions = await env.DB_FIRM_POOL_1.prepare(
      "SELECT id, version_number, content_sha256, status FROM file_version WHERE file_id = ?1 ORDER BY version_number",
    )
      .bind(fileId)
      .all<{ id: string; version_number: number; content_sha256: string; status: string }>();
    expect(versions.results.length).toBe(2);
    const cut = versions.results[1];
    if (cut === undefined) throw new Error("expected a second (reap-cut) version");
    expect(cut.content_sha256).toBe("reaped-hash");
    expect(cut.status).toBe("clean");
    expect(cut.id).not.toBe(v1);
    const current = await env.DB_FIRM_POOL_1.prepare(
      "SELECT current_version_id FROM file WHERE id = ?1",
    )
      .bind(fileId)
      .first<{ current_version_id: string }>();
    expect(current?.current_version_id).toBe(cut.id);
    expect(await editStateOf(fileId)).toBe("idle");
    // The new version's bytes are the working copy, copied server-side from `current`.
    const stored = await env.R2.get(`files/${fileId}/${cut.id}`);
    expect(await stored?.text()).toBe("reaped working copy bytes");
  });

  it("reap with no working-copy changes since the last version cuts nothing (SHA-skip)", async () => {
    const { fileId } = await seedCoeditingFileWithVersion();
    await env.R2.put(`files/${fileId}/current`, "unchanged");
    const stub = sessionStub(fileId);

    await runInDurableObject(stub, async (instance: DocumentSession) => {
      await instance.joinEditor(MEMBER, { fileId, bucketName: BUCKET });
      // `current` matches the committed version's hash — nothing to cut.
      await instance.setCurrentMeta({ sha256: "v1-hash", sizeBytes: 10, wopiTimestamp: ISO });
      await instance.alarm();
    });

    const count = await env.DB_FIRM_POOL_1.prepare(
      "SELECT COUNT(*) AS n FROM file_version WHERE file_id = ?1",
    )
      .bind(fileId)
      .first<{ n: number }>();
    expect(count?.n).toBe(1); // still just the base version
    expect(await editStateOf(fileId)).toBe("idle");
  });

  it("does not reap a session that closed cleanly (the last editor left)", async () => {
    const fileId = await seedCoeditingFile();
    const stub = sessionStub(fileId);

    await runInDurableObject(stub, async (instance: DocumentSession) => {
      await instance.joinEditor(MEMBER, { fileId, bucketName: BUCKET });
      // The editor leaves cleanly — the session closes and cancels its reap alarm.
      expect((await instance.dropParticipant(MEMBER)).sessionClosed).toBe(true);
      // A spurious alarm after a clean close is a no-op (no participants to reap).
      await instance.alarm();
      expect((await instance.getState()).participants).toEqual({});
    });
  });
});
