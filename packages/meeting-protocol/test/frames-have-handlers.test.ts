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
 *
 * ANYWHERE IN THE SOURCE, which is the weakness the dispatch scans below exist to close: this one
 * answers true for a name that appears in a type alias, a comment or an unrelated union, so it can
 * say a frame is handled when the handler was deleted. It is kept for the two directions that have
 * no single dispatch to read — a browser SENDS frames from several modules, and this package BUILDS
 * them in several functions.
 */
function names(source: string, frameType: string): boolean {
  if (source.includes(`"${frameType}"`)) return true;
  if (frameType === "ping") return source.includes("PING_FRAME");
  if (frameType === "pong") return source.includes("PONG_FRAME");
  return false;
}

/**
 * The frame types a `switch` in this source actually has a case for.
 *
 * Read from the case LABELS rather than from the file, so a deleted case is a missing member rather
 * than a word that still happens to appear somewhere above it.
 */
function caseLabelsIn(source: string): Set<string> {
  return new Set([...source.matchAll(/\bcase\s+"([a-z-]+)"\s*:/g)].map((match) => match[1] ?? ""));
}

/**
 * The frame types a source DISPATCHES ON — `frame.type === "publish"`, however the frame is named.
 *
 * `!==` is deliberately not matched: a negated comparison narrows a branch, it does not handle
 * anything, and counting it would let a file pass by mentioning a frame it refuses.
 */
function dispatchedTypesIn(source: string): Set<string> {
  return new Set([...source.matchAll(/\.type === "([a-z-]+)"/g)].map((match) => match[1] ?? ""));
}

/**
 * The keepalive frame this side RECEIVES, which may be dispatched on as a byte-exact constant.
 *
 * Named per side rather than as a pair: the room receives `ping` and answers `pong`, the browser is
 * the other way round, and adding both to either set would have each side credited with handling a
 * frame it only ever sends.
 */
function withKeepalive(found: Set<string>, source: string, received: "ping" | "pong"): Set<string> {
  const constant = received === "ping" ? "PING_FRAME" : "PONG_FRAME";
  const complete = new Set(found);
  if (source.includes(constant)) complete.add(received);
  return complete;
}

// The ONE module on each side that decides where a frame goes. The scans above read every module,
// because a frame can be built or sent from anywhere; a frame is DISPATCHED in exactly one place,
// and that is the place worth reading exactly.
const ROOM_DISPATCH = join(
  REPO_ROOT,
  "apps",
  "api-worker",
  "src",
  "meetings",
  "room",
  "room-frames.ts",
);
const CLIENT_DISPATCH = join(
  REPO_ROOT,
  "apps",
  "web",
  "src",
  "lib",
  "meetings",
  "client",
  "signaling.ts",
);

/**
 * FRAMES WHOSE BROWSER HALF IS BUILT IN A LATER CHANGE, and the only exception this scan admits.
 *
 * The room's half of live captions landed first: the room handles a host's `captions` frame and sends
 * `caption`, and the strip that draws them is the next change, made in apps/web alone. Until it lands
 * the two names are listed here and the browser-side checks skip exactly them — the room-side checks
 * and the builder checks still read them like any other.
 *
 * A REGISTER THAT ONLY SHRINKS. The last block below fails the moment the browser names one of these
 * (so the entry has to come off in the change that wires it), and fails for a name this package does
 * not declare (so a rename cannot leave a stale exemption behind). An entry is a promise with a
 * deadline, not a way to land one end of a frame.
 */
// The encrypted meeting's group frames are the second entry, on the same terms: the room's relay
// landed first, and the browser's group client and frame transform are the next change.
const AWAITING_THE_BROWSER: {
  readonly client: readonly string[];
  readonly room: readonly string[];
} = {
  client: ["captions", "mls-key-package", "mls-commit", "mls-proposal"],
  room: ["caption", "mls-key-package", "mls-commit", "mls-welcome", "mls-proposal"],
};

const roomSource = readAll(ROOM_SOURCES);
const clientSource = readAll(CLIENT_SOURCES);
const protocolSource = readFileSync(PROTOCOL_SOURCE, "utf8");
const roomDispatchSource = readFileSync(ROOM_DISPATCH, "utf8");
const clientDispatchSource = readFileSync(CLIENT_DISPATCH, "utf8");

