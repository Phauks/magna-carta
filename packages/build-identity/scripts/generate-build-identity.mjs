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

// How many characters of the hash a fallback stamp keeps. Git picks its own abbreviation length,
// so the two sources can disagree on length for the same commit; the overlay that compares the web
// app's stamp against a Worker's compares by prefix for exactly that reason
// (apps/web/src/lib/versions/version-overlay-model.ts).
const COMMIT_ABBREVIATION_LENGTH = 9;

/*
 * The commit the build runner says it checked out. Cloudflare Workers Builds and GitHub Actions
 * each publish it, and it is the same fact git would report, from the system that performed the
 * checkout — so it is a real identity, not a guess. It matters because a runner can hand the build
 * a working tree without a usable `.git` (a shallow or archive checkout, git absent from the
 * image), and then every deployed Worker reports "dev" and the version surface can say nothing
 * about a deployment that is perfectly healthy.
 */
function commitFromRunner() {
  const full = process.env.WORKERS_CI_COMMIT_SHA ?? process.env.GITHUB_SHA ?? null;
  if (full === null || !/^[0-9a-f]{7,40}$/i.test(full)) return null;
  return full.slice(0, COMMIT_ABBREVIATION_LENGTH);
}

const commit = gitRead("git rev-parse --short HEAD") ?? commitFromRunner();
const commitTime = gitRead("git show --no-patch --format=%cI HEAD");

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
