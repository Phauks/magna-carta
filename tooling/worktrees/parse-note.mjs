// Parse a docs/active-work/<branch>.md stream note. Each note is a small frontmatter block
// describing one active worktree so concurrent streams can see each other's scope and the files
// they expect to touch. See docs/active-work/README.md for the workflow.
const KEYS = ["branch", "worktree", "area", "status", "touches"];

export function parseNote(markdown) {
  const lines = markdown.split("\n");
  const note = { branch: "", worktree: "", area: "", status: "", touches: [] };
  if (lines[0] !== "---") return note;
  const end = lines.indexOf("---", 1);
  if (end === -1) return note;
  for (const line of lines.slice(1, end)) {
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim();
    if (!KEYS.includes(key)) continue;
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
