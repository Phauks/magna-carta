// @repo-wide-fitness — scans the Durable Object in apps/api-worker and the client in apps/web, so a
// slice that adds a frame to this package and wires only one end breaks it from a third directory.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MEETING_CLIENT_FRAME_TYPES, MEETING_ROOM_FRAME_TYPES } from "../src/frames.ts";

/*
 * EVERY FRAME HAS A HANDLER AT THE FAR END AND A SENDER AT THE NEAR ONE.
 *
 * The drift this closes is structural, not careless. A browser bundle cannot import from a Worker,
 * so for three slices the frames were declared twice — with zod in the room, by hand in the client —
 * and each slice added frames to both ends by prose agreement. This package ended that by being the
 * one declaration; what it cannot do on its own is make both ends USE what is declared. A frame type
 * added here and wired into the room alone compiles, deploys, and is discovered when somebody's tile
 * stays black in a meeting.
 *
 * WHAT IT ASKS, AND WHY IT IS A TEXT SCAN. Four questions, one per direction of the wire: the room
 * has somewhere to put each frame a browser may send, and a browser sends each of them; the browser
 * has somewhere to put each frame the room may send, and this package builds each of them. A type
 * system cannot ask any of those — a `switch` over a union with a `default` type-checks with every
 * case missing, and the two ends are separate compilations besides. So the evidence is the frame's
 * own name, written as a literal in the file that owns the decision, which is what both ends
 * genuinely do.
 *
 * It is deliberately a weak check that cannot be satisfied by accident and is trivially satisfied by
 * doing the right thing. Its value is the failure message: it names the frame and the side, at the
 * moment the frame is added, instead of leaving it to a meeting.
 */

// packages/meeting-protocol/test -> repo root.
const REPO_ROOT = join(import.meta.dirname, "..", "..", "..");

/** The room's own modules: the dispatch, and the concerns it dispatches to. */
const ROOM_SOURCES = [
  join(REPO_ROOT, "apps", "api-worker", "src", "meetings", "meeting-room.ts"),
  ...sourceFilesIn(join(REPO_ROOT, "apps", "api-worker", "src", "meetings", "room")),
];

/** The browser's own modules: the socket, the state machine, and everything they call. */
const CLIENT_SOURCES = sourceFilesIn(
  join(REPO_ROOT, "apps", "web", "src", "lib", "meetings", "client"),
);

/** This package's builders, which are the only writers of a room frame. */
const PROTOCOL_SOURCE = join(REPO_ROOT, "packages", "meeting-protocol", "src", "frames.ts");

function sourceFilesIn(directory: string): string[] {
  return readdirSync(directory)
    .filter((name) => name.endsWith(".ts"))
    .toSorted()
    .map((name) => join(directory, name));
}

function readAll(files: readonly string[]): string {
  return files.map((file) => readFileSync(file, "utf8")).join("\n");
}

/**
 * Whether a side names this frame.
 *
 * The plain evidence is the name as a quoted literal — a `case "roster"`, a `frame.type === "sync"`,
 * a `{ type: "publish" }`. The keepalive pair is the one exception and has to be: it travels as a
 * byte-exact constant precisely so the runtime's auto-response can match it without waking the room,
 * so neither end ever writes the bare word. Naming the constant is the same commitment.
 */
function names(source: string, frameType: string): boolean {
  if (source.includes(`"${frameType}"`)) return true;
  if (frameType === "ping") return source.includes("PING_FRAME");
  if (frameType === "pong") return source.includes("PONG_FRAME");
  return false;
}

const roomSource = readAll(ROOM_SOURCES);
const clientSource = readAll(CLIENT_SOURCES);
const protocolSource = readFileSync(PROTOCOL_SOURCE, "utf8");

describe("every client frame the protocol declares", () => {
  it.each([...MEETING_CLIENT_FRAME_TYPES])("is handled by the room: %s", (frameType) => {
    expect(
      names(roomSource, frameType),
      `the room has no handler for the client frame "${frameType}". ` +
        "Add one in apps/api-worker/src/meetings/room/room-frames.ts, or in the module it dispatches to.",
    ).toBe(true);
  });

  it.each([...MEETING_CLIENT_FRAME_TYPES])("is sent by the browser: %s", (frameType) => {
    expect(
      names(clientSource, frameType),
      `nothing in apps/web/src/lib/meetings/client sends the client frame "${frameType}". ` +
        "A frame the room accepts and no browser sends is a contract with one party to it.",
    ).toBe(true);
  });
});

describe("every room frame the protocol declares", () => {
  it.each([...MEETING_ROOM_FRAME_TYPES])("is handled by the browser: %s", (frameType) => {
    expect(
      names(clientSource, frameType),
      `the browser has no handler for the room frame "${frameType}". ` +
        "Add one to RoomFrameHandlers in apps/web/src/lib/meetings/client/signaling.ts — " +
        "an unhandled frame is silently dropped, which reads as a tile that never arrives.",
    ).toBe(true);
  });

  it.each([...MEETING_ROOM_FRAME_TYPES])("is built by this package: %s", (frameType) => {
    expect(
      names(protocolSource, frameType),
      `no builder in src/frames.ts produces the room frame "${frameType}". ` +
        "A frame type the browser waits for and nothing builds is a handler that never runs.",
    ).toBe(true);
  });
});

describe("the scan itself", () => {
  it("is reading real files at both ends", () => {
    // A scan over an empty string passes every case above and proves nothing, which is the one way
    // this check could rot silently: a directory renamed, a file moved, a path that no longer
    // resolves. Both sides are asserted to have substance before anything is asked of them.
    expect(ROOM_SOURCES.length).toBeGreaterThan(1);
    expect(CLIENT_SOURCES.length).toBeGreaterThan(1);
    expect(roomSource.length).toBeGreaterThan(1000);
    expect(clientSource.length).toBeGreaterThan(1000);
  });
});
