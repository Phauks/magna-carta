// One verifiable line per bundled file (path, byte size, content SHA-256), tab-separated and sorted by
// path, with a summary footer. A recipient can re-hash each extracted file and compare. Pure text; the
// builder writes it into the bundle as CONTENTS.txt.
export interface ManifestEntry {
  readonly path: string;
  readonly sizeBytes: number;
  readonly sha256: string;
}

export function buildContentsManifest(entries: readonly ManifestEntry[]): string {
  const sorted = [...entries].toSorted((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const rows = sorted.map((entry) => `${entry.path}\t${entry.sizeBytes}\t${entry.sha256}`);
  const totalBytes = sorted.reduce((sum, entry) => sum + entry.sizeBytes, 0);
  const footer = `# ${sorted.length} files, ${totalBytes} bytes`;
  return `path\tsize_bytes\tsha256\n${rows.length > 0 ? `${rows.join("\n")}\n` : ""}${footer}\n`;
}
