// Which Worker Previews the cleanup deletes, and which Workers it looks at. Pure, so the decisions
// are tested without the Cloudflare API (index.mjs does the calls).

/** The one Preview per Worker that is kept: the staging branch's. */
export const KEEP = "beta";

/**
 * The Previews to delete: every one but the kept one. Nothing at all when the kept one is not in the
 * list, because then the names are not what this expects and deleting would be a guess. That is also
 * what keeps the cleanup dormant until the staging Preview exists.
 *
 * @param {{ id?: string, name: string }[]} previews
 * @param {string} [keep]
 */
export function previewsToDelete(previews, keep = KEEP) {
  if (!previews.some((preview) => preview.name === keep)) return [];
  return previews.filter((preview) => preview.name !== keep);
}

/**
 * The Worker's name from a wrangler.jsonc: the top-level `name`, which every config here declares as
 * its first two-space-indented key. Nested objects (a binding's `name`, an environment) sit deeper, so
 * a match at exactly that indent is the top-level one. Null when there is none.
 *
 * @param {string} source
 */
export function workerName(source) {
  const match = /^ {2}"name":\s*"([^"]+)"/m.exec(source);
  return match ? match[1] : null;
}
