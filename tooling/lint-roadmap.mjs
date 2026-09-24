import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadHistory } from "./doc-fragments/build-register-history.mjs";
import { containsEmoji } from "./doc-fragments/changelog.mjs";
import { renderDecisionDesk } from "./doc-fragments/decision-desk.mjs";
import { publicCopyProblems } from "./doc-fragments/public-copy.mjs";
import { renderBuildRegisterArtifact } from "./doc-fragments/register-artifact.mjs";
import {
  RENDERED_REGISTER_FILES,
  registerRenderRefusal,
  renderedFilesChangedOnBranch,
} from "./doc-fragments/register-renderers.mjs";
import {
  STATUSES_WITH_SOMETHING_BUILT,
  parseArea,
  renderBuildRegister,
  rollUpIds,
} from "./doc-fragments/roadmap.mjs";

// Fitness function for the roadmap.d/* feature ledger and the document rendered from it (mirrors
// lint-status.mjs). Three jobs, in increasing order of what they carry:
//
//   1. The ledger parses, ids are unique, and the status/audience vocabularies hold.
//   2. Anything marked `audience: public` carries a summary written for a user — no decision
//      numbers, no slice or phase numbers, no file paths, no package names, no emoji, and no date
//      or quarter. Enforced on the fragment because a fragment can still be edited and a published
//      document cannot, which is the same reasoning lint-changelog-fragments gives. Nothing is
//      published from those keys today — the public rendering has no audience yet — and the check
//      stays on so the copy is already sound on the day it does.
//   3. `surface:` is set where it means something and absent where it does not — see below.
//   4. Where the register is RENDERED — on main, and on the assembly and docs-sync branches that
//      render it — docs/now.md, docs/now.html and docs/decisions-open.html all match a fresh render
//      of the ledger, byte for byte. On every other branch the three files must be UNTOUCHED
//      against where the branch left the trunk: a branch's change is its edit to roadmap.d/, and
//      the rendering follows on main.
//
// The fourth is the point of the whole design. A capability that ships flips one word in its ledger
// node, and this gate refuses the two ways a derived document rots: flipping the node without
// rebuilding, and hand-editing the rendered file. Same contract as the committed OpenAPI snapshot.
// Both renderings are held to it, because the published page is the one the owner actually reads and
// a page that is only regenerated when somebody remembers is the hand-maintained copy again.
//
// Why a branch does not render: it used to, and every two branches that each flipped a node then
// rewrote the same whole document and conflicted on it — fifteen of forty merges in a row, on a file
// nobody had written by hand. The register is a derived view of the trunk, so the trunk renders it
// (tooling/doc-fragments/register-renderers.mjs says who), and a branch that carries the rendered
// files fails here rather than at the merge.
//
// Run: `pnpm run lint:roadmap`. Pass `--rendered` to hold the files to a fresh render wherever you
// are, which is what a renderer does after rendering.

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const LEDGER_DIR = join(ROOT, "roadmap.d");
const RESERVED = new Set(["README.md"]);

const problems = [];
const areas = [];

for (const name of readdirSync(LEDGER_DIR)
  .filter((entry) => entry.endsWith(".md") && !RESERVED.has(entry))
  .toSorted()) {
  try {
    areas.push(parseArea(readFileSync(join(LEDGER_DIR, name), "utf8"), name));
  } catch (error) {
    problems.push(error.message);
  }
}

// Which nodes are roll-up parents, read off the id set. Needed by the `surface:` rules: a parent's
// reach is whatever its children's is, so a parent that carried its own value would be a second
// answer to a question its subtree has already answered, free to disagree with all of them.
const parents = rollUpIds(areas.flatMap((area) => area.nodes));

