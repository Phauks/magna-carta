# Auto-clean build artifacts — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reclaim regenerable build artifacts and dangling Docker cache automatically when a branch lands in `main`, so the dev disk stops filling with dead build output.

**Architecture:** A pure selection module (`tooling/clean/select.mjs`) decides which worktrees and directories may be deleted; an orchestrator (`tooling/clean/index.mjs`, exposed as `vp run clean`) walks the filesystem, confirms each candidate is git-ignored, deletes it, and prunes Docker. A tracked `post-merge` git hook — guarded on the current branch being `main` — runs the orchestrator on merge. Installation is a one-time `vp run setup-hooks` that points `core.hooksPath` at the tracked hooks dir.

**Tech Stack:** Node.js (ESM `.mjs`, same style as `tooling/worktrees/`), Vitest, POSIX `sh` git hook, `vite-plus` (`vp`) run-tasks, `git`, `docker`.

## Global Constraints

- **No process-artifact citations in source/tests/config** — no `ADR-NNNN`, "design spec", "implementation plan", "spec §", "white-paper", or "spike" in any `.mjs`/`.ts`/config file. Enforced by `pnpm run lint:process-refs`. Comments explain reasoning inline or point to a file by path. (Golden rule 13)
- **Spell names in full** — no shorthand (`identifier` not `id` beyond universal externals). (Golden rule 12)
- **Formatter:** Oxfmt, `printWidth: 100`, LF line endings. Run `vp check` before committing.
- **Delete only git-ignored directories** — every deletion candidate must pass `git check-ignore` before removal. Never delete `node_modules`, tracked source, or a worktree directory itself.
- **Cleanup never fails a merge** — the hook always exits 0; Docker steps are best-effort and degrade to a logged skip.
- **Docs same commit** — CLAUDE.md, a `changelog.d/` fragment, and a `docs/decisions/pending/` ADR fragment land with the code. (Golden rule 5)
- **Node scripts mirror `tooling/worktrees/`** — `execFileSync` for git, parse `--porcelain`, pure logic split into a sibling module with `.test.mjs` + `vitest.config.ts`.

---

## File Structure

- `tooling/clean/select.mjs` — **pure** selection logic: `ARTIFACT_DIRS`, `normalizePath`, `eligibleWorktrees`, `isArtifactDir`. No I/O. The safety-critical decisions live here so they are unit-testable.
- `tooling/clean/select.test.mjs` — unit tests for the pure logic.
- `tooling/clean/vitest.config.ts` — Vitest project config (named `clean`).
- `tooling/clean/index.mjs` — orchestrator (`vp run clean`): git queries, filesystem walk + `check-ignore`, deletion, size report, Docker prune, arg parsing (`--dry-run`, `--all-worktrees`).
- `tooling/git-hooks/post-merge` — POSIX `sh` hook, guarded on `main`, invokes the orchestrator.
- `vite.config.ts` — register the `clean` and `setup-hooks` run-tasks and the `tooling/clean/vitest.config.ts` test project (modify).
- `CLAUDE.md` — Worktree-lifecycle + Commands updates (modify).
- `changelog.d/auto-clean-build-artifacts.md` — changelog fragment (create).
- `docs/decisions/pending/auto-clean-build-artifacts-on-merge.md` — ADR fragment (create).

---

## Task 1: Pure selection module + tests

**Files:**

- Create: `tooling/clean/select.mjs`
- Test: `tooling/clean/select.test.mjs`
- Create: `tooling/clean/vitest.config.ts`
- Modify: `vite.config.ts` (add `tooling/clean/vitest.config.ts` to `test.projects`)

**Interfaces:**

- Produces:
  - `ARTIFACT_DIRS: string[]` — `["target", ".svelte-kit", ".wrangler", ".vite", "dist", "build", "coverage"]`
  - `normalizePath(path: string): string` — forward slashes, lowercase drive letter, no trailing slash
  - `eligibleWorktrees({ worktrees, currentPath, mergedBranches, allWorktrees }): Array<{path, branch, detached}>`
    - `worktrees`: `Array<{ path: string, branch: string|null, detached: boolean }>`
    - `currentPath: string`, `mergedBranches: Set<string>`, `allWorktrees: boolean`
  - `isArtifactDir(name: string): boolean`

