/*
 * Writes the build's identity into the SPA's build output as the static /__version file — the same
 * shape every dedicated Worker serves from packages/build-identity's version route. The assets-only
 * `magna-carta-web` Worker has no script to mount a route on, so this file IS its version answer:
 * the app worker's aggregate version endpoint probes it over the WEB_SERVICE binding and the asset
 * server hands the file back. Runs after `vite build` (the package's build script), so the build
 * directory exists; the file is build output, never committed, so — unlike the Worker stamp — it is
 * written on every build, local ones included.
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveCommitIdentity } from "../../../packages/build-identity/scripts/commit-identity.mjs";

const buildDirectory = join(dirname(fileURLToPath(import.meta.url)), "..", "build");
const { commit, commitTime } = resolveCommitIdentity();

const identity = {
  // "unknown" is the web build's honest placeholder (build-identity.ts renders it as "dev").
  commit: commit ?? "unknown",
  commitTime,
  buildTime: new Date().toISOString(),
};

writeFileSync(join(buildDirectory, "__version"), JSON.stringify(identity));
console.log(`version asset: ${identity.commit} (built ${identity.buildTime}).`);
