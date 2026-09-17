import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { findUngatedDecisions, readDurableObjectMethods } from "./rules.mjs";

// Fitness function: a Durable Object that decides from its stored state and then writes it must not
// await anything else in between.
//
// The atomicity a Durable Object gives read-then-write is real but invisible: workerd holds the input
// gate closed while a storage operation is outstanding, so a second call is not delivered until the
// first has written. Nothing in the source says so. Await one non-storage thing in that window — an R2
// HEAD to decide whether a cached artifact still exists, a queue send, a service binding — and the
// gate opens, two callers both read the old state, and both act on it. The code reads identically
// either way, which is why this is a scan.
//
// It found exactly one when it was written: BundleBuildCoordinator.requestBundle HEADed R2 to decide
// whether a reaped bundle needed rebuilding, so two requests for the same expired bundle each enqueued
// a full rebuild. `ctx.blockConcurrencyWhile` around the decision is the remedy.
//
// Escape hatch: `durable-object-gate:allow — <reason>` above the method. A bare marker fails.
//
// Run: `pnpm run lint:durable-object-gates`.

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

function walk(directory, found = []) {
  for (const entry of readdirSync(directory)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) walk(path, found);
    else if (path.endsWith(".ts")) found.push(path);
  }
  return found;
}

function main() {
  const files = walk(join(ROOT, "apps")).filter((path) => path.includes(`/src/`));
  const problems = [];
  let classCount = 0;
  let methodCount = 0;
  for (const path of files) {
    const source = readFileSync(path, "utf8");
    const methods = readDurableObjectMethods(source);
    if (methods.length === 0) continue;
    classCount++;
    methodCount += methods.length;
    for (const problem of findUngatedDecisions(methods)) {
      problems.push({ ...problem, file: relative(ROOT, path) });
    }
  }

  if (problems.length > 0) {
    console.error("\nA Durable Object decides across an open input gate:\n");
    for (const problem of problems) {
      console.error(
        `  ${problem.file}:${String(problem.line)}  ${problem.className}.${problem.method}\n` +
          `      reads stored state, then awaits ${problem.foreign.join(", ")} before writing it. ` +
          `Only a STORAGE await holds the input gate, so the gate opens there and a second call is delivered ` +
          `mid-decision: both read the old state and both act. Wrap the read-decide-write in ` +
          `ctx.blockConcurrencyWhile (LiveTimerDurableObject.stopAndCommit is the worked example), or ` +
          `mark the method \`durable-object-gate:allow — <reason>\` if a second caller acting is harmless.`,
      );
    }
    console.error(`\n${String(problems.length)} ungated decision(s).`);
    process.exit(1);
  }

  console.log(
    `Durable Object decisions are gated (${String(classCount)} class(es), ${String(methodCount)} method(s) scanned;` +
      " none reads stored state and then awaits a non-storage round trip before writing it).",
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
