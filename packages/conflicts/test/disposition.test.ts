import { createMigratedNodeDatabase } from "@magna-carta/database/node-sqlite";
import type { BatchDatabase } from "@magna-carta/data-access/effect-batch";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import { seededRandomSource } from "@magna-carta/identifiers/random";
import type { UserId } from "@magna-carta/identifiers/types";
import { expect, test } from "vitest";
import type { ConflictsWriteOptions } from "../src/audit.ts";
import {
  readCurrentDisposition,
  readDispositionTrail,
  recordDisposition,
} from "../src/disposition.ts";
import { DISPOSITION_KINDS } from "../src/types.ts";
import { waiverShortfalls } from "../src/waiver.ts";

// A disposition adjudicates a conflicts_hit row, so every test needs one on the books. Seeded
// directly through the raw node:sqlite handle rather than a full runConflictsCheck — the matching
// pipeline (parties, edges, evidence) is irrelevant here; only a real, referenceable hit id matters.

const ACTOR = "user_actor" as UserId;
const clock = { now: () => "2026-07-09T00:00:00.000Z" };

// A waiver names the Directory entity that consented, and the write refuses a handle that resolves to
// nothing — a handle nothing resolves is the typed-in name again, wearing a prefix.
const CONSENTING_PARTY = "directoryPerson_consenting";

/** A waiver record whose constitutive half is present: who consented, and when. */
const WAIVER = {
  givenByEntityId: CONSENTING_PARTY,
  confirmedInWriting: true,
  documentFileId: null,
  givenOn: "2026-07-08",
} as const;

interface HitFixture {
  readonly ctx: { readonly database: BatchDatabase };
  readonly options: ConflictsWriteOptions;
  readonly hitId: string;
  readonly raw: { exec(sql: string): void };
}

async function hitFixture(seed: string): Promise<HitFixture> {
  const { database, raw } = createMigratedNodeDatabase("per-firm");
  const randomSource = seededRandomSource(seed);
  const options: ConflictsWriteOptions = { clock, actorUserId: ACTOR, randomSource };

  const checkId = newIdentifier("conflictsCheck", randomSource);
  const hitId = newIdentifier("conflictsHit", randomSource);
  raw.exec(
    `INSERT INTO conflicts_check (id, trigger, subject_matter_id, subject_parties_json, scope_json, strictness, depth, inputs_json, floor_raised, actor_user_id, created_at) VALUES ('${checkId}', 'comprehensive', NULL, '[]', '{}', 'balanced', 1, '{}', 0, NULL, '2026-07-09T00:00:00.000Z')`,
  );
  raw.exec(
    `INSERT INTO conflicts_hit (id, check_id, entity_id, source_class, evidence_tier, matched_fields_json, graph_path_json, created_at) VALUES ('${hitId}', '${checkId}', 'directoryPerson_placeholder', 'party', 1, '[]', '[]', '2026-07-09T00:00:00.000Z')`,
  );

  raw.exec(
    `INSERT INTO directory_person (id, display_name, status, needs_review, created_at, updated_at) VALUES ('${CONSENTING_PARTY}', 'The Consenting Client', 'active', 0, '2026-07-09T00:00:00.000Z', '2026-07-09T00:00:00.000Z')`,
  );

  return { ctx: { database }, options, hitId, raw };
}

test("a disposition is recorded against a hit", async () => {
  const { ctx, options, hitId } = await hitFixture("record");
  const dispositionId = await recordDisposition(
    ctx.database,
    { hitId, kind: "cleared", rationale: "unrelated party", reviewerUserId: ACTOR },
    options,
  );
  expect(dispositionId).toMatch(/^conflictsDisposition_/);
});

test("a reversal appends a second row and becomes the current disposition", async () => {
  const { ctx, options, hitId } = await hitFixture("reversal");
  await recordDisposition(
    ctx.database,
    { hitId, kind: "cleared", rationale: "looked unrelated", reviewerUserId: ACTOR },
    options,
  );
  await recordDisposition(
    ctx.database,
    {
      hitId,
      kind: "representation_declined",
      rationale: "on review, adverse",
      reviewerUserId: ACTOR,
    },
    { ...options, clock: { now: () => "2026-07-09T01:00:00.000Z" } },
  );

  const current = await readCurrentDisposition(ctx.database, hitId);
  expect(current?.kind).toBe("representation_declined");

  const { results } = await ctx.database
    .prepare(`SELECT COUNT(*) AS count FROM conflicts_disposition`)
    .all();
  // A COUNT(*) always returns exactly one row, which is what makes this indexed read safe.
  expect(results[0]!.count).toBe(2); // the cleared row survives — the audit trail is the point
});

