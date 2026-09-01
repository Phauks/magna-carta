import { afterAll, describe, expect, it } from "vitest";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import { insertMemberStatement } from "@magna-carta/data-access/member-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { MatterId, UserId } from "@magna-carta/identifiers/types";
import { visibleMatterPredicate } from "@magna-carta/calendar/visibility";
import { runMatterSearch } from "@magna-carta/matter-search/run";
import { matterSearchSources } from "@magna-carta/matter-search/sources";
import { assertPermission, type Permission } from "@magna-carta/access-control/registry";
import { fixtureContext, type FixtureContext } from "../context.ts";
import { createLocalPerFirmDatabase, type LocalDatabase } from "../local-database.ts";
import { findFullScans, findTempBtreeSorts } from "./runner.ts";
import {
  MATTER_SEARCH_PLAN_SCAN_ALLOWLIST,
  matterSearchHotPathPlans,
} from "./matter-search-measurements.ts";

// The gate in front of adding more search sources.
//
// The question this answers is not "is a substring match fast" — it cannot be, and no index makes it
// so. It is whether the MATTER NARROWING is index-served, so the scan runs over one case's rows
// instead of the firm's. A source that gets slower as the firm grows rather than as the matter does
// is affordable on a demo and ruinous on a real book of business, and nothing about the query's shape
// reveals which one it is.
//
// The volume is deliberately lopsided: one matter carrying a working load, and a firm-sized
// background of OTHER matters holding rows with the same words in them. A plan that scans would find
// the background rows; one that narrows first cannot see them. That is also what makes the
// correctness assertion at the end meaningful rather than a restatement of the unit tests.

const SEED = "matter-search-measurements-smoke";

// One busy matter. Sized as a long-running case rather than a stress run — the point is to be big
// enough that a full scan and an index walk are distinguishable, not to find a breaking point.
const NOTES_ON_MATTER = 400;
const FILES_ON_MATTER = 1_500;
const PACKETS_ON_MATTER = 60;
const PARTIES_ON_MATTER = 40;

// The firm's other matters. Every one of them holds rows carrying the search term, so a plan that
// fails to narrow by matter returns them and fails the correctness assertion as well as the plan one.
const OTHER_MATTERS = 40;
const NOTES_PER_OTHER_MATTER = 40;
const FILES_PER_OTHER_MATTER = 120;

const TERM = "easement";
// A party is not called "easement". The name term is the parties source's own, and the isolation
// assertion below runs for both — half the background matters carry a party with the same name.
const NAME_TERM = "Easton";

const PERMISSIONS: ReadonlySet<Permission> = new Set([
  assertPermission("notes:read"),
  assertPermission("custody:read"),
]);

let local: LocalDatabase | undefined;

async function busiestMatterId(): Promise<MatterId> {
  if (local === undefined) throw new Error("the volume test must run first");
  const rows = await local.database
    .prepare("SELECT id FROM matter WHERE title = 'Herrera v Alvarez'")
    .bind()
    .all<{ id: string }>();
  const id = rows.results[0]?.id;
  if (id === undefined) throw new Error("the busy matter was not seeded");
  return id as MatterId;
}

afterAll(() => {
  local?.raw.close();
});

async function seedMatter(
  database: SqlDatabase,
  context: FixtureContext,
  actorUserId: UserId,
  title: string,
): Promise<MatterId> {
  const matterId = newIdentifier("matter", context.randomSource);
  const now = context.clock.now();
  await database
    .prepare(
      `INSERT INTO matter (id, title, status, responsible_member_id, created_at, updated_at) ` +
        `VALUES (?1, ?2, 'open', ?3, ?4, ?4)`,
    )
    .bind(matterId, title, actorUserId, now)
    .run();
  return matterId;
}

// Half the rows carry the term and half do not, so the match itself discriminates rather than
// every row being a hit — a corpus where everything matches measures the limit, not the scan.
function bodyFor(index: number): string {
  return index % 2 === 0
    ? `Attendance note ${index}: the ${TERM} along the eastern boundary was discussed.`
    : `Attendance note ${index}: routine correspondence with the client about scheduling.`;
}

function fileNameFor(index: number): string {
  return index % 2 === 0 ? `${TERM} survey ${index}.pdf` : `Correspondence ${index}.pdf`;
}

