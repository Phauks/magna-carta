import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { offTrunkReason } from "./build-register-history.mjs";

// WHERE THE BUILD REGISTER IS RENDERED, and where it is not.
//
// docs/now.md, docs/now.html and docs/decisions-open.html are rendered from roadmap.d/ on the trunk,
// by the per-merge assembly workflow or the weekly docs-sync routine, and never on a feature branch.
// They used to be rendered on every branch that flipped a node, and that is what made them collide:
// two branches that each flipped one node both rewrote the whole document, and fifteen of forty
// merges in a row conflicted on a file nobody had written by hand. A branch's whole change to the
// register is its edit to the ledger; the rendering follows on main.
//
// Two branches ARE the renderer and may write the files off the trunk: the assembly workflow's
// `docs-assembly` branch and the routine's `docs-sync/<date>` branches. Named by shape here, once,
// so the builder and the lint agree about who renders.

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
export const RENDERED_REGISTER_FILES = ["docs/now.md", "docs/now.html", "docs/decisions-open.html"];
const RENDERER_BRANCH = /^(docs-sync\/|docs-assembly$)/u;

function branchName(root, ref) {
  try {
    return execFileSync("git", ["rev-parse", "--abbrev-ref", ref], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

/** Why the register must not be rendered here, or null where this ref renders it. */
export function registerRenderRefusal(root = ROOT, ref = "HEAD") {
  const offTrunk = offTrunkReason(root, ref);
  if (offTrunk === null) return null;
  if (RENDERER_BRANCH.test(branchName(root, ref))) return null;
  return `${offTrunk}: the register renders on main (the assembly workflow, else the docs-sync routine), and a branch's change is its edit to roadmap.d/ alone`;
}

/**
 * The rendered register files this branch changed against where it left the trunk, or null where
 * the trunk cannot be found. A branch that carries a change to any of them is the collision this
 * module exists to end.
 */
export function renderedFilesChangedOnBranch(root = ROOT) {
  let base;
  try {
    base = execFileSync("git", ["merge-base", "HEAD", "origin/main"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
  try {
    const changed = execFileSync(
      "git",
      ["diff", "--name-only", base, "--", ...RENDERED_REGISTER_FILES],
      { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    )
      .split("\n")
      .filter((line) => line !== "");
    return changed;
  } catch {
    return null;
  }
}
