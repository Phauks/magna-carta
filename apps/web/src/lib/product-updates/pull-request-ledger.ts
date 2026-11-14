/*
 * Every pull request merged to `main`, as the System Status page reads it.
 *
 * GENERATED, NEVER WRITTEN HERE. The rows come from docs/pull-request-ledger.json, which
 * tooling/doc-fragments/build-pull-request-ledger.mjs rebuilds from git history on `main` (the
 * assemble-docs workflow runs it after every merge that carries a changelog fragment). Each row is
 * one squash-merged pull request: its number, its commit, the day it landed, the parts of the
 * application its changed paths fall in, and the changelog fragment its author wrote, if any.
 *
 * Every merged pull request is here, not only the ones written up for members, so a deployed
 * commit can always be named. A pull request whose fragment was marked `audience: public` is
 * flagged as one members see.
 *
 * The document travels inside the build, so it needs no read and can only describe the build it is
 * part of. Only src/lib/versions/pull-request-lookup.ts imports this module, through a dynamic
 * import, so its text is never fetched with the shell.
 */
import { CHANGELOG_CATEGORIES, type ChangelogCategory } from "@magna-carta/product-updates/schema";
import { parseChangelogText, type ChangelogParagraph } from "./changelog-text.ts";
import ledgerDocument from "../../../../../docs/pull-request-ledger.json?raw";

/** The repository the ledger's numbers and commits belong to. */
export const REPOSITORY_URL = "https://github.com/Phauks/magna-carta";

/** A pull request that touched no part of the application a reader can see. */
export const BEHIND_THE_SCENES = "Behind the scenes";

/** A pull request merged without a changelog fragment has no category of its own. */
export const UNRECORDED = "Unrecorded";
export type PullRequestKind = ChangelogCategory | typeof UNRECORDED;
export const PULL_REQUEST_KINDS: readonly PullRequestKind[] = [...CHANGELOG_CATEGORIES, UNRECORDED];

/** One row as the generator writes it. */
export interface PullRequestLedgerRow {
  readonly number: number;
  readonly sha: string;
  readonly date: string;
  readonly title: string;
  readonly kind: string;
  readonly memberFacing: boolean;
  readonly areas: readonly string[];
  readonly entry: string;
}

/** One row as the screen draws it. */
export interface MergedPullRequest {
  readonly number: number;
  readonly sha: string;
  readonly shortSha: string;
  readonly date: string;
  readonly title: string;
  readonly kind: PullRequestKind;
  readonly memberFacing: boolean;
  /** Never empty: a pull request that touched no visible area is placed behind the scenes. */
  readonly areas: readonly string[];
  /** The changelog entry as paragraphs; empty when none was written. */
  readonly entry: readonly ChangelogParagraph[];
  readonly pullRequestUrl: string;
  readonly commitUrl: string;
  /** Title, number, commit and entry, lower-cased, for the search. */
  readonly searchText: string;
}

function isKind(kind: string): kind is PullRequestKind {
  return (PULL_REQUEST_KINDS as readonly string[]).includes(kind);
}

/** The screen's rows from the generator's, in the generator's order (newest first). */
export function toMergedPullRequests(rows: readonly PullRequestLedgerRow[]): MergedPullRequest[] {
  return rows.map((row) => ({
    number: row.number,
    sha: row.sha,
    shortSha: row.sha.slice(0, 7),
    date: row.date,
    title: row.title,
    kind: isKind(row.kind) ? row.kind : UNRECORDED,
    memberFacing: row.memberFacing,
    areas: row.areas.length === 0 ? [BEHIND_THE_SCENES] : row.areas,
    entry: row.entry.trim() === "" ? [] : parseChangelogText(row.entry),
    pullRequestUrl: `${REPOSITORY_URL}/pull/${row.number}`,
    commitUrl: `${REPOSITORY_URL}/commit/${row.sha}`,
    searchText: `${row.title} #${row.number} ${row.sha} ${row.entry}`.toLowerCase(),
  }));
}

/** Every merged pull request in the ledger built into this bundle, newest first. */
export function mergedPullRequests(): MergedPullRequest[] {
  return toMergedPullRequests(JSON.parse(ledgerDocument) as PullRequestLedgerRow[]);
}

/** Each value in `values` with how many rows carry it, most common first. */
export function countBy<Value extends string>(
  rows: readonly MergedPullRequest[],
  valuesOf: (row: MergedPullRequest) => readonly Value[],
): { value: Value; count: number }[] {
  const counts = new Map<Value, number>();
  for (const row of rows) {
    for (const value of valuesOf(row)) counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts]
    .map(([value, count]) => ({ value, count }))
    .toSorted((left, right) => right.count - left.count || left.value.localeCompare(right.value));
}
