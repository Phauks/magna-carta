// Which commit "the change" is measured from.
//
// The obvious answer — the merge-base with `main` — is wrong in any worktree whose local `main` is not
// kept up to date. Agent worktrees are created from a clone whose `main` ref is frozen at clone time
// while `origin/main` keeps moving, so a merge-base against local `main` lands hundreds of commits
// behind and the scoped gate stops being scoped: it lints every file touched since that ancient point,
// which is both slow and noisy about code the current change never touched (a few hundred files is also
// enough to take the linter down with it).
//
// So the base is the NEWEST of the merge-bases the trunk refs offer, not the first ref that happens to
// resolve. When local `main` is current the two candidates agree and nothing changes; when it is stale,
// `origin/main` wins because its merge-base is a descendant of the stale one. A ref that does not exist
// (a clone with no remote, a worktree with no local `main`) simply contributes no candidate, and with no
// candidates at all the previous fallback still applies.

/** The trunk refs a merge-base is worth computing against, in no significant order. */
export const TRUNK_REFS = ["origin/main", "main"];

/** Used when no trunk ref resolves at all — the last commit is better than nothing to diff against. */
export const NO_TRUNK_FALLBACK = "HEAD~1";

/**
 * @param {object} options
 * @param {string|null} options.explicitBase  `--base <ref>`, which always wins.
 * @param {(ref: string) => string|null} options.mergeBaseWith  merge-base of HEAD and `ref`, or null
 *   when the ref does not resolve in this worktree.
 * @param {(ancestor: string, descendant: string) => boolean} options.isAncestor  whether the first
 *   commit is an ancestor of the second.
 * @param {readonly string[]} [options.refs]
 * @returns {string} the commit the diff is taken from.
 */
export function resolveDiffBase({
  explicitBase,
  mergeBaseWith,
  isAncestor,
  refs = TRUNK_REFS,
  fallback = NO_TRUNK_FALLBACK,
}) {
  if (explicitBase) return explicitBase;

  const candidates = [];
  for (const ref of refs) {
    const base = mergeBaseWith(ref);
    if (base && !candidates.includes(base)) candidates.push(base);
  }
  if (candidates.length === 0) return fallback;

  // The newest candidate is the one every other candidate is an ancestor of. Comparing by ancestry
  // rather than by commit date is what makes this correct: a rebased or amended commit can carry an
  // author date older than a commit it descends from, and only ancestry says which base actually
  // contains the other. Candidates on unrelated histories cannot be ordered, so the first one stands.
  let newest = candidates[0];
  for (const candidate of candidates.slice(1)) {
    if (isAncestor(newest, candidate)) newest = candidate;
  }
  return newest;
}
