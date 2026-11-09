// @node-runtime — reaches no Workers runtime API; see vitest.node-runtime.ts.
import { describe, expect, it } from "vitest";
import {
  JOB_PROGRESS_PROTOCOL_VERSION,
  MAX_CLIENT_FRAME_BYTES,
  parseClientFrame,
  PING_FRAME,
  PONG_FRAME,
  refusedFrame,
  stateFrame,
} from "../src/progress/job-progress-protocol.ts";

// The push-progress wire contract on its own, with no Durable Object in the way. These assertions are
// the ones a client is entitled to rely on: the exact keepalive bytes (they are matched byte-for-byte
// by the runtime's auto-response, so a change here silently costs every idle subscriber a wakeup), the
// version stamp on a state frame, and the closed set of refusals.

describe("job-progress client frames", () => {
  it("accepts the two frames a client may send", () => {
    expect(parseClientFrame('{"type":"ping"}')).toEqual({ frame: { type: "ping" } });
    expect(parseClientFrame('{"type":"resync"}')).toEqual({ frame: { type: "resync" } });
  });

  it("accepts a ping whatever the whitespace, so only the AUTO-RESPONSE path is byte-exact", () => {
    // A client that pretty-prints its ping still gets a pong; it just pays a wakeup for it.
    expect(parseClientFrame('{ "type": "ping" }')).toEqual({ frame: { type: "ping" } });
  });

  it("refuses a binary frame", () => {
    expect(parseClientFrame(new ArrayBuffer(8))).toEqual({ refusal: "binary-unsupported" });
  });

  it("refuses a frame past the size cap before parsing it", () => {
    const oversized = `{"type":"resync","padding":"${"x".repeat(MAX_CLIENT_FRAME_BYTES)}"}`;
    expect(parseClientFrame(oversized)).toEqual({ refusal: "frame-too-large" });
  });

  it("refuses unparseable and non-object payloads", () => {
    expect(parseClientFrame("not json")).toEqual({ refusal: "malformed-frame" });
    expect(parseClientFrame("42")).toEqual({ refusal: "malformed-frame" });
    expect(parseClientFrame("null")).toEqual({ refusal: "malformed-frame" });
  });

  it("refuses a well-formed frame of an unknown type", () => {
    expect(parseClientFrame('{"type":"subscribe"}')).toEqual({ refusal: "unknown-frame" });
  });
});

describe("job-progress server frames", () => {
  it("stamps the protocol version on every state frame", () => {
    const frame = JSON.parse(stateFrame({ status: "building" })) as Record<string, unknown>;
    expect(frame).toEqual({
      type: "state",
      protocolVersion: JOB_PROGRESS_PROTOCOL_VERSION,
      state: { status: "building" },
    });
  });

  it("carries the refusal reason as a label, never prose", () => {
    expect(JSON.parse(refusedFrame("unknown-frame"))).toEqual({
      type: "refused",
      reason: "unknown-frame",
    });
  });

  it("pins the keepalive pair byte-for-byte", () => {
    // These two strings are registered with the runtime's WebSocket auto-response, which matches the
    // request exactly. Reformatting either one (a space after the colon, key order) would stop idle
    // heartbeats being answered without waking the object — a cost regression no other test would see.
    expect(PING_FRAME).toBe('{"type":"ping"}');
    expect(PONG_FRAME).toBe('{"type":"pong"}');
  });
});
