// How a list of requests is ordered, and how much of the arithmetic a reader is shown.
//
// The ordering key is HOW MANY DISTINCT FIRMS want a thing, not how many people. A firm with forty
// seats and a firm with one both feel a missing feature once, and ranking by raw votes would let
// the larger firm out-shout the smaller forty times over. Ranking by distinct firms gets the
// anti-stuffing property without disenfranchising anybody: the paralegal who feels the cost most
// still votes, their vote still counts toward the raw total, and it simply cannot be multiplied by
// the size of their employer.
//
// Weighting a vote by what a firm pays was considered and rejected: a bigger cheque buying more
// influence is per-seat cost scaling wearing a different coat. The firm identifier on every vote is
// the seam that would make such a change possible, so the decision stays reversible without being
// taken.

import type { PostStatus, Sort } from "./types.ts";

// Below this many distinct firms, the distinct-firm number is not shown to a reader at all.
//
// The floor is a disclosure control rather than a presentation preference. "Two firms want this",
// on a post signed with a real display name, tells a reader roughly who the second firm is; at five
// the number stops being an identification. The raw vote total is shown at any size, because it
// names nobody. The voter list is never shown at any size, which is the sharpest disagreement this
// board has with the reference product it is modelled on.
export const DISTINCT_FIRM_DISPLAY_FLOOR = 5;

export interface RankableRequest {
  readonly voteCount: number;
  readonly distinctFirmVoteCount: number;
  readonly commentCount: number;
  readonly createdAt: string; // ISO-8601 instant
  readonly lastActivityAt: string; // ISO-8601 instant
  readonly status: PostStatus | null;
}

// The distinct-firm count as a reader is allowed to see it: the number above the floor, and
// nothing — not zero, not "fewer than five" — below it. Absence is the right shape because "fewer
// than five" is itself a fact about how few firms are involved.
export function displayableDistinctFirmCount(request: {
  readonly distinctFirmVoteCount: number;
}): number | undefined {
  return request.distinctFirmVoteCount >= DISTINCT_FIRM_DISPLAY_FLOOR
    ? request.distinctFirmVoteCount
    : undefined;
}

// The scale of the trending decay, in days. Long enough that a post made on a Friday is still
// competitive on Monday; short enough that a two-year-old request cannot sit at the top of a board
// forever on the strength of votes cast when it was new.
const TRENDING_DECAY_DAYS = 30;
const MILLISECONDS_PER_DAY = 86_400_000;

// The weight one comment carries relative to one firm's vote. A conversation is evidence of demand,
// but weaker evidence than somebody saying "yes, this, me too".
const COMMENT_WEIGHT = 0.25;

// The trending score: distinct-firm demand plus a fraction for the conversation, divided by how
// long ago the post was last active. Ties break on recency, in the comparator below.
//
// This expression is duplicated in SQL, in post-statements.ts, because a category with thousands of
// requests must be ordered and paged by the database rather than in memory. The duplication is
// deliberate and guarded: test/ranking.test.ts runs both orderings over the same rows and fails if
// they disagree. It is hyperbolic rather than exponential because `pow` and `exp` are optional
// SQLite functions and `julianday` and division are not.
export function trendingScore(request: RankableRequest, now: string): number {
  const ageDays = (Date.parse(now) - Date.parse(request.lastActivityAt)) / MILLISECONDS_PER_DAY;
  // A clock skew putting the last activity in the future must not manufacture a score above the
  // undecayed one, so the age floors at zero.
  const decay = 1 + Math.max(0, ageDays) / TRENDING_DECAY_DAYS;
  return (request.distinctFirmVoteCount + request.commentCount * COMMENT_WEIGHT) / decay;
}

// The comparator for a sorted list. Exported so the same ordering is applied wherever a list is
// assembled, including in tests, rather than being spelled out again in SQL and drifting from it.
export function compareRequests(sort: Sort, now: string) {
  return (left: RankableRequest, right: RankableRequest): number => {
    if (sort === "new") return Date.parse(right.createdAt) - Date.parse(left.createdAt);
    if (sort === "top") {
      const byFirms = right.distinctFirmVoteCount - left.distinctFirmVoteCount;
      if (byFirms !== 0) return byFirms;
      const byVotes = right.voteCount - left.voteCount;
      if (byVotes !== 0) return byVotes;
      return Date.parse(right.createdAt) - Date.parse(left.createdAt);
    }
    const byScore = trendingScore(right, now) - trendingScore(left, now);
    if (byScore !== 0) return byScore;
    return Date.parse(right.lastActivityAt) - Date.parse(left.lastActivityAt);
  };
}
