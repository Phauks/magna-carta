/*
 * The hole that makes a corpus permanently unreachable, and the two halves of closing it.
 *
 * A review set's access list is fail-closed: no row means no access, there is no operator override
 * and no Owner bypass, so a list nobody effective is on is a corpus nobody can read, close, produce
 * from, or grant access back to. Ever.
 *
 * The revoke guard has always refused emptying the list. What it counted was ROWS, and a
 * deactivated member keeps their row while every permission read in the platform treats them as
 * absent — so a list reading "two members" could hold one person who left the firm last year, and
 * removing the other would strand the corpus with the guard waving it through.
 *
 * These assertions are the shape of that failure, written as the failure rather than as the fix, so
 * they keep biting if somebody later "simplifies" the join out of the count.
 */
import { describe, expect, it } from "vitest";
import type { UserId } from "@magna-carta/identifiers/types";
import {
  readReviewSetAccessCount,
  readReviewSetsHeldOnlyBy,
} from "../src/review-set-access-statements.ts";
import { migratedDatabase, OUTSIDER, REVIEWER, REVIEW_SET, WALLED_REVIEW_SET } from "./support.ts";

const INSTANT = "2026-08-08T12:00:00.000Z";
const DEPARTED = "user_discoveryDeparted" as UserId;

type Raw = ReturnType<typeof migratedDatabase>["raw"];

/** A member who has left the firm: their rows survive, and every read treats them as absent. */
function seedDeactivatedMemberOn(raw: Raw, reviewSetId: string): void {
  raw.exec(
    `INSERT INTO member (user_id, display_name, status, created_at) ` +
      `VALUES ('${DEPARTED}', 'Departed Reviewer', 'deactivated', '${INSTANT}')`,
  );
  raw.exec(
    `INSERT INTO review_set_access (id, review_set_id, member_user_id, granted_by, created_at) ` +
      `VALUES ('reviewSetAccess_departed000000000000', '${reviewSetId}', '${DEPARTED}', '${REVIEWER}', '${INSTANT}')`,
  );
}

describe("the seat count behind the revoke guard", () => {
  it("counts the one active member, not the two rows", async () => {
    const { database, raw } = migratedDatabase();
    seedDeactivatedMemberOn(raw, REVIEW_SET);
    // Two rows on this list. One person who can open the corpus. The guard is refusing removal of
    // the last person who can act, so the number it reads has to be one.
    const rows = raw.prepare(
      "SELECT COUNT(*) AS n FROM review_set_access WHERE review_set_id = ?",
    ) as unknown as { get: (id: string) => { n: number } };
    expect(rows.get(REVIEW_SET).n).toBe(2);
    expect(await readReviewSetAccessCount(database, REVIEW_SET)).toBe(1);
  });

  it("counts a list of one active member as one", async () => {
    const { database } = migratedDatabase();
    expect(await readReviewSetAccessCount(database, REVIEW_SET)).toBe(1);
  });

  it("counts a member on no list as nothing for that review set", async () => {
    const { database } = migratedDatabase();
    // The reviewer is not on the walled list, so their presence elsewhere cannot inflate it.
    expect(await readReviewSetAccessCount(database, WALLED_REVIEW_SET)).toBe(1);
  });
});

describe("the review sets a member is the last active holder of", () => {
  it("names the review set nobody else active is on", async () => {
    const { database } = migratedDatabase();
    // The reviewer alone holds one corpus; the outsider alone holds the other.
    expect(
      (await readReviewSetsHeldOnlyBy(database, REVIEWER, 50)).map((row) => row.review_set_id),
    ).toEqual([REVIEW_SET]);
    expect(
      (await readReviewSetsHeldOnlyBy(database, OUTSIDER, 50)).map((row) => row.review_set_id),
    ).toEqual([WALLED_REVIEW_SET]);
  });

  it("still names it when the only other member on the list has been deactivated", async () => {
    const { database, raw } = migratedDatabase();
    seedDeactivatedMemberOn(raw, REVIEW_SET);
    // This is the case the whole read exists for: the list looks populated and is not. Deactivating
    // the reviewer here would strand the corpus with nothing anywhere refusing it.
    expect(
      (await readReviewSetsHeldOnlyBy(database, REVIEWER, 50)).map((row) => row.review_set_id),
    ).toEqual([REVIEW_SET]);
  });

  it("names nothing once a second active member is on the list", async () => {
    const { database, raw } = migratedDatabase();
    raw.exec(
      `INSERT INTO review_set_access (id, review_set_id, member_user_id, granted_by, created_at) ` +
        `VALUES ('reviewSetAccess_second00000000000000', '${REVIEW_SET}', '${OUTSIDER}', '${REVIEWER}', '${INSTANT}')`,
    );
    // Deactivating either one now strands nothing, so neither is refused. Which is the point: the
    // remedy for a refusal is to add somebody, and adding somebody has to actually clear it.
    expect(await readReviewSetsHeldOnlyBy(database, REVIEWER, 50)).toEqual([]);
    expect(
      (await readReviewSetsHeldOnlyBy(database, OUTSIDER, 50)).map((row) => row.review_set_id),
    ).toEqual([WALLED_REVIEW_SET]);
  });

  it("names nothing for a member on no list at all", async () => {
    const { database, raw } = migratedDatabase();
    raw.exec(
      `INSERT INTO member (user_id, display_name, status, created_at) ` +
        `VALUES ('${DEPARTED}', 'Nobody', 'active', '${INSTANT}')`,
    );
    expect(await readReviewSetsHeldOnlyBy(database, DEPARTED, 50)).toEqual([]);
  });

  it("carries the review set's name, because a refusal has to say which corpora it is about", async () => {
    const { database } = migratedDatabase();
    const held = await readReviewSetsHeldOnlyBy(database, REVIEWER, 50);
    expect(held[0]?.name).toBe(REVIEW_SET);
  });
});
