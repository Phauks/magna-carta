/*
 * Naming, in one place, because a name is born or changed in four places on this surface and all
 * four obey one rule:
 *
 *   - creation auto-disambiguates ("New Folder (2)"), so two siblings cannot collide;
 *   - a DELIBERATE rename that would collide is REFUSED with inline validation naming the exact
 *     sibling it collides with — never a silent failure, never an auto-mangle behind the reader;
 *   - pasting a copy disambiguates the copy;
 *   - an upload into a collision disambiguates per the copy convention.
 *
 * Names compare case-insensitively, because two files whose names differ only in case read as the
 * same file to everybody except the comparison.
 *
 * THE EXTENSION governs display and selection, never editability. When extensions are shown, what
 * the reader typed stands — retyping ".pdf" over ".pdf.exe" is a deliberate act and the commit must
 * not put the old extension back. When extensions are hidden, the stored extension reattaches,
 * because the field the reader edited never contained one.
 */

export interface SplitName {
  /** Everything before the final dot, or the whole name when there is no extension. */
  readonly stem: string;
  /** The final dot and what follows it, or the empty string. */
  readonly extension: string;
}

/**
 * Split a name at its final dot. A leading dot is part of the stem: ".gitignore" is a name, not an
 * extension, and treating it as one would leave the rename field empty.
 */
export function splitName(name: string): SplitName {
  const dot = name.lastIndexOf(".");
  if (dot <= 0 || dot === name.length - 1) return { stem: name, extension: "" };
  return { stem: name.slice(0, dot), extension: name.slice(dot) };
}

/** What the list shows for a name, given the reader's extension setting. */
export function displayName(name: string, hideExtensions: boolean): string {
  return hideExtensions ? splitName(name).stem : name;
}

/**
 * What the rename field is seeded with. With extensions hidden it holds no extension at all — the
 * reader cannot select what is not there. With extensions shown it holds the whole name, and the
 * caller selects only the stem.
 */
export function renameFieldValue(name: string, hideExtensions: boolean): string {
  return hideExtensions ? splitName(name).stem : name;
}

/**
 * Where the selection ends when a rename field opens: the stem only, never the extension. The
 * caller applies it with setSelectionRange, so a reader who types immediately replaces the name
 * and keeps the extension.
 */
export function renameSelectionEnd(fieldValue: string, hideExtensions: boolean): number {
  return hideExtensions ? fieldValue.length : splitName(fieldValue).stem.length;
}

/**
 * The name a rename actually commits. With extensions hidden the stored extension reattaches; with
 * them shown, what was typed stands — including a changed extension, which is what makes correcting
 * a misleading one possible at all.
 */
export function committedRename(
  typed: string,
  storedExtension: string,
  hideExtensions: boolean,
): string {
  const trimmed = typed.trim();
  if (!hideExtensions) return trimmed;
  return trimmed === "" ? trimmed : trimmed + storedExtension;
}

/** Case-insensitive sibling comparison — the one comparison every naming rule here uses. */
export function namesCollide(left: string, right: string): boolean {
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}

/**
 * The sibling a proposed name would collide with, or null. `existing` is every name already in the
 * destination; `excluding` is the row being renamed, which cannot collide with itself.
 */
export function collidingSibling(
  proposed: string,
  existing: readonly { readonly key: string; readonly name: string }[],
  excludingKey?: string,
): string | null {
  const hit = existing.find(
    (sibling) => sibling.key !== excludingKey && namesCollide(sibling.name, proposed),
  );
  return hit === undefined ? null : hit.name;
}

/**
 * A name that cannot collide, in the copy convention: "Report.pdf" becomes "Report (2).pdf", then
 * "Report (3).pdf". Used at creation, at paste, and on an upload that lands on a name already
 * taken — never on a deliberate rename, which is refused instead.
 */
export function disambiguated(
  wanted: string,
  existing: readonly { readonly key: string; readonly name: string }[],
): string {
  if (collidingSibling(wanted, existing) === null) return wanted;
  const { stem, extension } = splitName(wanted);
  for (let attempt = 2; attempt < 1000; attempt += 1) {
    const candidate = `${stem} (${attempt})${extension}`;
    if (collidingSibling(candidate, existing) === null) return candidate;
  }
  return wanted;
}

/** The refusal a colliding rename shows, said where the name was typed. */
export function renameConflictMessage(sibling: string): string {
  return `"${sibling}" is already here. Choose a different name.`;
}
