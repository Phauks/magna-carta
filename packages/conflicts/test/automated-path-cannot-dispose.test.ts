import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// A SOURCE SCAN, not a behavioural test — because what it protects cannot be caught by one.
//
// The automatic re-check path runs checks that nobody asked for, under nobody's authority. The one
// thing it must never be able to do is record a conclusion: a disposition written by machinery is a
// conclusion no person made, on a record whose entire value is that a live person's name is on every
// one of them. That rule survives review easily and dies in a refactor just as easily — somebody
// needs a disposition kind for something adjacent, imports the module, and every test still passes.
//
// So it is enforced on the TEXT of the modules that make up the automated path. Nothing here may
// import the disposition module, name its file, or call the function that writes a row.
//
// This is the FIRST of two layers. The second is a database trigger refusing a disposition whose
// reviewer is not a live member, which lands with the adjudication read models — a source scan can
// only see the code that exists in this repository, and the guarantee should not depend on that.

// The modules the automated path is made of, all inside this package. The worker's two consumers are
// scanned by the worker's own suite, which is where their files live.
const AUTOMATED_PATH_FILES = ["recheck-cause.ts", "recheck-request.ts", "recheck-run.ts"];

const SOURCE_DIRECTORY = new URL("../src/", import.meta.url).pathname;

// An import of the disposition module by any spelling — the package export, the relative file, or a
// dynamic import — plus a direct call of the writer, which would catch a re-export laundering it.
const DISPOSITION_REACH =
  /(from\s+["'][^"']*disposition(\.ts)?["'])|(import\s*\(\s*["'][^"']*disposition)|(\brecordDisposition\s*\()/;

describe("the automated re-check path cannot record a conclusion", () => {
  it("imports no disposition module and calls no disposition writer", () => {
    const offenders: string[] = [];
    for (const file of AUTOMATED_PATH_FILES) {
      const source = readFileSync(join(SOURCE_DIRECTORY, file), "utf8");
      if (DISPOSITION_REACH.test(source)) offenders.push(file);
    }
    // A failure here means a code path that runs with no member behind it can now write a row
    // claiming a member concluded something. Compose the check; leave the conclusion to a person.
    expect(offenders).toEqual([]);
  });

  it("scans files that actually exist, so a rename cannot silently empty this test", () => {
    // The list above is a list of names. A renamed module would leave the scan passing over nothing,
    // which is the failure mode every allowlist-shaped fitness function has.
    const present = new Set(
      readdirSync(SOURCE_DIRECTORY, { withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => entry.name),
    );
    for (const file of AUTOMATED_PATH_FILES) {
      expect(present.has(file), `${file} is scanned but no longer exists`).toBe(true);
    }
    // And every re-check module in the package is scanned, so adding one does not quietly opt out.
    const unscanned = [...present].filter(
      (name) =>
        name.startsWith("recheck-") &&
        name.endsWith(".ts") &&
        !AUTOMATED_PATH_FILES.includes(name) &&
        // Settings are firm configuration, not a code path that runs a check.
        name !== "recheck-settings.ts" &&
        // Statement builders are SQL for the ledger and write no conflicts_disposition row.
        name !== "recheck-statements.ts",
    );
    expect(unscanned).toEqual([]);
  });
});
