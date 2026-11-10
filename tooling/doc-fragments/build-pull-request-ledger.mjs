// The pull-request ledger behind the in-app Changelog screen: one row per pull request merged to
// `main`, newest first, with its squash commit, the day it landed, the parts of the application it
// touched, and the changelog entry its author wrote.
//
// Everything is read back out of git, so the ledger can be rebuilt from nothing at any time and is
// never hand-edited. `main` squash-merges, so every pull request is exactly one first-parent commit
// whose subject ends in `(#N)`; the changelog fragment that pull request added (changelog.d/<slug>.md)
// is still in that commit even though the assembler deletes it from the tree afterwards. A commit
// that carries no `(#N)` — the docs-assembly branch rebase-merges its own output — is not a pull
// request a reader merged and is left out, which is also what keeps the assembly from reporting its
// own commits as changes and re-triggering itself.
//
// It needs FULL history: in a shallow clone every early file looks as if the boundary commit added
// it. The assemble-docs workflow checks out with fetch-depth 0 for the same reason.
//
// The output is a JSON array written one pull request per line, so a landed pull request adds one
// line to the diff. The formatter is told to leave it alone (vite.config.ts), as with every other
// assembled document.
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseFragment } from "./changelog.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
export const LEDGER = join(ROOT, "docs/pull-request-ledger.json");

// A pull request that touches more places than this reads as a sweep, not a change to a part of the
// application, and is tagged as such rather than with a wall of badges.
const MOST_AREAS = 4;
export const ACROSS_THE_APP = "Across the app";

// Where in the tree a part of the application lives, mapped to the name a reader knows it by — the
// sidebar's own labels (apps/web/src/lib/navigation/destinations.ts) wherever there is one. A
// directory not listed here (build tooling, fixtures, shared plumbing) names no area: a change made
// only there is one the reader cannot see.
export const AREA_BY_DIRECTORY = {
  home: "Home",
  downloads: "Downloads",
  uploads: "Uploads",
  notifications: "Notifications",
  tasks: "Tasks",
  magnus: "Magnus",
  inference: "Magnus",
  calendar: "Calendar",
  matters: "Matters",
  "matter-search": "Matters",
  "matter-assets": "Matters",
  notes: "Matters",
  intake: "Intake",
  conflicts: "Conflicts Check",
  directory: "Directory",
  messaging: "Messaging",
  communications: "Messaging",
  "email-filing": "Messaging",
  meetings: "Meetings",
  "meeting-protocol": "Meetings",
  documents: "Documents",
  "file-manager": "Documents",
  "file-workbench": "Documents",
  "document-assembly": "Documents",
  pdf: "Documents",
  forms: "Forms",
  discovery: "Discovery",
  custodian: "Custodian",
  time: "Time",
  timekeeping: "Time",
  fees: "Fees",
  costs: "Costs",
  billing: "Billing",
  "billing-core": "Billing",
  trust: "Trust",
  ledger: "Trust",
  "trust-jurisdictions": "Trust",
  reports: "Reports",
  reporting: "Reports",
  "export-document": "Reports",
  "firm-usage": "Firm Usage",
  settings: "Settings",
  "sequence-numbering": "Settings",
  "custom-fields": "Settings",
  account: "Account",
  auth: "Sign-in and accounts",
  search: "Search",
  tools: "Tools",
  "safe-browse": "Tools",
  "safe-website-viewer": "Tools",
  whois: "Tools",
  "whois-lookup": "Tools",
  shipping: "Tools",
  "address-lookup": "Tools",
  "attorney-license-lookup": "Tools",
  "design-system": "Look and feel",
  "design-tokens": "Look and feel",
  preferences: "Settings",
  members: "Settings",
  offices: "Settings",
  templates: "Documents",
  versions: "Documents",
  screen: "Look and feel",
  navigation: "Navigation",
  "product-updates": "Changelog",
  updates: "Changelog",
};

