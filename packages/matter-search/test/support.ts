import { createMigratedNodeDatabase } from "@magna-carta/database/node-sqlite";
import { visibleMatterPredicate } from "@magna-carta/calendar/visibility";
import { assertPermission, type Permission } from "@magna-carta/access-control/registry";
import type { MatterId, UserId } from "@magna-carta/identifiers/types";

// A migrated in-memory per-firm database with one matter's record filled in across all four
// searchable sources, a SECOND matter holding decoys with the same words in them, and the
// platform-owned custody holding matter that must never appear on a read composing the
// visible-matter predicate.
//
// The decoys are the point. Nearly every property this package must have is a property about what
// does NOT come back, so a fixture with one matter in it would pass every test while proving
// nothing.

export const ACTOR = "user_searchTester00" as UserId;
export const MATTER = "matter_searchTest00000000000000000" as MatterId;
export const OTHER_MATTER = "matter_searchOther0000000000000000" as MatterId;
export const HOLDING_MATTER = "matter_searchHolding00000000000000" as MatterId;

export const visibility = visibleMatterPredicate();

export const ALL_PERMISSIONS: ReadonlySet<Permission> = new Set([
  assertPermission("notes:read"),
  assertPermission("custody:read"),
]);

export const NO_PERMISSIONS: ReadonlySet<Permission> = new Set<Permission>();

const INSTANT = "2026-08-01T00:00:00.000Z";

type Raw = ReturnType<typeof createMigratedNodeDatabase>["raw"];

function quote(value: string | null): string {
  return value === null ? "NULL" : `'${value.replace(/'/gu, "''")}'`;
}

function seedMatters(raw: Raw): void {
  raw.exec(
    `INSERT INTO member (user_id, display_name, status, created_at) ` +
      `VALUES ('${ACTOR}', 'Search Tester', 'active', '${INSTANT}')`,
  );
  const columns =
    "id, title, status, responsible_member_id, system_key, opened_at, created_at, updated_at";
  for (const [id, title, systemKey] of [
    [MATTER, "Herrera v Alvarez", null],
    [OTHER_MATTER, "Brown estate", null],
    [HOLDING_MATTER, "Custody holdings", "custody-holding"],
  ] as const) {
    raw.exec(
      `INSERT INTO matter (${columns}) VALUES ('${id}', ${quote(title)}, 'open', '${ACTOR}', ` +
        `${quote(systemKey)}, '${INSTANT}', '${INSTANT}', '${INSTANT}')`,
    );
  }
}

export function seedNote(
  raw: Raw,
  options: { id: string; matterId: string; body: string; occurredOn?: string },
): void {
  raw.exec(
    `INSERT INTO matter_note (id, matter_id, author_user_id, body, last_edited_by, occurred_on, ` +
      `occurred_at_time, time_zone, created_at, updated_at) VALUES ('${options.id}', ` +
      `'${options.matterId}', '${ACTOR}', ${quote(options.body)}, NULL, ` +
      `${quote(options.occurredOn ?? null)}, NULL, NULL, '${INSTANT}', '${INSTANT}')`,
  );
}

export function seedFile(
  raw: Raw,
  options: { id: string; matterId: string; name: string; deleted?: boolean },
): void {
  raw.exec(
    `INSERT INTO file (id, matter_id, folder_id, name, edit_state, deleted_at, created_at, updated_at) ` +
      `VALUES ('${options.id}', '${options.matterId}', NULL, ${quote(options.name)}, 'idle', ` +
      `${options.deleted === true ? `'${INSTANT}'` : "NULL"}, '${INSTANT}', '${INSTANT}')`,
  );
}

export function seedPacket(
  raw: Raw,
  options: { id: string; matterId: string; name: string; custodyNumber: string },
): void {
  raw.exec(
    `INSERT INTO custody_packet (id, custody_number, number_source, name, status, matter_id, ` +
      `created_at, updated_at) VALUES ('${options.id}', ${quote(options.custodyNumber)}, 'manual', ` +
      `${quote(options.name)}, 'held', '${options.matterId}', '${INSTANT}', '${INSTANT}')`,
  );
}

export function seedParty(
  raw: Raw,
  options: {
    id: string;
    matterId: string;
    entityId: string;
    displayName: string;
    role: string;
    capacity?: string;
  },
): void {
  raw.exec(
    `INSERT INTO directory_person (id, display_name, deceased, status, needs_review, created_at, updated_at) ` +
      `VALUES ('${options.entityId}', ${quote(options.displayName)}, 0, 'active', 0, '${INSTANT}', '${INSTANT}')`,
  );
  raw.exec(
    `INSERT INTO matter_party (id, matter_id, entity_id, role, capacity, created_at, updated_at) ` +
      `VALUES ('${options.id}', '${options.matterId}', '${options.entityId}', ${quote(options.role)}, ` +
      `${quote(options.capacity ?? null)}, '${INSTANT}', '${INSTANT}')`,
  );
}

// The standard fixture: the matter under test, plus a decoy of every kind on a second matter
// carrying the SAME search words, plus one on the holding matter.
export function seededDatabase() {
  const { database, raw } = createMigratedNodeDatabase("per-firm");
  seedMatters(raw);

  seedNote(raw, { id: "matterNote_easement", matterId: MATTER, body: "The easement runs east." });
  // A note ABOUT an earlier day than the day it was typed, so the ordering expression is exercised
  // rather than assumed — it is the one the Notes tab itself orders by.
  seedNote(raw, {
    id: "matterNote_occurred",
    matterId: MATTER,
    body: "Spoke to the neighbour about the easement fence.",
    occurredOn: "2026-07-14",
  });
  seedNote(raw, { id: "matterNote_decoy", matterId: OTHER_MATTER, body: "An easement elsewhere." });

  seedFile(raw, { id: "file_survey", matterId: MATTER, name: "Easement survey.pdf" });
  seedFile(raw, {
    id: "file_deleted",
    matterId: MATTER,
    name: "Easement draft (superseded).pdf",
    deleted: true,
  });
  seedFile(raw, { id: "file_decoy", matterId: OTHER_MATTER, name: "Easement notes.pdf" });
  seedFile(raw, { id: "file_holding", matterId: HOLDING_MATTER, name: "Easement original.pdf" });

  seedPacket(raw, {
    id: "custodyPacket_deed",
    matterId: MATTER,
    name: "Original easement deed",
    custodyNumber: "CUS-2026-0001",
  });
  seedPacket(raw, {
    id: "custodyPacket_decoy",
    matterId: OTHER_MATTER,
    name: "Easement papers",
    custodyNumber: "CUS-2026-0002",
  });

  seedParty(raw, {
    id: "matterParty_neighbour",
    matterId: MATTER,
    entityId: "directoryPerson_easton",
    displayName: "Marta Easton",
    role: "opposing_party",
    capacity: "Trustee",
  });
  seedParty(raw, {
    id: "matterParty_decoy",
    matterId: OTHER_MATTER,
    entityId: "directoryPerson_eastwood",
    displayName: "Ruth Eastwood",
    role: "client",
  });

  return { database, raw };
}
