/*
 * The changelog-coverage gate. A change that touches first-party source brings a changelog fragment
 * with it.
 *
 * WHY IT EXISTS. Golden rule 5 says no feature is done until its docs, the roadmap and the changelog
 * are updated in the same commit, and for the changelog that means committing `changelog.d/<slug>.md`.
 * Nothing enforced it. `lint:changelog-fragments` validates the fragments that ARE there and has
 * nothing to say about the one that is not, so a merge with no fragment was caught only by the weekly
 * docs audit — days later, on main, which is production, where the author has moved on and the only
 * remaining repair is somebody else reconstructing what the change did from its diff. This moves that
 * catch to the pull request, where the fix is one file and the person who made the change is still
 * holding it.
 *
 * HOW IT DECIDES. The change set is the diff against the merge base with the trunk plus everything in
 * the working tree, read through tooling/check-scoped/changed-files.mjs — the same implementation
 * `pnpm check:scoped` and `pnpm fix:scoped` already agree on, imported rather than written a second
 * time, so "the current change" cannot come to mean two different things in one repository. What
 * counts as first-party source, what is deliberately carved out, and the shape of the escape hatch are
 * all in rules.mjs with the argument for each.
 *
 * THE THREE PLACES IT RUNS:
 *
 *   1. A BRANCH. The base is the merge base with origin/main and the gate does its job.
 *   2. A PUSH TO MAIN, OR A MERGE QUEUE. There is no branch-shaped change here to judge, and failing
 *      would be too late to be useful: on main the merge has already deployed, and in the queue the
 *      only thing a failure achieves is blocking a merge over a fragment that the pull-request tier
 *      should have asked for. So the gate stands down and SAYS SO, in one line, rather than passing
 *      silently — a gate that goes quiet without explaining itself is indistinguishable from one that
 *      has broken.
 *   3. A DOCS-ONLY OR TOOLING-ONLY CHANGE. No first-party source, nothing to record, pass.
 *
 * WHAT IT DELIBERATELY DOES NOT CATCH. Whether the fragment is ABOUT the change — a fragment for one
 * thing satisfies the gate for everything else in the same branch, and no lint can tell the
 * difference. It also says nothing about a fragment's contents; `pnpm run lint:changelog-fragments`
 * owns that half, and the two together mean a fragment both exists and is well formed. And the
 * configuration hole named in rules.mjs — a binding or dependency change arriving entirely alone —
 * is review's to catch.
 *
 * Run: `pnpm run lint:changelog-coverage`, or `node tooling/lint-changelog-coverage/index.mjs --base <ref>`
 * to measure against something other than the trunk merge base. Read-only git; no install, no build.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ROOT,
  collectChangedFiles,
  parseBaseFlag,
  resolveBase,
} from "../check-scoped/changed-files.mjs";
import { EXEMPTION_PREFIX, SELF_TEST, decide, readExemption } from "./rules.mjs";

const git = (args) =>
  execFileSync("git", args, {
    cwd: ROOT,
    encoding: "utf8",
    shell: process.platform === "win32",
  });

const lines = (out) =>
  out
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

/*
 * The one thing collectChangedFiles drops: a path that no longer exists. It drops it correctly — the
 * formatter and the linter can only be pointed at files that are there — but a deletion is a change
 * with as much to say as an addition, and a change that removes a capability is exactly the kind that
 * must not merge unrecorded. So the deletions are added back here rather than the shared collector
 * being bent to serve two different questions.
 */
export function deletedFiles(base) {
  return [
    ...lines(git(["diff", "--name-only", "--diff-filter=D", `${base}...HEAD`])),
    ...lines(git(["diff", "--name-only", "--diff-filter=D", "HEAD"])),
    ...lines(git(["diff", "--name-only", "--diff-filter=D", "--cached"])),
  ];
}

/**
 * Whether this run has a branch-shaped change to judge at all.
 *
 * Asked of git rather than of the environment, because the answer has to be right when the gate is run
 * by hand as well as by a workflow. HEAD already being contained in the trunk means one of exactly two
 * things — this IS the trunk, or the branch has no commits of its own — and neither is a change a
 * changelog can be demanded of. The GitHub event name is honoured as well where it is set, because a
 * merge-queue run builds a commit that the trunk does not yet contain and git alone would read it as a
 * branch.
 */
export function onTrunk({ base, head, eventName }) {
  if (eventName === "push" || eventName === "merge_group") return true;
  return base === head;
}

