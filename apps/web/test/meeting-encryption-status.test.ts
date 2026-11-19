import { describe, expect, it } from "vitest";
import {
  encryptionState,
  keyGroupMembers,
  pauseBitsWith,
  pauseSentence,
  securityCodeGroups,
} from "../src/lib/meetings/client/encryption-status.ts";

// WHAT AN ENCRYPTED MEETING'S SCREEN SAYS ABOUT ITS ENCRYPTION, from the verified group state alone:
// the banner's sentence, the security panel's code and members, and the state the header reads.

describe("the encryption state the screen reads", () => {
  it("draws nothing about encryption in a meeting opened in the clear", () => {
    expect(encryptionState({ encrypted: false, standing: "off", pause: 0 })).toEqual({
      kind: "off",
    });
    // A stray pause flag cannot make a meeting in the clear look encrypted, or paused.
    expect(encryptionState({ encrypted: false, standing: "member", pause: 0b001 })).toEqual({
      kind: "off",
    });
  });

  it("is connecting while the engine loads and while this browser waits to be let into the group", () => {
    expect(encryptionState({ encrypted: true, standing: "loading", pause: 0 }).kind).toBe(
      "connecting",
    );
    expect(encryptionState({ encrypted: true, standing: "joining", pause: 0 }).kind).toBe(
      "connecting",
    );
  });

  it("is on in the group with no pause, and paused with every reason that holds", () => {
    expect(encryptionState({ encrypted: true, standing: "member", pause: 0 })).toEqual({
      kind: "on",
    });
    expect(encryptionState({ encrypted: true, standing: "member", pause: 0b101 })).toEqual({
      kind: "paused",
      reasons: ["recording", "phone"],
    });
  });

  it("says the group failed rather than claiming encryption it cannot give", () => {
    expect(encryptionState({ encrypted: true, standing: "failed", pause: 0 })).toEqual({
      kind: "failed",
    });
  });
});

describe("the pause banner's sentence", () => {
  it("names one reason in the words everybody in the room reads", () => {
    expect(pauseSentence(["recording"])).toBe(
      "Not end-to-end encrypted while this meeting is being recorded.",
    );
    expect(pauseSentence(["captions"])).toBe(
      "Not end-to-end encrypted while live captions are on.",
    );
    expect(pauseSentence(["phone"])).toBe(
      "Not end-to-end encrypted while a phone participant is connected.",
    );
  });

  it("joins every reason that holds into one sentence", () => {
    expect(pauseSentence(["recording", "captions"])).toBe(
      "Not end-to-end encrypted while this meeting is being recorded and live captions are on.",
    );
    expect(pauseSentence(["recording", "captions", "phone"])).toBe(
      "Not end-to-end encrypted while this meeting is being recorded, live captions are on and a phone participant is connected.",
    );
    expect(pauseSentence([])).toBe("");
  });
});

describe("a host's pause", () => {
  it("adds and removes one reason and keeps the others", () => {
    expect(pauseBitsWith(0, "recording", true)).toBe(0b001);
    expect(pauseBitsWith(0b001, "captions", true)).toBe(0b011);
    expect(pauseBitsWith(0b011, "recording", false)).toBe(0b010);
    expect(pauseBitsWith(0b010, "captions", false)).toBe(0);
    // Stopping what was not running changes nothing.
    expect(pauseBitsWith(0b010, "phone", false)).toBe(0b010);
  });
});

describe("the security panel", () => {
  it("reads the code as its groups of digits, and as nothing outside the group", () => {
    expect(securityCodeGroups("01234 56789 13579 24680 11111 99999")).toEqual([
      "01234",
      "56789",
      "13579",
      "24680",
      "11111",
      "99999",
    ]);
    expect(securityCodeGroups(null)).toEqual([]);
  });

  it("lists the group's members in leaf order, named from the roster, and keeps one the roster does not name", () => {
    const members = keyGroupMembers(
      [
        { leafIndex: 2, identity: "stay_bob" },
        { leafIndex: 0, identity: "stay_host" },
        { leafIndex: 1, identity: "stay_unnamed" },
      ],
      [
        { participantId: "stay_host", displayName: "Avery Host" },
        { participantId: "stay_bob", displayName: "Bob Client" },
        // On the roster but not in the group: not listed, because the group is what the code hashes.
        { participantId: "stay_waiting", displayName: "Wren Waiting" },
      ],
      "stay_host",
    );
    expect(members).toEqual([
      { participantId: "stay_host", displayName: "Avery Host", self: true },
      { participantId: "stay_unnamed", displayName: null, self: false },
      { participantId: "stay_bob", displayName: "Bob Client", self: false },
    ]);
  });
});
