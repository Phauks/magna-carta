/*
 * The stream-registry gate. Every note in docs/active-work/ has the shape the registry can read.
 *
 * WHY IT EXISTS. Parallel worktrees see each other through one mechanism and one only: a note at
 * `docs/active-work/<branch>.md`, whose path mirrors the branch exactly and whose frontmatter carries
 * `worktree`, `area`, `status` and `touches`. A note that misses either — a flattened path, or no
 * frontmatter block — is not a degraded note, it is an invisible one: the registry cannot look it up
 * by branch, it declares no `touches`, and the overlap warning another stream is told to consult
 * before editing a shared file simply does not mention it. The stream that wrote it believes it has
 * announced itself and has not.
 *
 * `vp run worktrees` already NAMES both shapes — and only names them, in a report a person has to
 * remember to run. CLAUDE.md compensates with an instruction to run it before pushing, which makes
 * the registry's accuracy a thing held up by memory. This is the half that does not need remembering.
 *
 * WHICH HALF THIS OWNS. Two directions, two gates, no overlap:
 *
 *   - THIS ONE: the note's own shape. Does its path name a branch, does it carry the four keys, is its
 *     status one of the documented four.
 *   - `pnpm run lint:status` (tooling/lint-status.mjs): the pointer FROM a `status.d/<slice>.md`
 *     fragment TO a note, and whether the file it names still exists. A note retired without its
 *     pointer fails there, and nothing about that is re-checked here.
 *
 * So: a dangling pointer is lint:status's finding, a malformed note is this one's. Neither reports the
 * other's, and a change that breaks both gets one finding from each rather than two of the same.
 *
 * WHAT THIS DELIBERATELY DOES NOT CATCH:
 *
 *   - Whether the branch the note names EXISTS. A fresh CI checkout has one branch and no others, so
 *     a ref lookup would answer differently in CI than on a machine with a dozen worktrees — which is
 *     the one thing a gate may never do. `vp run worktrees` asks that question, where a "cannot tell"
 *     can be printed instead of enforced.
 *   - Whether a note is STALE — the stream finished and the note outlived it. That is a question about
 *     whether a branch has landed, which the registry and `vp run retire-note` answer together.
 *   - Whether `touches` is TRUE. A stream that lists three paths and edits thirty is invisible to any
 *     text check; the list existing at all is the floor this holds.
 *   - Capitalisation and house style inside a branch name. Every branch here is lower-case kebab, but
 *     git permits more, and failing a legal branch name over a convention nobody wrote down is how a
 *     gate earns a reputation for being wrong.
 *
 * Run: `pnpm run lint:active-work`. Pure text over one directory; no install, no build, no network.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NOTE_ROOT, NOT_A_NOTE, SELF_TEST, checkNote } from "./rules.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

/** Every `.md` under docs/active-work/, repository-relative, README excepted. */
export function collectNotes(readDirectory, base = NOTE_ROOT) {
  const found = [];
  for (const entry of readDirectory(base)) {
    const child = `${base}${entry.name}`;
    if (entry.isDirectory()) {
      found.push(...collectNotes(readDirectory, `${child}/`));
    } else if (entry.name.endsWith(".md") && child !== NOT_A_NOTE) {
      found.push(child);
    }
  }
  return found.toSorted();
}

/** The namespaces in use — the sub-directories the registry contains, which is what makes a flattened path decidable. */
export function namespacesOf(notePaths) {
  const namespaces = new Set();
  for (const note of notePaths) {
    const rest = note.slice(NOTE_ROOT.length);
    const slash = rest.indexOf("/");
    if (slash !== -1) namespaces.add(rest.slice(0, slash));
  }
  return [...namespaces].toSorted();
}

// The gate's own rules, checked against their fixtures on every invocation, so a rule that stops
// biting fails here as well as in the suite.
export function runSelfTest() {
  const failures = [];
  for (const scenario of SELF_TEST) {
    const found = checkNote(scenario)
      .map((problem) => problem.rule)
      .toSorted();
    const wanted = [...scenario.expect].toSorted();
    if (JSON.stringify(found) !== JSON.stringify(wanted))
      failures.push({ name: scenario.name, found, wanted });
  }
  return failures;
}

function main() {
  const selfTestFailures = runSelfTest();
  if (selfTestFailures.length > 0) {
    console.error("\nlint-active-work: the gate's own rules no longer do what they must.\n");
    for (const failure of selfTestFailures) {
      console.error(
        `  ${failure.name}\n    expected: ${JSON.stringify(failure.wanted)}\n    got:      ${JSON.stringify(failure.found)}`,
      );
    }
    process.exit(1);
  }

  const readDirectory = (directory) => {
    try {
      return readdirSync(path.join(ROOT, directory), { withFileTypes: true });
    } catch {
      return [];
    }
  };

  const notes = collectNotes(readDirectory);
  const namespaces = namespacesOf(notes);

  const found = [];
  for (const note of notes) {
    const markdown = readFileSync(path.join(ROOT, note), "utf8");
    for (const problem of checkNote({ path: note, markdown, namespaces })) {
      found.push({ path: note, ...problem });
    }
  }

  if (found.length > 0) {
    console.error("\nStream notes the registry cannot read:\n");
    for (const one of found) {
      console.error(`  ${one.path}  [${one.rule}]\n      ${one.detail}`);
    }
    console.error(
      `\n${String(found.length)} problem(s) across ${String(new Set(found.map((one) => one.path)).size)} note(s).` +
        " A note is how a stream announces itself to every other worktree; one the registry cannot read" +
        " warns nobody, and its author has no way of knowing. Template and workflow:" +
        " docs/active-work/README.md.",
    );
    process.exit(1);
  }

  console.log(
    `Stream registry readable: ${String(notes.length)} note(s) across ${String(namespaces.length)} namespace(s), each at a branch-shaped path with the four keys the registry reads.`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
