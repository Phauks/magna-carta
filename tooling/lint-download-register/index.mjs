/*
 * The download-register gate: the register is only worth reading if it is COMPLETE, and completeness
 * is not a property anybody can check by reading one route.
 *
 * A member's register answers "what did I download, and can I have it again". That answer is wrong —
 * silently, and in the direction that looks fine — the moment one delivery path forgets to register
 * what it handed over. That is exactly how this subsystem got here: `bundle` and `conversion` were
 * named in the schema's vocabulary from the day the table was built, an `artifactShelfStatement`
 * helper was written for them, and neither ever acquired a caller. Nothing failed. The register just
 * quietly described a third of reality, and the defect surfaced as a person saying "I downloaded
 * something and it did not appear".
 *
 * So this scan asserts the two halves that a reviewer cannot hold in their head:
 *
 *   1. ONE WRITER. `insertDownloadItemStatement` is imported by the register chokepoint and by
 *      nothing else. Every producer goes through `registerDownload`, which is what makes the kind,
 *      the key rules, the expiry and the state derived facts rather than seven independent choices —
 *      and it is why a matter file cannot be filed as presignable bytes.
 *   2. EVERY DELIVERY PATH REGISTERS. A module that hands a member bytes — it presigns a GET, or it
 *      returns an archive stream — must also call `registerDownload`. A new one that does neither is
 *      named here with the two ways to resolve it, so the gap is caught at the commit that opens it
 *      rather than by a member.
 *
 * Run: `pnpm run lint:download-register`.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

/** The one module allowed to write a register row. */
const CHOKEPOINT = "apps/api-worker/src/downloads/download-register.ts";

/** The statement only the chokepoint may reach for. */
const INSERT_STATEMENT = "insertDownloadItemStatement";

/** What the chokepoint is called at every call site. */
const REGISTER_CALL = "registerDownload(";

/*
 * Where bytes reach a member. A module matching one of these is a delivery path and owes a
 * registration; `presignGet` is the signed handle to an object, and `makeZip` is an archive streamed
 * straight to the response.
 */
const DELIVERY_SIGNALS = [/\bpresignGet\s*\(/, /\bmakeZip\s*\(/];

/*
 * Delivery paths that deliberately register nothing, each with the reason. A path is listed here
 * because what it hands over is NOT a download of the member's — never because registering it was
 * inconvenient. Adding an entry is the reviewed act; the list is meant to stay short.
 *
 * AN ENTRY THAT OUTLIVES ITS REASON FAILS THIS CHECK, like every other allowance list in this
 * repository. A path that has since started registering, or that no longer delivers at all, is not
 * quietly tolerated here: a stale allowance is how a list stops describing the code and starts
 * excusing it.
 */
const NOT_A_MEMBER_DOWNLOAD = new Map([
  [
    "apps/api-worker/src/downloads/bundle-consumer.ts",
    "builds the archive into the firm's bucket; the member is handed it by the poll route, and the " +
      "row was written when they asked for it",
  ],
  [
    "apps/api-worker/src/downloads/bundle-progress.ts",
    "the shared resolver behind the bundle poll and its socket — it names bytes the route hands " +
      "over, and the route is what registered them",
  ],
  [
    "apps/api-worker/src/editing/checkout-routes.ts",
    "a check-out hands the EDITOR the document so a session can open it, under a lock that is " +
      "given back. It is not a member taking a copy away, and filling a download register with " +
      "every editing session would bury the downloads somebody is actually looking for",
  ],
  [
    "apps/api-worker/src/files/presign.ts",
    "the presigner wiring itself — a seam every caller reaches through, which hands nothing to " +
      "anybody on its own",
  ],
  [
    "apps/api-worker/src/routes/dev-seed.ts",
    "development seeding, compiled out of a deployment; there is no member on the other end",
  ],
  [
    "apps/api-worker/src/routes/downloads-register.ts",
    "the register's OWN fetch route. Taking an item again records the format on the row that is " +
      "already there — writing a second row would make the register grow every time somebody read it",
  ],
  [
    "apps/api-worker/src/conversions/conversion-progress.ts",
    "the shared resolver behind the conversion poll and its socket; the row is written at submit " +
      "and advanced by the poll route, so this resolver names bytes it does not hand over",
  ],
]);

const SCAN_ROOTS = ["apps/api-worker/src"];

function sourceFilesUnder(directory) {
  const found = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const child = path.join(directory, entry.name);
    if (entry.isDirectory()) found.push(...sourceFilesUnder(child));
    else if (entry.isFile() && entry.name.endsWith(".ts")) found.push(child);
  }
  return found;
}

/** Comments explain; they never deliver. Stripping them keeps prose off both scans. */
function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/[^\n]*/g, "$1");
}