async function seedVolume(
  database: SqlDatabase,
  raw: LocalDatabase["raw"],
  context: FixtureContext,
): Promise<{ matterId: MatterId; actorUserId: UserId }> {
  const actorUserId = newIdentifier("user", context.randomSource);
  const now = context.clock.now();
  await insertMemberStatement(database, {
    userId: actorUserId,
    displayName: "Load-profile captor",
    now,
  }).run();

  const matterId = await seedMatter(database, context, actorUserId, "Herrera v Alvarez");

  // Written through the raw handle in one transaction: this is fixture volume, not a measured write
  // path, and going through the services would measure the generator instead of the search.
  raw.exec("BEGIN");
  for (let index = 0; index < NOTES_ON_MATTER; index += 1) {
    raw
      .prepare(
        `INSERT INTO matter_note (id, matter_id, author_user_id, body, last_edited_by, occurred_on, ` +
          `occurred_at_time, time_zone, created_at, updated_at) VALUES (?, ?, ?, ?, NULL, NULL, NULL, NULL, ?, ?)`,
      )
      .run(
        newIdentifier("matterNote", context.randomSource),
        matterId,
        actorUserId,
        bodyFor(index),
        now,
        now,
      );
  }
  for (let index = 0; index < FILES_ON_MATTER; index += 1) {
    raw
      .prepare(
        `INSERT INTO file (id, matter_id, folder_id, name, edit_state, deleted_at, created_at, updated_at) ` +
          `VALUES (?, ?, NULL, ?, 'idle', NULL, ?, ?)`,
      )
      .run(newIdentifier("file", context.randomSource), matterId, fileNameFor(index), now, now);
  }
  for (let index = 0; index < PACKETS_ON_MATTER; index += 1) {
    raw
      .prepare(
        `INSERT INTO custody_packet (id, custody_number, number_source, name, status, matter_id, ` +
          `created_at, updated_at) VALUES (?, ?, 'manual', ?, 'held', ?, ?, ?)`,
      )
      .run(
        newIdentifier("custodyPacket", context.randomSource),
        `CUS-${String(index).padStart(6, "0")}`,
        index % 2 === 0 ? `Original ${TERM} deed ${index}` : `Deposit box papers ${index}`,
        matterId,
        now,
        now,
      );
  }
  for (let index = 0; index < PARTIES_ON_MATTER; index += 1) {
    const entityId = newIdentifier("directoryPerson", context.randomSource);
    raw
      .prepare(
        `INSERT INTO directory_person (id, display_name, deceased, status, needs_review, created_at, updated_at) ` +
          `VALUES (?, ?, 0, 'active', 0, ?, ?)`,
      )
      .run(
        entityId,
        index % 2 === 0 ? `Marta Easton ${index}` : `Ruth Winterbourne ${index}`,
        now,
        now,
      );
    raw
      .prepare(
        `INSERT INTO matter_party (id, matter_id, entity_id, role, capacity, created_at, updated_at) ` +
          `VALUES (?, ?, ?, 'opposing_party', NULL, ?, ?)`,
      )
      .run(newIdentifier("matterParty", context.randomSource), matterId, entityId, now, now);
  }

  // The firm's background. These rows must never reach an answer scoped to the matter above.
  for (let other = 0; other < OTHER_MATTERS; other += 1) {
    const otherId = newIdentifier("matter", context.randomSource);
    raw
      .prepare(
        `INSERT INTO matter (id, title, status, responsible_member_id, created_at, updated_at) ` +
          `VALUES (?, ?, 'open', ?, ?, ?)`,
      )
      .run(otherId, `Background matter ${other}`, actorUserId, now, now);
    for (let index = 0; index < NOTES_PER_OTHER_MATTER; index += 1) {
      raw
        .prepare(
          `INSERT INTO matter_note (id, matter_id, author_user_id, body, last_edited_by, occurred_on, ` +
            `occurred_at_time, time_zone, created_at, updated_at) VALUES (?, ?, ?, ?, NULL, NULL, NULL, NULL, ?, ?)`,
        )
        .run(
          newIdentifier("matterNote", context.randomSource),
          otherId,
          actorUserId,
          bodyFor(index),
          now,
          now,
        );
    }
    for (let index = 0; index < FILES_PER_OTHER_MATTER; index += 1) {
      raw
        .prepare(
          `INSERT INTO file (id, matter_id, folder_id, name, edit_state, deleted_at, created_at, updated_at) ` +
            `VALUES (?, ?, NULL, ?, 'idle', NULL, ?, ?)`,
        )
        .run(newIdentifier("file", context.randomSource), otherId, fileNameFor(index), now, now);
    }
    // A background party carrying the SAME name, so the parties isolation assertion is about the
    // matter filter rather than about the firm happening to hold one Easton.
    const backgroundEntityId = newIdentifier("directoryPerson", context.randomSource);
    raw
      .prepare(
        `INSERT INTO directory_person (id, display_name, deceased, status, needs_review, created_at, updated_at) ` +
          `VALUES (?, ?, 0, 'active', 0, ?, ?)`,
      )
      .run(backgroundEntityId, `Marta ${NAME_TERM} of matter ${other}`, now, now);
    raw
      .prepare(
        `INSERT INTO matter_party (id, matter_id, entity_id, role, capacity, created_at, updated_at) ` +
          `VALUES (?, ?, ?, 'client', NULL, ?, ?)`,
      )
      .run(
        newIdentifier("matterParty", context.randomSource),
        otherId,
        backgroundEntityId,
        now,
        now,
      );
  }
  raw.exec("COMMIT");
  raw.exec("ANALYZE");
  return { matterId, actorUserId };
}