- [ ] **Step 1: Write the failing test**

Create `tooling/clean/select.test.mjs`:

```js
import { describe, expect, it } from "vitest";
import { eligibleWorktrees, isArtifactDir, normalizePath } from "./select.mjs";

const WORKTREES = [
  { path: "C:/dev/magna-carta-worktrees/main-merge", branch: "main", detached: false },
  {
    path: "C:/dev/magna-carta-worktrees/feature-merged",
    branch: "feature-merged",
    detached: false,
  },
  { path: "C:/dev/magna-carta-worktrees/feature-open", branch: "feature-open", detached: false },
  { path: "C:/dev/magna-carta-worktrees/detached", branch: null, detached: true },
  { path: "C:/dev/magna-carta", branch: "current-branch", detached: false },
];

const base = {
  worktrees: WORKTREES,
  currentPath: "C:/dev/magna-carta",
  mergedBranches: new Set(["feature-merged"]),
};

describe("eligibleWorktrees", () => {
  it("sweeps merged, non-current, non-main worktrees only", () => {
    const got = eligibleWorktrees({ ...base, allWorktrees: false }).map((w) => w.branch);
    expect(got).toEqual(["feature-merged"]);
  });

  it("with allWorktrees includes open branches but never main, current, or detached", () => {
    const got = eligibleWorktrees({ ...base, allWorktrees: true }).map((w) => w.branch);
    expect(got).toEqual(["feature-merged", "feature-open"]);
  });

  it("matches the current worktree regardless of slash or drive-letter case", () => {
    const got = eligibleWorktrees({
      ...base,
      currentPath: "c:\\dev\\magna-carta",
      allWorktrees: true,
    }).map((w) => w.branch);
    expect(got).not.toContain("current-branch");
  });
});

describe("normalizePath", () => {
  it("uses forward slashes, a lowercase drive letter, and no trailing slash", () => {
    expect(normalizePath("C:\\dev\\Foo\\")).toBe("c:/dev/Foo");
  });
});

describe("isArtifactDir", () => {
  it("accepts regenerable build dirs and rejects source dirs", () => {
    expect(isArtifactDir("target")).toBe(true);
    expect(isArtifactDir(".svelte-kit")).toBe(true);
    expect(isArtifactDir("src")).toBe(false);
  });
});
```

Also create `tooling/clean/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "clean",
    root: import.meta.dirname,
    include: ["**/*.test.mjs"],
  },
});
```

- [ ] **Step 2: Register the test project**

In `vite.config.ts`, add the new project to the `test.projects` array (after the `tooling/worktrees/vitest.config.ts` entry):

```ts
    projects: [
      "apps/worker/vitest.config.ts",
      "packages/*/vitest.config.ts",
      "tooling/doc-fragments/vitest.config.ts",
      "tooling/worktrees/vitest.config.ts",
      "tooling/clean/vitest.config.ts",
    ],
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm vitest run --project clean`
Expected: FAIL — `Cannot find module './select.mjs'`.

- [ ] **Step 4: Write the implementation**

Create `tooling/clean/select.mjs`:

```js
// Pure selection logic for the build-artifact cleaner (tooling/clean/index.mjs). Kept free of I/O
// so the rules that decide WHICH worktrees and directories may be deleted — the safety-critical
// part of the cleaner — are unit-testable in isolation.

// Regenerable build-output directory names. Every one is git-ignored (see .gitignore and the
// per-crate .gitignore for `target`); the orchestrator additionally confirms each candidate is
// ignored before deleting, so a tracked directory that happens to share one of these names is
// never removed.
export const ARTIFACT_DIRS = [
  "target",
  ".svelte-kit",
  ".wrangler",
  ".vite",
  "dist",
  "build",
  "coverage",
];

// Normalize a filesystem path for cross-worktree comparison: forward slashes, lowercase drive
// letter, no trailing slash. Git emits forward-slash paths; the OS may hand us backslashes —
// normalize both before comparing.
export function normalizePath(path) {
  let normalized = path.replace(/\\/g, "/").replace(/\/+$/, "");
  if (/^[A-Za-z]:/.test(normalized)) {
    normalized = normalized[0].toLowerCase() + normalized.slice(1);
  }
  return normalized;
}

// Decide which worktrees may have their artifacts swept. Never the current worktree, never main,
// never a detached HEAD; otherwise included when allWorktrees is set, or when the branch is merged
// into main.
export function eligibleWorktrees({ worktrees, currentPath, mergedBranches, allWorktrees }) {
  const current = normalizePath(currentPath);
  return worktrees.filter((worktree) => {
    if (!worktree.branch || worktree.detached) return false;
    if (worktree.branch === "main") return false;
    if (normalizePath(worktree.path) === current) return false;
    return allWorktrees ? true : mergedBranches.has(worktree.branch);
  });
}

// Is `name` one of the regenerable artifact directory names?
export function isArtifactDir(name) {
  return ARTIFACT_DIRS.includes(name);
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm vitest run --project clean`
Expected: PASS — 5 tests.

- [ ] **Step 6: Lint + format**

Run: `pnpm run lint:process-refs && vp check`
Expected: both pass (no process-artifact references; no fmt/lint errors).

- [ ] **Step 7: Commit**

```bash
git add tooling/clean/select.mjs tooling/clean/select.test.mjs tooling/clean/vitest.config.ts vite.config.ts
git commit -m "feat(tooling): pure selection logic for the build-artifact cleaner"
```

---

## Task 2: The clean orchestrator (`vp run clean` script)

**Files:**

- Create: `tooling/clean/index.mjs`

**Interfaces:**

- Consumes (from Task 1): `ARTIFACT_DIRS`, `eligibleWorktrees`, `isArtifactDir`, `normalizePath` from `./select.mjs`
- Produces: an executable Node entrypoint. Behaviour: `node tooling/clean/index.mjs [--dry-run] [--all-worktrees]` prints a report and (unless `--dry-run`) deletes git-ignored artifact dirs in eligible worktrees and prunes dangling Docker cache.

- [ ] **Step 1: Write the implementation**

Create `tooling/clean/index.mjs`:

```js
// Reclaim regenerable build output and dangling Docker cache. Runs on demand (`vp run clean`) and
// automatically from the tracked post-merge hook when a branch lands in main
// (tooling/git-hooks/post-merge). Deletes ONLY git-ignored artifact directories (target/,
// .svelte-kit, .wrangler, .vite, dist, build, coverage) inside worktrees whose branch is merged
// into main — never the active worktree, never node_modules, never tracked source. The
// git check-ignore confirmation is the safety net: a directory that merely shares an artifact name
// but is tracked is never removed. Flags: --dry-run (report only), --all-worktrees (sweep every
// worktree except the current one — still git-ignored dirs only).
import { execFileSync } from "node:child_process";
import { readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { eligibleWorktrees, isArtifactDir, normalizePath } from "./select.mjs";

const flags = new Set(process.argv.slice(2));
const dryRun = flags.has("--dry-run");
const allWorktrees = flags.has("--all-worktrees");

function git(args, cwd = process.cwd()) {
  return execFileSync("git", args, { cwd }).toString();
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

function mergedBranches() {
  const branches = new Set();
  const output = git(["branch", "--merged", "main", "--format=%(refname:short)"]);
  for (const line of output.split("\n")) {
    const name = line.trim();
    if (name) branches.add(name);
  }
  return branches;
}

// True when `path` is git-ignored. check-ignore is run with cwd inside the target worktree so the
// query resolves against that worktree's ignore rules, not the caller's.
function isIgnored(path, cwd) {
  try {
    execFileSync("git", ["check-ignore", "-q", path], { cwd });
    return true;
  } catch {
    return false;
  }
}

// Collect git-ignored artifact directories under `root`, without descending into node_modules,
// .git, or a directory already matched (no need to walk inside target/). Returns absolute paths.
function findArtifactDirs(root) {
  const found = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      const full = join(dir, entry.name);
      if (isArtifactDir(entry.name) && isIgnored(full, root)) {
        found.push(full);
        continue;
      }
      walk(full);
    }
  };
  walk(root);
  return found;
}

function directorySize(path) {
  let total = 0;
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else {
        try {
          total += statSync(full).size;
        } catch {
          // A temp file vanishing mid-walk is fine; count it as zero.
        }
      }
    }
  };
  try {
    walk(path);
  } catch {
    // An unreadable directory contributes zero.
  }
  return total;
}

function gibibytes(bytes) {
  return `${(bytes / 1024 ** 3).toFixed(2)} GiB`;
}

function dockerPrune() {
  let output = "";
  try {
    output += execFileSync("docker", ["builder", "prune", "-f"]).toString();
    output += execFileSync("docker", ["image", "prune", "-f"]).toString();
  } catch (error) {
    return error.code === "ENOENT"
      ? "  docker not installed — skipped"
      : "  docker unavailable — skipped";
  }
  const totals = output.match(/Total reclaimed space: .*/g) || [];
  return totals.length > 0 ? totals.map((line) => `  ${line}`).join("\n") : "  nothing to reclaim";
}

const currentPath = normalizePath(git(["rev-parse", "--show-toplevel"]).trim());
const targets = eligibleWorktrees({
  worktrees: listWorktrees(),
  currentPath,
  mergedBranches: mergedBranches(),
  allWorktrees,
});

console.log(dryRun ? "clean (dry-run — nothing will be deleted)\n" : "clean\n");
console.log(
  `Artifact sweep — ${targets.length} worktree(s) (${allWorktrees ? "all except current" : "merged into main"}):`,
);

let reclaimed = 0;
for (const worktree of targets) {
  const dirs = findArtifactDirs(worktree.path);
  if (dirs.length === 0) {
    console.log(`  ${worktree.branch}: clean`);
    continue;
  }
  for (const dir of dirs) {
    const size = directorySize(dir);
    reclaimed += size;
    console.log(`  ${dryRun ? "would remove" : "removing"} ${dir}  (${gibibytes(size)})`);
    if (!dryRun) rmSync(dir, { recursive: true, force: true });
  }
}
console.log(
  `  ${dryRun ? "would reclaim" : "reclaimed"} ${gibibytes(reclaimed)} of build artifacts\n`,
);

console.log("Docker cache prune:");
console.log(dryRun ? "  skipped in dry-run" : dockerPrune());
```

- [ ] **Step 2: Verify dry-run runs and is non-destructive**

Run: `node tooling/clean/index.mjs --dry-run`
Expected: prints an "Artifact sweep" section listing merged worktrees (likely "clean" for each in a fresh checkout) and "Docker cache prune: skipped in dry-run". No files deleted. Exit 0.

- [ ] **Step 3: Verify `--all-worktrees` widens the report without deleting**

Run: `node tooling/clean/index.mjs --dry-run --all-worktrees`
Expected: the worktree list now includes non-merged feature branches (still excludes `main` and the current worktree). Nothing deleted.

- [ ] **Step 4: Lint + format**

Run: `pnpm run lint:process-refs && vp check`
Expected: both pass.

- [ ] **Step 5: Commit**

```bash
git add tooling/clean/index.mjs
git commit -m "feat(tooling): build-artifact + Docker cleaner orchestrator"
```

---

## Task 3: Register `vp run clean` and `vp run setup-hooks`

**Files:**

- Modify: `vite.config.ts` (`run.tasks`)

**Interfaces:**

- Consumes: `tooling/clean/index.mjs` (Task 2)
- Produces: `vp run clean` and `vp run setup-hooks` tasks.