describe("every client frame the protocol declares", () => {
  it.each([...MEETING_CLIENT_FRAME_TYPES])("is handled by the room: %s", (frameType) => {
    expect(
      names(roomSource, frameType),
      `the room has no handler for the client frame "${frameType}". ` +
        "Add one in apps/api-worker/src/meetings/room/room-frames.ts, or in the module it dispatches to.",
    ).toBe(true);
  });

  it.each(
    [...MEETING_CLIENT_FRAME_TYPES].filter((type) => !AWAITING_THE_BROWSER.client.includes(type)),
  )("is sent by the browser: %s", (frameType) => {
    expect(
      names(clientSource, frameType),
      `nothing in apps/web/src/lib/meetings/client sends the client frame "${frameType}". ` +
        "A frame the room accepts and no browser sends is a contract with one party to it.",
    ).toBe(true);
  });
});

describe("every room frame the protocol declares", () => {
  it.each(
    [...MEETING_ROOM_FRAME_TYPES].filter((type) => !AWAITING_THE_BROWSER.room.includes(type)),
  )("is handled by the browser: %s", (frameType) => {
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

// EQUALITY, NOT MEMBERSHIP, and against the dispatch rather than against the file.
//
// The per-frame scans above are a substring search over every module on a side, which is why they
// were passing for frames nothing handles: "sync" appears in a type alias that EXCLUDES it from the
// signaling frames, and "ended" is a meeting state the room reads off a row. Six of the room's
// handlers could be deleted with every one of those cases still green. What cannot be faked is the
// dispatch itself — one `switch`, one chain of comparisons — so these two read the labels out of it
// and compare the SET both ways: a frame with no case fails, and a case for a frame this package
// does not declare fails too, which is the half that catches a rename leaving the old branch behind.
describe("the dispatch each side actually runs", () => {
  it("routes every client frame the protocol declares, and nothing else", () => {
    expect(
      [
        ...withKeepalive(dispatchedTypesIn(roomDispatchSource), roomDispatchSource, "ping"),
      ].toSorted(),
      "the room's dispatch in room-frames.ts and MEETING_CLIENT_FRAME_TYPES disagree. A frame " +
        "with no branch there is accepted by the parser and then silently dropped.",
    ).toEqual([...MEETING_CLIENT_FRAME_TYPES].toSorted());
  });

  it("routes every room frame the protocol declares, and nothing else", () => {
    expect(
      [
        ...withKeepalive(caseLabelsIn(clientDispatchSource), clientDispatchSource, "pong"),
      ].toSorted(),
      "the browser's receive switch in signaling.ts and MEETING_ROOM_FRAME_TYPES disagree. An " +
        "unhandled frame is dropped, which reads as a tile that never arrives.",
    ).toEqual(
      [...MEETING_ROOM_FRAME_TYPES]
        .filter((type) => !AWAITING_THE_BROWSER.room.includes(type))
        .toSorted(),
    );
  });
});

describe("the frames awaiting the browser", () => {
  it.each([...AWAITING_THE_BROWSER.client])(
    "is a client frame this package declares: %s",
    (type) => {
      expect(MEETING_CLIENT_FRAME_TYPES as readonly string[]).toContain(type);
    },
  );

  it.each([...AWAITING_THE_BROWSER.room])("is a room frame this package declares: %s", (type) => {
    expect(MEETING_ROOM_FRAME_TYPES as readonly string[]).toContain(type);
  });

  it.each([...AWAITING_THE_BROWSER.client, ...AWAITING_THE_BROWSER.room])(
    "is still unwired in the browser, so its exemption still means something: %s",
    (type) => {
      expect(
        names(clientSource, type),
        `apps/web/src/lib/meetings/client now names "${type}". Take it off AWAITING_THE_BROWSER in ` +
          "this file in the same change, so the ordinary checks above read it.",
      ).toBe(false);
    },
  );
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
    // And the two dispatch reads found a dispatch rather than an empty file at a moved path.
    expect(dispatchedTypesIn(roomDispatchSource).size).toBeGreaterThan(4);
    expect(caseLabelsIn(clientDispatchSource).size).toBeGreaterThan(4);
  });
});