const relative = (file) => path.relative(ROOT, file).split(path.sep).join("/");

const problems = [];
const declaredAndStillNeeded = new Set();
let deliveryPaths = 0;

for (const root of SCAN_ROOTS) {
  const directory = path.join(ROOT, root);
  let exists = true;
  try {
    statSync(directory);
  } catch {
    exists = false;
  }
  if (!exists) continue;

  for (const file of sourceFilesUnder(directory)) {
    const name = relative(file);
    if (name.endsWith(".test.ts")) continue;
    const source = stripComments(readFileSync(file, "utf8"));

    // Rule 1 — one writer.
    if (source.includes(INSERT_STATEMENT) && name !== CHOKEPOINT) {
      problems.push(
        `${name}\n    reaches for \`${INSERT_STATEMENT}\` directly. A register row is written in one ` +
          `place — ${CHOKEPOINT} — so that the kind, the key rules, the expiry and the state follow ` +
          `from what a producer REPORTS rather than from what it remembers to set. Call ` +
          `\`registerDownload\` with what the member received.`,
      );
    }

    // Rule 2 — every delivery path registers.
    const delivers = DELIVERY_SIGNALS.some((signal) => signal.test(source));
    if (!delivers || name === CHOKEPOINT) continue;
    deliveryPaths += 1;
    if (source.includes(REGISTER_CALL)) continue;
    if (NOT_A_MEMBER_DOWNLOAD.has(name)) {
      declaredAndStillNeeded.add(name);
      continue;
    }
    problems.push(
      `${name}\n    hands a member bytes (it signs a GET, or streams an archive) and never calls ` +
        `\`registerDownload\`. A download nothing registers is a download the member cannot find ` +
        `afterwards, which is the defect this register exists to close. Either register what it ` +
        `hands over, or — if what it serves is not a member's download — add it to ` +
        `NOT_A_MEMBER_DOWNLOAD in tooling/lint-download-register/index.mjs with the reason.`,
    );
  }
}

for (const [name, reason] of NOT_A_MEMBER_DOWNLOAD) {
  if (declaredAndStillNeeded.has(name)) continue;
  problems.push(
    `${name}\n    is declared as serving something that is not a member's download — "${reason}" — ` +
      `but it no longer needs the allowance: it either registers now, or has stopped delivering ` +
      `bytes. Delete its entry from NOT_A_MEMBER_DOWNLOAD.`,
  );
}

if (problems.length > 0) {
  console.error("\nThe download register is not complete:\n");
  for (const problem of problems) console.error(`  ${problem}\n`);
  console.error(
    `${problems.length} problem(s). The register answers "what did I download, and can I have it ` +
      `again"; every path that hands bytes over owes it an answer.\n`,
  );
  process.exit(1);
}

console.log(
  `Download register: one writer (${CHOKEPOINT}), and ${deliveryPaths} delivery path(s) each ` +
    `either register or are declared as serving something that is not a member's download ` +
    `(${NOT_A_MEMBER_DOWNLOAD.size} declared).`,
);