- [ ] **Step 1: Add the tasks**

In `vite.config.ts`, inside `run.tasks` (after the `worktrees` entry), add:

```ts
      // Reclaim regenerable build artifacts from merged worktrees + dangling Docker cache. Runs
      // automatically from the post-merge hook (tooling/git-hooks/post-merge); also runnable by
      // hand. Pass flags to the script directly for a preview: node tooling/clean/index.mjs --dry-run
      clean: {
        command: "node tooling/clean/index.mjs",
      },
      // One-time per clone: point git at the tracked hooks directory so the post-merge auto-clean
      // is active. Idempotent.
      "setup-hooks": {
        command: "git config core.hooksPath tooling/git-hooks",
      },
```

- [ ] **Step 2: Verify `vp run clean` works through vp**

Run: `vp run clean`
Expected: runs the orchestrator (in a fresh worktree most merged trees report "clean"; Docker prune runs and reports reclaimed space or a skip). Exit 0.

> Note: if `vp run clean --dry-run` does not forward the flag to the script, use `node tooling/clean/index.mjs --dry-run` for previews. Document whichever works in Task 5.

- [ ] **Step 3: Lint + format**

Run: `vp check`
Expected: pass.

- [ ] **Step 4: Commit**

```bash
git add vite.config.ts
git commit -m "feat(tooling): vp run clean + vp run setup-hooks tasks"
```

---

## Task 4: post-merge hook + installer wiring

**Files:**

- Create: `tooling/git-hooks/post-merge`

**Interfaces:**

- Consumes: `tooling/clean/index.mjs` (Task 2), the `core.hooksPath` config set by `vp run setup-hooks` (Task 3)
- Produces: an active git hook that runs the cleaner on merges to `main`.

- [ ] **Step 1: Create the hook**

Create `tooling/git-hooks/post-merge`:

```sh
#!/bin/sh
# post-merge — after a branch lands in main, reclaim regenerable build artifacts from merged
# worktrees and prune dangling Docker cache (tooling/clean/index.mjs). Guarded on main so a routine
# `git pull` on a feature branch is a no-op. Cleanup must never fail a merge: always exit 0.
branch="$(git symbolic-ref --quiet --short HEAD 2>/dev/null)"
[ "$branch" = "main" ] || exit 0
root="$(git rev-parse --show-toplevel)"
node "$root/tooling/clean/index.mjs" || true
exit 0
```

- [ ] **Step 2: Mark the hook executable in git's index**

Run: `git update-index --add --chmod=+x tooling/git-hooks/post-merge`
Expected: no output; `git ls-files -s tooling/git-hooks/post-merge` shows mode `100755`.

- [ ] **Step 3: Install the hooks path**

Run: `vp run setup-hooks`
Then: `git config --get core.hooksPath`
Expected: prints `tooling/git-hooks`.

- [ ] **Step 4: Verify the guard skips a non-main branch**

Run (from this feature worktree, current branch is `tooling-auto-clean`):

```bash
sh tooling/git-hooks/post-merge && echo "exit=$?"
```

Expected: no cleaner output (guard exits early), `exit=0`.

- [ ] **Step 5: Verify the hook invokes the cleaner on main (dry simulation)**

Run:

```bash
sh -c 'branch=main; [ "$branch" = "main" ] && node "$(git rev-parse --show-toplevel)/tooling/clean/index.mjs" --dry-run'
```

Expected: the cleaner's dry-run report prints. (This simulates the `branch == main` path without performing a real merge.)

- [ ] **Step 6: Lint + format**

Run: `pnpm run lint:process-refs && vp check`
Expected: pass. (The hook is `sh`, not scanned by lint:process-refs, but vp check formats tracked files.)

- [ ] **Step 7: Commit**

```bash
git add tooling/git-hooks/post-merge
git commit -m "feat(tooling): post-merge hook runs auto-clean on merge to main"
```

---

## Task 5: Documentation (CLAUDE.md + fragments)

**Files:**

