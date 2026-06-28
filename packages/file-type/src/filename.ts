// The extension a filename CLAIMS — lowercased, without the dot — or null when there is none. A leading
// dot with no later dot (".gitignore") is a dotfile, not an extension; a trailing dot is empty. This is
// the "claim" the content-based detection is checked against.
export function claimedExtensionOf(filename: string): string | null {
  const lastDot = filename.lastIndexOf(".");
  if (lastDot <= 0) return null; // -1 (none) or 0 (leading-dot dotfile)
  const extension = filename.slice(lastDot + 1).toLowerCase();
  return extension.length > 0 ? extension : null;
}
