/*
 * The container gate. Eleven container workspaces run the untrusted-byte side of this platform, and
 * one of them holds the tree's only deliberately-consented C/C++ engine — and until this file there
 * was no gate on any Dockerfile in the repository.
 *
 * The rules, the two ratchet tables, and everything this deliberately leaves to review are on
 * rules.mjs. What matters here is how it RUNS: it walks `git ls-files` for every tracked path
 * whose basename is `Dockerfile` or starts/ends with it (`Dockerfile.validate-prefilter`,
 * `wasm.Dockerfile`), parses each one, and applies the rule table. No Docker daemon, no registry
 * call, no install — text over tracked files, the same posture as the license gate.
 *
 * Both ratchet tables are printed on every run, pass or fail. A standing exemption nobody sees is
 * an exemption that stops being read as one.
 *
 * Run: `pnpm run lint:containers`. Exit 0 clean, 1 with findings, 2 when the scan could not run.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ROOT_RUNTIME_STAGES,
  RULES,
  SELF_TEST,
  TAG_ONLY_BASES,
  check,
  isDockerfile,
} from "./rules.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

/**
 * The rule table is exercised on every invocation, positive and negative, so a parser or pattern
 * regression fails loudly instead of silently permitting.
 */
function selfTest() {
  const failures = [];
  for (const sample of SELF_TEST) {
    const found = check(sample.file, sample.source);
    if (sample.rule === null) {
      if (found.length > 0) {
        failures.push(`  "${sample.label}" should be silent, but [${found[0].rule}] fired`);
      }
      continue;
    }
    if (!found.some((one) => one.rule === sample.rule)) {
      failures.push(
        `  "${sample.label}" should fire [${sample.rule}], but ${found.length === 0 ? "nothing fired" : `only [${found.map((one) => one.rule).join(", ")}] did`}`,
      );
    }
  }
  if (failures.length > 0) {
    console.error(
      "container gate self-test FAILED — the rule table no longer does what it says:\n",
    );
    console.error(failures.join("\n"));
    process.exit(2);
  }
}

/**
 * The tables are only a backlog while every entry still names something real. An entry pointing at
 * a Dockerfile that no longer exists is a rule that quietly stopped applying, so it fails the gate.
 */
function findStaleAllowances(files) {
  const present = new Set(files);
  return [...ROOT_RUNTIME_STAGES.keys()]
    .filter((file) => !present.has(file))
    .map((file) => ({
      rule: "stale-allowance",
      file,
      line: 1,
      detail: "ROOT_RUNTIME_STAGES names a Dockerfile that is no longer tracked",
      fix:
        "Remove the entry from ROOT_RUNTIME_STAGES in tooling/lint-containers/rules.mjs. The " +
        "backlog may shrink, and this is how it shrinks — but an entry pointing at nothing is a " +
        "rule that stopped applying without anybody deciding it should.",
    }));
}

function main() {
  selfTest();

  let raw;
  try {
    raw = execFileSync("git", ["ls-files", "-z"], {
      cwd: ROOT,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (error) {
    console.error("container gate: could not list tracked files (`git ls-files`).");
    console.error(String(error.stderr || error.message || error));
    process.exit(2);
  }

  const files = raw.split("\0").filter(Boolean).filter(isDockerfile).sort();
  // A gate that silently walks nothing passes every time. Fail loudly instead.
  if (files.length === 0) {
    console.error(
      "container gate: no tracked Dockerfile was found. The container workspaces moved or were " +
        "renamed, so these rules no longer point anywhere — repoint them rather than trusting a " +
        "run that read nothing.",
    );
    process.exit(2);
  }

  const findings = [...findStaleAllowances(files)];
  for (const file of files) {
    findings.push(...check(file, readFileSync(path.join(ROOT, file), "utf8")));
  }

  // Printed pass or fail: these are the properties the tree does NOT have, and they stay visible.
  console.log(`  ratchet [base-image-digest] ${TAG_ONLY_BASES.size} base image(s) pinned by tag:`);
  for (const [reference, reason] of TAG_ONLY_BASES) console.log(`    ${reference} — ${reason}.`);
  console.log(
    `  ratchet [runtime-user] ${ROOT_RUNTIME_STAGES.size} runtime image(s) still running as root:`,
  );
  for (const [file, reason] of ROOT_RUNTIME_STAGES) console.log(`    ${file} — ${reason}.`);

  if (findings.length > 0) {
    const byRule = new Map();
    for (const one of findings) byRule.set(one.rule, [...(byRule.get(one.rule) ?? []), one]);
    console.error("\nContainer gate FAILED:\n");
    for (const [rule, inRule] of [...byRule].sort(([a], [b]) => a.localeCompare(b))) {
      console.error(`  [${rule}]`);
      for (const one of inRule.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)) {
        console.error(`    ${one.file}:${one.line}`);
        console.error(`      This is where ${one.detail}.`);
        console.error(`      Fix: ${one.fix}\n`);
      }
    }
    console.error(`${findings.length} problem(s) across ${byRule.size} rule(s).`);
    process.exit(1);
  }

  console.log(
    `Container gate OK — ${files.length} tracked Dockerfile(s) checked against ${RULES.length} rules.`,
  );
}

main();
