// Shared archive-path helpers used by both the selection resolver and the bundle layout transform.

// Suffixes " (n)" before any extension when a path is already taken, so two same-named files never
// overwrite in the archive. Mutates `taken` to reserve the chosen path.
export function disambiguate(path: string, taken: Set<string>): string {
  if (!taken.has(path)) {
    taken.add(path);
    return path;
  }
  const slash = path.lastIndexOf("/");
  const dir = slash === -1 ? "" : path.slice(0, slash + 1);
  const base = slash === -1 ? path : path.slice(slash + 1);
  const dot = base.lastIndexOf(".");
  const stem = dot <= 0 ? base : base.slice(0, dot);
  const ext = dot <= 0 ? "" : base.slice(dot);
  let counter = 1;
  let candidate = `${dir}${stem} (${counter})${ext}`;
  while (taken.has(candidate)) {
    counter += 1;
    candidate = `${dir}${stem} (${counter})${ext}`;
  }
  taken.add(candidate);
  return candidate;
}

// Windows reserves these device names regardless of extension.
const RESERVED_DEVICE_NAMES = new Set([
  "CON", "PRN", "AUX", "NUL",
  "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
  "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
]);

function sanitizeSegment(segment: string): string {
  // Replace characters illegal on Windows/macOS, then trim trailing dots/spaces (Windows strips them,
  // which would silently collide two distinct names). Spaces inside a name are legal and kept.
  let cleaned = segment.replace(/[<>:"/\\|?*]/g, "_").replace(/[ .]+$/g, "");
  if (cleaned.length === 0) cleaned = "_";
  const stem = cleaned.split(".")[0]?.toUpperCase() ?? "";
  if (RESERVED_DEVICE_NAMES.has(stem)) cleaned = `_${cleaned}`;
  return cleaned;
}

// Sanitizes every "/"-separated segment so the archive extracts cleanly on Windows, macOS, and Linux.
// Empty segments (from doubled or trailing slashes) are dropped.
export function sanitizeArchivePath(path: string): string {
  return path
    .split("/")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0)
    .map(sanitizeSegment)
    .join("/");
}
