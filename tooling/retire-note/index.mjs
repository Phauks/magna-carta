// `vp run retire-note <branch>` — end a stream in one operation.
//
// The worktree lifecycle in the root CLAUDE.md has always read as three parts: remove the worktree,
// delete the branch, delete docs/active-work/<branch>.md. It has a fourth, and nobody wrote it down —
// any status.d/ fragment carrying `active-work: docs/active-work/<branch>.md` now points at a file that
// is gone, and `pnpm run lint:status` fails with "active-work points at a missing file". The fourth
// part is invisible from where the work happens: nothing in docs/active-work/ knows who references it,
// so the only way to find out is to think of grepping, and thinking of it is the step that fails.
//
// So this does all four, and the order is chosen so no intermediate state is broken: clear the
// pointers, re-render STATUS, delete the note, and only then touch the workspace. The pointer cannot
// outlive the note because the same command removes both.
//
// Retiring a stream whose work has not reached the trunk is a different act from tidying up after one
// that has, and only the second is safe to do without being asked, so a landing check
// (tooling/branch-landing) guards it rather than a prompt. `--force` says you meant it,
// `--keep-workspace` retires the paperwork and leaves the worktree and branch alone, `--dry-run` prints
// the plan and writes nothing.
//
// `--with-merge` is the everyday case: retire the note IN the pull request that lands the work,
// rather than in a second merge afterwards whose only content is the deletion. On this repository a
// merge to `main` deploys, so that second merge is a production deploy to delete one file. The
// deletion is a commit on the branch, so it reaches `main` exactly when the work does and `main`
// keeps the note for as long as the pull request is open — which is why the landing check is not the
// right guard there, and being on the branch is. ./dependents.mjs holds that reasoning in full. It
// does the paperwork only: removing a worktree and deleting a branch cannot happen from inside that
// branch, so the workspace half stays a later, local step and keeps its landing check.
//
// Usage: node tooling/retire-note/index.mjs <branch> [--with-merge] [--dry-run] [--force] [--keep-workspace]

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { landedBranchesIn, listWorktrees } from "../branch-landing/index.mjs";
import { build } from "../doc-fragments/build-status.mjs";
import { planRetirement, retirementRefusal } from "./dependents.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const ACTIVE_DIR = join(ROOT, "docs/active-work");
const FRAGMENT_DIR = join(ROOT, "status.d");
const RESERVED = new Set(["_sections.md", "README.md"]);

const argv = process.argv.slice(2);
const flags = new Set(argv.filter((argument) => argument.startsWith("--")));
const branch = argv.find((argument) => !argument.startsWith("--"));
const dryRun = flags.has("--dry-run");
const force = flags.has("--force");
const withMerge = flags.has("--with-merge");
// --with-merge cannot touch the workspace: it runs ON the branch, and a branch cannot delete itself.
const keepWorkspace = flags.has("--keep-workspace") || withMerge;

if (branch === undefined) {
  console.error(
    "retire-note: name the branch whose stream is finished, e.g.\n" +
      "  vp run retire-note claude/some-branch --with-merge   # in the pull request that lands it\n" +
      "  vp run retire-note claude/some-branch                # after it landed, to clear the workspace\n" +
      "  flags: --with-merge, --dry-run, --force (branch has not landed), --keep-workspace",
  );
  process.exit(1);
}

const notePath = `docs/active-work/${branch}.md`;
const noteAbsolute = join(ROOT, notePath);

// Every status fragment, read once. The note may already be gone — a half-done retirement is exactly
// the state this exists to repair — so a missing note is not fatal on its own; a missing note with no
// dependents is.
const fragments = readdirSync(FRAGMENT_DIR, { recursive: true })
  .map(String)
  .filter((name) => name.endsWith(".md") && !RESERVED.has(name))
  .map((name) => ({
    path: `status.d/${name.replace(/\\/g, "/")}`,
    text: readFileSync(join(FRAGMENT_DIR, name), "utf8"),
  }));

const { dependents } = planRetirement({ notePath, fragments });
const noteExists = existsSync(noteAbsolute);

// Which streams still have a workspace here, which branch HEAD is on, and has this one's work
// reached the trunk? Asked once, before anything is written, so a refusal costs nothing.
const worktreeHere = listWorktrees(ROOT).find((worktree) => worktree.branch === branch);
const headBranch = git(["rev-parse", "--abbrev-ref", "HEAD"], { capture: true })?.trim() ?? null;
const { landed, unresolved } = landedBranchesIn({ branches: [branch], cwd: ROOT });
const hasLanded = landed.has(branch);
const branchUnknown = unresolved.includes(branch);

