// The startup dimension: what the api worker's entry graph costs to evaluate, measured locally and
// recorded as a trend.
//
// Cloudflare validates every deploy against a startup CPU budget (error 10021), and the app worker
// crossed it once (docs/conventions/build-performance.md, _A Worker entrypoint spends a validated
// startup budget_). The fix moved the route graph behind a dynamic import, which moved the cost
// from validation to the first request — where it still grows with every route and nothing was
// measuring it. `wrangler check startup` builds the Worker and profiles its startup phase; the
// profile's span is the number. Local CPU is not Cloudflare CPU, so this never fails on a
// threshold: it records the value beside the previous one and prints both, so a step change is
// read as a trend in the gate's summary rather than discovered as a refused deploy.
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

const WORKER = "@magna-carta/api-worker";
const WORKER_DIRECTORY = "apps/api-worker";
const PROFILE = "worker-startup.cpuprofile";
// wrangler refuses to build while the assets directory the configuration names is absent. The
// profile measures the script, not the assets, so an empty directory is enough — and it is the
// SPA's own build output path, git-ignored, so creating it changes nothing that is tracked.
const ASSETS_DIRECTORY = "apps/web/build";
const HISTORY = "startup-history.jsonl";

/** The startup span recorded in a V8 CPU profile, in seconds. */
export function startupSecondsOf(profileText) {
  const profile = JSON.parse(profileText);
  if (typeof profile.startTime !== "number" || typeof profile.endTime !== "number") {
    throw new Error("the CPU profile carries no startTime/endTime span");
  }
  return (profile.endTime - profile.startTime) / 1_000_000;
}

/** The most recent recorded run, or null. */
export function previousRun(historyText) {
  const lines = historyText.split("\n").filter(Boolean);
  if (lines.length === 0) return null;
  return JSON.parse(lines[lines.length - 1]);
}

/**
 * @param {{ root: string, cache: string, log: (line: string) => void, environment?: NodeJS.ProcessEnv, shell?: boolean }} options
 * @returns {{ status: "passed" | "failed", detail: string }}
 */
export function runStartupCheck({ root, cache, log, environment = process.env, shell = false }) {
  const assets = path.join(root, ASSETS_DIRECTORY);
  if (!existsSync(assets)) mkdirSync(assets, { recursive: true });

  const result = spawnSync("pnpm", ["--filter", WORKER, "exec", "wrangler", "check", "startup"], {
    cwd: root,
    encoding: "utf8",
    env: environment,
    shell,
  });
  if (result.error !== undefined || result.status !== 0) {
    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim().split("\n").slice(-12);
    for (const line of output) log(line);
    return { status: "failed", detail: "wrangler check startup did not complete" };
  }

  const profilePath = path.join(root, WORKER_DIRECTORY, PROFILE);
  if (!existsSync(profilePath)) {
    return { status: "failed", detail: `wrangler check startup wrote no ${PROFILE}` };
  }
  const seconds = startupSecondsOf(readFileSync(profilePath, "utf8"));

  mkdirSync(cache, { recursive: true });
  const historyPath = path.join(cache, HISTORY);
  const previous = existsSync(historyPath) ? previousRun(readFileSync(historyPath, "utf8")) : null;
  const commit = spawnSync("git", ["rev-parse", "--short", "HEAD"], {
    cwd: root,
    encoding: "utf8",
    shell,
  });
  appendFileSync(
    historyPath,
    `${JSON.stringify({ at: new Date().toISOString(), commit: (commit.stdout ?? "").trim(), seconds })}\n`,
  );

  const current = `${seconds.toFixed(3)} s local startup`;
  const trend =
    previous === null
      ? "no previous run recorded here"
      : `previous ${Number(previous.seconds).toFixed(3)} s at ${previous.commit || "?"} (${seconds >= previous.seconds ? "+" : ""}${(seconds - previous.seconds).toFixed(3)} s)`;
  log(`${current}; ${trend}`);
  log(`profile: ${path.relative(root, profilePath)} (load it into the Chrome DevTools profiler)`);
  return { status: "passed", detail: `${current}; ${trend}` };
}
