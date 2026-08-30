/*
 * The record menu's model: what a menu IS, before anything renders it.
 *
 * THE ONE IDEA THIS COMPONENT EXISTS FOR. A right-click menu here speaks for the WHOLE selection,
 * not for the row the pointer happened to land on. Everything below follows from that:
 *
 *   - A verb that acts on many SAYS how many. "Delete" over twelve files is a lie about what is
 *     about to happen; "Delete 12 Items" is not.
 *   - A verb that only makes sense somewhere exists only there. Writing into "the current folder"
 *     has no meaning in a view that is not a folder, so those verbs are gated on one genuinely
 *     existing rather than quietly acting on the last folder somebody looked at.
 *   - A verb that cannot run RENDERS, disabled, saying why. Silently dropping it teaches the reader
 *     that the menu changes shape for reasons they cannot see.
 *   - A verb that has no meaning at all over many is omitted instead — entering an archive, or
 *     converting a file, is a gesture about one thing, and there-and-disabled would be noise.
 *
 * WHY THE MODEL IS DATA AND THE COMPONENT IS THIN. Every question worth arguing about — which verbs
 * appear, what each is called, what its count is, whether it is disabled and with what words — is
 * answered here, by pure functions over a described selection. That is what lets those answers be
 * asserted without a browser, and it is why the two catalogues (the file surfaces and the ledger
 * surfaces) can differ in their verbs while sharing every rule about how a verb behaves.
 *
 * WHAT LIVES WHERE:
 *   record-menu-model.ts       — this file: the grammar, the item shapes, the shortcut model.
 *   file-record-menu.ts        — the verbs of the file surfaces.
 *   ledger-record-menu.ts      — the verbs of the time, fee and cost surfaces.
 *   record-menu-shortcuts.ts   — the keyboard handler that makes a displayed shortcut real.
 *   record-menu.svelte         — the rendering, and nothing else.
 */
import type { Component } from "svelte";
import { isApplePlatform } from "@magna-carta/design-system/internal/platform";

// --- counting ---------------------------------------------------------------------------------

/** How a kind of record is named, in the two numbers a counted verb needs. */
export interface NounPair {
  readonly singular: string;
  readonly plural: string;
}

export const FILE_NOUN: NounPair = { singular: "File", plural: "Files" };
export const FOLDER_NOUN: NounPair = { singular: "Folder", plural: "Folders" };
export const DOCUMENT_NOUN: NounPair = { singular: "Document", plural: "Documents" };
/** What a mixed selection is called. Files and folders together are neither. */
export const ITEM_NOUN: NounPair = { singular: "Item", plural: "Items" };

/**
 * How a verb names what it will act on when there is exactly one of them.
 *
 * `bare` drops the noun entirely: "Download" reads better than "Download This File", and the row
 * the menu opened over is already the answer to "which one".
 *
 * `demonstrative` keeps it, for the verbs whose sentence would not survive losing it — "Restore
 * Into the Matter" has lost its object, "Restore This File Into the Matter" has not.
 */
export type CountStyle = "bare" | "demonstrative";

export interface CountedLabelParts {
  /** The verb, in the case it renders: "Download", "Re-run Safety Check". */
  readonly verb: string;
  /** How many records this verb will act on. Not the size of the selection, where they differ. */
  readonly count: number;
  readonly noun: NounPair;
  readonly style?: CountStyle;
  /** The word that joins the verb to its object, where one is needed: "on", "for". */
  readonly preposition?: string;
  /** Anything that follows the object: "Into the Matter". */
  readonly suffix?: string;
}

/**
 * A verb's label, counted.
 *
 * The preposition and the object appear or vanish together, so a verb whose object drops at one
 * does not leave a dangling "on" behind it.
 */
export function countedLabel(parts: CountedLabelParts): string {
  const { verb, count, noun, style = "bare", preposition, suffix } = parts;
  const object =
    count === 1
      ? style === "demonstrative"
        ? `This ${noun.singular}`
        : ""
      : `${count} ${noun.plural}`;

  const words = [verb];
  if (object !== "") {
    if (preposition !== undefined) words.push(preposition);
    words.push(object);
  }
  if (suffix !== undefined) words.push(suffix);
  return words.join(" ");
}

// --- keyboard shortcuts -----------------------------------------------------------------------

/**
 * A shortcut a menu row DISPLAYS, which is the same thing as a shortcut that works.
 *
 * The two halves used to drift: a menu advertised the clipboard chords while nothing listened for
 * them, so the menu taught people a gesture the product did not have. Holding the chord on the
 * action itself is what closes that — the handler resolves a keystroke to the very action object
 * the menu draws, so a row cannot show a chord that reaches somewhere else, or nowhere.
 */
export interface KeyboardShortcut {
  /** Compared case-insensitively against the event's `key`. */
  readonly key: string;
  /** Ctrl on Windows and Linux; Command on Apple platforms. */
  readonly commandModifier: boolean;
  readonly shift: boolean;
}

export function commandShortcut(letter: string): KeyboardShortcut {
  return { key: letter.toLowerCase(), commandModifier: true, shift: false };
}

export function plainShortcut(key: string): KeyboardShortcut {
  return { key, commandModifier: false, shift: false };
}

/**
 * The keycaps a shortcut draws, written the way the reader's own keyboard writes it. The Apple
 * question is answered in one place for the whole product; this reads that answer rather than
 * asking it again.
 */
export function shortcutKeycaps(shortcut: KeyboardShortcut, platform?: string): string[] {
  const caps: string[] = [];
  if (shortcut.commandModifier) caps.push(isApplePlatform(platform) ? "⌘" : "Ctrl");
  if (shortcut.shift) caps.push("Shift");
  caps.push(shortcut.key.length === 1 ? shortcut.key.toUpperCase() : shortcut.key);
  return caps;
}

