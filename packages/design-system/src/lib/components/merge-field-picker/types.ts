/*
 * The picker's option shape — STRUCTURAL, not domain.
 *
 * The design system deliberately does not import the merge-field catalog contract: a component that
 * knew about catalog entries could only ever serve one producer, and the boundary that keeps this
 * package free of workspace domain types is worth more than the adapter a consumer writes. A
 * consumer maps whatever it has (a catalog entry today, an endpoint payload later) into these
 * fields, which are exactly what a row needs to render and be found by search.
 */
import type { MergeFieldChipStatus } from "../merge-field-chip/variants.ts";

export interface MergeFieldPickerOption {
  /** The value committed on selection, and the option's identity in the list. */
  readonly key: string;
  /** What the row reads. A person picks by label; the key is search vocabulary, not the subject. */
  readonly label: string;
  /** Group identity — rows with the same group render under one heading. */
  readonly group: string;
  /** The heading text for this option's group. */
  readonly groupLabel: string;
  /** Short value-type name shown on the row ("Date", "Money"). */
  readonly valueTypeLabel: string;
  /** One line about the field, shown under the label. Also searched. */
  readonly description?: string;
  /** Whether choosing this field means work later — drives the row's status affordance. */
  readonly status?: MergeFieldChipStatus;
  /** Present but unselectable (a field the acting member may not use). */
  readonly disabled?: boolean;
}

export interface MergeFieldPickerSection {
  readonly group: string;
  readonly label: string;
  readonly options: readonly MergeFieldPickerOption[];
}
