/*
 * What a kind of ask implies, and how wide a panel opens. Every decision the shell makes that can
 * be made without a DOM lives here, so it can be asserted directly rather than inferred from a
 * rendered panel — the same division the rest of this package draws between what a story shows and
 * what a test pins.
 *
 * The point of putting these in a table rather than in `{#if}` branches is that the table is the
 * argument. A reader can see at a glance that a question has no corner dismiss and a form does,
 * that only a form is dismissed by a press outside, and that the two are the same everywhere —
 * which is exactly what was NOT true of the panels this shell replaces, where each file decided
 * its own and thirty files disagreed.
 */
import type { ActionDialogKind, ActionDialogWidth } from "./types.ts";

/** Everything a kind decides, resolved in one place. */
export interface KindTraits {
  /** Which primitive renders it. An alert dialog takes the `alertdialog` role and traps a decision. */
  readonly primitive: "dialog" | "alert-dialog";
  /** The word on the control that walks away without committing. */
  readonly dismissLabel: string;
  /** Whether the panel carries the corner dismiss. */
  readonly showsCornerDismiss: boolean;
  /** Whether a press outside the panel dismisses it. */
  readonly dismissOnPressOutside: boolean;
  /** The commit control's variant. */
  readonly commitVariant: "primary" | "destructive";
}

const KIND_TRAITS: Record<ActionDialogKind, KindTraits> = {
  form: {
    primitive: "dialog",
    dismissLabel: "Cancel",
    showsCornerDismiss: true,
    dismissOnPressOutside: true,
    commitVariant: "primary",
  },
  confirm: {
    primitive: "alert-dialog",
    dismissLabel: "Never mind",
    showsCornerDismiss: false,
    dismissOnPressOutside: false,
    commitVariant: "primary",
  },
  destructive: {
    primitive: "alert-dialog",
    dismissLabel: "Never mind",
    showsCornerDismiss: false,
    dismissOnPressOutside: false,
    commitVariant: "destructive",
  },
};

/** What this kind of ask implies. */
export function traitsOf(kind: ActionDialogKind): KindTraits {
  return KIND_TRAITS[kind];
}

/*
 * The width utilities. Utilities rather than a recipe, deliberately and for a reason that has bitten
 * this package before: the dialog panel underneath arrives wearing its own default cap as a Tailwind
 * utility, and utilities outrank the components layer whatever the selector — so a max-inline-size
 * written in a recipe is overridden silently and governs nothing. Only another utility can replace
 * it. The same note is on the record window's recipe, which learned it the hard way.
 */
const WIDTH_CLASSES: Record<ActionDialogWidth, string> = {
  narrow: "max-w-md",
  default: "max-w-lg",
  wide: "max-w-2xl",
  record: "max-w-record-window",
};

/** The max-width utility for a panel of this width. */
export function widthClass(width: ActionDialogWidth): string {
  return WIDTH_CLASSES[width];
}

/**
 * The sentence the discard question asks about an unfinished panel.
 *
 * Here rather than in the shell's markup so the wording is one string a reader can find and a test
 * can pin. It describes what the reader was doing rather than naming the panel, because a panel's
 * own title read back as a noun ("Open a Packet") is not what anybody thinks they were in the
 * middle of. It also says plainly that nothing has happened yet — the reader's fear at this moment
 * is that dismissing has already half-done something.
 */
export const DISCARD_SENTENCE =
  "This has entries that have not been saved. Leaving now throws them away; nothing has been " +
  "changed yet, so everything else stays exactly as it was.";