const seen = new Map();
for (const area of areas) {
  for (const node of area.nodes) {
    if (seen.has(node.id)) {
      problems.push(
        `roadmap.d/${area.name}:${node.line}  duplicate id "${node.id}" (also in roadmap.d/${seen.get(node.id)}) — ids are stable and unique forever`,
      );
    }
    seen.set(node.id, area.name);

    const where = `roadmap.d/${area.name}:${node.line}  ${node.id}`;

    if (node.audience === "public") {
      if (node.publicSummary === null) {
        problems.push(
          `${where}  is audience: public with no public-summary — the sentence users read is written, never derived from scope:`,
        );
      } else {
        for (const problem of publicCopyProblems(node.publicSummary, "public-summary")) {
          problems.push(`${where}  ${problem}`);
        }
      }
      for (const problem of publicCopyProblems(node.publicName, "public-name")) {
        problems.push(`${where}  ${problem}`);
      }
    } else if (node.publicSummary !== null) {
      problems.push(
        `${where}  carries a public-summary but is not audience: public — the summary would never be published`,
      );
    }

    // A blank `awaiting-owner:` is caught where the file is parsed, not here: every optional key
    // reads absent and blank as the same value below the parser, so by this point there is nothing
    // left to see. The rule that used to live here could not fire and said nothing about it.
    if (node.awaitingOwner !== null && containsEmoji(node.awaitingOwner)) {
      problems.push(`${where}  awaiting-owner contains an emoji`);
    }

    // `surface:` answers "can anybody reach this", which is only a question once something exists to
    // be reached. Required on every leaf with code behind it — a shipped backend nobody can open and
    // a screen somebody uses daily are both `shipped`, and leaving the key off is what let the two
    // read as one number. Refused everywhere else, so the key can never be a second opinion: a
    // roll-up parent's reach is its children's, and a capability nothing has been written for has no
    // reach to record beyond what its status already says.
    const somethingIsBuilt = STATUSES_WITH_SOMETHING_BUILT.includes(node.status);
    if (parents.has(node.id)) {
      if (node.surface !== null) {
        problems.push(
          `${where}  is a roll-up parent and carries surface: ${node.surface} — a parent's reach is its children's, so the key belongs on them`,
        );
      }
    } else if (somethingIsBuilt) {
      if (node.surface === null) {
        problems.push(
          `${where}  is ${node.status} with no surface: — say whether a person can reach it (screen), whether only the interface is missing (awaiting-screen), or whether it has no user surface by nature (internal)`,
        );
      }
    } else if (node.surface !== null) {
      problems.push(
        `${where}  is ${node.status} and carries surface: ${node.surface} — nothing is built to be reached, which the status already says`,
      );
    }
  }
}

// The drift gate. Only meaningful if every area parsed — a partial ledger renders a shorter document
// and would report the difference as drift rather than as the parse failure it is.
//
// The register renders from two committed inputs, so the gate re-derives from both: the ledger, and
// the reconstruction of its own past in docs/register-history.json. Reading the history file here
// rather than rebuilding it is the point — the gate must be fast and must not depend on the git
// history being present, and the file is what the document was rendered from.
const refusal = process.argv.includes("--rendered") ? null : registerRenderRefusal(ROOT);
if (problems.length === 0 && refusal !== null) {
  // A branch. The files must be exactly what the trunk had where this branch left it.
  const changed = renderedFilesChangedOnBranch(ROOT);
  if (changed === null) {
    console.log(
      `lint:roadmap: ${refusal}; origin/main is not available here, so the rendered files were not compared`,
    );
  } else if (changed.length > 0) {
    problems.push(
      `${changed.join(", ")} changed on this branch — the register renders on main, never on a branch (${refusal}). Restore them from the trunk: git checkout origin/main -- ${RENDERED_REGISTER_FILES.join(" ")}`,
    );
  }
}
if (problems.length === 0 && refusal === null) {
  let history = null;
  try {
    history = loadHistory();
  } catch (error) {
    problems.push(`docs/register-history.json is malformed: ${error.message}`);
  }
  if (history === null && problems.length === 0) {
    problems.push(
      "docs/register-history.json is missing — the register's history is reconstructed into it and rendered from it, never written by hand; run `vp run register-build`",
    );
  }
  for (const [path, rendered] of problems.length > 0
    ? []
    : [
        ["docs/now.md", renderBuildRegister(areas, history)],
        ["docs/now.html", renderBuildRegisterArtifact(areas)],
        ["docs/decisions-open.html", renderDecisionDesk(areas)],
      ]) {
    const absolute = join(ROOT, path);
    const onDisk = existsSync(absolute) ? readFileSync(absolute, "utf8") : null;
    if (onDisk === rendered) continue;
    problems.push(
      onDisk === null
        ? `${path} does not exist — it is rendered from roadmap.d/, never written by hand`
        : `${path} differs from a fresh render of roadmap.d/ at ${firstDifference(onDisk, rendered)}`,
    );
  }
}

function firstDifference(onDisk, rendered) {
  const left = onDisk.split("\n");
  const right = rendered.split("\n");
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    if (left[index] === right[index]) continue;
    return `line ${index + 1}:\n      on disk:   ${left[index] ?? "(end of file)"}\n      rendered:  ${right[index] ?? "(end of file)"}`;
  }
  return "an unknown line";
}

if (problems.length > 0) {
  console.error("\nThe feature ledger (roadmap.d/*) failed validation:\n");
  console.error(problems.map((problem) => `  ${problem}`).join("\n"));
  console.error(
    `\n${problems.length} problem(s). Format: roadmap.d/README.md. Fix the node(s) and re-run \`vp run register-build\`.`,
  );
  process.exit(1);
}

const publicNodes = areas.reduce(
  (total, area) => total + area.nodes.filter((node) => node.audience === "public").length,
  0,
);
console.log(
  refusal === null
    ? `Feature ledger valid (${seen.size} node(s) across ${areas.length} area(s), ${publicNodes} marked public and not yet published); docs/now.md + docs/now.html + docs/decisions-open.html are current.`
    : `Feature ledger valid (${seen.size} node(s) across ${areas.length} area(s), ${publicNodes} marked public and not yet published); the rendered register is untouched on this branch and renders on main.`,
);
