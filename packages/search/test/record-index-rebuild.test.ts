import { describe, expect, it } from "vitest";
import type { UserId } from "@magna-carta/identifiers/types";
import {
  readRecordIndexRebuildStanding,
  RECORD_INDEX_REBUILD_REQUESTED_EVENT,
  RECORD_INDEX_REBUILT_EVENT,
  recordIndexRebuildIsOutstanding,
  recordIndexRebuildRequestedEffect,
  recordIndexRebuiltAuditStatement,
} from "../src/record-index-rebuild.ts";
import { recordIndexPlaceIsBehind } from "../src/record-index-statements.ts";
import { RECORD_INDEX_REBUILD_REQUESTED_TOPIC } from "../src/record-index-topics.ts";
import { MEMBER, migratedDatabase } from "./record-index-support.ts";

// The two facts a rebuild leaves in a firm's audit log, and what a screen reads from them.
//
// Pinned because the settings page tells a firm's administrator whether a rebuild they asked for
// has happened, and each of these is a way it could say the wrong thing:
//
//   - a request must carry the message that makes the rebuild run, in the same write as its audit
//     row, or a firm is told a rebuild is outstanding that nothing will ever do;
//   - the message must name no place, so a late or repeated delivery rebuilds what is behind then;
//   - a rebuild is outstanding from the moment it is asked for until one finishes at or after it,
//     and never because of a finish that came before the request.

const ASKED = "2026-11-10T14:20:00.000Z";

describe("whether a place is behind", () => {
  it("is behind when the two counts differ in either direction", () => {
    expect(recordIndexPlaceIsBehind({ indexed: 12, expected: 12 })).toBe(false);
    expect(recordIndexPlaceIsBehind({ indexed: 0, expected: 0 })).toBe(false);
    expect(recordIndexPlaceIsBehind({ indexed: 11, expected: 12 })).toBe(true);
    expect(recordIndexPlaceIsBehind({ indexed: 13, expected: 12 })).toBe(true);
  });
});

describe("asking for a rebuild", () => {
  it("writes one audit row and one message that names no place", () => {
    const { database } = migratedDatabase();
    const effect = recordIndexRebuildRequestedEffect(database, {
      actorUserId: MEMBER as UserId,
      now: ASKED,
    });
    expect(effect.statements).toHaveLength(1);
    expect(effect.outboxMessages).toEqual([
      { topic: RECORD_INDEX_REBUILD_REQUESTED_TOPIC, payload: {} },
    ]);
  });
});

describe("what the log says about a rebuild", () => {
  it("says nothing was asked for and nothing ran in a firm that never rebuilt", async () => {
    const { database } = migratedDatabase();
    const standing = await readRecordIndexRebuildStanding(database);
    expect(standing).toEqual({ requestedAt: null, finishedAt: null });
    expect(recordIndexRebuildIsOutstanding(standing)).toBe(false);
  });

  it("is outstanding from the request until a rebuild finishes after it", async () => {
    const { database, raw } = migratedDatabase();
    const [requested] = recordIndexRebuildRequestedEffect(database, {
      actorUserId: MEMBER as UserId,
      now: ASKED,
    }).statements;
    await (requested as { run(): Promise<unknown> }).run();

    const asked = await readRecordIndexRebuildStanding(database);
    expect(asked).toEqual({ requestedAt: ASKED, finishedAt: null });
    expect(recordIndexRebuildIsOutstanding(asked)).toBe(true);

    await recordIndexRebuiltAuditStatement(database, {
      places: ["notes"],
      now: "2026-11-10T14:22:00.000Z",
    }).run();
    const finished = await readRecordIndexRebuildStanding(database);
    expect(finished).toEqual({ requestedAt: ASKED, finishedAt: "2026-11-10T14:22:00.000Z" });
    expect(recordIndexRebuildIsOutstanding(finished)).toBe(false);

    // The row a rebuild leaves: no actor, and the places by key.
    const row = raw
      .prepare("SELECT actor_user_id, metadata FROM audit_log WHERE event = ?")
      .get(RECORD_INDEX_REBUILT_EVENT) as { actor_user_id: string | null; metadata: string };
    expect(row.actor_user_id).toBeNull();
    expect(JSON.parse(row.metadata)).toEqual({ places: ["notes"] });
    const request = raw
      .prepare("SELECT actor_user_id, metadata FROM audit_log WHERE event = ?")
      .get(RECORD_INDEX_REBUILD_REQUESTED_EVENT) as {
      actor_user_id: string | null;
      metadata: string | null;
    };
    expect(request.actor_user_id).toBe(MEMBER);
    expect(request.metadata).toBeNull();
  });

  it("reads the newest request and the newest finish, whatever else the log holds", async () => {
    const { database } = migratedDatabase();
    await recordIndexRebuiltAuditStatement(database, {
      places: [],
      now: "2026-11-09T08:00:00.000Z",
    }).run();
    await recordIndexRebuiltAuditStatement(database, {
      places: ["notes"],
      now: "2026-11-10T08:00:00.000Z",
    }).run();
    expect(await readRecordIndexRebuildStanding(database)).toEqual({
      requestedAt: null,
      finishedAt: "2026-11-10T08:00:00.000Z",
    });
  });

  it("is outstanding again when a request follows the last finish", () => {
    expect(
      recordIndexRebuildIsOutstanding({
        requestedAt: "2026-11-10T14:20:00.000Z",
        finishedAt: "2026-11-09T08:00:00.000Z",
      }),
    ).toBe(true);
    // A finish in the same instant as the request answers it.
    expect(recordIndexRebuildIsOutstanding({ requestedAt: ASKED, finishedAt: ASKED })).toBe(false);
  });
});
