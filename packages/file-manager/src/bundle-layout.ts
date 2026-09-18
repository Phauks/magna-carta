import type { BundleOptions } from "./bundle-options.ts";
import { disambiguate, sanitizeArchivePath } from "./bundle-paths.ts";
import type { ResolvedZip, ZipEntry } from "./zip-composition.ts";

// Composes the user's layout choice on top of the resolver's version-pinned entries: optionally flatten
// every entry to its base name, optionally nest everything under a single wrapper folder, and always
// sanitize the resulting paths for cross-platform extraction. Pure — sizes and identities are untouched,
// only paths change; entries are returned sorted by path; collisions introduced by flattening are
// disambiguated deterministically.
export function applyBundleLayout(
  resolved: ResolvedZip,
  options: Pick<BundleOptions, "layout" | "wrapperFolder">,
): ResolvedZip {
  const wrapperPrefix =
    options.wrapperFolder === null ? "" : `${sanitizeArchivePath(options.wrapperFolder.name)}/`;

  const taken = new Set<string>();
  const entries: ZipEntry[] = resolved.entries
    .map((entry): { entry: ZipEntry; path: string } => {
      const base =
        options.layout === "flatten" ? (entry.path.split("/").pop() ?? entry.path) : entry.path;
      return { entry, path: sanitizeArchivePath(`${wrapperPrefix}${base}`) };
    })
    .toSorted((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    .map(({ entry, path }) => ({ ...entry, path: disambiguate(path, taken) }));

  return { entries, fileCount: entries.length, totalBytes: resolved.totalBytes };
}
