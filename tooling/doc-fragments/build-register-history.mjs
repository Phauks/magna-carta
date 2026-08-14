import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  emptyHistory,
  missingCommits,
  orderSnapshots,
  parseHistory,
  readSnapshot,
  serializeHistory,
  short,
  unreadSnapshot,
} from "./register-history.mjs";
import { LEDGER_STATUSES, parseArea } from "./roadmap.mjs";

// Reconstruct the feature ledger's counts at every past commit, into docs/register-history.json.
// The ledger keeps no history of its own, but roadmap.d/ is version controlled, so the ledger at any
// commit can be read out of git and parsed by parseArea — the same parser the live build uses, so
// the reconstruction and the number at the top of docs/now.md can never disagree.
//
// Reading a commit costs a process per area file, so a full pass over the whole history is far too
// slow to sit inside every register build. It does not have to: the file is committed, and an
// ordinary run reads only the commits the file does not already hold — normally one. Pass --rebuild
// to recompute every row from scratch, which is what picks up commits that a later parser change has
// made readable.
//
// A commit whose ledger does not parse under today's schema is recorded as unread with the parser's
// own reason, and rendered as a hole. It is never estimated and never interpolated across: the point
// of a reconstruction is that every number in it was read off something.

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const HISTORY_FILE = join(ROOT, "docs", "register-history.json");
const LEDGER_DIRECTORY = "roadmap.d";
const RESERVED = new Set(["README.md"]);

// git's own stderr is captured rather than passed through: a commit this run cannot read is an
// expected outcome that gets recorded with its reason, not a failure to shout about.
function git(root, args) {
  return execFileSync("git", ["-C", root, ...args], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

// First-parent only. The register describes the trunk, and every merge into it is one landing of one
// stream: walking into the branches would count a capability's status as it wobbled inside a branch
// that had not landed yet. The directory's README carries the format rather than any node, so a
// commit that touched only it moved no count and earns no row.
export function ledgerCommits(root = ROOT, ref = "HEAD") {
  const log = git(root, [
    "log",
    "--first-parent",
    "--reverse",
    "--format=%H\t%cs",
    ref,
    "--",
    `${LEDGER_DIRECTORY}/`,
    `:(exclude)${LEDGER_DIRECTORY}/README.md`,
  ]).trim();
  if (log === "") return [];
  return log.split("\n").map((line) => {
    const [commit, date] = line.split("\t");
    return { commit, date };
  });
}

export function areaFilesAt(root, commit) {
  const listing = git(root, [
    "ls-tree",
    "-r",
    "--name-only",
    commit,
    "--",
    `${LEDGER_DIRECTORY}/`,
  ]).trim();
  if (listing === "") return [];
  return listing
    .split("\n")
    .filter((path) => path.endsWith(".md") && !RESERVED.has(path.slice(path.lastIndexOf("/") + 1)))
    .toSorted();
}

// Parse the whole ledger as it stood at one commit. Every area is attempted even after one fails,
// so the recorded reason names all of them rather than only the first — the reasons are what a
// later reader uses to decide whether a schema change has made the commit readable.
export function snapshotAt(root, { commit, date }) {
  let paths;
  try {
    paths = areaFilesAt(root, commit);
  } catch (error) {
    return unreadSnapshot({ commit, date }, `the ledger could not be listed: ${firstLine(error)}`);
  }

  const areas = [];
  const problems = [];
  for (const path of paths) {
    const name = path.slice(path.lastIndexOf("/") + 1);
    try {
      areas.push(parseArea(git(root, ["show", `${commit}:${path}`]), name));
    } catch (error) {
      problems.push(`${path}: ${firstProblem(error)}`);
    }
  }
  if (problems.length > 0) return unreadSnapshot({ commit, date }, problems.join("; "));
  return readSnapshot({ commit, date }, areas, LEDGER_STATUSES);
}

// What git said, in preference to the wrapper's "Command failed: git -C …" line, which names the
// invocation rather than the problem.
function firstLine(error) {
  const said = String(error.stderr ?? "").trim();
  return (said === "" ? String(error.message) : said).split("\n")[0].trim();
}

// A RoadmapParseError carries its problems as a list under a summary line; the first is the one that
// says what the schema did. Anything else is reported whole.
function firstProblem(error) {
  const problems = error.problems ?? null;
  return problems === null || problems.length === 0
    ? firstLine(error)
    : `${problems[0].trim()}${problems.length > 1 ? ` (and ${problems.length - 1} more)` : ""}`;
}

export function loadHistory(file = HISTORY_FILE) {
  if (!existsSync(file)) return null;
  return parseHistory(readFileSync(file, "utf8"));
}

export function updateHistory({
  root = ROOT,
  file = HISTORY_FILE,
  ref = "HEAD",
  rebuild = false,
} = {}) {
  const existing = (rebuild ? null : loadHistory(file)) ?? emptyHistory();

  let commits;
  try {
    commits = ledgerCommits(root, ref);
  } catch (error) {
    // No git, or no history to walk (a shallow clone, an export). The committed file is still the
    // truth about every commit it already holds, so it is left exactly as it is.
    return { history: existing, added: [], dropped: [], unavailable: firstLine(error) };
  }

  const wanted = missingCommits(existing, commits);
  const additions = wanted.map((entry) => snapshotAt(root, entry));
  const { snapshots, dropped } = orderSnapshots(existing, commits, additions);
  const history = { ...emptyHistory(), snapshots };
  writeFileSync(file, serializeHistory(history));
  return { history, added: additions, dropped, unavailable: null };
}

export function build(argv = []) {
  const rebuild = argv.includes("--rebuild");
  const refFlag = argv.find((argument) => argument.startsWith("--ref="));
  const { history, added, dropped, unavailable } = updateHistory({
    ref: refFlag === undefined ? "HEAD" : refFlag.slice("--ref=".length),
    rebuild,
  });

  if (unavailable !== null) {
    console.log(`register history: git history unavailable (${unavailable}) — file left unchanged`);
    return history;
  }
  const unread = history.snapshots.filter((snapshot) => !snapshot.read).length;
  const addedUnread = added.filter((snapshot) => !snapshot.read);
  console.log(
    `register history: ${history.snapshots.length} commit(s) in the series, ${added.length} read this run` +
      `${rebuild ? " (full rebuild)" : ""}; ${unread} could not be parsed and are recorded as gaps`,
  );
  for (const snapshot of addedUnread) {
    console.log(`  ${short(snapshot.commit)} ${snapshot.date} unread — ${snapshot.reason}`);
  }
  for (const snapshot of dropped) {
    console.log(
      `  ${short(snapshot.commit)} ${snapshot.date} dropped — no longer on the first-parent history`,
    );
  }
  return history;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  build(process.argv.slice(2));
}
