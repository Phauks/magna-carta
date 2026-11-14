// lint:ux-copy. Holds the mechanical part of docs/conventions/ux-copy.md: em dashes, the "Nothing
// answered" family, "is where" sentences, machinery words and the old Soon wording, in the shipped
// source of apps/web and packages/design-system.
//
// The copy already in the product is a per-file baseline (baseline.json) that may only shrink: a
// count that rises fails. A count that falls is reported, not failed, so another thread's copy fix
// never turns main red; `--update` writes the lower number down. It proves its
// own patterns on every run before it scans, so a pattern that stops matching cannot pass silently.
//
// Run: `pnpm run lint:ux-copy`, or `pnpm run lint:ux-copy --update` after fixing copy.

import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { RULES, compareWithBaseline, countViolations } from "./rules.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const BASELINE = fileURLToPath(new URL("./baseline.json", import.meta.url));
const TREES = ["apps/web/src", "packages/design-system/src"];
const SKIPPED =
  /(?:\.test\.|\.spec\.|\.stories\.|\/stories\/|\/developer-console\/|\/lib\/developer\/|\/fixtures?\/|fixtures?\.ts$|-fixture\.ts$|\/__tests__\/)/;

function selfTest() {
  const failures = [];
  const must = [
    ["em-dash", 'const message = "Saved the file — you can close this now";', false],
    ["nothing-answered", '"Nothing answered, so nothing changed."', false],
    ["is-where", "<p>An email address is where the invitation goes.</p>", true],
    ["machinery", '"Read by the platform."', false],
    ["old-soon-wording", '"Not built yet. Waiting on the engine."', false],
  ];
  for (const [rule, line, svelte] of must) {
    if (!(countViolations(line, svelte)[rule] > 0)) failures.push(`${rule} did not match: ${line}`);
  }
  const mustNot = [
    "// a comment — with a dash",
    "const corpus = load();",
    '"Couldn\'t connect. Try again."',
  ];
  for (const line of mustNot) {
    if (Object.keys(countViolations(line, false)).length > 0)
      failures.push(`matched clean line: ${line}`);
  }
  return failures;
}

function walk(directory, out) {
  for (const name of readdirSync(directory)) {
    if (name === "node_modules") continue;
    const full = join(directory, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|svelte)$/.test(name)) out.push(full);
  }
}

export function scan() {
  const files = [];
  for (const tree of TREES) walk(join(ROOT, tree), files);
  const counts = {};
  for (const file of files) {
    const path = relative(ROOT, file).split(sep).join("/");
    if (SKIPPED.test(`/${path}`)) continue;
    const found = countViolations(readFileSync(file, "utf8"), path.endsWith(".svelte"));
    if (Object.keys(found).length > 0)
      counts[path] = Object.fromEntries(Object.entries(found).sort());
  }
  return counts;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const problems = selfTest();
  if (problems.length > 0) {
    console.error(
      "lint-ux-copy: the scan's own patterns no longer behave:\n  " + problems.join("\n  "),
    );
    process.exit(1);
  }
  const current = scan();
  if (process.argv.includes("--update")) {
    writeFileSync(BASELINE, JSON.stringify(current, null, 2) + "\n");
    console.log(`lint-ux-copy: baseline written (${Object.keys(current).length} files).`);
    process.exit(0);
  }
  const baseline = JSON.parse(readFileSync(BASELINE, "utf8"));
  const { rose, fell } = compareWithBaseline(current, baseline);
  const why = Object.fromEntries(RULES.map((rule) => [rule.id, rule.why]));
  if (rose.length > 0) {
    console.error("lint-ux-copy: new copy breaks docs/conventions/ux-copy.md:");
    for (const item of rose)
      console.error(`  ${item.file}: ${item.rule} ${item.was} -> ${item.now}. ${why[item.rule]}`);
  }
  if (fell.length > 0) {
    console.error(
      "lint-ux-copy: copy got better. Run `pnpm run lint:ux-copy --update` to lock it in:",
    );
    for (const item of fell)
      console.error(`  ${item.file}: ${item.rule} ${item.was} -> ${item.now}`);
  }
  if (rose.length > 0 || fell.length > 0) process.exit(1);
  const total = Object.values(current).reduce(
    (sum, rules) => sum + Object.values(rules).reduce((a, b) => a + b, 0),
    0,
  );
  console.log(`lint-ux-copy: no new wording problems (${total} known, in the baseline).`);
}