const AREA_PATHS = [
  /^apps\/web\/src\/routes\/\(app\)\/([^/]+)\//u,
  /^apps\/web\/src\/lib\/([^/]+)\//u,
  /^packages\/([^/]+)\//u,
  /^apps\/api-worker\/src\/http\/routes\/([^/]+)\//u,
  /^apps\/api-worker\/src\/([^/.]+)/u,
];

/** The areas a set of changed paths touches, in the order first seen. */
export function areasOf(paths) {
  const areas = [];
  for (const path of paths) {
    for (const pattern of AREA_PATHS) {
      const directory = pattern.exec(path)?.[1];
      const area = directory === undefined ? undefined : AREA_BY_DIRECTORY[directory];
      if (area !== undefined) {
        if (!areas.includes(area)) areas.push(area);
        break;
      }
    }
  }
  return areas.length > MOST_AREAS ? [ACROSS_THE_APP] : areas;
}

const PULL_REQUEST_SUBJECT = /^(.*?)\s*\(#(\d+)\)$/u;

/**
 * One ledger row from what git says about one first-parent commit, or null when the commit is not a
 * merged pull request. `fragments` are the changelog fragments the commit added, as file text.
 */
export function ledgerRow({ sha, date, subject, paths, fragments }) {
  const match = PULL_REQUEST_SUBJECT.exec(subject);
  if (match === null) return null;
  const entries = fragments.map((markdown) => {
    try {
      return parseFragment(markdown);
    } catch {
      // The oldest fragments predate the frontmatter; their whole text is the entry.
      return { category: "", audience: "", text: markdown.trim(), publicText: null };
    }
  });
  const text = entries
    .map((entry) => entry.text)
    .filter((entryText) => entryText !== "")
    .join("\n\n");
  return {
    number: Number(match[2]),
    sha,
    date,
    title: match[1],
    kind: entries.find((entry) => entry.category !== "")?.category ?? "Unrecorded",
    memberFacing: entries.some((entry) => entry.audience === "public"),
    areas: areasOf(paths),
    entry: text,
  };
}

/** The ledger as text: a JSON array, one row per line. */
export function renderLedger(rows) {
  if (rows.length === 0) return "[]\n";
  return `[\n${rows.map((row) => JSON.stringify(row)).join(",\n")}\n]\n`;
}

function git(...args) {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8", maxBuffer: 1024 * 1024 * 512 });
}

function collectRows(ref) {
  const rows = [];
  const log = git("log", ref, "--first-parent", "--format=%H%x09%cs%x09%s").trim();
  for (const line of log.split("\n")) {
    const [sha, date, ...rest] = line.split("\t");
    const subject = rest.join("\t");
    if (!PULL_REQUEST_SUBJECT.test(subject)) continue;
    const changes = git("show", "--name-status", "--no-renames", "--format=", sha)
      .split("\n")
      .map((row) => row.split("\t"))
      .filter((parts) => parts.length >= 2);
    const paths = changes.map((parts) => parts.at(-1));
    const fragments = changes
      .filter(
        ([status, path]) =>
          status === "A" &&
          /^changelog\.d\/[^/]+\.md$/u.test(path) &&
          path !== "changelog.d/README.md",
      )
      .map(([, path]) => git("show", `${sha}:${path}`));
    rows.push(ledgerRow({ sha, date, subject, paths, fragments }));
  }
  return rows;
}

function build() {
  const refArgument = process.argv.find((argument) => argument.startsWith("--ref="));
  const ref = refArgument === undefined ? "HEAD" : refArgument.slice("--ref=".length);
  if (git("rev-parse", "--is-shallow-repository").trim() === "true") {
    console.error(
      "pull-request ledger: this clone is shallow, so every early file would look added by its boundary commit. Fetch full history (git fetch --unshallow) and run again.",
    );
    process.exit(1);
  }
  // Newest first by the day each landed. The trunk's own order is nearly that already, but a commit
  // re-dated by a rebase can sit a day out of place; the sort is stable, so within a day the trunk's
  // order stands.
  const rows = collectRows(ref).toSorted((left, right) => right.date.localeCompare(left.date));
  writeFileSync(LEDGER, renderLedger(rows));
  console.log(`pull-request ledger: ${rows.length} pull requests from ${ref}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) build();
