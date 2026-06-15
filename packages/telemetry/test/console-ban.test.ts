import { readdir, readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

// The console ban — the one-logging-path rule (docs/conventions/error-logging.md) made structural.
// Application code logs ONLY through the telemetry Logger; a raw console.* anywhere in
// apps/worker/src or packages/*/src fails CI. This scan lives here because the telemetry package
// owns the one logging path, runs in the node pool (fs available, unlike the worker's workerd pool),
// and reads every package's source from the repo root. (scripts/ and test/ are out of scope —
// tooling may print.)

// packages/telemetry/test -> repo root.
const REPO_ROOT = join(import.meta.dirname, "..", "..", "..");
// The FULL console surface, not a method enumeration: any console.<method>( (log/error/warn/info/
// debug/trace/dir/table/group/count/assert/timeEnd/…) AND bracket-notation console["log"]( — a ban
// that listed only five methods would let console.table(privileged) or console["log"](secret) pass.
const CONSOLE_CALL = /\bconsole\s*(?:\.\s*\w+|\[[^\]]+\])\s*\(/;

// The ONLY two source files permitted a console.* call, each for a deliberate reason:
const ALLOWLIST = new Set([
  // The Workers logger adapter — THE one structured-JSON emit site (it IS the pipeline).
  join("packages", "telemetry", "src", "workers-logger.ts"),
  // The load-profile measurement CLI — a developer tool whose stdout is its product, not app logging
  // (the scripts/ exemption in spirit; it lives in src only because it is the package's entrypoint).
  join("packages", "fixtures", "src", "load-profile", "measure-cli.ts"),
]);

// Every .ts file under apps/worker/src and packages/*/src (skipping node_modules/test/dist/build).
async function sourceFiles(): Promise<string[]> {
  const roots = [join(REPO_ROOT, "apps", "worker", "src")];
  for (const entry of await readdir(join(REPO_ROOT, "packages"), { withFileTypes: true })) {
    if (entry.isDirectory()) roots.push(join(REPO_ROOT, "packages", entry.name, "src"));
  }
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