test("the trail keeps a reversed answer standing, oldest first", async () => {
  /*
   * The reason the table is append-only, read back. A reviewer clears a hit and later reverses; the
   * CURRENT word is the reversal, and the clearance is still an act the firm performed and can be
   * asked about. A trail that returned only the surviving answer would destroy on the read exactly
   * what the triggers refuse to destroy on the write.
   */
  const { ctx, options, hitId } = await hitFixture("trail");
  await recordDisposition(
    ctx.database,
    { hitId, kind: "cleared", rationale: "former client, unrelated matter", reviewerUserId: ACTOR },
    options,
  );
  await recordDisposition(
    ctx.database,
    {
      hitId,
      kind: "representation_declined",
      rationale: "on review, the parent is a current client",
      reviewerUserId: ACTOR,
    },
    { ...options, clock: { now: () => "2026-07-09T01:00:00.000Z" } },
  );

  const trail = await readDispositionTrail(ctx.database, hitId);
  expect(trail).toHaveLength(2);
  // Oldest first, which is the OPPOSITE of readCurrentDisposition's ordering: a reversal only makes
  // sense read after the thing it reverses.
  expect(trail.map((entry) => entry.kind)).toEqual(["cleared", "representation_declined"]);
  expect(trail[0]?.rationale).toBe("former client, unrelated matter");
  expect(trail[1]?.createdAt).toBe("2026-07-09T01:00:00.000Z");

  // And the two reads agree about which one is current.
  const current = await readCurrentDisposition(ctx.database, hitId);
  expect(current?.id).toBe(trail[1]?.id);
});

test("a hit nobody has answered has an empty trail rather than an error", async () => {
  // Distinct from a hit that does not exist, which the route answers 404. An empty trail is a fact
  // about the hit: no reviewer has spoken to it. It says nothing about whether an interest is adverse.
  const { ctx, hitId } = await hitFixture("untouched");
  expect(await readDispositionTrail(ctx.database, hitId)).toEqual([]);
});

test("the trail carries each answer's own waiver record rather than the latest one's", async () => {
  // A waiver recorded and then superseded must keep its own record on the trail: a reader asking how
  // a decision was reached needs what the reviewer had in front of them at the time.
  const { ctx, options, hitId } = await hitFixture("waiver-trail");
  await recordDisposition(
    ctx.database,
    {
      hitId,
      kind: "waiver_obtained",
      rationale: "client consented by telephone",
      reviewerUserId: ACTOR,
      waiver: { ...WAIVER, givenOn: "2026-07-01" },
    },
    options,
  );
  await recordDisposition(
    ctx.database,
    { hitId, kind: "wall_erected", rationale: "wall put up as well", reviewerUserId: ACTOR },
    { ...options, clock: { now: () => "2026-07-09T02:00:00.000Z" } },
  );

  const trail = await readDispositionTrail(ctx.database, hitId);
  expect(trail[0]?.waiver?.givenOn).toBe("2026-07-01");
  // The later act carries none, because only waiver_obtained does — not because the record was lost.
  expect(trail[1]?.waiver).toBeNull();
});

test("same-millisecond dispositions resolve to the genuinely-latest by insertion order, not by id", async () => {
  // Two dispositions on one hit sharing a created_at (a reviewer reversing within the same millisecond,
  // or two reviewers racing). The FIRST-inserted carries a lexically-HIGHER id than the second, so an
  // `id DESC` tie-break would surface the stale first row — reporting a reversed conflict as still
  // cleared. `rowid DESC` returns the genuinely-latest (second) row regardless of id.
  const { database, raw } = createMigratedNodeDatabase("per-firm");
  const sameInstant = "2026-07-09T00:00:00.000Z";
  raw.exec(
    `INSERT INTO conflicts_check (id, trigger, subject_matter_id, subject_parties_json, scope_json, strictness, depth, inputs_json, floor_raised, actor_user_id, created_at) VALUES ('conflictsCheck_tie', 'comprehensive', NULL, '[]', '{}', 'balanced', 1, '{}', 0, NULL, '${sameInstant}')`,
  );
  raw.exec(
    `INSERT INTO conflicts_hit (id, check_id, entity_id, source_class, evidence_tier, matched_fields_json, graph_path_json, created_at) VALUES ('conflictsHit_tie', 'conflictsCheck_tie', 'directoryPerson_x', 'party', 1, '[]', '[]', '${sameInstant}')`,
  );
  // First row: lexically-high id, cleared. Second row: lexically-low id, representation_declined.
  raw.exec(
    `INSERT INTO conflicts_disposition (id, hit_id, kind, rationale, reviewer_user_id, created_at) VALUES ('conflictsDisposition_zzzzzzzzzzzzzzzzzzzzz', 'conflictsHit_tie', 'cleared', 'looked unrelated', '${ACTOR}', '${sameInstant}')`,
  );
  raw.exec(
    `INSERT INTO conflicts_disposition (id, hit_id, kind, rationale, reviewer_user_id, created_at) VALUES ('conflictsDisposition_aaaaaaaaaaaaaaaaaaaaa', 'conflictsHit_tie', 'representation_declined', 'on review, adverse', '${ACTOR}', '${sameInstant}')`,
  );

  const current = await readCurrentDisposition(
    database as unknown as BatchDatabase,
    "conflictsHit_tie",
  );
  expect(current?.kind).toBe("representation_declined");
});