- Modify: `CLAUDE.md` (Worktree-lifecycle bullet + Commands block)
- Create: `changelog.d/auto-clean-build-artifacts.md`
- Create: `docs/decisions/pending/auto-clean-build-artifacts-on-merge.md`

**Interfaces:**

- Consumes: `vp run clean`, `vp run setup-hooks` (Tasks 3-4)
- Produces: developer-facing docs + changelog/ADR fragments assembled on `main`.

- [ ] **Step 1: Run the worktree overlap check before editing CLAUDE.md**

Run: `vp run worktrees`
Expected: confirm no other stream lists `CLAUDE.md` under "Declared touch-overlaps". If one does, coordinate before continuing.

- [ ] **Step 2: Update the Worktree-lifecycle bullet in `CLAUDE.md`**

Find the bullet beginning `- **Worktree lifecycle.**` under "Parallel worktrees & branches". Append these two sentences to the end of that bullet (before the next bullet):

```markdown
A tracked `post-merge` hook runs `vp run clean` on every merge to `main`, sweeping regenerable build artifacts (`target/`, `.svelte-kit/`, `.wrangler/`, `.vite/`, `dist/`, `build/`, `coverage/`) from worktrees whose branch is merged — and pruning dangling Docker cache — so dead build output never accumulates. The hook is git-ignored-only and never removes a worktree, branch, or `node_modules`. Run **`vp run setup-hooks`** once per clone to activate it; `vp run clean` is also runnable by hand (preview with `node tooling/clean/index.mjs --dry-run`).
```

- [ ] **Step 3: Add `setup-hooks` to the Commands block in `CLAUDE.md`**

In the `## Commands` fenced block, add a line directly under the `vp install` line:

```
vp run setup-hooks                                                     # one-time per clone: activate the tracked git hooks (auto-clean on merge to main)
```

- [ ] **Step 4: Create the changelog fragment**

Create `changelog.d/auto-clean-build-artifacts.md`:

```markdown
---
category: Added
---

**Auto-clean of build artifacts on merge to `main`**: a tracked `post-merge` git hook runs `vp run clean`, which sweeps regenerable build output (`target/`, `.svelte-kit/`, `.wrangler/`, `.vite/`, `dist/`, `build/`, `coverage/`) from worktrees whose branch is merged into `main` and prunes dangling Docker build cache and image layers. Deletion is **git-ignored-only** (each candidate is confirmed with `git check-ignore`) and never touches the active worktree, `node_modules`, tracked source, or the worktree/branch themselves. Activate once per clone with **`vp run setup-hooks`**; run on demand with `vp run clean` (preview via `node tooling/clean/index.mjs --dry-run`, or sweep every non-current worktree with `--all-worktrees`). This stops dead build artifacts from filling the dev disk.
```

- [ ] **Step 5: Create the ADR fragment**

Create `docs/decisions/pending/auto-clean-build-artifacts-on-merge.md`:

