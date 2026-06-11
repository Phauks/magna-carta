/**
 * Contrast pairs: the design-language contract the contrast gate enforces
 * (test/contrast.test.ts) — foreground/background semantic-token pairings that
 * must clear WCAG 2.2 AA in every theme and mode permutation.
 *
 * Names are the dashed semantic variable names without the `--mc-` prefix
 * (token `status.info-foreground` → `status-info-foreground`).
 */
export interface ContrastPair {
  /** Semantic variable name of the foreground (text, icon, border, ring) color. */
  readonly foreground: string;
  /** Semantic variable name of the background color it renders on. */
  readonly background: string;
  /** Minimum WCAG 2.2 relative-luminance contrast ratio: 4.5 for text (1.4.3 AA), 3 for non-text UI (1.4.11). */
  readonly minimumRatio: number;
}

/** Foreground/background pairings that must clear WCAG 2.2 AA in every theme x mode. */
export const CONTRAST_PAIRS: ReadonlyArray<ContrastPair> = [
  { foreground: "text-default", background: "surface-default", minimumRatio: 4.5 },
  { foreground: "text-muted", background: "surface-default", minimumRatio: 4.5 },
  { foreground: "text-default", background: "surface-raised", minimumRatio: 4.5 },
  { foreground: "action-primary-foreground", background: "action-primary", minimumRatio: 4.5 },
  { foreground: "action-secondary-foreground", background: "action-secondary", minimumRatio: 4.5 },
  {
    foreground: "action-destructive-foreground",
    background: "action-destructive",
    minimumRatio: 4.5,
  },
  { foreground: "status-info-foreground", background: "status-info", minimumRatio: 4.5 },
  { foreground: "status-success-foreground", background: "status-success", minimumRatio: 4.5 },
  { foreground: "status-warning-foreground", background: "status-warning", minimumRatio: 4.5 },
  { foreground: "status-danger-foreground", background: "status-danger", minimumRatio: 4.5 },
  { foreground: "text-link", background: "surface-default", minimumRatio: 4.5 },
  // non-text UI (borders, focus ring) per WCAG 1.4.11:
  { foreground: "border-strong", background: "surface-default", minimumRatio: 3 },
  { foreground: "focus-ring", background: "surface-default", minimumRatio: 3 },
];