console.log(`retire-note: ${branch}`);
console.log(`  note:        ${noteExists ? notePath : `${notePath} (already gone)`}`);
console.log(
  `  landed:      ${branchUnknown ? "unknown — no ref resolves for this branch" : hasLanded ? "yes" : "no"}`,
);
console.log(
  `  dependents:  ${
    dependents.length === 0
      ? "none — no status fragment points at this note"
      : dependents.map((dependent) => dependent.path).join(", ")
  }`,
);
console.log(`  workspace:   ${worktreeHere ? worktreeHere.path : "not checked out here"}`);
console.log(
  `  mode:        ${
    withMerge
      ? `paperwork only, carried by this branch's own merge (HEAD: ${headBranch ?? "detached"})`
      : keepWorkspace
        ? "paperwork only"
        : "paperwork + workspace"
  }`,
);

// Deleting the note of a stream still in flight erases the one warning other worktrees get about it,
// and it is not undone by re-creating the file — the point of the note is that it was there while the
// work was. The rules, and why --with-merge is judged differently, are in ./dependents.mjs.
const refusal = retirementRefusal({
  branch,
  withMerge,
  force,
  hasLanded,
  branchUnknown,
  headBranch,
  noteExists,
  dependentCount: dependents.length,
  hasWorkspace: worktreeHere !== undefined,
});
if (refusal !== null) {
  console.error(`\nretire-note: refusing — ${refusal}`);
  process.exit(1);
}

const actions = [];
for (const dependent of dependents) {
  actions.push({
    what: `clear the active-work pointer in ${dependent.path} (was ${dependent.pointer})`,
    run: () => writeFileSync(join(ROOT, dependent.path), dependent.text),
  });
}
if (dependents.length > 0) {
  actions.push({
    what: "re-render STATUS.md + STATUS.json from status.d/",
    run: () => build(),
  });
}
if (noteExists) {
  actions.push({ what: `delete ${notePath}`, run: () => rmSync(noteAbsolute) });
}
if (worktreeHere && !keepWorkspace) {
  actions.push({
    what: `git worktree remove ${relative(ROOT, worktreeHere.path) || worktreeHere.path}`,
    // No --force: a worktree holding uncommitted work must block this, loudly, rather than lose it.
    run: () => git(["worktree", "remove", worktreeHere.path]),
  });
  // -D rather than -d, because this repository squash-merges: a landed branch is never an ancestor of
  // main, so -d refuses every branch this command is for. The landing check above is what makes that
  // safe — it is a real answer about where the work went, not an ancestry test.
  actions.push({ what: `git branch -D ${branch}`, run: () => git(["branch", "-D", branch]) });
}

console.log("");
if (dryRun) {
  console.log("retire-note: --dry-run, nothing written. Would:");
  for (const action of actions) console.log(`  - ${action.what}`);
  process.exit(0);
}

for (const action of actions) {
  console.log(`  ${action.what}`);
  action.run();
}

// The gate this whole command exists to keep green, run here so a retirement cannot be reported as
// done while the state it leaves behind fails. Its own output names any remaining problem.
const lint = spawnSync("node", ["tooling/lint-status.mjs"], {
  cwd: ROOT,
  stdio: "inherit",
  shell: process.platform === "win32",
});
if (lint.status !== 0) {
  console.error("\nretire-note: lint:status is not clean after retirement — see above.");
  process.exit(1);
}
console.log(
  withMerge
    ? `\nretire-note: ${branch}'s paperwork retired. Commit the deletion, any cleared fragment, and ` +
        "STATUS.md/STATUS.json with the work this pull request lands — the note stays on main until " +
        `it merges.\n  Afterwards, \`vp run retire-note ${branch}\` clears the worktree and branch.`
    : `\nretire-note: ${branch} retired. Commit the deletion, any cleared fragment, and STATUS.md/STATUS.json together.`,
);

function git(args, { capture = false } = {}) {
  if (!capture) {
    return execFileSync("git", args, { cwd: ROOT, stdio: ["ignore", "inherit", "inherit"] });
  }
  // Reading HEAD must never be the thing that fails a retirement: a detached HEAD, or a repository
  // git cannot answer for, reads as "no branch", which the guard then refuses on its own terms.
  try {
    return execFileSync("git", args, {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return null;
  }
}