```markdown
---
slug: auto-clean-build-artifacts-on-merge
status: Accepted
date: 2026-06-23
area: Dev tooling
summary: "Regenerable build artifacts and dangling Docker cache are reclaimed automatically when a branch lands in main, via a tracked post-merge git hook that runs a `vp run clean` script. The cleaner deletes only git-ignored artifact directories (target/, .svelte-kit, .wrangler, .vite, dist, build, coverage) inside worktrees whose branch is merged into main, and prunes dangling Docker builder cache and image layers. It deliberately never removes worktrees, branches, or node_modules — those stay manual because a worktree may hold uncommitted or foreign work. Installed once per clone with `vp run setup-hooks` (sets core.hooksPath to the tracked tooling/git-hooks)."
---

**Build artifacts auto-clean on merge to main.**

**Context:** the dev disk filled to 100%. Regenerable build output had accumulated unbounded — Rust `target/` directories multiplied across ~10 worktrees, and local Container image builds left tens of gigabytes of Docker builder cache. The existing worktree-lifecycle rule (remove a merged worktree by hand) was not being followed, and nothing swept artifacts from worktrees that were kept.

**Decision:** a tracked `post-merge` git hook, guarded on the current branch being `main`, runs a `vp run clean` script on every merge to `main`. The script deletes only **git-ignored** artifact directories (`target/`, `.svelte-kit/`, `.wrangler/`, `.vite/`, `dist/`, `build/`, `coverage/`) inside worktrees whose branch is merged into `main`, confirming each candidate with `git check-ignore` before removal, and prunes dangling Docker builder cache and image layers (best-effort; a missing or stopped Docker daemon is a logged skip, never a merge failure). The worktree shell, `node_modules`, tracked source, and the worktree/branch themselves are never touched. Installation is a one-time `vp run setup-hooks` that points `core.hooksPath` at the tracked `tooling/git-hooks` directory, so the hook is version-controlled and shared across all worktrees through the common git directory.

**Scope:** automatic trigger is merge-to-`main` only; routine `git pull` on a feature branch is a no-op. Worktree/branch removal and `node_modules` deletion stay manual (a worktree may hold uncommitted or foreign work, so automated removal is too risky). System-level reclamation (OneDrive cache, Phone Link media, hibernation file, OS temp) is out of scope — those are handled manually. The WSL2 Docker disk is kept sparse as a one-time setup so pruned space returns to the host automatically; it is not re-asserted per merge.

**Consequences:** dead build output no longer accumulates, so manual disk rescues become rare. The cost is a few seconds added to each merge-to-`main` and a one-time `vp run setup-hooks` step after cloning. Squash- or rebase-merged branches are not detected by `git branch --merged main`; their artifacts are reclaimed on the next `vp run clean --all-worktrees` or when the worktree is removed.
```

- [ ] **Step 6: Lint + full check**

Run: `pnpm run lint:process-refs && pnpm check`
Expected: both pass. (The fragments are `.md`, exempt from the process-ref scan; `pnpm check` validates formatting.)

- [ ] **Step 7: Commit**

```bash
git add CLAUDE.md changelog.d/auto-clean-build-artifacts.md docs/decisions/pending/auto-clean-build-artifacts-on-merge.md
git commit -m "docs(tooling): document auto-clean (CLAUDE.md, changelog + ADR fragments)"
```

---

## Final verification

- [ ] **Step 1: Full test suite**

Run: `pnpm vitest run --project clean`
Expected: PASS.

- [ ] **Step 2: Full quality gate**

Run: `pnpm check && pnpm run lint:process-refs`
Expected: PASS.

- [ ] **Step 3: End-to-end dry-run**

Run: `node tooling/clean/index.mjs --dry-run --all-worktrees`
Expected: a sweep report covering all non-current, non-main worktrees, no deletions, exit 0.

- [ ] **Step 4: Confirm hook is installed**

Run: `git config --get core.hooksPath`
Expected: `tooling/git-hooks`.

---

## Self-review notes (author)

- **Spec coverage:** trigger (Task 4 hook), regenerables-only sweep of merged worktrees keeping the shell (Tasks 1-2), Docker prune every merge (Task 2), `--dry-run`/`--all-worktrees` flags (Task 2), `vp run clean` + `vp run setup-hooks` (Task 3), tests (Task 1), docs incl. CLAUDE.md + changelog + ADR fragments (Task 5). All covered.
- **Deviation from the design (recorded in the ADR fragment):** WSL sparse mode is a one-time setup, not re-asserted per merge — re-running `wsl --manage … --set-sparse true --allow-unsafe` on every merge is heavy and carries a corruption warning; sparse persists once set, so the per-merge step is Docker pruning only.
- **Type consistency:** `eligibleWorktrees`, `isArtifactDir`, `normalizePath`, `ARTIFACT_DIRS` are named identically across `select.mjs`, its test, and `index.mjs`.
- **Process-ref safety:** code comments avoid `ADR-NNNN`, "design spec", "spike", "white-paper", "spec §"; the ADR/changelog content lives only in `.md` fragments (exempt).
