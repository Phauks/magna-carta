import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { fileIsExempt, findHandRolledStaleGuards } from "./rules.mjs";

// Fitness function: nobody re-derives the stale-answer guard.
//
// A screen reads on a subject, the person changes subject, a second read starts, and both resolve —
// in whichever order the network felt like, which is frequently the wrong one. Whichever lands last
// wins the state, so the screen shows the previous subject's data under the current subject's
// heading and looks exactly like a screen that loaded correctly. The guard is a counter bumped when a
// read starts and checked when it answers.
//
// Four screens had grown their own copy before `LatestOnly` existed, and they agreed with each other
// by luck rather than by construction: the bug is invisible in every test that resolves one read at a
// time, so a copy written slightly wrong passes everything. This is what stops the fifth.
//
// Escape hatch: `stale-response:allow — <reason>` anywhere in the file. A bare marker fails.
//
// Run: `pnpm run lint:stale-response`.

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const HOME = join("apps", "web", "src", "lib", "api", "latest-only.ts");

function walk(directory, found = []) {
  for (const entry of readdirSync(directory)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) walk(path, found);
    else if (path.endsWith(".ts") || path.endsWith(".svelte")) found.push(path);
  }
  return found;
}

function main() {
  const problems = [];
  let scanned = 0;
  for (const path of walk(join(ROOT, "apps", "web", "src"))) {
    const file = relative(ROOT, path);
    if (file === HOME) continue;
    const source = readFileSync(path, "utf8");
    scanned++;
    if (fileIsExempt(source)) continue;
    for (const guard of findHandRolledStaleGuards(source)) {
      problems.push({ file, ...guard });
    }
  }

  if (problems.length > 0) {
    console.error("\nA screen is re-deriving the stale-answer guard:\n");
    for (const problem of problems) {
      console.error(
        `  ${problem.file}:${String(problem.line)}  ${problem.field} is incremented and compared —\n` +
          `      that is the stale-answer guard, written again. Use LatestOnly from ` +
          `apps/web/src/lib/api/latest-only.ts: begin() when a read starts, supersede() when the screen ` +
          `is cleared without one, and check attempt.current before writing the answer.`,
      );
    }
    console.error(`\n${String(problems.length)} hand-rolled guard(s).`);
    process.exit(1);
  }

  console.log(
    `No hand-rolled stale-answer guards (${String(scanned)} web source file(s) scanned; every read that can be` +
      " superseded goes through LatestOnly).",
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
