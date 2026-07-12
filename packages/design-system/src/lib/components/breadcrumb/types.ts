/**
 * One node in a breadcrumb path. Colocated in a plain module (not the .svelte) so the type can be
 * re-exported and imported by plain tsc; a `type` re-exported from a `*.svelte` file resolves only
 * under svelte-check.
 */
export type BreadcrumbEntry = {
  /** The visible label for this path segment. */
  label: string;
  /** Where the segment links to. Omit for the current page (the last entry) or an inert node. */
  href?: string;
};
