import { describe, expect, it } from "vitest";
import {
  EDITOR_READY_BUDGET_MILLISECONDS,
  editorSignalOf,
  HOST_READY_MESSAGE,
} from "../src/lib/documents/editor-frame-readiness.ts";

// The editor's messages arrive as JSON STRINGS, not objects — a reader that destructures the event
// data straight to an object sees nothing and the screen waits forever.
const loadingStatus = (status: string): string =>
  JSON.stringify({
    MessageId: "App_LoadingStatus",
    SendTime: 1_700_000_000,
    Values: { Status: status },
  });

describe("editorSignalOf", () => {
  it("reads the frame's own readiness, which is what the host answers", () => {
    expect(
      editorSignalOf(
        JSON.stringify({ MessageId: "App_LoadingStatus", Values: { Status: "Frame_Ready" } }),
      ),
    ).toBe("frame-ready");
  });

  it("reads the document being on screen, which is what ends the waiting state", () => {
    expect(
      editorSignalOf(
        JSON.stringify({ MessageId: "App_LoadingStatus", Values: { Status: "Document_Loaded" } }),
      ),
    ).toBe("document-loaded");
  });

  it("ignores the editor's other traffic rather than treating any message as readiness", () => {
    expect(
      editorSignalOf(
        JSON.stringify({ MessageId: "Doc_ModifiedStatus", Values: { Modified: true } }),
      ),
    ).toBeNull();
    expect(
      editorSignalOf(
        JSON.stringify({ MessageId: "App_LoadingStatus", Values: { Status: "Something_Else" } }),
      ),
    ).toBeNull();
  });

  it("reads a real message, extra fields and all — the editor sends more than the two keys", () => {
    expect(editorSignalOf(loadingStatus("Document_Loaded"))).toBe("document-loaded");
  });

  it("is case-sensitive about the status, because the protocol is", () => {
    expect(editorSignalOf(loadingStatus("document_loaded"))).toBeNull();
  });

  it("survives anything a page can receive, since a window hears more than its own frame", () => {
    for (const data of [
      undefined,
      null,
      42,
      "",
      "not json",
      "{",
      JSON.stringify(null),
      JSON.stringify([1, 2, 3]),
      JSON.stringify({ MessageId: "App_LoadingStatus" }),
      JSON.stringify({ MessageId: "App_LoadingStatus", Values: null }),
      // An object rather than the string the protocol sends.
      { MessageId: "App_LoadingStatus", Values: { Status: "Document_Loaded" } },
    ]) {
      expect(editorSignalOf(data)).toBeNull();
    }
  });
});

describe("the host's half of the handshake", () => {
  it("is the message the editor waits for before it loads the document", () => {
    expect(JSON.parse(HOST_READY_MESSAGE)).toEqual({ MessageId: "Host_PostmessageReady" });
  });

  it("allows for a cold container start, so a slow first open is not called a broken one", () => {
    // The container is a multi-gigabyte image started on first address. A budget shorter than that
    // start reports a working editor as a failure, which is the more expensive mistake of the two.
    expect(EDITOR_READY_BUDGET_MILLISECONDS).toBeGreaterThanOrEqual(60_000);
  });
});