// The gate's own rules, checked against their fixtures on every invocation, so a rule that stops
// biting fails here as well as in the suite.
export function runSelfTest() {
  const failures = [];
  for (const scenario of SELF_TEST) {
    const found = decide({ onTrunk: scenario.onTrunk, changed: scenario.changed });
    if (found.outcome !== scenario.expect) {
      failures.push({ name: scenario.name, found: found.outcome, wanted: scenario.expect });
    }
    if (
      scenario.fragments !== undefined &&
      JSON.stringify(found.fragments) !== JSON.stringify(scenario.fragments)
    ) {
      failures.push({
        name: `${scenario.name} (fragments)`,
        found: found.fragments,
        wanted: scenario.fragments,
      });
    }
  }
  const malformed = [
    ["no frontmatter at all", "a rename, nothing more\n"],
    ["a frontmatter block with no reason", "---\ncategory: Changed\n---\n"],
    ["an empty reason", "---\nreason:   \n---\n"],
  ];
  for (const [name, markdown] of malformed) {
    if (readExemption(markdown).problem === null) {
      failures.push({
        name: `an exemption with ${name} is refused`,
        found: "accepted",
        wanted: "refused",
      });
    }
  }
  if (
    readExemption("---\nreason: a revert of work that never reached main\n---\n").reason === null
  ) {
    failures.push({ name: "a well-formed exemption is read", found: null, wanted: "a reason" });
  }
  return failures;
}

function main() {
  const selfTestFailures = runSelfTest();
  if (selfTestFailures.length > 0) {
    console.error("\nlint-changelog-coverage: the gate's own rules no longer do what they must.\n");
    for (const failure of selfTestFailures) {
      console.error(
        `  ${failure.name}\n    expected: ${JSON.stringify(failure.wanted)}\n    got:      ${JSON.stringify(failure.found)}`,
      );
    }
    process.exit(1);
  }

  const explicitBase = parseBaseFlag(process.argv.slice(2));
  const base = resolveBase({ explicitBase });
  const head = git(["rev-parse", "HEAD"]).trim();
  const trunk = onTrunk({ base, head, eventName: process.env.GITHUB_EVENT_NAME });

  if (trunk) {
    console.log(
      "Changelog coverage: no branch-shaped change to judge (this run is on the trunk or in the" +
        " merge queue), so the gate stands down — a missing fragment is the pull request's to catch," +
        " and by here the merge has already deployed.",
    );
    return;
  }

  const changed = [...collectChangedFiles({ base }), ...deletedFiles(base)];
  const verdict = decide({ onTrunk: false, changed: [...new Set(changed)] });

  if (verdict.outcome === "no-source") {
    console.log(
      `Changelog coverage: nothing to record — ${String(changed.length)} changed path(s), none of them first-party source (docs, tooling, workflows, manifests and configuration are out; see rules.mjs).`,
    );
    return;
  }

  if (verdict.outcome === "exempt") {
    // An exemption is read, validated and PRINTED. A claim nobody sees stops being a claim, and the
    // reason is the only artifact this gate produces when it lets something through.
    const problems = [];
    for (const file of verdict.exemptions) {
      const absolute = path.join(ROOT, file);
      if (!existsSync(absolute)) continue; // deleted in this change: it grants nothing
      const { reason, problem } = readExemption(readFileSync(absolute, "utf8"));
      if (problem === null) {
        console.log(`Changelog coverage: exempted by ${file} — ${reason}`);
      } else {
        problems.push(`  ${file}  ${problem}`);
      }
    }
    if (problems.length === 0) {
      console.log(
        `  ${String(verdict.source.length)} source file(s) changed with no fragment, and an exemption written for them.`,
      );
      return;
    }
    console.error("\nAn exemption that does not say why exempts nothing:\n");
    console.error(problems.join("\n"));
    console.error(
      `\nFormat:\n  ---\n  reason: <one line saying why this change has nothing to record>\n  ---\n`,
    );
    process.exit(1);
  }

  if (verdict.outcome === "covered") {
    const named = verdict.fragments.slice(0, 3).join(", ");
    const rest =
      verdict.fragments.length > 3 ? ` and ${String(verdict.fragments.length - 3)} more` : "";
    console.log(
      `Changelog coverage: ${String(verdict.source.length)} source file(s) changed, ${String(verdict.fragments.length)} fragment(s) written — ${named}${rest}.`,
    );
    return;
  }

  console.error("\nFirst-party source changed with no changelog fragment:\n");
  for (const file of verdict.source.slice(0, 20)) console.error(`  ${file}`);
  if (verdict.source.length > 20) {
    console.error(`  … and ${String(verdict.source.length - 20)} more`);
  }
  console.error(
    `\n${String(verdict.source.length)} source file(s) since ${base.slice(0, 12)}. No feature is done until its` +
      " changelog entry is committed with it, and the rendered CHANGELOG.md is assembled on main, so" +
      " what a branch writes is the fragment:\n" +
      "\n  changelog.d/<a-short-kebab-case-slug>.md\n" +
      "  ---\n  category: Added | Changed | Deprecated | Removed | Fixed | Security\n  audience: public | internal\n  ---\n" +
      "\n  **What changed, in the repository's own language.**\n" +
      "\nFormat and the audience rule: changelog.d/README.md.\n" +
      `\nIf this change genuinely has nothing to record — a rename with no behaviour in it, a revert of` +
      ` work that never reached main — say so in a file, where a reviewer sees it:\n` +
      `\n  ${EXEMPTION_PREFIX}<a-short-kebab-case-slug>.md\n  ---\n  reason: <one line>\n  ---\n`,
  );
  process.exit(1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
