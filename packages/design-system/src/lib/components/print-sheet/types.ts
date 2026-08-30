/*
 * The printable unit's shapes.
 *
 * A sheet is DATA, never markup. Everything the paper says arrives as the strings below, so the
 * component can render a time entry, a fee, a cost or an invoice without ever learning which of
 * those it is holding — and so that what reaches the paper is a closed set somebody can enumerate.
 * That closure is what makes the internal-memo exclusion (client-facing-projection.ts) provable
 * rather than promised: there is no snippet, no HTML and no caller-supplied formatter through which
 * text the client must never see could arrive.
 */
import type { EventRailEvent } from "../event-rail/types.ts";

/**
 * One stated fact: what it is, and what it says.
 *
 * `secondary` is the same value in its other literacy, set quieter beside the primary one — a
 * duration's clock form beside the decimal hours the bill actually multiplies. It is a second
 * rendering of one value, never a second fact.
 */
export interface PrintSheetField {
  readonly label: string;
  readonly value: string;
  readonly secondary?: string;
}

interface PrintSheetSectionBase {
  /** Stable identity within the sheet; the render key. */
  readonly id: string;
  /** The heading above the section. A section whose contents speak for themselves may omit it. */
  readonly title?: string;
}

/** A block of stated facts, label and value. */
export interface PrintSheetFieldsSection extends PrintSheetSectionBase {
  readonly kind: "fields";
  readonly fields: readonly PrintSheetField[];
}

/**
 * A block of prose the client reads — the description a bill carries.
 *
 * It wraps and grows on paper as it does in the record window: the text a client is charged
 * against is never clipped, ellipsised or scrolled away.
 */
export interface PrintSheetTextSection extends PrintSheetSectionBase {
  readonly kind: "text";
  readonly text: string;
}

/**
 * The record's history, oldest first.
 *
 * It carries the same events the on-screen rail does, so a history reads the same in both places,
 * but it is set as a static list rather than the rail component: the rail is a scrolling region,
 * and paper does not scroll. A printed history that had to be scrolled would simply be a printed
 * history missing its end.
 */
export interface PrintSheetHistorySection extends PrintSheetSectionBase {
  readonly kind: "history";
  readonly events: readonly EventRailEvent[];
}

export type PrintSheetSection =
  | PrintSheetFieldsSection
  | PrintSheetTextSection
  | PrintSheetHistorySection;

/**
 * Everything one printed sheet says.
 *
 * The heading names what the document IS ("Time Entry"), the reference is the record's own number,
 * and the subtitle is what it belongs to. Each of those has exactly one home here, so nothing on
 * the paper repeats itself.
 */
export interface PrintSheetDocument {
  readonly heading: string;
  readonly reference?: string;
  readonly subtitle?: string;
  readonly sections: readonly PrintSheetSection[];
  /** One quiet line at the foot of the paper — who the sheet came from, and when it was printed. */
  readonly footer?: string;
}
