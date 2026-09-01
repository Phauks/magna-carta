/*
 * The shape a surface hands DigestList. Separate from the component so the type is importable
 * without importing the component — and because a type declared in a `.svelte` file's instance
 * script is not part of that module's exports.
 */
export interface DigestEntry {
  /** The algorithm as it is named to a reader: "SHA-256", not "sha256". */
  readonly algorithm: string;
  /** The digest, or null when it has not been computed. */
  readonly value: string | null;
}
