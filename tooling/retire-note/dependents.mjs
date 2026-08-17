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
