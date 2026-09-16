// Which status fragments point at a stream note, and what they look like once they do not.
//
// A `status.d/<slice>.md` fragment may carry `active-work: docs/active-work/<branch>.md`, and
// tooling/lint-status.mjs fails when that path does not exist. So deleting a stream note is never one
// deletion: the pointer has to go with it, and STATUS.md / STATUS.json have to be re-rendered, or the
// branch that swept the note cannot pass its own gate. That third part is invisible from the note —
// nothing in docs/active-work/ knows who references it — which is why it was missed five times in one
// session, twice after the person already knew about it. A chore a human must remember is a chore that
// will be got wrong, so this makes the pointer unable to survive the note it names.
//
// Pure: text in, text out, no filesystem. The impure runner is index.mjs.

/** The frontmatter key a status fragment uses to name its stream note. */
export const POINTER_KEY = "active-work";

function frontmatterBounds(text) {
  const lines = text.split("\n");
  if (lines[0] !== "---") return null;
  const end = lines.indexOf("---", 1);
  return end === -1 ? null : { lines, end };
}

/**
 * The note path a fragment points at, or null. Read from the frontmatter block only — a note path
 * quoted in the prose body is a citation, not a pointer, and clearing it would edit someone's sentence.
 */
export function pointerIn(fragmentText) {
  const bounds = frontmatterBounds(fragmentText);
  if (bounds === null) return null;
  for (const line of bounds.lines.slice(1, bounds.end)) {
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    if (line.slice(0, colon).trim() !== POINTER_KEY) continue;
    const value = line.slice(colon + 1).trim();
    return value === "" ? null : value;
  }
  return null;
}

/**
 * The same fragment with its pointer emptied, or the text unchanged when it pointed somewhere else.
 *
 * The key is kept and only its value cleared, because the fragment schema expects the field to be
 * present — dropping the line entirely would trade a dangling pointer for a parse failure, which is the
 * same gate failing for a different reason.
 */
export function clearPointer(fragmentText) {
  const bounds = frontmatterBounds(fragmentText);
  if (bounds === null) return fragmentText;
  const lines = [...bounds.lines];
  for (let index = 1; index < bounds.end; index += 1) {
    const line = lines[index];
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    if (line.slice(0, colon).trim() !== POINTER_KEY) continue;
    lines[index] = `${POINTER_KEY}:`;
  }
  return lines.join("\n");
}

/**
 * Everything retiring `notePath` has to change, given every fragment on disk.
 *
 * `fragments` is `[{ path, text }]`; the result names each dependent with its rewritten text, so the
 * caller writes files it has already been shown rather than recomputing them. Path comparison is
 * normalized to forward slashes and made leading-`./`-insensitive: a pointer written either way names
 * the same file, and a match this misses is a lint failure after the fact.
 */
export function planRetirement({ notePath, fragments }) {
  const target = normalize(notePath);
  const dependents = [];
  for (const { path, text } of fragments) {
    const pointer = pointerIn(text);
    if (pointer === null || normalize(pointer) !== target) continue;
    dependents.push({ path, pointer, text: clearPointer(text) });
  }
  return { notePath: target, dependents };
}

function normalize(path) {
  return path.replace(/\\/g, "/").replace(/^\.\//, "");
}

/**
 * Whether a retirement may proceed, and the sentence refusing it when it may not.
 *
 * TWO WORKFLOWS, TWO GUARDS. Retiring a note used to mean one thing: a second merge to `main` after
 * the work landed, whose only content was the deletion. There the landing check is exactly right —
 * the deletion takes effect the moment it merges, so a note removed while its stream is still in
 * flight erases the one collision warning other worktrees get, immediately.
 *
 * `--with-merge` is the other workflow, and the landing check is the wrong question for it. The
 * deletion is a commit on the branch, so it reaches `main` when the branch does and not one moment
 * sooner: `main` keeps the note for the whole time the pull request is open, and every other
 * worktree goes on seeing it. Nothing is erased early, so there is nothing for a landing check to
 * protect — and it cannot pass anyway, because a branch cannot have landed while the pull request
 * landing it is still open. What replaces it is the fact that actually has to hold: HEAD is on the
 * branch whose note this is, which is what makes "the deletion travels with the merge" true rather
 * than merely asserted.
 *
 * The workspace half is untouched by this. Removing a worktree and deleting a branch cannot happen
 * from inside that branch, so `--with-merge` never tries, and the landing check still guards that
 * half when it runs later.
 */
export function retirementRefusal({
  branch,
  withMerge = false,
  force = false,
  hasLanded = false,
  branchUnknown = false,
  headBranch = null,
  noteExists = false,
  dependentCount = 0,
  hasWorkspace = false,
}) {
  // A workspace alone is enough to proceed: that is precisely the state `--with-merge` leaves
  // behind once it lands — note gone, pointers cleared, worktree and branch still here — and the
  // cleanup pass would otherwise be told there is nothing to do by the retirement that worked.
  if (!noteExists && dependentCount === 0 && !hasWorkspace) {
    return (
      `${branch}: no note, no status fragment pointing at one, and no workspace here — nothing to retire.\n` +
      "  Check the branch name: a note's path mirrors its branch exactly, slashes included."
    );
  }

  if (withMerge) {
    if (headBranch !== branch) {
      return (
        `--with-merge retires ${branch}'s note in the commit that lands it, so it has to run on ` +
        `${branch}.\n` +
        `  HEAD is ${headBranch === null ? "not on any branch" : `on ${headBranch}`}.\n` +
        "  Check out the branch, or drop --with-merge to retire a note that has already landed."
      );
    }
    return null;
  }

  if (!hasLanded && !force) {
    return (
      `${branch} has not landed${branchUnknown ? " (and resolves to no ref)" : ""}.\n` +
      "  Retiring a live stream removes the only collision warning other worktrees get.\n" +
      "  If this note retires with the pull request that lands the work, use --with-merge.\n" +
      "  If the stream really is finished (abandoned, superseded, landed under another name),\n" +
      "  re-run with --force."
    );
  }

  return null;
}
