import { env, SELF } from "cloudflare:test";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type {
  FileId,
  FileVersionId,
  FirmId,
  MatterId,
  UserId,
} from "@magna-carta/identifiers/types";
import { beforeAll, describe, expect, it } from "vitest";
import { documentSessionStub } from "../../src/editing/document-session.ts";
import { mintEditToken, type EditCapability } from "../../src/editing/wopi-token.ts";
import { applyControlPlaneMigrations } from "../support/apply-control-plane-migrations.ts";
import { firmDatabaseHandle } from "../support/firm-database-handle.ts";
import { seedFirm } from "../support/test-auth.ts";

// The mounted WOPI host surface (/wopi/files/*) end to end over Miniflare: a minted access_token drives
// CheckFileInfo, GetFile, PutFile and the Lock family exactly as Collabora would, with no session
// cookie. Tenancy/capability come only from the token; a bad token is 401 and a view token cannot write.

const ISO = "2026-06-20T00:00:00.000Z";
const VERSION_BYTES = new TextEncoder().encode("committed version bytes");
let firmId: FirmId;
let firmDb: ReturnType<typeof firmDatabaseHandle>;
let matterId: MatterId;
const MEMBER = "user_wopi" as UserId;

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  firmId = (await seedFirm({ name: "WOPI Host Firm", databaseIdentifier: "DB_FIRM_POOL_1" }))
    .firmId;
  firmDb = firmDatabaseHandle(firmId);
  await firmDb
    .prepare(
      "INSERT INTO member (user_id, display_name, status, created_at) VALUES (?1, 'WOPI', 'active', ?2)",
    )
    .bind(MEMBER, ISO)
    .run();
  matterId = newIdentifier("matter");
  await firmDb
    .prepare(
      "INSERT INTO matter (id, title, status, responsible_member_id, created_at, updated_at) VALUES (?1, 'M', 'open', ?2, ?3, ?3)",
    )
    .bind(matterId, MEMBER, ISO)
    .run();
});

async function seedFile(): Promise<{ fileId: FileId; versionId: FileVersionId }> {
  const fileId = newIdentifier("file");
  const versionId = newIdentifier("fileVersion");
  await firmDb
    .prepare(
      "INSERT INTO file (id, matter_id, name, current_version_id, created_at, updated_at) VALUES (?1, ?2, 'Brief.docx', NULL, ?3, ?3)",
    )
    .bind(fileId, matterId, ISO)
    .run();
  await firmDb
    .prepare(
      "INSERT INTO file_version (id, file_id, version_number, r2_key, size_bytes, content_sha256, status, uploaded_by, created_at, committed_at) VALUES (?1, ?2, 1, ?3, ?4, 'seed', 'clean', ?5, ?6, ?6)",
    )
    .bind(versionId, fileId, `files/${fileId}/${versionId}`, VERSION_BYTES.byteLength, MEMBER, ISO)
    .run();
  await firmDb
    .prepare("UPDATE file SET current_version_id = ?2 WHERE id = ?1")
    .bind(fileId, versionId)
    .run();
  await env.R2.put(`files/${fileId}/${versionId}`, VERSION_BYTES);
  return { fileId, versionId };
}

async function token(
  fileId: FileId,
  versionId: FileVersionId,
  capability: EditCapability,
  sessionId = "session-1",
): Promise<string> {
  return mintEditToken(
    {
      firmId,
      matterId,
      fileId,
      versionId,
      memberId: MEMBER,
      capability,
      sessionId,
      exp: Date.parse(ISO) + 60 * 60 * 1000 + Date.now(),
    },
    env,
  );
}

// Opens a live editing session on the DO (as the launch route would) and returns its session id, so a
// mutating edit token can be minted bound to it (the WOPI host requires an edit token's session to be
// live for PutFile/Lock). `withLock` also takes the WOPI lock that a PutFile must hold.
async function openSession(fileId: FileId, withLock = false): Promise<string> {
  const stub = documentSessionStub(env, fileId);
  const { sessionId } = await stub.joinEditor(MEMBER, { fileId, bucketName: "R2" });
  if (withLock) await stub.setWopiLock("editor-lock");
  return sessionId;
}

const wopi = (path: string, init?: RequestInit) =>
  SELF.fetch(`https://example.com/wopi/files/${path}`, init);

