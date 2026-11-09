/*
 * Browsing INSIDE an archive: one level at a time, the same shape the folder listing uses.
 *
 * Reading a zip's central directory is not extraction — the entry list, the sizes and the dates
 * all come out of the directory record without inflating a byte, which is why entering an archive
 * is cheap and extracting from it is a decision. Entries deeper than the current path collapse
 * into the directory that contains them, so a zip with ten thousand members still renders one
 * screen.
 */
import type { ArchiveEntry } from "./matter-file-api.ts";

export interface ArchiveDirectoryRow {
  readonly kind: "directory";
  /** The row's identity: the full path prefix this directory stands for, trailing slash included. */
  readonly path: string;
  readonly name: string;
  /** Files anywhere beneath this directory, and their uncompressed bytes summed. */
  readonly fileCount: number;
  readonly totalBytes: number;
}

export interface ArchiveFileRow {
  readonly kind: "file";
  readonly path: string;
  readonly name: string;
  readonly sizeBytes: number | null;
  readonly modifiedAt: string | null;
}

export type ArchiveRow = ArchiveDirectoryRow | ArchiveFileRow;

/** The rows one level of the archive shows: directories first, then files, each set name-sorted. */
export function archiveLevelRows(entries: readonly ArchiveEntry[], prefix: string): ArchiveRow[] {
  const directories = new Map<string, { fileCount: number; totalBytes: number }>();
  const files: ArchiveFileRow[] = [];
  for (const entry of entries) {
    if (!entry.path.startsWith(prefix) || entry.path === prefix) continue;
    const rest = entry.path.slice(prefix.length);
    const slash = rest.indexOf("/");
    if (slash === -1) {
      if (!entry.isDirectory) {
        files.push({
          kind: "file",
          path: entry.path,
          name: rest,
          sizeBytes: entry.uncompressedSizeBytes,
          modifiedAt: entry.modifiedAt,
        });
      }
      continue;
    }
    const name = rest.slice(0, slash);
    const held = directories.get(name) ?? { fileCount: 0, totalBytes: 0 };
    if (!entry.isDirectory) {
      held.fileCount += 1;
      held.totalBytes += entry.uncompressedSizeBytes ?? 0;
    }
    directories.set(name, held);
  }
  return [
    ...[...directories.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, held]): ArchiveDirectoryRow => ({
        kind: "directory",
        path: prefix + name + "/",
        name,
        fileCount: held.fileCount,
        totalBytes: held.totalBytes,
      })),
    ...files.sort((left, right) => left.name.localeCompare(right.name)),
  ];
}

/** The path segments between the archive's root and the current level, for the crossing's crumb. */
export function archivePathSegments(prefix: string): { name: string; path: string }[] {
  const segments: { name: string; path: string }[] = [];
  let walked = "";
  for (const name of prefix.split("/").filter((segment) => segment !== "")) {
    walked += name + "/";
    segments.push({ name, path: walked });
  }
  return segments;
}
