import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { containsEmoji } from "./doc-fragments/changelog.mjs";
import { publicCopyProblems } from "./doc-fragments/public-copy.mjs";
import { parseArea, renderBuildRegister } from "./doc-fragments/roadmap.mjs";

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
//   3. docs/now.md matches a fresh render of the ledger, byte for byte.
//
// The third is the point of the whole design. A capability that ships flips one word in its ledger
// node, and this gate refuses the two ways a derived document rots: flipping the node without
// rebuilding, and hand-editing the rendered file. Same contract as the committed OpenAPI snapshot.
//
// Run: `pnpm run lint:roadmap`.

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

    if (node.awaitingOwner !== null && node.awaitingOwner.trim() === "") {
      problems.push(
        `${where}  has an empty awaiting-owner — state the question, or drop the key; a flag with no question has moved the problem rather than solved it`,
      );
    }
    if (node.awaitingOwner !== null && containsEmoji(node.awaitingOwner)) {
      problems.push(`${where}  awaiting-owner contains an emoji`);
    }
  }
}

// The drift gate. Only meaningful if every area parsed — a partial ledger renders a shorter document
// and would report the difference as drift rather than as the parse failure it is.
if (problems.length === 0) {
  for (const [path, rendered] of [["docs/now.md", renderBuildRegister(areas)]]) {
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
  `Feature ledger valid (${seen.size} node(s) across ${areas.length} area(s), ${publicNodes} marked public and not yet published); docs/now.md is current.`,
);