/** The keystroke fields a match needs. Taking the shape rather than the event keeps this pure. */
export interface KeystrokeDescription {
  readonly key: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
}

export function shortcutMatches(
  shortcut: KeyboardShortcut,
  keystroke: KeystrokeDescription,
  platform?: string,
): boolean {
  if (keystroke.key.toLowerCase() !== shortcut.key.toLowerCase()) return false;
  if (keystroke.altKey) return false;
  if (keystroke.shiftKey !== shortcut.shift) return false;
  const command = isApplePlatform(platform) ? keystroke.metaKey : keystroke.ctrlKey;
  return command === shortcut.commandModifier;
}

// --- the items --------------------------------------------------------------------------------

/**
 * One verb.
 *
 * `disabledReason` and `soonDependency` are two different kinds of "cannot", and they read
 * differently on the row: a reason says this selection cannot take this verb, and a dependency says
 * nobody can yet, because the thing it needs is not built. Both leave the verb on screen.
 */
export interface RecordMenuAction {
  readonly kind: "action";
  /** Stable across renders and wordings; what a test and a shortcut hold on to. */
  readonly identifier: string;
  readonly label: string;
  readonly icon: Component;
  readonly shortcut?: KeyboardShortcut;
  /** Why this selection cannot take this verb, as a sentence. Its presence is what disables it. */
  readonly disabledReason?: string;
  /** What the verb waits on, as a noun phrase. Its presence marks the verb as designed, not served. */
  readonly soonDependency?: string;
  /**
   * Whether choosing this leaves the menu open. Pinning is applied to several rows in a row, so a
   * menu that closed on the first one would be reopened immediately.
   */
  readonly staysOpen?: boolean;
  /** Whether the verb's glyph renders in its marked form — a filled pin on an already-pinned row. */
  readonly marked?: boolean;
}

/** One choice inside a flyout: a colour, an icon, a document type, a value to copy. */
export interface RecordMenuChoice {
  readonly identifier: string;
  readonly label: string;
  /** Whether every record in the verb's scope already carries this choice. */
  readonly selected?: boolean;
  readonly disabledReason?: string;
  readonly soonDependency?: string;
}

/**
 * A verb whose answer is a set of choices, opened beside its own row rather than over the menu.
 *
 * A flyout is not a second menu: it is one verb whose object is picked. That distinction is why
 * choosing a colour for four folders is one verb counted once, not four.
 */
export interface RecordMenuFlyout {
  readonly kind: "flyout";
  readonly identifier: string;
  readonly label: string;
  readonly icon: Component;
  readonly choices: readonly RecordMenuChoice[];
  readonly disabledReason?: string;
}

export type RecordMenuItem = RecordMenuAction | RecordMenuFlyout;

/**
 * A run of verbs that belong together, drawn between separator rules.
 *
 * The group is the unit rather than the separator, so a group that turns out to have nothing in it
 * takes its rule with it. A menu can never draw two rules with nothing between them.
 */
export interface RecordMenuGroup {
  readonly identifier: string;
  readonly items: readonly RecordMenuItem[];
}

export type RecordMenuModel = readonly RecordMenuGroup[];

/** Assemble groups, dropping the empty ones so no separator is left bounding nothing. */
export function menuOf(
  groups: readonly { identifier: string; items: readonly (RecordMenuItem | null)[] }[],
): RecordMenuModel {
  return groups
    .map((group) => ({
      identifier: group.identifier,
      items: group.items.filter((item): item is RecordMenuItem => item !== null),
    }))
    .filter((group) => group.items.length > 0);
}

/** Every item in a menu, flattened, in the order a reader meets them. */
export function menuItems(menu: RecordMenuModel): RecordMenuItem[] {
  return menu.flatMap((group) => [...group.items]);
}

/** One item by its identifier, or null. The lookup tests and callers both use. */
export function menuItem(menu: RecordMenuModel, identifier: string): RecordMenuItem | null {
  return menuItems(menu).find((item) => item.identifier === identifier) ?? null;
}

/** Whether an item is choosable: neither refused for this selection nor waiting on something. */
export function isEnabled(item: RecordMenuItem): boolean {
  if (item.disabledReason !== undefined) return false;
  if (item.kind === "action" && item.soonDependency !== undefined) return false;
  return true;
}

// --- the disciplines every catalogue shares ---------------------------------------------------

/**
 * A verb that means something on one record and nothing on a selection.
 *
 * It keeps its singular label and renders disabled with the reason, rather than disappearing: a
 * verb that vanishes when a second row is selected reads as a menu with a mind of its own. The
 * verbs that have no meaning on ONE either — entering an archive, converting a file's bytes — are
 * a different case and are simply not built by their catalogue.
 */
export function oneRecordGesture(
  count: number,
  reason: string,
): { readonly disabledReason?: string } {
  return count > 1 ? { disabledReason: reason } : {};
}

/**
 * The one choice every record in scope already carries, or null when they disagree.
 *
 * A menu that marked a colour because ONE of four folders wore it would be stating something
 * untrue about the other three, so a shared mark is shown only where the whole scope agrees.
 */
export function sharedMark<T>(values: readonly T[]): T | null {
  const [first, ...rest] = values;
  if (first === undefined) return null;
  return rest.every((value) => value === first) ? first : null;
}

/** Mark the choice the whole scope already carries, leaving the rest unmarked. */
export function markShared(
  choices: readonly { identifier: string; label: string }[],
  shared: string | null,
): RecordMenuChoice[] {
  return choices.map((choice) => ({ ...choice, selected: choice.identifier === shared }));
}
