// Whether bootstrap is running against the checkout the caller meant, with the dependencies it needs.
//
// Both questions exist because of one real failure: `pnpm exec vp run bootstrap` in a worktree that has
// no node_modules exits 0 having built nothing in that worktree. `pnpm exec` resolves a missing binary
// by walking UP the directory tree, and worktrees live under `.claude/worktrees/` inside the main
// checkout — so `vp` is found in the PARENT checkout's node_modules, vp then takes that checkout as its
// workspace root, and `node tooling/bootstrap/index.mjs` runs there. The parent's artefacts are already
// current, so bootstrap prints "nothing to do" and succeeds. The worktree the developer is standing in
// is never touched, and the next command fails on a missing wasm import with no hint why.
//
// Nothing above this script can catch that: vp is the thing that mis-resolved, so vp cannot be the one
// to notice. The script can, because the two directories disagree — `process.cwd()` is the checkout vp
// chose, while the shell's own directory (PWD, or INIT_CWD under a package script) is the one the
// developer typed the command in. When they resolve to different checkouts, the run is against the
// wrong tree and the only safe outcome is to refuse and name the remedy.
//
// "Different checkouts" has to mean more than "not a path prefix": a worktree at
// <repo>/.claude/worktrees/x IS underneath <repo>, so a prefix test would call it part of the parent.
// What separates them is that each carries its own workspace manifest, so the question is which
// checkout ENCLOSES each directory, not which path contains which.

import { existsSync } from "node:fs";
import path from "node:path";

// The file that marks the root of a checkout of this monorepo. Every git worktree gets a full checkout,
// so every worktree has one — which is exactly what makes a sibling worktree distinguishable from a
// subdirectory of this checkout.
const WORKSPACE_MANIFEST = "pnpm-workspace.yaml";

/**
 * The checkout that encloses `directory`: the nearest ancestor (itself included) holding the workspace
 * manifest, or null when the path is not inside a checkout at all.
 */
export function enclosingCheckout(directory) {
  let current = path.resolve(directory);
  for (;;) {
    if (existsSync(path.join(current, WORKSPACE_MANIFEST))) return current;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

/**
 * Whether `checkout` has had its dependencies installed. `vite-plus` is the one every task in this repo
 * runs through, so its absence means nothing here can run yet — the state a freshly-created worktree is
 * in before `pnpm install`.
 */
export function dependenciesInstalled(checkout) {
  return existsSync(path.join(checkout, "node_modules", "vite-plus"));
}

/**
 * Why bootstrap must refuse, as a message the caller can act on — or null when the invocation is sound.
 *
 * `scriptRoot` is the checkout this script belongs to; `invokedFrom` is the directory the caller's shell
 * was in, which may be undefined (some shells do not export it), in which case the mismatch cannot be
 * proven and is not guessed at.
 */
export function refusalReason({ scriptRoot, invokedFrom }) {
  const standingIn = invokedFrom ? enclosingCheckout(invokedFrom) : null;
  if (standingIn !== null && path.resolve(standingIn) !== path.resolve(scriptRoot)) {
    return [
      `bootstrap: refusing to run — you are in ${standingIn}, but this is ${scriptRoot}'s bootstrap.`,
      `${standingIn} has no installed dependencies, so \`vp\` was resolved out of ${scriptRoot} and every`,
      `task ran against THAT checkout. Continuing would report success while ${standingIn}'s wasm`,
      `artefacts stay missing, and the next command there would fail on an unresolved import.`,
      ``,
      `Run \`pnpm install\` in ${standingIn} first, then \`vp run bootstrap\` there.`,
    ].join("\n");
  }
  if (!dependenciesInstalled(scriptRoot)) {
    return [
      `bootstrap: refusing to run — ${scriptRoot} has no installed dependencies (node_modules/vite-plus`,
      `is absent). Bootstrap exists to make a fresh worktree runnable, and building the wasm artefacts`,
      `alone does not get there: every test, type-check, and dev command still has nothing to run with.`,
      ``,
      `Run \`pnpm install\` first, then \`vp run bootstrap\`.`,
    ].join("\n");
  }
  return null;
}

/**
 * The directory the caller's shell was in, as distinct from the one this process was started in. `pnpm`
 * exports INIT_CWD for package scripts; POSIX shells export PWD. Undefined when neither is set, which
 * is a "cannot tell", not a "they match".
 */
export function callerDirectory(environment = process.env) {
  return environment.INIT_CWD ?? environment.PWD ?? undefined;
}
