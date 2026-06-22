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
