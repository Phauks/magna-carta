/*
 * The secret gate. A credential committed to git is compromised the moment it is pushed, and stays
 * compromised in the object database long after the commit that removed it — so the only cheap
 * moment to catch one is before it lands. This platform holds firm credentials, the root
 * key-encryption key that wraps every per-firm data key, and privileged client documents; there
 * was no scan of any kind here before this file.
 *
 * The rules, their carve-outs and everything this deliberately does NOT catch are on rules.mjs.
 * Two properties are worth restating here because they govern how this RUNS:
 *
 *   - IN-HOUSE ONLY, like the license gate. A hosted secret scanner is handed, by construction,
 *     exactly the bytes it is hunting for. This is text matching with node builtins — no install,
 *     no network, no service, no third-party tool.
 *   - NOTHING SECRET IS PRINTED. A finding reports path, line, rule and a redacted fingerprint
 *     (leading characters and a length). A scan that echoes the credential into a build log has
 *     moved it from one durable store to another.
 *
 * The scan walks `git ls-files`, so it sees exactly what a push would carry: tracked text files,
 * skipping known binary extensions and anything with a NUL byte in its first block. This tool's
 * own directory is NOT skipped — every pattern is written so its own source cannot satisfy it, so
 * a real secret dropped in here is caught like any other.
 *
 * Run: `pnpm run lint:secrets`. Exit 0 clean, 1 with findings, 2 when the scan could not run.
 */
import { execFileSync } from "node:child_process";
import { openSync, readFileSync, readSync, closeSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BINARY_EXTENSIONS, RULES, SELF_TEST, scan } from "./rules.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

/** Above this a file is an artefact, not authored text. Nothing tracked here approaches it. */
const MAXIMUM_FILE_BYTES = 4 * 1024 * 1024;

/**
 * The rule table is exercised on every invocation, positive and negative, so a regression in a
 * pattern fails loudly instead of silently permitting. The samples are assembled from fragments in
 * rules.mjs; none of their matching text appears as a literal anywhere in this tool.
 */
function selfTest() {
  const failures = [];
  for (const sample of SELF_TEST) {
    const found = scan(sample.file, sample.source);
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
    console.error("secret gate self-test FAILED — the rule table no longer does what it says:\n");
    console.error(failures.join("\n"));
    process.exit(2);
  }
}

/** True when the first block holds a NUL byte, which no authored text file does. */
function looksBinary(absolute) {
  let handle;
  try {
    handle = openSync(absolute, "r");
  } catch {
    return true;
  }
  try {
    const buffer = Buffer.alloc(4096);
    const read = readSync(handle, buffer, 0, buffer.length, 0);
    return buffer.subarray(0, read).includes(0);
  } catch {
    return true;
  } finally {
    closeSync(handle);
  }
}

function trackedFiles() {
  let raw;
  try {
    raw = execFileSync("git", ["ls-files", "-z"], {
      cwd: ROOT,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (error) {
    console.error("secret gate: could not list tracked files (`git ls-files`).");
    console.error(String(error.stderr || error.message || error));
    process.exit(2);
  }
  return raw.split("\0").filter(Boolean);
}

function main() {
  selfTest();

  const files = trackedFiles();
  // A scan that silently walks nothing passes every time. Fail loudly instead.
  if (files.length === 0) {
    console.error(
      "secret gate: `git ls-files` returned nothing. The scan would pass by reading zero files, " +
        "which is the one failure mode a secret gate must never have — fix the invocation rather " +
        "than trusting this run.",
    );
    process.exit(2);
  }

  const findings = [];
  let scanned = 0;
  let skipped = 0;
  for (const file of files) {
    if (BINARY_EXTENSIONS.has(path.extname(file).toLowerCase())) {
      skipped += 1;
      continue;
    }
    const absolute = path.join(ROOT, file);
    let size;
    try {
      size = statSync(absolute).size;
    } catch {
      // A tracked path with no working-tree file (a sparse checkout, a submodule) is not readable.
      skipped += 1;
      continue;
    }
    if (size > MAXIMUM_FILE_BYTES || looksBinary(absolute)) {
      skipped += 1;
      continue;
    }
    let source;
    try {
      source = readFileSync(absolute, "utf8");
    } catch {
      skipped += 1;
      continue;
    }
    scanned += 1;
    findings.push(...scan(file, source));
  }

  if (findings.length > 0) {
    const byRule = new Map();
    for (const one of findings) byRule.set(one.rule, [...(byRule.get(one.rule) ?? []), one]);
    console.error("Secret gate FAILED — credential-shaped values are tracked in this tree:\n");
    for (const [rule, inRule] of [...byRule].sort(([a], [b]) => a.localeCompare(b))) {
      console.error(`  [${rule}]`);
      for (const one of inRule.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)) {
        console.error(`    ${one.file}:${one.line}  ${one.evidence}`);
        console.error(`      Fix: ${one.fix}\n`);
      }
    }
    console.error(
      `${findings.length} finding(s) across ${byRule.size} rule(s). Treat every one as LIVE until ` +
        "a person says otherwise: rotate first, then remove the literal, then push. Removing the " +
        "line is not enough on its own — the value stays readable in the object database.",
    );
    process.exit(1);
  }

  console.log(
    `Secret gate OK — ${scanned} tracked text file(s) scanned against ${RULES.length} rules, ` +
      `${skipped} binary or oversized file(s) skipped, no credential-shaped values found.`,
  );
}

main();
