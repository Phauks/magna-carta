// Point git at the tracked hooks directory (tooling/git-hooks), so the pre-push quality gate
// and the post-merge auto-clean are active.
//
// This runs from `postinstall` rather than being a manual once-per-clone step because a fresh
// clone leaves `core.hooksPath` unset — and a cloud session IS a fresh clone every time. Left
// manual, every cloud session pushes with the quality gate silently disabled.
//
// Idempotent, and a no-op outside a git working tree (a published tarball, a Docker build
// context) so it can never fail an install.
import { execFileSync } from "node:child_process";

const HOOKS_PATH = "tooling/git-hooks";

function git(...args) {
  return execFileSync("git", args, { stdio: ["ignore", "pipe", "ignore"] })
    .toString()
    .trim();
}

try {
  if (git("rev-parse", "--is-inside-work-tree") !== "true") process.exit(0);
} catch {
  // No git, or not a repository. Nothing to wire up.
  process.exit(0);
}

try {
  if (git("config", "--get", "core.hooksPath") === HOOKS_PATH) process.exit(0);
} catch {
  // Unset. Fall through and set it.
}

try {
  git("config", "core.hooksPath", HOOKS_PATH);
  console.log(`git hooks active: core.hooksPath -> ${HOOKS_PATH}`);
} catch (error) {
  console.warn(
    `could not set core.hooksPath (${error.message}); run \`vp run setup-hooks\` by hand`,
  );
}
