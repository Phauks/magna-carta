/*
 * Which remote branches have delivered their work and can go?
 *
 * WHY THIS EXISTS. `vp run worktrees` asks the landing question only over branches the registry
 * knows about — those with a workspace in this checkout or a note in docs/active-work. A branch
 * whose note was retired, or that never had one, is invisible to it. Nothing else looked, so remote
 * refs accumulated: 307 of them by 2026-08-25, of which 283 had landed.
 *
 * WHY NOT JUST ASK GIT. Because git's obvious answer is wrong here. This repository squash-merges,
 * so a landed branch is never an ancestor of main and `git branch --merged` reports almost nothing.
 * The merge-tree shortcut — merge the branch into main in memory and check the tree is unchanged —
 * is right only on the day it merges: once main touches any file the branch touched, it answers
 * "not landed" forever. Sampled against fourteen branches that provably landed, it got thirteen
 * wrong. This uses the walk-forward test in ../branch-landing instead, which asks WHERE the content
 * landed and therefore never expires.
 *
 * THIS COMMAND DELETES NOTHING. It prints two lists and the command that removes one branch. Bulk
 * deletion is the owner's call, and a branch reported here as landed may still be somebody's live
 * workspace on another machine — which is precisely what `vp run worktrees` is for.
 *
 * Run: `vp run stale-branches` (add --all to list the landed ones too).
 */
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { landedBranchesIn } from "../branch-landing/index.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const showLanded = process.argv.includes("--all");

function git(args) {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" });
}

const branches = git(["for-each-ref", "--format=%(refname:short)", "refs/remotes/origin/claude/*"])
  .split("\n")
  .filter(Boolean);

if (branches.length === 0) {
  console.log("No remote claude/* branches. Nothing to report.");
  process.exit(0);
}

const { landed, unresolved } = landedBranchesIn({ branches, cwd: ROOT });
const open = branches.filter((branch) => !landed.has(branch));
const short = (branch) => branch.replace(/^origin\//, "");

console.log(
  `${branches.length} remote claude/* branches: ${landed.size} landed, ${open.length} not.`,
);
if (unresolved.length > 0) {
  console.log(`\n${unresolved.length} could not be resolved to a ref — fetch, then re-run:`);
  for (const branch of unresolved) console.log("  " + short(branch));
}

console.log("\nNOT landed — each still holds work of its own, or is a live workspace:");
for (const branch of open) console.log("  " + short(branch));

if (showLanded) {
  console.log("\nLanded — their content is in main and the ref is all that remains:");
  for (const branch of branches.filter((b) => landed.has(b))) console.log("  " + short(branch));
} else if (landed.size > 0) {
  console.log(`\n${landed.size} landed branches not listed. Pass --all to see them.`);
}

console.log(
  "\nNothing was deleted. To retire one properly — its status fragments, its note, its worktree\n" +
    "and its branch, in one step — use: vp run retire-note <branch>\n" +
    "A landed branch can still be somebody's live workspace elsewhere: check `vp run worktrees` first.",
);