describe("a matter search narrows by matter before it scans", () => {
  it("plans every registered source's read without a full table scan, at volume", async () => {
    local = createLocalPerFirmDatabase();
    const context = fixtureContext(SEED);
    const { matterId } = await seedVolume(local.database, local.raw, context);

    const plans = matterSearchHotPathPlans({
      database: local.database,
      raw: local.raw,
      matterId,
      query: TERM,
    });

    // Not vacuous: every registered source must have contributed a plan, or a source that quietly
    // stopped building a statement would pass this by contributing nothing to scan.
    expect(plans).toHaveLength(matterSearchSources.all().length);

    const scans = findFullScans(plans, MATTER_SEARCH_PLAN_SCAN_ALLOWLIST);
    expect(scans, `full table scans in: ${scans.join(", ")}`).toEqual([]);
  });

  it("materialises a sort only where the rows are already narrowed to one matter", async () => {
    if (local === undefined) throw new Error("the volume test must run first");
    const plans = matterSearchHotPathPlans({
      database: local.database,
      raw: local.raw,
      matterId: await busiestMatterId(),
      query: TERM,
    });

    // Two sources DO materialise a sort, and both are recorded here rather than waved through.
    //
    // Notes order by COALESCE(occurred_on, date(created_at)) — the day the note is ABOUT, which is
    // the expression the Notes tab itself orders by, and no index can serve a computed one. Parties
    // order by the case-folded display name, which is resolved per row by subquery.
    //
    // Both are acceptable HERE and would not be on a firm-wide read, and the difference is the whole
    // reason this assertion is scoped rather than absolute: the rows being sorted are the rows the
    // substring scan has ALREADY read, bounded by one matter. The sort adds a log factor over work
    // already done; it does not add a new dependency on the size of the firm. A source that
    // materialised a sort over rows it had not already narrowed would fail the scan assertion above
    // first.
    const sorts = findTempBtreeSorts(plans);
    expect(sorts.toSorted()).toEqual(["matter-search.notes", "matter-search.parties"]);
  });

  it("returns only the searched matter's rows out of the firm's whole corpus", async () => {
    if (local === undefined) throw new Error("the volume test must run first");
    const matterId = await busiestMatterId();

    // Not vacuous: the background must really hold rows that a scan would have found.
    const background = await local.database
      .prepare(
        `SELECT (SELECT COUNT(*) FROM matter_note WHERE matter_id != ?1 AND body LIKE '%easement%') AS notes, ` +
          `(SELECT COUNT(*) FROM matter_party WHERE matter_id != ?1) AS parties`,
      )
      .bind(matterId)
      .all<{ notes: number; parties: number }>();
    expect(background.results[0]?.notes ?? 0).toBeGreaterThan(0);
    expect(background.results[0]?.parties ?? 0).toBeGreaterThan(0);

    const answer = await runMatterSearch({
      database: local.database,
      registry: matterSearchSources,
      matterId,
      query: TERM,
      visibility: visibleMatterPredicate(),
      sourceKeys: undefined,
      permissions: PERMISSIONS,
      limit: 50,
      includeDeleted: false,
    });
    for (const group of answer.groups) {
      expect(group.skipped).toBeNull();
      if (group.source === "parties") continue; // answered under its own term below
      expect(group.hits.length, `${group.source} answered nothing at volume`).toBeGreaterThan(0);
    }

    const byName = await runMatterSearch({
      database: local.database,
      registry: matterSearchSources,
      matterId,
      query: NAME_TERM,
      visibility: visibleMatterPredicate(),
      sourceKeys: ["parties"],
      permissions: PERMISSIONS,
      limit: 50,
      includeDeleted: false,
    });
    const partyHits = byName.groups[0]?.hits ?? [];
    expect(partyHits.length).toBeGreaterThan(0);

    // The isolation property, asserted against the rows a scan would have returned rather than
    // against a count: every hit's row must belong to the searched matter.
    const foreignNotes = new Set(
      (
        await local.database
          .prepare(`SELECT id FROM matter_note WHERE matter_id != ?1`)
          .bind(matterId)
          .all<{ id: string }>()
      ).results.map((row) => row.id),
    );
    for (const hit of answer.groups.find((group) => group.source === "notes")?.hits ?? []) {
      expect(foreignNotes.has(hit.id)).toBe(false);
    }
    const foreignParties = new Set(
      (
        await local.database
          .prepare(`SELECT id FROM matter_party WHERE matter_id != ?1`)
          .bind(matterId)
          .all<{ id: string }>()
      ).results.map((row) => row.id),
    );
    for (const hit of partyHits) expect(foreignParties.has(hit.id)).toBe(false);
  });
});
