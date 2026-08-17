// Can this change set move a type-check result?
//
// `vp run typecheck` is `tsc -b tsconfig.build.json tsconfig.test.json`. Both root solutions reference
// projects under `apps/` and `packages/` and nowhere else — 71 each, no other path prefix — so the type
// graph is reachable only from those two trees plus the manifests, configs and lockfile that decide what
// they resolve. Prose is not an input to it, and neither is anything under `docs/`.
//
// The predicate is deliberately written the hard way round: it enumerates what provably CANNOT reach the
// type graph, and the caller runs the type-check unless EVERY changed path is one of those. Deny by
// default. A new file extension, a new top-level directory, a config nobody anticipated — each takes the
// type-check rather than skipping it, because a false skip hands back a green gate for a diff nothing
// read, and that is far worse than a slow gate. Only entries that can be argued to be inert belong here,
// and each one carries the argument.
export const OUTSIDE_TYPE_GRAPH = [
  // Prose, anywhere in the repository. That covers every ledger fragment (`status.d/`, `changelog.d/`,
  // `roadmap.d/`, `docs/decisions/pending/`), every per-area `CLAUDE.md`, and every tracker rendered from
  // a fragment set (`STATUS.md`, `ROADMAP.md`, `CHANGELOG.md`). `resolveJsonModule` is on in
  // tsconfig.base.json, but there is no compiler option that makes markdown a module.
  /\.md$/,
  // The documentation tree, whatever the extension. No workspace package lives under `docs/`, so no
  // project is rooted there and no `include` glob reaches it; `docs/now.html` and
  // `docs/register-history.json` are generated renderings of the feature ledger, read by tooling only.
  /^docs\//,
  // The rendered status index. A root-level `.json`, so the `docs/` rule does not reach it, and it is
  // what `vp run status-build` writes beside `STATUS.md` — omitting it would mean any documentation
  // sweep that re-renders status still pays a full type-check, which is the exact case this exists for.
  // Nothing imports it: it is data for the status tooling.
  /^STATUS\.json$/,
];

/**
 * True when at least one changed path could be an input to `tsc -b` — which is the answer for an empty
 * change set too, since "nothing to go on" must not read as "nothing to check".
 *
 * @param {readonly string[]} files repo-relative paths, forward slashes.
 */
export function reachesTypeGraph(files) {
  if (files.length === 0) return true;
  return files.some((file) => !OUTSIDE_TYPE_GRAPH.some((pattern) => pattern.test(file)));
}

/**
 * The paths that made the answer `true`, capped — so the gate can name why it is type-checking instead
 * of asserting it, and a wrong answer is debuggable from the run that produced it.
 *
 * @param {readonly string[]} files repo-relative paths, forward slashes.
 * @param {number} limit how many to name.
 */
export function reachingPaths(files, limit = 3) {
  return files
    .filter((file) => !OUTSIDE_TYPE_GRAPH.some((pattern) => pattern.test(file)))
    .slice(0, limit);
}