test("an empty rationale is rejected", async () => {
  const { ctx, options, hitId } = await hitFixture("empty-rationale");
  await expect(
    recordDisposition(
      ctx.database,
      { hitId, kind: "cleared", rationale: "   ", reviewerUserId: ACTOR },
      options,
    ),
  ).rejects.toThrow(/empty-rationale/);
});

test("a disposition against an unknown hit is rejected before any write", async () => {
  const { ctx, options } = await hitFixture("unknown-hit");
  await expect(
    recordDisposition(
      ctx.database,
      { hitId: "conflictsHit_missing", kind: "cleared", rationale: "x", reviewerUserId: ACTOR },
      options,
    ),
  ).rejects.toThrow(/unknown-hit/);
});

test("every disposition kind is accepted", async () => {
  for (const kind of DISPOSITION_KINDS) {
    const { ctx, options, hitId } = await hitFixture(`kind-${kind}`);
    await expect(
      recordDisposition(
        ctx.database,
        {
          hitId,
          kind,
          rationale: "reason",
          reviewerUserId: ACTOR,
          // Only a waiver carries a waiver record, and it is refused on every other kind.
          waiver: kind === "waiver_obtained" ? WAIVER : undefined,
        },
        options,
      ),
    ).resolves.toBeDefined();
  }
});

// ---- the waiver's own record --------------------------------------------------------------------

test("a waiver records who consented, whether it was confirmed in writing, and when", async () => {
  const { ctx, options, hitId } = await hitFixture("waiver-record");
  await recordDisposition(
    ctx.database,
    {
      hitId,
      kind: "waiver_obtained",
      rationale: "informed consent, confirmed by letter",
      reviewerUserId: ACTOR,
      waiver: WAIVER,
    },
    options,
  );

  const current = await readCurrentDisposition(ctx.database, hitId);
  expect(current?.waiver).toEqual({
    givenByEntityId: CONSENTING_PARTY,
    confirmedInWriting: true,
    documentFileId: null,
    // The civil date the waiver was GIVEN, which is a day before the instant it was recorded.
    givenOn: "2026-07-08",
  });
  expect(current?.createdAt).toBe("2026-07-09T00:00:00.000Z");
});

// The refusal that matters most, and the one this record exists to prevent being needed: a waiver
// whose written confirmation has not arrived is RECORDED, not refused. Refusing it would push the
// reviewer into recording some other kind, and the firm's log would then carry no waiver at all.
test("a waiver with no written confirmation is recorded and reports what it is short of", async () => {
  const { ctx, options, hitId } = await hitFixture("waiver-unconfirmed");
  await recordDisposition(
    ctx.database,
    {
      hitId,
      kind: "waiver_obtained",
      rationale: "consent given by telephone; the confirming letter goes out today",
      reviewerUserId: ACTOR,
      waiver: { ...WAIVER, confirmedInWriting: false },
    },
    options,
  );

  const current = await readCurrentDisposition(ctx.database, hitId);
  expect(current?.waiver?.confirmedInWriting).toBe(false);
  expect(waiverShortfalls("waiver_obtained", current?.waiver ?? null)).toEqual([
    "consent-not-confirmed-in-writing",
    "confirmation-not-filed",
  ]);
});

