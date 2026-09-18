import { env, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { DocumentSession } from "../../src/editing/document-session.ts";

// The binding is deliberately unparameterized in Bindings (avoiding a circular import with the DO
// class), so the stub is narrowed to the concrete class here for the typed RPC surface the tests drive.
function sessionStub(name: string): DurableObjectStub<DocumentSession> {
  return env.DOCUMENT_SESSION.get(
    env.DOCUMENT_SESSION.idFromName(name),
  ) as DurableObjectStub<DocumentSession>;
}

describe("DocumentSession", () => {
  it("tracks participants and signals session-close only when the last editor leaves", async () => {
    const stub = sessionStub("file_session");
    await runInDurableObject(stub, async (instance: DocumentSession) => {
      await instance.recordParticipant("usr_a", "edit");
      await instance.recordParticipant("usr_b", "edit");
      expect(Object.keys((await instance.getState()).participants)).toEqual(["usr_a", "usr_b"]);

      // An editor leaving while another remains does not close the session.
      expect((await instance.dropParticipant("usr_a")).sessionClosed).toBe(false);
      // The last editor leaving closes the session — the session-close cut signal.
      expect((await instance.dropParticipant("usr_b")).sessionClosed).toBe(true);
      expect((await instance.getState()).participants).toEqual({});
    });
  });

  it("persists the current working-object metadata durably across access", async () => {
    const stub = sessionStub("file_meta");
    const meta = {
      sha256: "edited-hash",
      sizeBytes: 4096,
      wopiTimestamp: "2026-06-22T00:00:00.000Z",
    };

    await runInDurableObject(stub, async (instance: DocumentSession) => {
      await instance.setCurrentMeta(meta);
    });
    // A fresh access reads the persisted state — durable storage, not in-memory fields.
    await runInDurableObject(stub, async (instance: DocumentSession) => {
      expect((await instance.getState()).current).toEqual(meta);
    });
  });

  it("holds the single WOPI session lock durably and clears it", async () => {
    const stub = sessionStub("file_lock");

    await runInDurableObject(stub, async (instance: DocumentSession) => {
      expect((await instance.getState()).wopiLock).toBeNull();
      await instance.setWopiLock("lock-value-1");
    });
    // The lock survives eviction — a re-acquired session still holds it.
    await runInDurableObject(stub, async (instance: DocumentSession) => {
      expect((await instance.getState()).wopiLock).toBe("lock-value-1");
      await instance.clearWopiLock();
      expect((await instance.getState()).wopiLock).toBeNull();
    });
  });

  it("assigns one shared session id that co-editors join and that clears when the last leaves", async () => {
    const stub = sessionStub("file_join");

    await runInDurableObject(stub, async (instance: DocumentSession) => {
      expect((await instance.getState()).sessionId).toBeNull();
      // First editor opens the session — a fresh id is minted.
      const first = await instance.joinEditor("usr_a");
      expect(first.sessionId).toMatch(/.+/);
      // A second editor joins the SAME session — the id is reused, not re-minted.
      const second = await instance.joinEditor("usr_b");
      expect(second.sessionId).toBe(first.sessionId);
      expect(Object.keys((await instance.getState()).participants)).toEqual(["usr_a", "usr_b"]);
      expect((await instance.getState()).participants.usr_a).toBe("edit");

      // One editor leaving keeps the session (and its id) alive.
      expect((await instance.dropParticipant("usr_a")).sessionClosed).toBe(false);
      expect((await instance.getState()).sessionId).toBe(first.sessionId);
      // The last editor leaving closes the session and clears the id.
      expect((await instance.dropParticipant("usr_b")).sessionClosed).toBe(true);
      expect((await instance.getState()).sessionId).toBeNull();
    });
  });

  it("records a member's open from the launch on, marking the two calls that decide it", async () => {
    const stub = sessionStub("file_open");
    await runInDurableObject(stub, async (instance: DocumentSession) => {
      expect(await instance.openProgressOf("usr_a")).toBeNull();
      await instance.beginOpen("usr_a", "2026-09-17T19:00:00.000Z");
      expect(await instance.openProgressOf("usr_a")).toEqual({
        launchedAt: "2026-09-17T19:00:00.000Z",
        checkFileInfoAt: null,
        getFileAt: null,
        lastCallback: null,
      });

      // The editor asks what the document is, and is told: the first mark.
      await instance.recordCallback("usr_a", {
        operation: "wopi:check-file-info",
        status: 200,
        errorId: null,
        at: "2026-09-17T19:00:05.000Z",
      });
      // Then asks for its bytes and is refused: no second mark, and the refusal is the last callback.
      await instance.recordCallback("usr_a", {
        operation: "wopi:get-file",
        status: 404,
        errorId: "error_01",
        at: "2026-09-17T19:00:06.000Z",
      });
      const open = await instance.openProgressOf("usr_a");
      expect(open?.checkFileInfoAt).toBe("2026-09-17T19:00:05.000Z");
      expect(open?.getFileAt).toBeNull();
      expect(open?.lastCallback).toEqual({
        operation: "wopi:get-file",
        status: 404,
        errorId: "error_01",
        at: "2026-09-17T19:00:06.000Z",
      });
      // Another member's open is their own record.
      expect(await instance.openProgressOf("usr_b")).toBeNull();
    });
  });

  it("resets the record at the next launch, so a retry never reads the marks of the attempt before", async () => {
    const stub = sessionStub("file_reopen");
    await runInDurableObject(stub, async (instance: DocumentSession) => {
      await instance.beginOpen("usr_a", "2026-09-17T19:00:00.000Z");
      await instance.recordCallback("usr_a", {
        operation: "wopi:check-file-info",
        status: 200,
        errorId: null,
        at: "2026-09-17T19:00:05.000Z",
      });
      await instance.beginOpen("usr_a", "2026-09-17T19:10:00.000Z");
      expect(await instance.openProgressOf("usr_a")).toEqual({
        launchedAt: "2026-09-17T19:10:00.000Z",
        checkFileInfoAt: null,
        getFileAt: null,
        lastCallback: null,
      });
    });
  });

  it("keeps a callback that arrives with no launch on record, so the editor's answer is never lost", async () => {
    const stub = sessionStub("file_unlaunched");
    await runInDurableObject(stub, async (instance: DocumentSession) => {
      await instance.recordCallback("usr_a", {
        operation: "wopi:check-file-info",
        status: 200,
        errorId: null,
        at: "2026-09-17T19:00:05.000Z",
      });
      const open = await instance.openProgressOf("usr_a");
      expect(open?.checkFileInfoAt).toBe("2026-09-17T19:00:05.000Z");
      expect(open?.launchedAt).toBe("2026-09-17T19:00:05.000Z");
    });
  });

  it("reads a record persisted before the open record existed as one with no opens", async () => {
    const stub = sessionStub("file_legacy");
    await runInDurableObject(stub, async (instance: DocumentSession, state) => {
      // The shape a session stored before `opens` was a field.
      await state.storage.put("session-state", {
        participants: { usr_a: "edit" },
        current: null,
        wopiLock: null,
        sessionId: "session-legacy",
        fileId: null,
        bucketName: null,
      });
      expect((await instance.getState()).opens).toEqual({});
      expect((await instance.getState()).sessionId).toBe("session-legacy");
      expect(await instance.openProgressOf("usr_a")).toBeNull();
    });
  });
});
