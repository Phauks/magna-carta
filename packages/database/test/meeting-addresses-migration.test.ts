import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { applyMigrations, loadMigrationsFromDisk } from "../src/node-sqlite.ts";

/*
 * THE MEETING ADDRESSES MIGRATION, RUN OVER A DATABASE THAT ALREADY HOLDS ROWS.
 *
 * It gives every existing meeting a nine-digit code and every existing personal room an address by
 * its owner's first name. Both are UPDATEs, and an UPDATE is only proved against rows: seed meetings
 * and rooms at the schema before it, apply it, and read what each row became.
 */
const TAG = "20261114T000307_meeting-addresses";
const NOW = "2026-11-13T12:00:00.000Z";

const MEMBERS = [
  ["user_trevorgoldsmith00000000", "Trevor Goldsmith"],
  ["user_trevorjones000000000000", "Trevor Jones"],
  ["user_anamaria000000000000000", "Ana-Maria Lopez"],
  ["user_ada0000000000000000000a", "  Ada  "],
] as const;

function seed(raw: DatabaseSync): void {
  const member = raw.prepare(
    `INSERT INTO member (user_id, display_name, status, created_at) VALUES (?, ?, 'active', ?)`,
  );
  const room = raw.prepare(
    `INSERT INTO meeting_personal_room (id, owner_user_id, link_code, medium, lobby, created_at, updated_at)
     VALUES (?, ?, ?, 'video', 'on', ?, ?)`,
  );
  MEMBERS.forEach(([userId, name], position) => {
    member.run(userId, name, NOW);
    const at = `2026-11-1${String(position)}T12:00:00.000Z`;
    room.run(
      `meetingPersonalRoom_${String(position)}`,
      userId,
      `roomcode0${String(position)}`,
      at,
      at,
    );
  });
  const event = raw.prepare(
    `INSERT INTO firm_event (id, title, starts_on, time_zone, recorded_at, created_at, updated_at)
     VALUES (?, 'A meeting', '2026-11-13', 'America/Chicago', ?, ?, ?)`,
  );
  const meeting = raw.prepare(
    `INSERT INTO meeting (id, event_kind, firm_event_id, created_by_user_id, created_at, updated_at)
     VALUES (?, 'firm', ?, ?, ?, ?)`,
  );
  for (const position of [1, 2, 3]) {
    event.run(`firmEvent_${String(position)}`, NOW, NOW, NOW);
    meeting.run(
      `meeting_${String(position)}`,
      `firmEvent_${String(position)}`,
      MEMBERS[0][0],
      NOW,
      NOW,
    );
  }
}

describe("the meeting addresses migration over existing rows", () => {
  const migrations = loadMigrationsFromDisk("per-firm");
  const at = migrations.findIndex((migration) => migration.tag === TAG);

  it("gives every meeting its own nine-digit code and every room a name", () => {
    expect(at).toBeGreaterThan(0);
    const raw = new DatabaseSync(":memory:");
    applyMigrations(raw, migrations.slice(0, at));
    seed(raw);
    expect(() => applyMigrations(raw, migrations.slice(at))).not.toThrow();

    const codes = raw.prepare(`SELECT join_code FROM meeting ORDER BY id`).all() as {
      join_code: string;
    }[];
    expect(codes).toHaveLength(3);
    for (const { join_code } of codes) expect(join_code).toMatch(/^\d{9}$/);
    expect(new Set(codes.map((row) => row.join_code)).size).toBe(3);

    const names = raw
      .prepare(`SELECT owner_user_id, address_name FROM meeting_personal_room ORDER BY id`)
      .all() as { owner_user_id: string; address_name: string }[];
    expect(names.map((row) => row.address_name)).toEqual([
      "trevor",
      "trevor-2",
      // A hyphen in the first name is not a plain word, so the room keeps its link code.
      "roomcode02",
      "ada",
    ]);
  });
});
