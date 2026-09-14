// @repo-wide-fitness — runs the screen-data gate over every route and lib module in apps/web, so any
// screen's diff can break it and a screen's own package has no test that would.
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// apps/web/test -> repo root.
const REPO_ROOT = join(import.meta.dirname, "..", "..", "..");

/*
 * The gate runs as its own process rather than being re-implemented here.
 *
 * `pnpm run lint:screen-data` is what a person runs and what CI runs, so a test that re-implemented
 * its rules could pass while the command a reviewer actually invokes fails, or the reverse. Running
 * the command is the only assertion that cannot drift from it — and it is what puts the rule in the
 * repo-wide fitness sweep, which is the sweep the inner-loop gate runs whenever first-party source
 * changed. The rules themselves, and why each one cannot be a type instead, are on
 * tooling/lint-screen-data/index.mjs.
 */
describe("the screen-data seam", () => {
  it("holds across every screen", () => {
    let output: string;
    try {
      output = execFileSync("node", [join("tooling", "lint-screen-data", "index.mjs")], {
        cwd: REPO_ROOT,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      const failure = error as { stdout?: string; stderr?: string };
      // The gate's own report is the failure message: it names each file, the rule it broke, and the
      // remedy. Re-wording it here would leave a reader with strictly less than the command prints.
      expect.fail(`${failure.stdout ?? ""}${failure.stderr ?? ""}`);
    }
    expect(output).toContain("hand-written transport module(s) left to migrate");
  });
});