test("a waiver naming nobody, or no date, is refused before anything is written", async () => {
  const missingParty = await hitFixture("waiver-no-party");
  await expect(
    recordDisposition(
      missingParty.ctx.database,
      {
        hitId: missingParty.hitId,
        kind: "waiver_obtained",
        rationale: "a waiver was obtained",
        reviewerUserId: ACTOR,
      },
      missingParty.options,
    ),
  ).rejects.toThrow(/waiver-record-required/);

  const missingDate = await hitFixture("waiver-no-date");
  await expect(
    recordDisposition(
      missingDate.ctx.database,
      {
        hitId: missingDate.hitId,
        kind: "waiver_obtained",
        rationale: "a waiver was obtained",
        reviewerUserId: ACTOR,
        waiver: { ...WAIVER, givenOn: "" },
      },
      missingDate.options,
    ),
  ).rejects.toThrow(/waiver-record-required/);
});

test("a date that is not a real civil date is refused", async () => {
  const { ctx, options, hitId } = await hitFixture("waiver-bad-date");
  await expect(
    recordDisposition(
      ctx.database,
      {
        hitId,
        kind: "waiver_obtained",
        rationale: "a waiver was obtained",
        reviewerUserId: ACTOR,
        waiver: { ...WAIVER, givenOn: "2026-02-31" },
      },
      options,
    ),
  ).rejects.toThrow(/invalid-waiver-date/);
});

test("a consenting party the Directory does not hold is refused", async () => {
  const { ctx, options, hitId } = await hitFixture("waiver-unknown-party");
  await expect(
    recordDisposition(
      ctx.database,
      {
        hitId,
        kind: "waiver_obtained",
        rationale: "a waiver was obtained",
        reviewerUserId: ACTOR,
        waiver: { ...WAIVER, givenByEntityId: "directoryPerson_nobody" },
      },
      options,
    ),
  ).rejects.toThrow(/unknown-consenting-party/);
});

test("an evidencing document nothing resolves is refused", async () => {
  const { ctx, options, hitId } = await hitFixture("waiver-unknown-document");
  await expect(
    recordDisposition(
      ctx.database,
      {
        hitId,
        kind: "waiver_obtained",
        rationale: "a waiver was obtained",
        reviewerUserId: ACTOR,
        waiver: { ...WAIVER, documentFileId: "file_nothing" },
      },
      options,
    ),
  ).rejects.toThrow(/unknown-waiver-document/);
});

test("a waiver record on any other kind is refused", async () => {
  const { ctx, options, hitId } = await hitFixture("waiver-wrong-kind");
  await expect(
    recordDisposition(
      ctx.database,
      {
        hitId,
        kind: "cleared",
        rationale: "unrelated party",
        reviewerUserId: ACTOR,
        waiver: WAIVER,
      },
      options,
    ),
  ).rejects.toThrow(/waiver-record-not-applicable/);
});

// The database refuses it too, beside the six append-only guards, so nothing in application code can
// quietly stop calling the rule.
test("the database refuses a waiver record on a kind that has none", async () => {
  const { raw, hitId } = await hitFixture("waiver-trigger");
  expect(() =>
    raw.exec(
      `INSERT INTO conflicts_disposition (id, hit_id, kind, rationale, reviewer_user_id, waiver_given_on, created_at) VALUES ('conflictsDisposition_bad', '${hitId}', 'cleared', 'unrelated', '${ACTOR}', '2026-07-08', '2026-07-09T00:00:00.000Z')`,
    ),
  ).toThrow(/only a waiver_obtained disposition carries a waiver record/);
});

// A row written before the waiver columns existed says nothing about a waiver, which is not the same
// as a waiver given by nobody — and it is short of every part of the record, so it reads that way.
test("a waiver row that predates the record reports every part as missing", async () => {
  const { ctx, raw, hitId } = await hitFixture("waiver-legacy");
  raw.exec(
    `INSERT INTO conflicts_disposition (id, hit_id, kind, rationale, reviewer_user_id, created_at) VALUES ('conflictsDisposition_legacy', '${hitId}', 'waiver_obtained', 'a waiver was obtained', '${ACTOR}', '2026-07-09T00:00:00.000Z')`,
  );
  const current = await readCurrentDisposition(ctx.database, hitId);
  expect(current?.waiver).toBeNull();
  expect(waiverShortfalls("waiver_obtained", current?.waiver ?? null)).toEqual([
    "consenting-party-unrecorded",
    "consent-not-confirmed-in-writing",
    "confirmation-not-filed",
    "date-given-unrecorded",
  ]);
});
