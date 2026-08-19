// @repo-wide-fitness — scans apps/*/src and packages/*/src, so any package's diff can break it and
// almost none of them touch this one.
import { readdir, readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

// The console ban — the one-logging-path rule (docs/conventions/error-logging.md) made structural.
// That rule binds EVERY Worker, not just the API worker, so the scan enumerates every app and every
// package rather than naming apps/worker: a raw console.* anywhere in apps/*/src or packages/*/src
// fails CI. Enumerating (instead of listing) is the point — an extracted worker app is inside the
// ban the moment it exists, with no test edit to remember. This scan lives here because the
// telemetry package owns the one logging path, runs in the node pool (fs available, unlike the
// worker's workerd pool), and reads every app's and package's source from the repo root. (scripts/
// and test/ are out of scope — tooling may print.)

// packages/telemetry/test -> repo root.
const REPO_ROOT = join(import.meta.dirname, "..", "..", "..");
// The FULL console surface, not a method enumeration: any console.<method>( (log/error/warn/info/
// debug/trace/dir/table/group/count/assert/timeEnd/…) AND bracket-notation console["log"]( — a ban
// that listed only five methods would let console.table(privileged) or console["log"](secret) pass.
const CONSOLE_CALL = /\bconsole\s*(?:\.\s*\w+|\[[^\]]+\])\s*\(/;

// The only source files permitted a console.* call, each for a deliberate reason:
const ALLOWLIST = new Set([
  // The Workers logger adapter — THE one structured-JSON emit site (it IS the pipeline).
  join("packages", "telemetry", "src", "workers-logger.ts"),
  // The load-profile measurement CLI — a developer tool whose stdout is its product, not app logging
  // (the scripts/ exemption in spirit; it lives in src only because it is the package's entrypoint).
  join("packages", "fixtures", "src", "load-profile", "measure-cli.ts"),
  // The discovery measurement harness — the same class as the CLI above, printing machine-relative
  // latencies and a measured database size that exist to be compared across commits on one machine,
  // never asserted against a threshold that would make a busy laptop a red build. It differs from the
  // CLI only in being a test rather than an entrypoint, which is what put it in front of this scan.
  // Listed as one file rather than exempting the load-profile directory: a directory rule would cover
  // measurement harnesses nobody has written yet. If a third of these appears, that is the signal to
  // make the exemption a rule on purpose.
  join("packages", "fixtures", "src", "load-profile", "discovery-measurements.test.ts"),
  // The GPU benchmark harness — same class: a developer CLI/runner whose console output IS its
  // product (benchmark results), not application logging.
  join("packages", "gpu-benchmark", "src", "cli.ts"),
  join("packages", "gpu-benchmark", "src", "run.ts"),
  // The bundle worker's guarded post-deploy self-test — an operator-invoked diagnostic, not request
  // handling. Its product is the structured report it returns; these lines only mirror a leaked-object
  // count and the run id into Workers Logs so an ignored report still leaves a trace. That worker
  // carries no telemetry binding of its own, so there is no Logger to route them through; they move
  // onto the Logger when it gains one. Nothing here can carry domain data — no field exists for it.
  join("apps", "bundle-worker", "src", "self-test.ts"),
]);

// The app source roots. Every app is scanned EXCEPT the web app: it is browser code, whose logging
// path is the in-app developer console (apps/web/src/lib/developer/), not the Workers Logger this
// ban funnels server code into. Excluded by name so a new worker app is covered automatically.
const UNSCANNED_APPS = new Set(["web"]);

async function sourceRoots(): Promise<string[]> {
  const roots: string[] = [];
  for (const entry of await readdir(join(REPO_ROOT, "apps"), { withFileTypes: true })) {
    if (entry.isDirectory() && !UNSCANNED_APPS.has(entry.name)) {
      roots.push(join(REPO_ROOT, "apps", entry.name, "src"));
    }
  }
  for (const entry of await readdir(join(REPO_ROOT, "packages"), { withFileTypes: true })) {
    if (entry.isDirectory()) roots.push(join(REPO_ROOT, "packages", entry.name, "src"));
  }
  return roots;
}

// Every .ts file under those roots (skipping node_modules/test/dist/build).
async function sourceFiles(): Promise<string[]> {
  const roots = await sourceRoots();
  const files: string[] = [];
  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => null);
    if (entries === null) return; // a package without a src/ dir
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (["node_modules", "dist", "build", "test"].includes(entry.name)) continue;
        await walk(full);
      } else if (entry.name.endsWith(".ts")) {
        files.push(full);
      }
    }
  }
  for (const root of roots) await walk(root);
  return files;
}

describe("console ban (the one-logging-path rule, made structural)", () => {
  it("console.* appears ONLY in the allowlisted source files", async () => {
    const offenders: string[] = [];
    let scanned = 0;
    for (const file of await sourceFiles()) {
      scanned += 1;
      const content = await readFile(file, "utf8");
      if (CONSOLE_CALL.test(content)) {
        const relativePath = relative(REPO_ROOT, file).split(sep).join("/");
        const allowlistKey = relative(REPO_ROOT, file);
        if (!ALLOWLIST.has(allowlistKey)) offenders.push(relativePath);
      }
    }
    expect(offenders).toEqual([]);
    // Vacuity guard: the scan actually walked a meaningful corpus, not zero files.
    expect(scanned).toBeGreaterThan(20);
  });

  it("covers every app but the web app, so an extracted worker cannot fall outside the ban", async () => {
    const apps = (await readdir(join(REPO_ROOT, "apps"), { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
    // The enumeration must see the real apps directory, not an empty one.
    expect(apps.length).toBeGreaterThan(1);

    const scannedRoots = new Set(await sourceRoots());
    for (const app of apps) {
      const root = join(REPO_ROOT, "apps", app, "src");
      expect(scannedRoots.has(root), `apps/${app}/src`).toBe(!UNSCANNED_APPS.has(app));
    }

    // Spot-check the extracted workers by name: the scan must reach files inside them, not merely
    // list their roots. A root that walks to nothing would leave the app silently unenforced.
    const scanned = (await sourceFiles()).map((file) =>
      relative(REPO_ROOT, file).split(sep).join("/"),
    );
    for (const app of ["scan-worker", "bundle-worker", "convert-worker"]) {
      expect(
        scanned.some((file) => file.startsWith(`apps/${app}/src/`)),
        `apps/${app}/src`,
      ).toBe(true);
    }
  });

  it("the detector matches the full console.* surface incl. bracket notation (reads content, not filenames)", () => {
    expect(CONSOLE_CALL.test('console.error("leak")')).toBe(true);
    expect(CONSOLE_CALL.test("console.log(x)")).toBe(true);
    // Methods beyond the common five must also be caught.
    expect(CONSOLE_CALL.test("console.table(rows)")).toBe(true);
    expect(CONSOLE_CALL.test("console.trace()")).toBe(true);
    // Bracket notation is a real call site too.
    expect(CONSOLE_CALL.test('console["log"](secret)')).toBe(true);
    // A bare reference without a call (e.g. an injected-sink default `= console.log`) is allowed —
    // it is not an ad-hoc logging CALL site.
    expect(CONSOLE_CALL.test("const sink = console.log;")).toBe(false);
  });

  it("the allowlisted files do each contain a console.* call (the allowlist is not stale)", async () => {
    for (const allowed of ALLOWLIST) {
      const content = await readFile(join(REPO_ROOT, allowed), "utf8");
      expect(CONSOLE_CALL.test(content), allowed).toBe(true);
    }
  });
});