describe("WOPI host surface", () => {
  it("CheckFileInfo returns the file metadata and the member's display name for a valid edit token", async () => {
    const { fileId, versionId } = await seedFile();
    const response = await wopi(
      `${fileId}?access_token=${encodeURIComponent(await token(fileId, versionId, "edit"))}`,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    // The seeded member's display name, read from the firm's own member table on every callback.
    expect(body.UserFriendlyName).toBe("WOPI");
    expect(body.BaseFileName).toBe("Brief.docx");
    expect(body.Size).toBe(VERSION_BYTES.byteLength);
    expect(body.UserId).toBe(MEMBER);
    expect(body.OwnerId).toBe(`file:${fileId}`);
    expect(body.UserCanWrite).toBe(true);
  });

  it("GetFile streams the committed version bytes before any working copy exists", async () => {
    const { fileId, versionId } = await seedFile();
    const response = await wopi(
      `${fileId}/contents?access_token=${encodeURIComponent(await token(fileId, versionId, "edit"))}`,
    );
    expect(response.status).toBe(200);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(VERSION_BYTES);
  });

  it("PutFile writes the working copy, records session meta, and echoes the timestamp", async () => {
    const { fileId, versionId } = await seedFile();
    const sessionId = await openSession(fileId, true); // live session + held lock
    const edited = new TextEncoder().encode("edited working copy");
    const response = await wopi(
      `${fileId}/contents?access_token=${encodeURIComponent(await token(fileId, versionId, "edit", sessionId))}`,
      { method: "POST", body: edited },
    );
    expect(response.status).toBe(200);
    const timestamp = response.headers.get("X-COOL-WOPI-Timestamp");
    expect(timestamp).not.toBeNull();
    // The body is the answer the editor reads; the header is the same fact for a trace.
    expect(await response.json()).toEqual({ LastModifiedTime: timestamp });

    const current = await env.R2.get(`files/${fileId}/current`);
    expect(new Uint8Array(await current!.arrayBuffer())).toEqual(edited);
    const state = await documentSessionStub(env, fileId).getState();
    expect(state.current?.sizeBytes).toBe(edited.byteLength);
  });

  it("Lock takes the lock, and a successor container instance's differing lock takes it over", async () => {
    const { fileId, versionId } = await seedFile();
    const sessionId = await openSession(fileId); // live session so the edit token's session matches
    const accessToken = encodeURIComponent(await token(fileId, versionId, "edit", sessionId));
    const lock = (value: string) =>
      wopi(`${fileId}?access_token=${accessToken}`, {
        method: "POST",
        headers: { "X-WOPI-Override": "LOCK", "X-WOPI-Lock": value },
      });

    expect((await lock("LOCK-1")).status).toBe(200);
    // One container serves a document, so a different value can only be the next instance of it,
    // after the previous one stopped without unlocking: the stale lock is replaced, never reported
    // to the member as another editor holding the document.
    const successor = await lock("LOCK-2");
    expect(successor.status).toBe(200);
    expect(successor.headers.get("X-WOPI-Lock")).toBeNull();
    expect((await documentSessionStub(env, fileId).getState()).wopiLock).toBe("LOCK-2");
  });

  it("GetFile serves the working copy to the session that wrote it and the committed version to anyone else", async () => {
    const { fileId, versionId } = await seedFile();
    const sessionId = await openSession(fileId, true);
    const edited = new TextEncoder().encode("edited working copy");
    await wopi(
      `${fileId}/contents?access_token=${encodeURIComponent(await token(fileId, versionId, "edit", sessionId))}`,
      { method: "POST", body: edited },
    );

    const owner = await wopi(
      `${fileId}/contents?access_token=${encodeURIComponent(await token(fileId, versionId, "edit", sessionId))}`,
    );
    expect(new Uint8Array(await owner.arrayBuffer())).toEqual(edited);

    // A token minted for a different session — a viewer that never joined, or a stale token from a
    // session already reaped — reads the immutable version it names, not the live bytes.
    const outsider = await wopi(
      `${fileId}/contents?access_token=${encodeURIComponent(await token(fileId, versionId, "view", "session-elsewhere"))}`,
    );
    expect(new Uint8Array(await outsider.arrayBuffer())).toEqual(VERSION_BYTES);

    // CheckFileInfo agrees with the bytes each of them is served.
    const sizeSeenBy = async (accessToken: string): Promise<number> => {
      const body = (await (
        await wopi(`${fileId}?access_token=${encodeURIComponent(accessToken)}`)
      ).json()) as Record<string, unknown>;
      return body.Size as number;
    };
    expect(await sizeSeenBy(await token(fileId, versionId, "edit", sessionId))).toBe(
      edited.byteLength,
    );
    expect(await sizeSeenBy(await token(fileId, versionId, "view", "session-elsewhere"))).toBe(
      VERSION_BYTES.byteLength,
    );
  });

  it("rejects a missing or malformed token with 401", async () => {
    const { fileId } = await seedFile();
    expect((await wopi(fileId)).status).toBe(401);
    expect((await wopi(`${fileId}?access_token=not-a-real-token`)).status).toBe(401);
  });

  it("refuses PutFile under a view-only token (403)", async () => {
    const { fileId, versionId } = await seedFile();
    const response = await wopi(
      `${fileId}/contents?access_token=${encodeURIComponent(await token(fileId, versionId, "view"))}`,
      { method: "POST", body: new TextEncoder().encode("nope") },
    );
    expect(response.status).toBe(403);
  });

  it("cuts a version on every save with changed bytes, with its kind and everyone in the session on it", async () => {
    const { fileId, versionId } = await seedFile();
    const sessionId = await openSession(fileId, true);
    // A second member with a view open: recorded on every version cut while they are there.
    await documentSessionStub(env, fileId).recordParticipant("user_reader", "view");
    const accessToken = encodeURIComponent(await token(fileId, versionId, "edit", sessionId));
    const versions = async (): Promise<{ kind: string | null; participants: string[] }[]> => {
      const { results } = await firmDb
        .prepare(
          "SELECT v.id, v.save_kind AS kind, (SELECT group_concat(p.member_user_id, ',') FROM file_version_participant p WHERE p.version_id = v.id) AS participants FROM file_version v WHERE v.file_id = ?1 ORDER BY v.version_number",
        )
        .bind(fileId)
        .all<{ id: string; kind: string | null; participants: string | null }>();
      return results.map((row) => ({
        kind: row.kind,
        participants: row.participants === null ? [] : row.participants.split(",").toSorted(),
      }));
    };
    const save = (body: string, headers: Record<string, string>) =>
      wopi(`${fileId}/contents?access_token=${accessToken}`, {
        method: "POST",
        body: new TextEncoder().encode(body),
        headers,
      });

    expect(await versions()).toHaveLength(1);
    expect((await save("first draft", { "X-COOL-WOPI-IsAutosave": "false" })).status).toBe(200);
    expect((await save("second draft", { "X-COOL-WOPI-IsAutosave": "true" })).status).toBe(200);
    expect(
      (
        await save("third draft", {
          "X-COOL-WOPI-IsAutosave": "true",
          "X-COOL-WOPI-IsExitSave": "true",
        })
      ).status,
    ).toBe(200);
    // A save with unchanged bytes cuts nothing.
    expect((await save("third draft", { "X-COOL-WOPI-IsAutosave": "false" })).status).toBe(200);

    const cut = await versions();
    expect(cut.map((row) => row.kind)).toEqual([null, "explicit", "autosave", "exit"]);
    for (const row of cut.slice(1))
      expect(row.participants).toEqual([MEMBER, "user_reader"].sort());
    const file = await firmDb
      .prepare("SELECT current_version_id AS currentVersionId FROM file WHERE id = ?1")
      .bind(fileId)
      .first<{ currentVersionId: string }>();
    expect(file?.currentVersionId).not.toBe(versionId);
  });

  it("records each callback's answer on the member's open record, refusals included", async () => {
    const { fileId, versionId } = await seedFile();
    const stub = documentSessionStub(env, fileId);
    await stub.beginOpen(MEMBER, "2026-09-17T19:00:00.000Z");

    // CheckFileInfo answered: the first mark of the open.
    const info = await wopi(
      `${fileId}?access_token=${encodeURIComponent(await token(fileId, versionId, "edit"))}`,
    );
    expect(info.status).toBe(200);
    let open = await stub.openProgressOf(MEMBER);
    expect(open?.checkFileInfoAt).not.toBeNull();
    expect(open?.getFileAt).toBeNull();
    expect(open?.lastCallback).toMatchObject({ operation: "wopi:check-file-info", status: 200 });

    // GetFile answered: the second mark.
    const bytes = await wopi(
      `${fileId}/contents?access_token=${encodeURIComponent(await token(fileId, versionId, "edit"))}`,
    );
    expect(bytes.status).toBe(200);
    open = await stub.openProgressOf(MEMBER);
    expect(open?.getFileAt).not.toBeNull();

    // A refusal is recorded with the same Error ID the answer carried, and moves no mark.
    await firmDb.prepare("UPDATE file SET deleted_at = ?2 WHERE id = ?1").bind(fileId, ISO).run();
    const refused = await wopi(
      `${fileId}/contents?access_token=${encodeURIComponent(await token(fileId, versionId, "edit"))}`,
    );
    expect(refused.status).toBe(404);
    open = await stub.openProgressOf(MEMBER);
    expect(open?.lastCallback).toEqual({
      operation: "wopi:get-file",
      status: 404,
      errorId: refused.headers.get("X-MC-Error-Id"),
      at: expect.any(String),
    });
    expect(open?.lastCallback?.errorId).toMatch(/^error_/);
  });

  it("records nothing for a token the guard refused, so a forged token writes onto no one's record", async () => {
    const { fileId } = await seedFile();
    const stub = documentSessionStub(env, fileId);
    await stub.beginOpen(MEMBER, "2026-09-17T19:00:00.000Z");
    expect((await wopi(`${fileId}?access_token=not-a-real-token`)).status).toBe(401);
    expect((await stub.openProgressOf(MEMBER))?.lastCallback).toBeNull();
  });
});
