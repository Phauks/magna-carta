/*
 * The screen-data gate. Three properties the type system cannot see, and one ratchet.
 *
 * WHY A GATE AT ALL, GIVEN THE TYPES DO MOST OF THIS. Most of the discipline here is enforced by
 * making the wrong thing unrepresentable rather than forbidden: DataTable.Grid has no `empty`
 * snippet to pass, NoResults takes no props, and the generated client is the only thing that knows
 * the contract's paths. That is the better mechanism and it is used wherever it reaches. What it
 * cannot reach is a NEGATIVE ("do not hand-write a transport") and a PLACEMENT ("start the read in
 * the route's load, not on mount") — a screen that fetches on mount type-checks perfectly and is
 * simply slower, which is exactly the kind of regression nobody notices in review.
 *
 * Usage: node tooling/lint-screen-data/index.mjs
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const WEB_SOURCE = path.join(ROOT, "apps", "web", "src");
const API_SEAM = path.join(WEB_SOURCE, "lib", "api");

/*
 * The hand-written transport is on its way out, not gone: 56 files still spell a contract path by
 * hand while their screens migrate to @magna-carta/api-client, across 48 modules and ~12,000 lines
 * mirroring 459 types the generator already emits. A budget rather than a ban, because a ban today
 * would mean migrating all of it in one commit — and a budget that can only fall is what the ban was
 * for. LOWER THIS NUMBER as screens migrate; never raise it. When it reaches zero, delete the budget
 * and ./request.ts with it, and the rule becomes the ban it was always going to be.
 */
const HAND_WRITTEN_TRANSPORT_BUDGET = 56;

/*
 * Screens whose reads legitimately do not start in a load. A tool that reads only once a member has
 * typed something has nothing to warm on arrival, and a developer-console gallery renders fixtures.
 * Every entry is a path, so a rename surfaces here rather than silently widening the exemption.
 */
const READS_ON_DEMAND = new Set([
  "apps/web/src/routes/(app)/tools/whois-lookup/+page.svelte",
  "apps/web/src/routes/(app)/tools/safe-website-viewer/+page.svelte",
  "apps/web/src/routes/(app)/tools/network-speed-test/+page.svelte",
  "apps/web/src/routes/(app)/matters/[id]/search/+page.svelte",
]);

const relative = (file) => path.relative(ROOT, file).split(path.sep).join("/");

function filesUnder(directory, extensions) {
  if (!existsSync(directory)) return [];
  const found = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const child = path.join(directory, entry.name);
    if (entry.isDirectory()) found.push(...filesUnder(child, extensions));
    else if (extensions.some((extension) => entry.name.endsWith(extension))) found.push(child);
  }
  return found;
}

const problems = [];
const note = (file, rule, message) => problems.push({ file: relative(file), rule, message });

/*
 * Comments are prose, and prose about the seam says the seam's own words. A gate that trips on a
 * comment explaining why a path moved is a gate somebody turns off, so every rule below reads the
 * CODE: block comments, line comments and markup comments are blanked first. Crude by design —
 * this is not a parser, and a `//` inside a string only costs a rule the rest of that line.
 */
function codeOf(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
}

const sourceFiles = filesUnder(WEB_SOURCE, [".svelte", ".ts"]);
const read = new Map(sourceFiles.map((file) => [file, codeOf(readFileSync(file, "utf8"))]));

/*
 * RULE 1 — the contract's paths live in the generated client, not in a string.
 *
 * A `/api/v1/...` literal outside the seam is a module about to become the forty-ninth hand-written
 * mirror of a contract that CI already generates and diff-gates. The seam itself is exempt because
 * something has to hold the outgoing one until it is empty.
 */
let handWrittenTransport = 0;
for (const [file, text] of read) {
  if (file.startsWith(API_SEAM)) continue;
  if (!/["'`]\/api\/v1\//.test(text)) continue;
  handWrittenTransport += 1;
  if (handWrittenTransport > HAND_WRITTEN_TRANSPORT_BUDGET) {
    note(file, "hand-written-path", "spells a contract path by hand");
  }
}

/*
 * RULE 2 — a screen's reads start in its load, where the hover preload can reach them.
 *
 * `data-sveltekit-preload-data="hover"` runs a route's LOAD on hover, so a read placed there starts
 * while the pointer is still on the link and the screen renders from a warm cache. The same read
 * placed in an effect cannot start until the chunk has been fetched, parsed and mounted — which is
 * the waterfall this whole seam exists to end, and it comes back one screen at a time.
 */
const pageComponents = sourceFiles.filter((file) => path.basename(file) === "+page.svelte");
let screensReading = 0;
for (const file of pageComponents) {
  const text = read.get(file) ?? "";
  if (!/\bcreate(Infinite)?Query\s*\(/.test(text)) continue;
  screensReading += 1;
  if (READS_ON_DEMAND.has(relative(file))) continue;
  const directory = path.dirname(file);
  const warmed = ["+page.ts", "+layout.ts"]
    .map((name) => path.join(directory, name))
    .some(
      (sibling) =>
        existsSync(sibling) && /\bwarm\w*\s*\(/.test(codeOf(readFileSync(sibling, "utf8"))),
    );
  if (!warmed) {
    note(file, "cold-navigation", "reads on mount with nothing warming it from its load");
  }
}

/*
 * RULE 3 — one cache, made once.
 *
 * A second QueryClient answers the same questions as the first and shares nothing with it, so a
 * screen built against it would re-read everything the app already holds and never see a write the
 * rest of the app made.
 */
for (const [file, text] of read) {
  if (file === path.join(API_SEAM, "screen-data.ts")) continue;
  if (/new QueryClient\s*\(/.test(text)) {
    note(
      file,
      "second-cache",
      "builds its own QueryClient instead of using $lib/api/screen-data.ts",
    );
  }
}

if (problems.length > 0) {
  console.error("Screen data reads are drifting off the seam:\n");
  for (const problem of problems) {
    console.error(`  ${problem.file}  [${problem.rule}]`);
    console.error(`    This file ${problem.message}.\n`);
  }
  console.error(
    `${problems.length} problem(s). Reads go through @magna-carta/api-client and the one cache in ` +
      "apps/web/src/lib/api/screen-data.ts, and they START IN THE ROUTE'S LOAD so the hover " +
      "preload reaches them. See docs/specs/2026-09-14-screen-data-loading-design.md.",
  );
  process.exit(1);
}

console.log(
  `Screen data: ${screensReading} screen(s) reading through the one cache, ` +
    `${handWrittenTransport}/${HAND_WRITTEN_TRANSPORT_BUDGET} hand-written transport module(s) left ` +
    "to migrate (this number only falls).",
);
