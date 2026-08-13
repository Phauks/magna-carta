import { beforeEach, describe, expect, it } from "vitest";
import type { CommunityPostId, CommunityProfileId, UserId } from "@magna-carta/identifiers/types";
import {
  compareRequests,
  displayableDistinctFirmCount,
  DISTINCT_FIRM_DISPLAY_FLOOR,
  trendingScore,
  type RankableRequest,
} from "../src/ranking.ts";
import { insertProfileStatement } from "../src/data-access/profile-statements.ts";
import {
  insertPostStatement,
  listPostsStatement,
  type StoredPostRow,
} from "../src/data-access/post-statements.ts";
import { communityDatabase, FIRM_ONE, seedUser } from "./support.ts";
import type { CommunityTestDatabase } from "./support.ts";

const NOW = "2026-08-13T00:00:00.000Z";
const AUTHOR = "user_rankingAuthor" as UserId;
const AUTHOR_PROFILE = "communityProfile_ranking" as CommunityProfileId;

function request(overrides: Partial<RankableRequest>): RankableRequest {
  return {
    voteCount: 0,
    distinctFirmVoteCount: 0,
    commentCount: 0,
    createdAt: NOW,
    lastActivityAt: NOW,
    status: null,
    ...overrides,
  };
}

describe("the display floor", () => {
  it("withholds the distinct-firm number below the floor and gives it at the floor", () => {
    expect(
      displayableDistinctFirmCount({ distinctFirmVoteCount: DISTINCT_FIRM_DISPLAY_FLOOR - 1 }),
    ).toBeUndefined();
    expect(displayableDistinctFirmCount({ distinctFirmVoteCount: DISTINCT_FIRM_DISPLAY_FLOOR })).toBe(
      DISTINCT_FIRM_DISPLAY_FLOOR,
    );
  });

  it("withholds rather than flooring, because a floored number is still a small number", () => {
    // Returning 0 or "fewer than five" would publish the same inference the floor exists to stop.
    expect(displayableDistinctFirmCount({ distinctFirmVoteCount: 1 })).toBeUndefined();
  });
});

describe("trending", () => {
  it("prefers demand from more firms over more seats in one firm", () => {
    const manyFirms = request({ voteCount: 5, distinctFirmVoteCount: 5 });
    const oneBigFirm = request({ voteCount: 40, distinctFirmVoteCount: 1 });
    expect(trendingScore(manyFirms, NOW)).toBeGreaterThan(trendingScore(oneBigFirm, NOW));
  });

  it("decays with time since the last activity", () => {
    const fresh = request({ distinctFirmVoteCount: 10, lastActivityAt: NOW });
    const stale = request({
      distinctFirmVoteCount: 10,
      lastActivityAt: "2026-02-13T00:00:00.000Z",
    });
    expect(trendingScore(fresh, NOW)).toBeGreaterThan(trendingScore(stale, NOW));
  });

  it("does not let a clock skew manufacture a score above the undecayed one", () => {
    const future = request({ distinctFirmVoteCount: 4, lastActivityAt: "2027-01-01T00:00:00.000Z" });
    expect(trendingScore(future, NOW)).toBe(4);
  });
});

describe("the comparator and the query agree", () => {
  let test: CommunityTestDatabase;

  const rows: { number: number; firms: number; comments: number; lastActivityAt: string }[] = [
    { number: 1001, firms: 12, comments: 0, lastActivityAt: "2026-02-01T00:00:00.000Z" },
    { number: 1002, firms: 3, comments: 8, lastActivityAt: "2026-08-12T00:00:00.000Z" },
    { number: 1003, firms: 7, comments: 2, lastActivityAt: "2026-07-01T00:00:00.000Z" },
    { number: 1004, firms: 1, comments: 0, lastActivityAt: "2026-08-13T00:00:00.000Z" },
    { number: 1005, firms: 7, comments: 2, lastActivityAt: "2026-06-01T00:00:00.000Z" },
  ];

  beforeEach(async () => {
    test = communityDatabase();
    seedUser(test, AUTHOR, FIRM_ONE, "Ranking Author");
    await insertProfileStatement(test.database, {
      id: AUTHOR_PROFILE,
      userId: AUTHOR,
      firmId: FIRM_ONE,
      displayName: "Ranking Author",
      isPseudonym: false,
      now: NOW,
    }).run();
    for (const row of rows) {
      await insertPostStatement(test.database, {
        id: `communityPost_${row.number}` as CommunityPostId,
        number: row.number,
        slug: `post-${row.number}`,
        kind: "request",
        category: "reports",
        title: `Request ${row.number}`,
        body: "A body long enough to be a real post about the software.",
        authorProfileId: AUTHOR_PROFILE,
        authorUserId: AUTHOR,
        authorFirmId: FIRM_ONE,
        visibility: "published",
        hiddenReason: null,
        now: "2026-01-01T00:00:00.000Z",
      }).run();
      test.raw
        .prepare(
          `UPDATE community_post SET vote_count = ?, distinct_firm_vote_count = ?, comment_count = ?, last_activity_at = ? WHERE number = ?`,
        )
        .run(row.firms, row.firms, row.comments, row.lastActivityAt, row.number);
    }
  });

  // The trending arithmetic is written twice — once as a comparator and once in SQL — because a
  // category with thousands of requests has to be ordered and paged by the database. This is the
  // test that stops the two definitions drifting apart, which is the failure a duplicated formula
  // actually has.
  it("orders a page the same way in SQL as the comparator does in memory", async () => {
    const listed = await listPostsStatement(test.database, {
      sort: "trending",
      limit: 20,
      now: NOW,
    }).all<StoredPostRow>();
    const fromComparator = rows
      .map((row) =>
        request({
          voteCount: row.firms,
          distinctFirmVoteCount: row.firms,
          commentCount: row.comments,
          createdAt: "2026-01-01T00:00:00.000Z",
          lastActivityAt: row.lastActivityAt,
        }),
      )
      .map((rankable, index) => ({ rankable, number: rows[index]?.number ?? 0 }))
      .sort((left, right) => compareRequests("trending", NOW)(left.rankable, right.rankable))
      .map((entry) => entry.number);
    expect(listed.results.map((row) => row.number)).toEqual(fromComparator);
  });

  it("orders by distinct firms first when sorting by top", async () => {
    const listed = await listPostsStatement(test.database, {
      sort: "top",
      limit: 20,
      now: NOW,
    }).all<StoredPostRow>();
    expect(listed.results.map((row) => row.distinct_firm_vote_count)).toEqual([12, 7, 7, 3, 1]);
  });
});
