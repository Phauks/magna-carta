// The readable half of a post's URL. The NUMBER is the identity — a post is fetched by its number
// and a wrong or stale slug still resolves — so this only has to be stable enough to read and safe
// enough to put in a path.
//
// It is derived from the title once, at creation, and never recomputed: a member who edits their
// title must not silently break every link anybody already shared.

const MAX_SLUG_LENGTH = 72;

export function slugFromTitle(title: string): string {
  const slug = title
    .normalize("NFKD")
    // Strip combining marks so an accented letter becomes its base letter rather than disappearing.
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/g, "");
  // A title made entirely of characters this drops — punctuation, or a script with no Latin
  // transliteration — would otherwise produce an empty path segment. The number carries the
  // identity, so a placeholder is honest rather than lossy.
  return slug === "" ? "post" : slug;
}
