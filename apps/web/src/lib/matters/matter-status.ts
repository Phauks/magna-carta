/*
 * The matter lifecycle status register — ONE map from status to how it reads, so no surface picks
 * its own words or its own tone. The header seal, the list's status column, and anything later that
 * shows a matter's standing all read this.
 *
 * Closed is archived-but-additive — a matter can still accrue record after it closes — so it reads
 * quiet neutral, never destructive red. Prospective is a consultation the firm has not taken yet,
 * which is information rather than progress, so it takes the info register. Open is the working
 * state and the only one that reads as green.
 *
 * The tones are the subtle badge register: a status column on a work surface must not turn a table
 * of matters into a traffic light.
 */
import type { BadgeVariant } from "@magna-carta/design-system/badge";

export type MatterStatus = "prospective" | "open" | "closed";

export interface MatterStatusPresentation {
  /** The label as it prints, title case. */
  label: string;
  /** The subtle badge register this status wears. */
  variant: BadgeVariant;
}

export const MATTER_STATUS_PRESENTATION: Record<MatterStatus, MatterStatusPresentation> = {
  prospective: { label: "Prospective", variant: "info" },
  open: { label: "Open", variant: "success" },
  closed: { label: "Closed", variant: "neutral" },
};

/** How one status reads. */
export function matterStatusPresentation(status: MatterStatus): MatterStatusPresentation {
  return MATTER_STATUS_PRESENTATION[status];
}

/** The label alone — what a sort key, a filter value, or a cell's plain text needs. */
export function matterStatusLabel(status: MatterStatus): string {
  return MATTER_STATUS_PRESENTATION[status].label;
}

/**
 * The lifecycle statuses in the order a matter passes through them. Drives any control that offers
 * a status, so two surfaces cannot disagree about which comes first.
 */
export const MATTER_STATUSES: readonly MatterStatus[] = ["prospective", "open", "closed"];
