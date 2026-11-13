import { describe, expect, it } from "vitest";
import {
  MAX_MEETING_FRAME_BYTES,
  MAX_MLS_COMMIT_STAYS,
  MAX_MLS_MESSAGE_BASE64_LENGTH,
  mlsCommitFrame,
  mlsKeyPackageFrame,
  mlsProposalFrame,
  mlsWelcomeFrame,
  parseMeetingClientFrame,
} from "../src/frames.ts";

// The encrypted meeting's group frames: what the parse lets through, and what the builders say.

const BYTES = "AAECAwQFBgc=";

function commit(fields: Record<string, unknown>): string {
  return JSON.stringify({
    v: 1,
    type: "mls-commit",
    epoch: 3,
    commit: BYTES,
    added: [],
    removed: [],
    ...fields,
  });
}

describe("the group frames a browser sends", () => {
  it("parses a key package, a commit with its welcome and a proposal", () => {
    expect(
      parseMeetingClientFrame(JSON.stringify({ v: 1, type: "mls-key-package", keyPackage: BYTES })),
    ).toEqual({ frame: { v: 1, type: "mls-key-package", keyPackage: BYTES } });
    const parsed = parseMeetingClientFrame(commit({ welcome: BYTES, added: ["stay_b"] }));
    expect("frame" in parsed && parsed.frame).toMatchObject({
      type: "mls-commit",
      epoch: 3,
      welcome: BYTES,
      added: ["stay_b"],
    });
    expect(
      parseMeetingClientFrame(
        JSON.stringify({ v: 1, type: "mls-proposal", epoch: 0, proposal: BYTES }),
      ),
    ).toEqual({ frame: { v: 1, type: "mls-proposal", epoch: 0, proposal: BYTES } });
  });

  it("refuses bytes that are not base64, and an epoch that is not a whole number", () => {
    expect(parseMeetingClientFrame(commit({ commit: "not base64!" }))).toEqual({
      refusal: "malformed-frame",
    });
    expect(parseMeetingClientFrame(commit({ epoch: 1.5 }))).toEqual({
      refusal: "malformed-frame",
    });
    expect(parseMeetingClientFrame(commit({ epoch: -1 }))).toEqual({
      refusal: "malformed-frame",
    });
  });

  it("refuses a commit naming more stays than the room can hold", () => {
    const stays = Array.from(
      { length: MAX_MLS_COMMIT_STAYS + 1 },
      (_, index) => `stay_${String(index)}`,
    );
    expect(parseMeetingClientFrame(commit({ removed: stays }))).toEqual({
      refusal: "malformed-frame",
    });
  });

  it("carries a welcome for the room's ceiling inside one frame", () => {
    // Measured: the three hundredth admission's welcome is 59,737 bytes, so about 79,650 as base64.
    const welcome = "A".repeat(79_652);
    const frame = commit({ welcome, added: ["stay_b"] });
    expect(new TextEncoder().encode(frame).byteLength).toBeLessThan(MAX_MEETING_FRAME_BYTES);
    expect("frame" in parseMeetingClientFrame(frame)).toBe(true);
    expect(MAX_MLS_MESSAGE_BASE64_LENGTH).toBeLessThan(MAX_MEETING_FRAME_BYTES);
  });
});

describe("the group frames the room sends", () => {
  it("names the sender, the epoch and the bytes", () => {
    expect(JSON.parse(mlsKeyPackageFrame("stay_a", BYTES))).toEqual({
      v: 1,
      type: "mls-key-package",
      from: "stay_a",
      keyPackage: BYTES,
    });
    expect(JSON.parse(mlsCommitFrame("stay_a", 2, BYTES, ["stay_b"], ["stay_c"]))).toEqual({
      v: 1,
      type: "mls-commit",
      from: "stay_a",
      epoch: 2,
      commit: BYTES,
      added: ["stay_b"],
      removed: ["stay_c"],
    });
    expect(JSON.parse(mlsProposalFrame("stay_a", 2, BYTES))).toEqual({
      v: 1,
      type: "mls-proposal",
      from: "stay_a",
      epoch: 2,
      proposal: BYTES,
    });
  });

  it("tells a founder to found the group with a welcome that carries none", () => {
    expect(JSON.parse(mlsWelcomeFrame(0, null))).toEqual({
      v: 1,
      type: "mls-welcome",
      epoch: 0,
      welcome: null,
    });
  });
});
