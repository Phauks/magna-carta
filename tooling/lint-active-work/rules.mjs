/*
 * The rules of the stream-registry gate, and why each is drawn where it is. The runner is index.mjs;
 * everything here is a pure function over (path, markdown), so the decision can be tested without a
 * repository and self-tested on every invocation.
 *
 * The note itself is parsed by tooling/worktrees/parse-note.mjs, which the registry already uses.
 * There is no second parser here on purpose: two readers of the same file would eventually disagree
 * about what a note says, and the whole value of the registry is that everyone reads it the same way.
 */
import { branchFromNotePath, parseNote } from "../worktrees/parse-note.mjs";

/** The lifecycle a stream note may declare, as docs/active-work/README.md writes it. */
export const STATUSES = ["designing", "building", "review", "blocked"];

/** Where the notes live, and the one file in there that is not a note. */
export const NOTE_ROOT = "docs/active-work/";
export const NOT_A_NOTE = "docs/active-work/README.md";

/*
 * Git's own rules for what may be a branch name, kept to the ones a note path can actually violate. A
 * path that breaks these names no branch that could ever exist, so the note is unreachable from the
 * branch it claims to describe — which is the same failure as a flattened path, arriving by a
 * different route.
 */
const ILLEGAL_IN_REF = /[\s~^:?*[\]\\\u0000-\u001F\u007F]/;

export function branchShapeProblem(branch) {
  if (branch === "") return "is an empty branch name";
  if (ILLEGAL_IN_REF.test(branch)) {
    return "contains a character git will not accept in a branch name (whitespace, or one of ~^:?*[]\\)";
  }
  if (branch.includes("..") || branch.includes("@{")) {
    return "contains `..` or `@{`, which git will not accept in a branch name";
  }
  const segments = branch.split("/");
  if (segments.some((segment) => segment === "")) return "has an empty path segment";
  if (segments.some((segment) => segment.startsWith("."))) return "has a segment starting with `.`";
  if (segments.some((segment) => segment.endsWith(".lock")))
    return "has a segment ending in `.lock`";
  if (branch.endsWith(".") || branch.endsWith("/")) return "ends in `.` or `/`";
  return null;
}

/*
 * THE FLATTENED PATH, which is the failure CLAUDE.md actually warns about and the one a path cannot
 * detect on its own: `claude/fix-thing` written as `claude-fix-thing.md` is, read as a path, a
 * perfectly ordinary note for a top-level branch called `claude-fix-thing`.
 *
 * What makes it decidable is the directory beside it. The namespaces in use are the sub-directories
 * the registry already contains, so a note sitting at the top level whose name opens with one of those
 * namespaces followed by a hyphen is a flattened note and nothing else — the branch it names would
 * have to be a top-level branch whose name happens to begin with an existing namespace, which nobody
 * creates. Where there are no sub-directories the rule simply does not fire, which is the safe
 * direction: it can be silent, it cannot invent a finding.
 */
export function flattenedNamespace(branch, namespaces) {
  if (branch.includes("/")) return null;
  return namespaces.find((namespace) => branch.startsWith(`${namespace}-`)) ?? null;
}

/**
 * Every problem with one stream note.
 *
 * @param {object} note
 * @param {string} note.path  repository-relative, e.g. `docs/active-work/claude/fix-thing.md`.
 * @param {string} note.markdown
 * @param {readonly string[]} note.namespaces  the sub-directories the registry contains.
 * @returns {{ rule: string, detail: string }[]}
 */
export function checkNote({ path, markdown, namespaces = [] }) {
  const problems = [];
  const branch = branchFromNotePath(path);

  const shape = branchShapeProblem(branch);
  if (shape !== null) {
    problems.push({
      rule: "not-a-branch-path",
      detail: `the path mirrors no branch that could exist — it ${shape}. The note's path IS its branch, slashes included`,
    });
  }

  const flattened = flattenedNamespace(branch, namespaces);
  if (flattened !== null) {
    const asBranch = `${flattened}/${branch.slice(flattened.length + 1)}`;
    problems.push({
      rule: "flattened-path",
      detail: `this looks like the branch \`${asBranch}\` with its slash flattened to a hyphen. Move it to ${NOTE_ROOT}${asBranch}.md — the registry looks a note up by the branch's own path and cannot find it anywhere else`,
    });
  }

  const parsed = parseNote(markdown, branch);
  if (parsed.malformed) {
    problems.push({
      rule: "no-frontmatter",
      detail:
        "there is no `---` frontmatter block, so the note declares no scope and no touches — it is invisible to the registry and warns nobody. Template: docs/active-work/README.md",
    });
    return problems;
  }

  for (const [key, value] of [
    ["worktree", parsed.worktree],
    ["area", parsed.area],
    ["status", parsed.status],
  ]) {
    if (value === "") {
      problems.push({
        rule: "missing-key",
        detail: `\`${key}:\` is missing or blank. All four of worktree, area, status and touches are required — see docs/active-work/README.md`,
      });
    }
  }
  if (parsed.touches.length === 0) {
    problems.push({
      rule: "missing-key",
      detail:
        "`touches:` is missing or empty, so this stream declares no overlap with anything. It is the one key another stream reads before editing a shared file — list the files and areas you expect to touch",
    });
  }

  if (parsed.status !== "" && !STATUSES.includes(parsed.status)) {
    problems.push({
      rule: "unknown-status",
      detail: `\`status: ${parsed.status}\` is not one of ${STATUSES.join(" | ")}. A status outside the set is a word only its author can read`,
    });
  }

  return problems;
}

