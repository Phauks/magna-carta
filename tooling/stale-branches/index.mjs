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
 * WHY THE HISTORY HAS TO BE COMPLETE. The walk-forward test starts from `git merge-base`, so a
 * clone whose history is truncated cannot find the fork point and every branch falls through to
 * "not landed". That failure is silent and it looks exactly like a real answer: in a clone cut to
 * fifty commits this command reported 42 landed of 321, against a true 297. A shallow clone is
 * therefore refused outright rather than answered, because the number it would print is worse than
 * no number — somebody would believe it.
 *
 * WHAT THE THREE ANSWERS MEAN. "Landed" is a content fact: the branch's work is in main and the ref
 * is all that remains. "Nothing of its own" is a different fact that reads the same from a distance
 * — the branch holds no commit main lacks, so deleting it cannot lose work either, but it may be a
 * workspace somebody cut off the trunk and has not committed in yet, which is why it is counted
 * apart rather than folded in with the landed ones. Only the third list, branches holding commits
 * of their own, is work that would actually be lost.
 *
 * THIS COMMAND DELETES NOTHING. It prints the lists and the command that removes one branch. Bulk
 * deletion is the owner's call, and a branch reported here may still be somebody's live workspace on
 * another machine — which is precisely what `vp run worktrees` is for. It reads git only, so it
 * cannot see an open pull request either: check that before removing anything.
 *
 * Run: `vp run stale-branches` (add --all to list the landed ones too).
 */
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { baselineRef, landedBranchesIn } from "../branch-landing/index.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const showLanded = process.argv.includes("--all");

// Never cleanup candidates, whatever the landing test says about them. `main` is the trunk the
// question is asked against, and `release` is kept deliberately: it stopped gating deploys when
// main became production and survives as the history of what was released through it.
const PROTECTED_BRANCHES = new Set(["origin/main", "origin/release", "origin/HEAD"]);

function git(args) {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" });
}

function nonEmptyLines(output) {
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

const shortName = (branch) => branch.replace(/^origin\//, "");

// The same trunk ref the landing test measures against, so the two halves of this report cannot
// disagree about what "already in main" means.
const baseline = baselineRef(ROOT);

// A truncated history cannot answer this question, so refuse rather than print a plausible wrong
// number. See the header: the failure mode is silent and the numbers look real.
if (git(["rev-parse", "--is-shallow-repository"]).trim() === "true") {
  console.error(
    "This clone is shallow, so the landing test cannot find where any branch forked from main\n" +
      "and would report almost every branch as unlanded. Complete the history first:\n\n" +
      "  git fetch --unshallow --prune\n",
  );
  process.exit(1);
}

const branches = nonEmptyLines(
  git(["for-each-ref", "--format=%(refname:short)", "refs/remotes/origin"]),
).filter((branch) => !PROTECTED_BRANCHES.has(branch));

if (branches.length === 0) {
  console.log("No remote branches besides the protected ones. Nothing to report.");
  process.exit(0);
}

// How many commits the branch has that main does not. Zero means deleting the ref cannot lose
// work whatever the content test says, so those branches are separated before the question is
// asked — the landing test declines to answer for them, by the same predicate, and folding its
// silence in with a real "not landed" is what made four spent refs read as unfinished work.
function uniqueCommitCount(branch) {
  return Number(git(["rev-list", "--count", `${baseline}..${branch}`]).trim());
}

function commitsBehind(branch) {
  return git(["rev-list", "--count", `${branch}..${baseline}`]).trim();
}

function lastCommitDate(branch) {
  return git(["log", "-1", "--format=%cd", "--date=short", branch]).trim();
}

const holdsNothing = [];
const candidates = [];
for (const branch of branches) {
  if (uniqueCommitCount(branch) === 0) holdsNothing.push(branch);
  else candidates.push(branch);
}

const { landed, unresolved } = landedBranchesIn({ branches: candidates, cwd: ROOT });
const holdsWork = candidates.filter((branch) => !landed.has(branch));

console.log(
  `${branches.length} remote branches (main and release excluded): ${landed.size} landed, ` +
    `${holdsNothing.length} holding nothing of their own, ${holdsWork.length} holding work.`,
);

if (unresolved.length > 0) {
  console.log(`\n${unresolved.length} could not be resolved to a ref — fetch, then re-run:`);
  for (const branch of unresolved) console.log("  " + shortName(branch));
}

console.log(
  "\nHOLDING WORK — commits of their own that are not in main. Read each before removing it:",
);
for (const branch of holdsWork) {
  console.log(
    `  ${shortName(branch).padEnd(50)} ${String(uniqueCommitCount(branch)).padStart(3)} commits, ` +
      `${commitsBehind(branch).padStart(4)} behind, last ${lastCommitDate(branch)}`,
  );
}

console.log(
  "\nNOTHING OF THEIR OWN — main already contains every commit these point at, so removing one\n" +
    "loses nothing. A freshly cut workspace looks the same, so check the distance before removing:",
);
for (const branch of holdsNothing) {
  console.log(
    `  ${shortName(branch).padEnd(50)} ${commitsBehind(branch).padStart(4)} behind, ` +
      `last ${lastCommitDate(branch)}`,
  );
}

if (showLanded) {
  console.log("\nLANDED — their content is in main and the ref is all that remains:");
  for (const branch of candidates.filter((b) => landed.has(b)))
    console.log("  " + shortName(branch));
} else if (landed.size > 0) {
  console.log(`\n${landed.size} landed branches not listed. Pass --all to see them.`);
}

console.log(
  "\nNothing was deleted. To retire one properly — its status fragments, its note, its worktree\n" +
    "and its branch, in one step — use: vp run retire-note <branch>\n" +
    "A branch listed here can still be somebody's live workspace elsewhere, or carry an open pull\n" +
    "request this command cannot see: check `vp run worktrees` and the open pull requests first.",
);
