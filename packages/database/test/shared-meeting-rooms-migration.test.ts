import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { applyMigrations, loadMigrationsFromDisk } from "../src/node-sqlite.ts";

/*
 * THE SHARED MEETING ROOMS MIGRATION, RUN OVER A DATABASE THAT ALREADY HOLDS ROOMS.
 *
 * It adds a room's kind, its own name and its retirement, and narrows the one-room-per-member index
 * to members' own rooms. Seed rooms at the schema before it, apply it, and check every existing room
 * became a member's own room, that a member still has only one, and that shared rooms are not capped.
 */
const TAG = "20261114T010019_shared-meeting-rooms";
const NOW = "2026-11-14T12:00:00.000Z";
const OWNER = "user_trevorgoldsmith00000000";

describe("the shared meeting rooms migration over existing rooms", () => {
  const migrations = loadMigrationsFromDisk("per-firm");
  const at = migrations.findIndex((migration) => migration.tag === TAG);

  it("keeps every existing room a member's own, one per member, and lets shared rooms be many", () => {
    expect(at).toBeGreaterThan(0);
    const raw = new DatabaseSync(":memory:");
    applyMigrations(raw, migrations.slice(0, at));
    raw
      .prepare(
        `INSERT INTO member (user_id, display_name, status, created_at) VALUES (?, 'Trevor Goldsmith', 'active', ?)`,
      )
      .run(OWNER, NOW);
    raw
      .prepare(
        `INSERT INTO meeting_personal_room (id, owner_user_id, link_code, address_name, medium, lobby, created_at, updated_at)
         VALUES ('meetingPersonalRoom_0', ?, 'roomcode00', 'trevor', 'video', 'on', ?, ?)`,
      )
      .run(OWNER, NOW, NOW);
    expect(() => applyMigrations(raw, migrations.slice(at))).not.toThrow();

    expect(
      raw.prepare(`SELECT kind, title, retired_at, address_name FROM meeting_personal_room`).get(),
    ).toEqual({ kind: "personal", title: null, retired_at: null, address_name: "trevor" });

    const insert = raw.prepare(
      `INSERT INTO meeting_personal_room (id, owner_user_id, link_code, address_name, kind, title, medium, lobby, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'video', 'on', ?, ?)`,
    );
    expect(() =>
      insert.run("meetingPersonalRoom_1", OWNER, "roomcode01", null, "personal", null, NOW, NOW),
    ).toThrow();
    insert.run("meetingPersonalRoom_2", OWNER, "roomcode02", "red-room", "shared", "Red Room", NOW, NOW);
    insert.run("meetingPersonalRoom_3", OWNER, "roomcode03", "blue-room", "shared", "Blue Room", NOW, NOW);
    expect(() =>
      insert.run("meetingPersonalRoom_4", OWNER, "roomcode04", null, "other", "X", NOW, NOW),
    ).toThrow();
    expect(() =>
      insert.run("meetingPersonalRoom_5", OWNER, "roomcode05", null, "shared", "", NOW, NOW),
    ).toThrow();
    expect(
      raw.prepare(`SELECT count(*) AS rooms FROM meeting_personal_room WHERE kind = 'shared'`).get(),
    ).toEqual({ rooms: 2 });
  });
});