const WELL_FORMED = [
  "---",
  "worktree: C:/dev/magna-carta-worktrees/claude/fix-thing",
  "area: One line of scope",
  "status: building",
  "touches: packages/billing, docs/conventions/",
  "---",
  "",
  "What this stream is doing.",
].join("\n");

const replacing = (line, replacement) => WELL_FORMED.replace(line, replacement);

/*
 * The fixtures the gate self-tests against on every invocation, and that index.test.mjs drives
 * through the same entry point. Each is a note shape this registry has actually held, or one the
 * registry warns about today without failing anything.
 */
export const SELF_TEST = [
  {
    name: "a well-formed note in its namespace passes",
    path: "docs/active-work/claude/fix-thing.md",
    markdown: WELL_FORMED,
    namespaces: ["claude"],
    expect: [],
  },
  {
    name: "a top-level branch is a real branch and its note belongs at the top level",
    path: "docs/active-work/hotfix.md",
    markdown: WELL_FORMED,
    namespaces: ["claude"],
    expect: [],
  },
  {
    name: "a flattened path is the failure the registry only warns about today",
    path: "docs/active-work/claude-fix-thing.md",
    markdown: WELL_FORMED,
    namespaces: ["claude"],
    expect: ["flattened-path"],
  },
  {
    name: "with no namespaces in the registry the flattening rule stays silent rather than guessing",
    path: "docs/active-work/claude-fix-thing.md",
    markdown: WELL_FORMED,
    namespaces: [],
    expect: [],
  },
  {
    name: "a note with no frontmatter warns nobody, and nothing else about it is worth reporting",
    path: "docs/active-work/claude/fix-thing.md",
    markdown: "Just a paragraph about what I am doing.\n",
    namespaces: ["claude"],
    expect: ["no-frontmatter"],
  },
  {
    name: "an unterminated frontmatter block is unreadable, not half-read",
    path: "docs/active-work/claude/fix-thing.md",
    markdown: "---\nstatus: building\n\nbody\n",
    namespaces: ["claude"],
    expect: ["no-frontmatter"],
  },
  {
    name: "a missing key is named one at a time",
    path: "docs/active-work/claude/fix-thing.md",
    markdown: replacing("area: One line of scope", "area:"),
    namespaces: ["claude"],
    expect: ["missing-key"],
  },
  {
    name: "an empty touches list declares no overlap, which is the one thing a note is for",
    path: "docs/active-work/claude/fix-thing.md",
    markdown: replacing("touches: packages/billing, docs/conventions/", "touches:"),
    namespaces: ["claude"],
    expect: ["missing-key"],
  },
  {
    name: "a status outside the documented set is a word only its author can read",
    path: "docs/active-work/claude/fix-thing.md",
    markdown: replacing("status: building", "status: active"),
    namespaces: ["claude"],
    expect: ["unknown-status"],
  },
  {
    name: "every documented status is accepted",
    path: "docs/active-work/claude/fix-thing.md",
    markdown: replacing("status: building", "status: blocked"),
    namespaces: ["claude"],
    expect: [],
  },
  {
    name: "a path git could not make a branch of is reported as such",
    path: "docs/active-work/claude/fix thing.md",
    namespaces: ["claude"],
    markdown: WELL_FORMED,
    expect: ["not-a-branch-path"],
  },
  {
    name: "a path with an empty segment names no branch either",
    path: "docs/active-work/claude//fix-thing.md",
    markdown: WELL_FORMED,
    namespaces: ["claude"],
    expect: ["not-a-branch-path"],
  },
];
