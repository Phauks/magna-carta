// How "Trending" orders the board. Ranking counts DISTINCT FIRMS rather than raw votes, so twenty
// people at one firm cannot outvote five firms that each need the same thing, without taking the
// vote away from anyone (a paralegal's vote still counts toward the total shown).
//
// The score is a gravity-style decay over recent activity: firms supporting a post, divided by the
// square of how long it has been since anything happened on it. It is computed in SQL (see
// board-statements.ts) so the database sorts it, which is why the exponent is a plain square: SQLite's
// math functions are a compile-time option, and multiplication is not. This function is the same
// formula for tests and for any caller that ranks rows it already holds.
const HOUR_MILLISECONDS = 60 * 60 * 1000;

export function trendingScore(firmVoteCount: number, lastActivityAt: string, now: Date): number {
  const ageHours = Math.max(0, (now.getTime() - Date.parse(lastActivityAt)) / HOUR_MILLISECONDS);
  return (firmVoteCount + 1) / ((ageHours + 2) * (ageHours + 2));
}
