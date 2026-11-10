/*
 * What a feature hands the permission request, and all it may hand it.
 *
 * The contract is the owner's ruling of 2026-11-10: a request says what is being granted and stops.
 * So there is a heading, a name for who is asking, and the grants — and no field in which a caller
 * could list what is NOT being granted, reassure, or explain. The absence is the mechanism: a list of
 * what a grant leaves out has no end, and every entry on it raises the question of what else was
 * left off, while the list of grants is the whole of what the reader is deciding.
 */
export interface PermissionRequestContent {
  /** What is being allowed, in the reader's words: "Allow Magna Carta to Use Your Outlook Calendar". */
  readonly heading: string;
  /** Who or what is asking, as a name: a feature ("Calendar Sync") or a person ("Maria Okafor"). */
  readonly askedBy: string;
  /** Each thing granted, one plain sentence about an act. Never empty: a request grants something. */
  readonly grants: readonly [string, ...string[]];
}
