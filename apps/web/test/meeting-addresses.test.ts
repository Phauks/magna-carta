/*
 * The two addresses the meetings surfaces compose, pinned.
 *
 * The socket's scheme is the one that cannot be checked by looking at it: a hard-coded `wss:` works
 * on the deployed site and fails against a local Worker, and a hard-coded `ws:` fails the other way
 * as a blocked mixed-content upgrade. Both directions are asserted, because only one of them ever
 * shows up in whichever environment somebody happens to be in.
 *
 * The way back to the event is the other: a matter meeting returns to the matter's own calendar and
 * a firm meeting to the firm's, and a matter identifier that never arrived must not produce a link
 * reading `/matters/null/calendar`.
 */
import { describe, expect, it } from "vitest";
import { meetingSocketUrl } from "$lib/api/socket-url.ts";
import { eventAddress } from "$lib/meetings/meetings-api.ts";

describe("meetingSocketUrl", () => {
  it("upgrades a secure document to wss", () => {
    expect(meetingSocketUrl("meeting_1", "https://app.example.test/meetings/meeting_1")).toBe(
      "wss://app.example.test/api/v1/meetings/meeting_1/socket",
    );
  });

  it("uses ws where the document itself is not secure", () => {
    expect(meetingSocketUrl("meeting_1", "http://localhost:8787/meetings/meeting_1")).toBe(
      "ws://localhost:8787/api/v1/meetings/meeting_1/socket",
    );
  });

  it("encodes the identifier rather than letting it shape the path", () => {
    expect(meetingSocketUrl("a/b", "https://app.example.test/")).toBe(
      "wss://app.example.test/api/v1/meetings/a%2Fb/socket",
    );
  });
});

describe("eventAddress", () => {
  it("returns a matter meeting to the matter's own calendar, with the entry open", () => {
    expect(eventAddress("matter", "matterEvent_7", "matter_3")).toBe(
      "/matters/matter_3/calendar?entry=matterEvent_7",
    );
  });

  it("returns a firm meeting to the firm calendar", () => {
    expect(eventAddress("firm", "firmEvent_7", null)).toBe("/calendar?entry=firmEvent_7");
  });

  it("falls back to the firm calendar for a matter event whose matter never arrived", () => {
    expect(eventAddress("matter", "matterEvent_7", null)).toBe("/calendar?entry=matterEvent_7");
  });
});
