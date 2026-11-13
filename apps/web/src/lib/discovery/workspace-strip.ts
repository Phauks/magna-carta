/*
 * The review workspace's top level.
 *
 * TWO ENTRIES, AND IT GROWS ONLY ON A DELIVERABLE. What the strip must never gain is an entry
 * holding an answer the document list already gives — everything excepted, everything from one
 * custodian, everything uncoded. Those are NARROWINGS, and a strip of them is pre-set filters
 * wearing the costume of destinations: a reader has to visit each one to find out whether it holds
 * anything, and two mechanisms then narrow the same list. The Custodian register's tab strip was
 * corrected for exactly this on 2026-09-01, and the correction binds here.
 *
 * The third entry the design first proposed — Records, for the corpus's deliverables — is not here
 * yet, and its absence is the same rule applied honestly. A load's manifest and exception report
 * belong to that LOAD: they are written at its completion and reconcile its declaration against
 * what arrived, so they render on the load. Until a deliverable exists that belongs to the review
 * set rather than to a load — the privilege log is the first — a Records entry would be a screen
 * that either shows those two artifacts a second time, away from the record they describe, or shows
 * nothing at all. A strip entry that is always empty is the same mistake as a menu of one.
 */
export interface WorkspaceEntry {
  /** The route segment under /discovery/review-sets/<id>/. */
  readonly slug: string;
  readonly label: string;
  /** One line: what a reader finds here. */
  readonly holds: string;
}

export const WORKSPACE_ENTRIES: readonly WorkspaceEntry[] = [
  {
    slug: "documents",
    label: "Documents",
    holds: "All documents in the review set, narrowed however you choose.",
  },
  {
    slug: "loads",
    label: "Loads",
    holds: "What arrived, how far it got, and the two records each delivery produced.",
  },
];

/** The entry an address is on, or undefined off one. */
export function workspaceEntryForPathname(
  reviewSetId: string,
  pathname: string,
): WorkspaceEntry | undefined {
  const root = `/discovery/review-sets/${reviewSetId}`;
  return WORKSPACE_ENTRIES.find(
    (entry) =>
      pathname === `${root}/${entry.slug}` || pathname.startsWith(`${root}/${entry.slug}/`),
  );
}
