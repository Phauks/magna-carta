// `vp run worktrees` — print the active-work registry: every git worktree merged with the
// hand-authored stream notes in docs/active-work/, plus the touch-overlap surface. Read-only;
// nothing is written or committed, so the registry can never become a contended file itself.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { findOverlaps, parseNote } from "./parse-note.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const ACTIVE_DIR = join(ROOT, "docs/active-work");

function git(args) {
  return execFileSync("git", args, { cwd: ROOT }).toString();
}

function listWorktrees() {
  const worktrees = [];
  let current = null;
  for (const line of git(["worktree", "list", "--porcelain"]).split("\n")) {
    if (line.startsWith("worktree ")) {
      current = { path: line.slice("worktree ".length).trim(), branch: null, detached: false };
      worktrees.push(current);
    } else if (line.startsWith("branch ")) {
      current.branch = line.slice("branch ".length).trim().replace("refs/heads/", "");
    } else if (line.trim() === "detached") {
      current.detached = true;
    }
  }
  return worktrees;
}

function divergence(branch) {
  try {
    const ahead = Number.parseInt(git(["rev-list", "--count", `main..${branch}`]).trim(), 10);
    const behind = Number.parseInt(git(["rev-list", "--count", `${branch}..main`]).trim(), 10);
    return { ahead, behind };
  } catch {
    return { ahead: 0, behind: 0 };
  }
}

function loadNotes() {
  if (!existsSync(ACTIVE_DIR)) return [];
  return readdirSync(ACTIVE_DIR)
    .filter((name) => name.endsWith(".md") && name !== "README.md")
    .map((name) => parseNote(readFileSync(join(ACTIVE_DIR, name), "utf8")));
}

function isAgent(path) {
  return path.replace(/\\/g, "/").includes("/.claude/worktrees/");
}

const worktrees = listWorktrees();
const notesByBranch = new Map(loadNotes().map((note) => [note.branch, note]));

const feature = worktrees.filter((w) => !isAgent(w.path) && w.branch && w.branch !== "main");
const agents = worktrees.filter((w) => isAgent(w.path));

console.log("Active feature streams (branch · area · status · ahead/behind main):\n");
for (const w of feature) {
  const note = notesByBranch.get(w.branch);
  const { ahead, behind } = divergence(w.branch);
  const drift = behind > 20 ? `  [behind ${behind} — sync main]` : "";
  const scope = note
    ? `${note.area || "?"} · ${note.status || "?"}`
    : "(no note — add docs/active-work/" + w.branch + ".md)";
  console.log(`  ${w.branch}  —  ${scope}  ·  +${ahead}/-${behind}${drift}`);
}
if (agents.length > 0)
  console.log(`\n${agents.length} transient agent worktree(s) under .claude/worktrees/ (omitted).`);

const overlaps = findOverlaps([...notesByBranch.values()]);
if (overlaps.length > 0) {
  console.log("\nDeclared touch-overlaps (coordinate before editing):");
  for (const { path, branches } of overlaps) console.log(`  ${path}  ←  ${branches.join(", ")}`);
} else {
  console.log("\nNo declared touch-overlaps among streams with notes.");
}

const noteless = feature.filter((w) => !notesByBranch.has(w.branch)).map((w) => w.branch);
if (noteless.length > 0) {
  console.log(
    `\nStreams without a note: ${noteless.join(", ")}. Add docs/active-work/<branch>.md so others see your scope.`,
  );
}
