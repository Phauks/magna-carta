// Parse a docs/active-work/<branch>.md stream note. Each note is a small frontmatter block
// describing one active worktree so concurrent streams can see each other's scope and the files
// they expect to touch. See docs/active-work/README.md for the workflow.
const KEYS = new Set(["worktree", "area", "status", "touches"]);

// The branch a note describes is its path, not a key inside it. The note for `claude/fix-thing`
// lives at `docs/active-work/claude/fix-thing.md` and nowhere else, so the path already carries the
// fact — and a `branch:` key repeating it is a second copy free to disagree with the first. Deriving
// it also means a note whose frontmatter is malformed still has an identity, which is what lets the
// registry name the file instead of silently dropping it.
export function branchFromNotePath(relativePath) {
  return relativePath
    .replace(/\\/g, "/")
    .replace(/^docs\/active-work\//, "")
    .replace(/\.md$/, "");
}

// A note whose frontmatter block is missing or unterminated. Its scope and its touch list are prose
// nothing reads, so it declares no overlap and warns nobody — reported rather than skipped.
export function isUnreadable(note) {
  return note.malformed;
}

export function parseNote(markdown, branch = "") {
  const lines = markdown.split("\n");
  const note = { branch, worktree: "", area: "", status: "", touches: [], malformed: false };
  const end = lines[0] === "---" ? lines.indexOf("---", 1) : -1;
  if (end === -1) return { ...note, malformed: true };
  for (const line of lines.slice(1, end)) {
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim();
    if (!KEYS.has(key)) continue;
    const value = line.slice(colon + 1).trim();
    if (key === "touches") {
      note.touches =
        value === ""
          ? []
          : value
              .split(",")
              .map((entry) => entry.trim())
              .filter(Boolean);
    } else {
      note[key] = value;
    }
  }
  return note;
}

// Paths declared in `touches` by more than one stream — the collision-risk surface to surface first.
//
// The caller passes only streams that are still in flight. A note is a file, and a file outlives the
// work it describes: nothing deletes it but the hand that wrote it, and the cue to do so — the branch
// disappearing — never fires in a repository whose branches are never deleted. Fed every note on
// disk, this reports finished streams colliding with each other, which is every entry wrong at once,
// on the one screen an agent is told to consult before editing a shared file.
export function findOverlaps(notes) {
  const byPath = new Map();
  for (const note of notes) {
    for (const path of note.touches) {
      if (!byPath.has(path)) byPath.set(path, []);
      byPath.get(path).push(note.branch);
    }
  }
  const overlaps = [];
  for (const [path, branches] of byPath) {
    if (branches.length > 1) {
      overlaps.push({
        path,
        branches: [...branches].sort((left, right) => left.localeCompare(right)),
      });
    }
  }
  return overlaps.sort((left, right) => left.path.localeCompare(right.path));
}
