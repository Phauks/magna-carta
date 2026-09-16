/*
 * The native-build gate — the mechanism behind golden rule 14, which until this file had none.
 *
 * The rule says a C or C++ dependency, including a transitive native library, arrives only with
 * explicit owner consent, and that one already here or newly proposed must be SURFACED and asked
 * about rather than adopted silently. This gate is both halves: it prints everything native in the
 * tree with its language, its consumer and its status on every single run, and it FAILS when
 * something native arrives that nobody has written down.
 *
 * The register, the detectors, what this can see and what it cannot are all on register.mjs. Read
 * that header before adding an entry — particularly the part about what it cannot see, because the
 * gate is only worth what its stated limits are.
 *
 * Four surfaces, in the order they are checked:
 *   1. pnpm-workspace.yaml `onlyBuiltDependencies` — the named grants to run a build script.
 *   2. node_modules/.modules.yaml — the build scripts pnpm BLOCKED. Needs an install; without one
 *      this half prints a notice and is skipped, never passed silently.
 *   3. pnpm-lock.yaml — packages shipping a prebuilt platform binary, collapsed per tool.
 *   4. every tracked Cargo.lock — `*-sys` crates and crates that build with cc/cmake/bindgen.
 *
 * Run: `pnpm run lint:native-builds`. Exit 0 clean, 1 on an unregistered arrival, 2 when the gate
 * could not run. Node builtins only; no install, no build, no network.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  BLOCKED_BUILD_SCRIPTS,
  BUILD_SCRIPT_GRANTS,
  NATIVE_BINARY_FAMILIES,
  NATIVE_CRATES,
  SELF_TEST,
  SYSTEM_ENGINES,
  grantProblems,
  judge,
  readBuildScriptGrants,
  readNativeBinaryFamilies,
  readNativeCrates,
  standingNotices,
} from "./register.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

const read = (relative) => {
  try {
    return readFileSync(path.join(ROOT, relative), "utf8");
  } catch {
    return null;
  }
};

function selfTest() {
  const failures = [];
  for (const sample of SELF_TEST) {
    const actual = JSON.stringify(sample.run());
    const expected = JSON.stringify(sample.expect);
    if (actual !== expected) failures.push(`  "${sample.label}": got ${actual}, want ${expected}`);
  }
  if (failures.length > 0) {
    console.error(
      "native-build gate self-test FAILED — a detector no longer reads what it says:\n",
    );
    console.error(failures.join("\n"));
    process.exit(2);
  }
}

function main() {
  selfTest();

  const problems = [];
  const skipped = [];

  // 1. The named grants to run a build script.
  const workspace = read("pnpm-workspace.yaml");
  if (workspace === null) {
    console.error("native-build gate: pnpm-workspace.yaml is missing; the gate cannot run.");
    process.exit(2);
  }
  const granted = readBuildScriptGrants(workspace);
  if (granted === null) {
    console.error(
      "native-build gate: pnpm-workspace.yaml has no `onlyBuiltDependencies` block. That block IS " +
        "the audited allowlist this gate checks; without it pnpm's default (block every build " +
        "script) applies, but the register here now describes nothing. Restore the block, or " +
        "retire BUILD_SCRIPT_GRANTS deliberately rather than by deletion.",
    );
    process.exit(2);
  }
  problems.push(...grantProblems(granted));

  // 2. The build scripts pnpm blocked. Needs an install; a missing file is reported, not passed.
  const modules = read("node_modules/.modules.yaml");
  if (modules === null) {
    skipped.push(
      "blocked build scripts — node_modules/.modules.yaml is absent, so pnpm has not recorded " +
        "which install scripts it refused in this worktree. Run `pnpm install` and re-run; the " +
        "gate of record runs after an install, so this half is live in CI.",
    );
  } else {
    let recorded = [];
    try {
      const parsed = JSON.parse(modules);
      recorded = [...(parsed.ignoredBuilds ?? []), ...(parsed.pendingBuilds ?? [])];
    } catch {
      skipped.push(
        "blocked build scripts — node_modules/.modules.yaml did not parse. pnpm writes it as JSON " +
          "despite the name; a future format change would land here.",
      );
    }
    const names = [...new Set(recorded.map((entry) => entry.replace(/@[^@]*$/, "")))];
    problems.push(
      ...judge(
        "node_modules/.modules.yaml",
        names,
        BLOCKED_BUILD_SCRIPTS,
        (name) =>
          `\`${name}\` has an install script that pnpm refused to run. Add it to ` +
          "BLOCKED_BUILD_SCRIPTS in tooling/lint-native-builds/register.mjs with what it does and " +
          "why it stays blocked — a refusal nobody wrote down is a refusal that gets lifted by " +
          "whoever hits it next.",
      ),
    );
  }

  // 3. Prebuilt platform binaries in the npm graph.
  const lockfile = read("pnpm-lock.yaml");
  if (lockfile === null) {
    console.error("native-build gate: pnpm-lock.yaml is missing; the gate cannot run.");
    process.exit(2);
  }
  const families = readNativeBinaryFamilies(lockfile);
  if (families === null || families.length === 0) {
    console.error(
      "native-build gate: pnpm-lock.yaml yielded no platform-constrained packages. This tree has " +
        "many, so the lockfile format changed and the detector is reading nothing — which would " +
        "pass every run. Repoint readNativeBinaryFamilies rather than trusting this result.",
    );
    process.exit(2);
  }
  problems.push(
    ...judge(
      "pnpm-lock.yaml",
      families,
      NATIVE_BINARY_FAMILIES,
      (name) =>
        `\`${name}\` ships a prebuilt platform binary and is new to this tree. Add it to ` +
        "NATIVE_BINARY_FAMILIES in tooling/lint-native-builds/register.mjs with the language it " +
        "is written in. If that language is C or C++, golden rule 14 wants the owner's explicit " +
        "consent before it lands.",
    ),
  );

  // 4. The Cargo side.
  let cargoLocks;
  try {
    cargoLocks = execFileSync("git", ["ls-files", "-z", "*Cargo.lock"], {
      cwd: ROOT,
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    })
      .split("\0")
      .filter(Boolean);
  } catch (error) {
    console.error("native-build gate: could not list tracked Cargo.lock files.");
    console.error(String(error.stderr || error.message || error));
    process.exit(2);
  }
  if (cargoLocks.length === 0) {
    console.error(
      "native-build gate: no tracked Cargo.lock was found. The Rust workspaces moved or were " +
        "renamed, so the Cargo half of this gate is reading nothing.",
    );
    process.exit(2);
  }
  const crates = new Map();
  for (const file of cargoLocks) {
    for (const crate of readNativeCrates(readFileSync(path.join(ROOT, file), "utf8"))) {
      crates.set(crate, [...(crates.get(crate) ?? []), file]);
    }
  }
  problems.push(
    ...judge(
      "Cargo.lock",
      [...crates.keys()].sort((a, b) => a.localeCompare(b)),
      NATIVE_CRATES,
      (name) =>
        `\`${name}\` is new to the Cargo graph (in ${crates.get(name).join(", ")}) and either ends ` +
        "in -sys or builds with cc/cmake/bindgen — the signature of compiling or linking C or " +
        "C++. Add it to NATIVE_CRATES in tooling/lint-native-builds/register.mjs with what pulls " +
        "it in and whether a build here actually reaches it. If it does, golden rule 14 wants the " +
        "owner's explicit consent, and the trade recorded.",
    ),
  );

  // The standing surfacing. Printed every run, pass or fail: golden rule 14 asks for what is here
  // to be visible rather than assumed, and a register nobody reads is not a surfacing.
  const notices = standingNotices();
  const byStatus = new Map();
  for (const notice of notices) {
    byStatus.set(notice.status, [...(byStatus.get(notice.status) ?? []), notice]);
  }
  for (const status of ["consented", "pending-removal", "surfaced", "blocked"]) {
    const inStatus = byStatus.get(status);
    if (!inStatus) continue;
    console.log(`  ${status} — ${inStatus.length} entr${inStatus.length === 1 ? "y" : "ies"}:`);
    for (const notice of inStatus) {
      console.log(`    ${notice.name} [${notice.language}] — ${notice.reason}.`);
    }
  }
  for (const note of skipped) console.log(`  not checked: ${note}`);

  if (problems.length > 0) {
    console.error(
      "\nNative-build gate FAILED — something native is here that nobody wrote down:\n",
    );
    for (const problem of problems.sort((a, b) => a.name.localeCompare(b.name))) {
      console.error(`  ${problem.where}: ${problem.name}`);
      console.error(`    Fix: ${problem.fix}\n`);
    }
    console.error(`${problems.length} unregistered or stale entr(y/ies).`);
    process.exit(1);
  }

  console.log(
    `Native-build gate OK — ${granted.length} build-script grant(s), ${families.length} prebuilt ` +
      `binary famil(y/ies), ${crates.size} native crate(s) across ${cargoLocks.length} Cargo.lock ` +
      `file(s); all registered. ${NATIVE_CRATES.size + NATIVE_BINARY_FAMILIES.size + BUILD_SCRIPT_GRANTS.size + BLOCKED_BUILD_SCRIPTS.size + SYSTEM_ENGINES.size} register entr(y/ies).`,
  );
}

main();
