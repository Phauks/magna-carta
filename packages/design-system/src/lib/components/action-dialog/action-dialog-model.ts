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
 *
 * It is also the reason a ruling on any of this is now one edit. The dismissal verb was settled by
 * the owner after this table existed, and settling it changed one constant rather than thirty files.
 */
import type { ActionDialogKind, ActionDialogWidth } from "./types.ts";

/**
 * The word on the control that walks away without committing — ONE word, for every kind of ask.
 *
 * Owner ruling, 2026-09-02, settling a thirteen-to-five split between "Cancel" and "Close" across
 * the panels this shell replaces. It is a constant rather than a column in the table below on
 * purpose: a per-kind field that happened to hold the same value in every row would be an invitation
 * to make them differ again, and the ruling is that they do not.
 */
export const DISMISS_LABEL = "Cancel";

/**
 * The word on the way out of a panel that asked for nothing. "Cancel" is the ruling for an act —
 * something was begun — and nothing was begun here; the record window's own reading mode leaves
 * through "Close", so a reading panel does too.
 */
export const LEAVE_LABEL = "Close";

/** Everything a kind decides, resolved in one place. */
export interface KindTraits {
  /** Which primitive renders it. An alert dialog takes the `alertdialog` role and traps a decision. */
  readonly primitive: "dialog" | "alert-dialog";
  /** Whether the panel carries the corner dismiss. */
  readonly showsCornerDismiss: boolean;
  /** Whether a press outside the panel dismisses it. */
  readonly dismissOnPressOutside: boolean;
  /** The commit control's variant. A reading panel has no commit, and says so. */
  readonly commitVariant: "primary" | "destructive" | null;
}

const KIND_TRAITS: Record<ActionDialogKind, KindTraits> = {
  form: {
    primitive: "dialog",
    showsCornerDismiss: true,
    dismissOnPressOutside: true,
    commitVariant: "primary",
  },
  confirm: {
    primitive: "alert-dialog",
    showsCornerDismiss: false,
    dismissOnPressOutside: false,
    commitVariant: "primary",
  },
  destructive: {
    primitive: "alert-dialog",
    showsCornerDismiss: false,
    dismissOnPressOutside: false,
    commitVariant: "destructive",
  },
  reading: {
    primitive: "dialog",
    showsCornerDismiss: true,
    dismissOnPressOutside: true,
    commitVariant: null,
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

/**
 * The max-width utility for a panel of this width.
 *
 * A context pane implies the record width, whatever `width` says. The two panes have bases of
 * their own (the primary stops at size.record-pane, the context asks for size.record-context), and
 * a frame narrower than the two together squeezes both into something neither was designed for.
 * Rather than let a caller discover that by eye, the shell decides it: context beside the fields
 * is the record window's geometry, so it opens at the record window's width.
 */
export function widthClass(width: ActionDialogWidth, { withContext = false } = {}): string {
  return WIDTH_CLASSES[withContext ? "record" : width];
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
