// @repo-wide-fitness scope=source — the rule binds every consumer of this package, and the diff
// that adds a consumer never touches this package.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// EVERY INTAKE RECORD IS A PERSON'S. A member's answer to a step is the firm's evidence that it did
// what its own procedure requires before it acted, and evidence nobody signed is not evidence — so
// no queue consumer, scheduled handler, outbox sweep or rule engine may write one. The rule is held
// on the source text: the only files in the workspace that may import the record writer are HTTP
// route modules, where a chokepoint has already named the member.
//
// The same shape as packages/conflicts' automated-path-cannot-dispose scan, for the same reason.

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const SCANNED_ROOTS = ["apps", "packages"];
const SKIPPED = new Set([
  "node_modules",
  ".tsbuild",
  ".svelte-kit",
  ".wrangler",
  ".vite",
  "dist",
  "build",
  "coverage",
  "target",
]);
const WRITER_IMPORT = /@magna-carta\/intake\/record-service|\/intake\/src\/record-service/u;

function* sourceFiles(directory: string): Generator<string> {
  for (const entry of readdirSync(directory)) {
    if (SKIPPED.has(entry)) continue;
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      yield* sourceFiles(path);
    } else if (/\.(?:ts|mts|svelte)$/u.test(entry)) {
      yield path;
    }
  }
}

function isPermittedImporter(path: string): boolean {
  const relativePath = relative(ROOT, path).replaceAll("\\", "/");
  if (relativePath.startsWith("packages/intake/")) return true;
  return /^apps\/[^/]+\/src\/http\/routes\//u.test(relativePath);
}

describe("no automated path writes an intake record", () => {
  it("only route modules import the record writer", () => {
    const offenders: string[] = [];
    for (const root of SCANNED_ROOTS) {
      for (const path of sourceFiles(join(ROOT, root))) {
        if (isPermittedImporter(path)) continue;
        if (WRITER_IMPORT.test(readFileSync(path, "utf8"))) {
          offenders.push(relative(ROOT, path).replaceAll("\\", "/"));
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("can still see an import when one exists", () => {
    expect(
      WRITER_IMPORT.test('import { waiveStep } from "@magna-carta/intake/record-service";'),
    ).toBe(true);
  });
});
