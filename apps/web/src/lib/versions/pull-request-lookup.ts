/*
 * Which merged pull request a deployed commit is, and how far apart two deployed commits are, read
 * from the merged-pull-request ledger this build carries (docs/pull-request-ledger.json).
 *
 * The ledger is large, so only the System Status page reaches this module, and it does so through
 * a dynamic import: the header chip is on every screen and must not carry it.
 *
 * The ledger is as old as this web build. A commit newer than the build — the API deployed after
 * the interface — is simply not in it, and the answer says "not in this build's ledger" by being
 * null rather than by guessing.
 */
import { mergedPullRequests } from "$lib/product-updates/pull-request-ledger.ts";

export interface DeployedPullRequest {
  readonly number: number;
  readonly title: string;
  readonly url: string;
}

export interface PullRequestLookup {
  /** The pull request whose merge produced this commit, by full or short hash. */
  pullRequestFor(commit: string | null): DeployedPullRequest | null;
  /**
   * How many merges `behind` trails `ahead` by, or null when either is not in the ledger. Zero when
   * they are the same merge; negative when `behind` is in fact the newer one.
   */
  mergesBetween(ahead: string | null, behind: string | null): number | null;
}

export function createPullRequestLookup(): PullRequestLookup {
  // Newest first, as the ledger is written.
  const rows = mergedPullRequests();
  const indexOf = (commit: string | null): number => {
    if (commit === null || commit.length < 7) return -1;
    const needle = commit.toLowerCase();
    return rows.findIndex((row) => row.sha.startsWith(needle));
  };
  return {
    pullRequestFor(commit) {
      const index = indexOf(commit);
      if (index < 0) return null;
      const row = rows[index];
      if (row === undefined) return null;
      return { number: row.number, title: row.title, url: row.pullRequestUrl };
    },
    mergesBetween(ahead, behind) {
      const aheadIndex = indexOf(ahead);
      const behindIndex = indexOf(behind);
      if (aheadIndex < 0 || behindIndex < 0) return null;
      return behindIndex - aheadIndex;
    },
  };
}
