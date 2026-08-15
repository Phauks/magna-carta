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
//
// The reconstruction is a TRUNK-ONLY operation, and refuses to write anywhere else. On a feature
// branch `git log --first-parent` walks the branch's line, not the trunk's, so every trunk landing
// after the branch point is simply absent from it — and rebuilding from that walk does not produce a
// shorter history, it deletes the committed snapshot of every one of those landings. Off the trunk
// the committed file is read and left exactly as it is; the register renders from it, and so does
// the roadmap gate, so declining to rebuild never puts the gate out of reach.

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const HISTORY_FILE = join(ROOT, "docs", "register-history.json");
const LEDGER_DIRECTORY = "roadmap.d";
const RESERVED = new Set(["README.md"]);
const TRUNK_BRANCH = "main";

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

function resolves(root, revision) {
  try {
    git(root, ["rev-parse", "--verify", "--quiet", revision]);
    return true;
  } catch {
    return false;
  }
}

// Why this ref is not the trunk, or null when it is.
//
// Answered from the ref's NAME, not from the shape of the commit graph, because the two cases that
// have to be told apart are graph-identical: `main` holding commits that are not pushed yet, and a
// branch cut from that same commit holding commits of its own, differ in nothing but what they are
// called. A detached HEAD names itself "HEAD" and is off the trunk, which is right — it sees only
// the line below wherever it is standing. A repository with no trunk branch at all (a fixture, an
// export, a single-branch clone) has no trunk to be off, so whatever it is on counts as one.
export function offTrunkReason(root = ROOT, ref = "HEAD") {
  if (
    !resolves(root, `refs/heads/${TRUNK_BRANCH}`) &&
    !resolves(root, `refs/remotes/origin/${TRUNK_BRANCH}`)
  ) {
    return null;
  }
  let name;
  try {
    name = git(root, ["rev-parse", "--abbrev-ref", ref]).trim();
  } catch {
    // A ref that does not resolve is not off the trunk, it is absent. Say nothing here and let the
    // walk fail, so the run reports the ref it could not find rather than a place it is not.
    return null;
  }
  if (name === TRUNK_BRANCH || name === `origin/${TRUNK_BRANCH}`) return null;
  // A revision that names no branch — a raw commit, `HEAD~57` — abbreviates to nothing; a detached
  // HEAD abbreviates to the word itself. Both are the same answer: nowhere with a trunk's name on it.
  if (name === "" || name === "HEAD") return `${ref} names no branch, so it is not ${TRUNK_BRANCH}`;
  return `this is ${name}, not ${TRUNK_BRANCH}`;
}

export function updateHistory({
  root = ROOT,
  file = HISTORY_FILE,
  ref = "HEAD",
  rebuild = false,
} = {}) {
  const committed = loadHistory(file);
  const existing = (rebuild ? null : committed) ?? emptyHistory();
  const idle = { added: [], dropped: [], retained: [], unavailable: null, offTrunk: null };

  // Off the trunk before anything is read, so no walk of the wrong line can reach the file. The
  // committed history is returned whole — including on a rebuild, which off-trunk would otherwise
  // recompute the series from a walk that cannot see most of it.
  const offTrunk = offTrunkReason(root, ref);
  if (offTrunk !== null) {
    return { ...idle, history: committed ?? emptyHistory(), offTrunk };
  }

  let commits;
  try {
    commits = ledgerCommits(root, ref);
  } catch (error) {
    // No git, or no history to walk (a shallow clone, an export). The committed file is still the
    // truth about every commit it already holds, so it is left exactly as it is.
    return { ...idle, history: existing, unavailable: firstLine(error) };
  }

  const wanted = missingCommits(existing, commits);
  const additions = wanted.map((entry) => snapshotAt(root, entry));
  const { snapshots, dropped, retained } = orderSnapshots(existing, commits, additions, (commit) =>
    resolves(root, `${commit}^{commit}`),
  );
  const history = { ...emptyHistory(), snapshots };
  writeFileSync(file, serializeHistory(history));
  return { history, added: additions, dropped, retained, unavailable: null, offTrunk: null };
}

export function build(argv = []) {
  const rebuild = argv.includes("--rebuild");
  const refFlag = argv.find((argument) => argument.startsWith("--ref="));
  const { history, added, dropped, retained, unavailable, offTrunk } = updateHistory({
    ref: refFlag === undefined ? "HEAD" : refFlag.slice("--ref=".length),
    rebuild,
  });

  if (offTrunk !== null) {
    console.log(
      `register history: not rebuilt — ${offTrunk}. The series describes ${TRUNK_BRANCH}, and this ref cannot see the landings after it was cut; the committed file is left untouched and the register renders from it. Rebuild on ${TRUNK_BRANCH}.`,
    );
    return history;
  }
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
  for (const snapshot of retained) {
    console.log(
      `  ${short(snapshot.commit)} ${snapshot.date} retained — off this walk, but the commit is still in the repository`,
    );
  }
  for (const snapshot of dropped) {
    console.log(
      `  ${short(snapshot.commit)} ${snapshot.date} dropped — the commit no longer exists in the repository`,
    );
  }
  return history;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  build(process.argv.slice(2));
}
