/*
 * The one resolution of "which commit is this build from", shared by every build-time stamper:
 * generate-build-identity.mjs (the Worker stamp), the web app's vite define block, and the web
 * app's static /__version asset. Git answers first; the build runner's own commit variable second.
 * Both name the same commit — the second exists because a runner can hand the build a tree git
 * cannot answer for (a shallow or archive checkout, git absent from the image), and a build that
 * cannot state its commit makes the version surface unreadable for a deployment that is perfectly
 * healthy. Nothing here ever invents an identity: no source means null, and the caller keeps its
 * honest placeholder.
 */
import { execSync } from "node:child_process";

function gitRead(command) {
  try {
    return execSync(command, { encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

// How many characters of the hash a fallback stamp keeps. Git picks its own abbreviation length,
// so the two sources can disagree on length for the same commit; the overlay that compares the web
// app's stamp against a Worker's compares by prefix for exactly that reason
// (apps/web/src/lib/versions/version-overlay-model.ts).
const COMMIT_ABBREVIATION_LENGTH = 9;

/*
 * The commit the build runner says it checked out. Cloudflare Workers Builds and GitHub Actions
 * each publish it, and it is the same fact git would report, from the system that performed the
 * checkout — a real identity, not a guess.
 */
function commitFromRunner() {
  const full = process.env.WORKERS_CI_COMMIT_SHA ?? process.env.GITHUB_SHA ?? null;
  if (full === null || !/^[0-9a-f]{7,40}$/i.test(full)) return null;
  return full.slice(0, COMMIT_ABBREVIATION_LENGTH);
}

/** @returns {{ commit: string | null, commitTime: string | null }} */
export function resolveCommitIdentity() {
  return {
    commit: gitRead("git rev-parse --short HEAD") ?? commitFromRunner(),
    commitTime: gitRead("git show --no-patch --format=%cI HEAD"),
  };
}
