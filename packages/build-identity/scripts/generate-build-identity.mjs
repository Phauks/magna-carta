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
 */
import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

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

function gitRead(command) {
  try {
    return execSync(command, { encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

const commit = gitRead("git rev-parse --short HEAD");
const commitTime = gitRead("git show --no-patch --format=%cI HEAD");

if (commit === null) {
  // No git identity available (a tarball checkout, git absent): the honest answer stays "dev".
  console.log("build-identity: git identity unavailable — keeping the dev identity.");
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
