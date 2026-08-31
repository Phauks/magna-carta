/*
 * Regenerates src/build-identity-values.generated.ts with the real git identity of the checkout —
 * run as the first step of every Worker's deploy build (each Worker package's `build` script), so
 * the `wrangler deploy` that follows bundles the commit the artifact was actually built from.
 *
 * It REFUSES to write outside CI unless forced. The generated file is checked in with honest dev
 * placeholder values, and a local `pnpm run build` that overwrote it would leave a dirty tree
 * whose commit hash goes stale the moment anything else is committed — a stale stamped identity
 * is a false claim, where "dev" is a true one. The CI checkout is throwaway, so overwriting there
 * is safe and is the whole point. Pass --force to stamp a deliberate local deploy.
 *
 * It reads git first and the build runner's own commit variable second. Both name the same commit;
 * the second exists because a runner can hand the build a tree git cannot answer for, and a Worker
 * that cannot state its version makes the whole deployment unreadable from the version surface.
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveCommitIdentity } from "./commit-identity.mjs";

const generatedFilePath = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "src",
  "build-identity-values.generated.ts",
);

const runningInContinuousIntegration =
  process.env.CI !== undefined || process.env.WORKERS_CI !== undefined;
const forced = process.argv.includes("--force");

if (!runningInContinuousIntegration && !forced) {
  console.log(
    "build-identity: not CI — keeping the checked-in dev identity (pass --force to stamp anyway).",
  );
  process.exit(0);
}

// Git first, the build runner's own commit variable second — the shared resolution in
// scripts/commit-identity.mjs, which says why the fallback exists and why it abbreviates.
const { commit, commitTime } = resolveCommitIdentity();

if (commit === null) {
  // Neither git nor the runner can name the commit: the honest answer stays "dev".
  console.log("build-identity: no commit identity available — keeping the dev identity.");
  process.exit(0);
}

const identity = {
  commit,
  commitTime,
  buildTime: new Date().toISOString(),
};

const contents = `/*
 * GENERATED at deploy build time by scripts/generate-build-identity.mjs — this copy carries the
 * real identity of the build in progress and must never be committed (the checked-in state is the
 * "dev" placeholder).
 */
export const GENERATED_BUILD_IDENTITY: {
  commit: string;
  commitTime: string | null;
  buildTime: string | null;
} = ${JSON.stringify(identity, null, 2).replace(/"(commit|commitTime|buildTime)":/g, "$1:")};
`;

writeFileSync(generatedFilePath, contents);
console.log(
  `build-identity: stamped ${identity.commit} (committed ${identity.commitTime ?? "unknown"}, built ${identity.buildTime}).`,
);
