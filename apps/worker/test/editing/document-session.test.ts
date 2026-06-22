import { env, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { DocumentSession } from "../../src/editing/document-session.ts";

function sessionStub(name: string) {
  return env.DOCUMENT_SESSION.get(env.DOCUMENT_SESSION.idFromName(name));
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
    const meta = { sha256: "edited-hash", sizeBytes: 4096, wopiTimestamp: "2026-06-22T00:00:00.000Z" };

    await runInDurableObject(stub, async (instance: DocumentSession) => {
      await instance.setCurrentMeta(meta);
    });
    // A fresh access reads the persisted state — durable storage, not in-memory fields.
    await runInDurableObject(stub, async (instance: DocumentSession) => {
      expect((await instance.getState()).current).toEqual(meta);
    });
  });
});
