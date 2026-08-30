/*
 * What the docket is currently being asked for, and whether that is narrower than the whole thing.
 *
 * The screen has three narrowing mechanisms and they are not the same kind of thing. The SCOPE is a
 * server read: it decides which matters are fetched at all, and a consultation is unreachable
 * without it because the listing's own default leaves unnumbered matters out. The SEARCH is also
 * the server's, run over the firm's whole record rather than the rows on screen. The COLUMN FILTERS
 * are the table's, run over what has been loaded.
 *
 * They live behind one control anyway, because from where a reader sits they answer one question —
 * "why am I not seeing everything?" — and answering it in three places is how a person ends up
 * staring at an empty table with a filter set on a screen they are not looking at. What this module
 * owns is the arithmetic of that: what the control is called, and whether it must show itself as
 * live.
 */
import type { MatterScope } from "./matters-api.ts";

export interface MatterScopeItem {
  readonly value: MatterScope;
  readonly label: string;
}

/**
 * The scopes, in reading order.
 *
 * The working docket leads because it is the answer a person wants nine mornings in ten, and it is
 * the listing's own default, so leading with it means the control's first entry and the read that
 * happens without touching it are the same thing.
 */
export const MATTER_SCOPE_ITEMS: readonly MatterScopeItem[] = [
  { value: "caseload", label: "The working docket" },
  { value: "open", label: "Open matters" },
  { value: "closed", label: "Closed matters" },
  { value: "prospective", label: "Consultations" },
];

/** The scope the screen reads with when nobody has chosen otherwise. */
export const DEFAULT_MATTER_SCOPE: MatterScope = "caseload";

export function matterScopeLabel(scope: MatterScope): string {
  return MATTER_SCOPE_ITEMS.find((item) => item.value === scope)?.label ?? scope;
}

export interface DocketNarrowing {
  readonly scope: MatterScope;
  /** The settled search text, not what is mid-keystroke. */
  readonly search: string;
  /** How many of the table's own columns are filtered. */
  readonly columnFilterCount: number;
}

/**
 * Whether anything is holding matters back from the view.
 *
 * A scope other than the default counts, because choosing "Closed matters" hides every open one and
 * a reader who has forgotten they chose it is looking at a screen that appears to say the firm has
 * no live work.
 */
export function docketIsNarrowed(narrowing: DocketNarrowing): boolean {
  return (
    narrowing.scope !== DEFAULT_MATTER_SCOPE ||
    narrowing.search.trim() !== "" ||
    narrowing.columnFilterCount > 0
  );
}

/**
 * What the narrowing control says about itself, for its accessible name and its hover.
 *
 * It states what is in play rather than how to undo it: the control is the way to undo it, and a
 * sentence explaining a control that is under the reader's pointer is a sentence read once.
 */
export function docketNarrowingSummary(narrowing: DocketNarrowing): string {
  const parts: string[] = [matterScopeLabel(narrowing.scope)];
  if (narrowing.search.trim() !== "") parts.push(`searching "${narrowing.search.trim()}"`);
  if (narrowing.columnFilterCount > 0) {
    parts.push(
      narrowing.columnFilterCount === 1
        ? "1 column filtered"
        : `${narrowing.columnFilterCount} columns filtered`,
    );
  }
  return parts.join(" · ");
}
