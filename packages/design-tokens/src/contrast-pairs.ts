/**
 * Contrast pairs: the design-language contract the contrast gate enforces
 * (test/contrast.test.ts) — foreground/background semantic-token pairings that
 * must clear WCAG 2.2 AA in every theme and mode permutation.
 *
 * Names are the dashed semantic variable names without the `--mc-` prefix
 * (token `status.info-foreground` → `status-info-foreground`).
 */
/** WCAG 2.2 minimum contrast ratio for text (1.4.3 Contrast (Minimum), AA). */
export const WCAG_TEXT_MINIMUM_RATIO = 4.5;
/** WCAG 2.2 minimum contrast ratio for non-text UI components (1.4.11 Non-text Contrast). */
export const WCAG_NON_TEXT_MINIMUM_RATIO = 3;

export interface ContrastPair {
  /** Semantic variable name of the foreground (text, icon, border, ring) color. */
  readonly foreground: string;
  /** Semantic variable name of the background color it renders on. */
  readonly background: string;
  /**
   * Minimum WCAG 2.2 relative-luminance contrast ratio. Typed as the union of the two
   * named constants so an off-spec ratio (a workshop typo like 4.4 or 5) cannot compile.
   */
  readonly minimumRatio: typeof WCAG_TEXT_MINIMUM_RATIO | typeof WCAG_NON_TEXT_MINIMUM_RATIO;
}

/** Foreground/background pairings that must clear WCAG 2.2 AA in every theme x mode. */
export const CONTRAST_PAIRS: ReadonlyArray<ContrastPair> = [
  {
    foreground: "text-default",
    background: "surface-default",
    minimumRatio: WCAG_TEXT_MINIMUM_RATIO,
  },
  {
    foreground: "text-muted",
    background: "surface-default",
    minimumRatio: WCAG_TEXT_MINIMUM_RATIO,
  },
  {
    foreground: "text-default",
    background: "surface-raised",
    minimumRatio: WCAG_TEXT_MINIMUM_RATIO,
  },
  {
    foreground: "action-primary-foreground",
    background: "action-primary",
    minimumRatio: WCAG_TEXT_MINIMUM_RATIO,
  },
  {
    foreground: "action-secondary-foreground",
    background: "action-secondary",
    minimumRatio: WCAG_TEXT_MINIMUM_RATIO,
  },
  {
    foreground: "action-destructive-foreground",
    background: "action-destructive",
    minimumRatio: WCAG_TEXT_MINIMUM_RATIO,
  },
  {
    foreground: "status-info-foreground",
    background: "status-info",
    minimumRatio: WCAG_TEXT_MINIMUM_RATIO,
  },
  {
    foreground: "status-success-foreground",
    background: "status-success",
    minimumRatio: WCAG_TEXT_MINIMUM_RATIO,
  },
  {
    foreground: "status-warning-foreground",
    background: "status-warning",
    minimumRatio: WCAG_TEXT_MINIMUM_RATIO,
  },
  {
    foreground: "status-danger-foreground",
    background: "status-danger",
    minimumRatio: WCAG_TEXT_MINIMUM_RATIO,
  },
  {
    foreground: "text-link",
    background: "surface-default",
    minimumRatio: WCAG_TEXT_MINIMUM_RATIO,
  },
  {
    foreground: "accent-subtle-foreground",
    background: "accent-subtle",
    minimumRatio: WCAG_TEXT_MINIMUM_RATIO,
  },
  {
    foreground: "accent-strong-foreground",
    background: "accent-strong",
    minimumRatio: WCAG_TEXT_MINIMUM_RATIO,
  },
  // The dark edge-chrome (app-shell rail + top bar) — text and the gold accent on the ink ground.
  {
    foreground: "chrome-text",
    background: "chrome-surface",
    minimumRatio: WCAG_TEXT_MINIMUM_RATIO,
  },
  {
    foreground: "chrome-text-muted",
    background: "chrome-surface",
    minimumRatio: WCAG_TEXT_MINIMUM_RATIO,
  },
  {
    foreground: "chrome-text-strong",
    background: "chrome-surface",
    minimumRatio: WCAG_TEXT_MINIMUM_RATIO,
  },
  // non-text UI (borders, focus ring, accent indicators) per WCAG 1.4.11:
  {
    foreground: "chrome-accent",
    background: "chrome-surface",
    minimumRatio: WCAG_NON_TEXT_MINIMUM_RATIO,
  },
  {
    foreground: "accent-default",
    background: "surface-default",
    minimumRatio: WCAG_NON_TEXT_MINIMUM_RATIO,
  },
  {
    foreground: "border-strong",
    background: "surface-default",
    minimumRatio: WCAG_NON_TEXT_MINIMUM_RATIO,
  },
  {
    foreground: "focus-ring",
    background: "surface-default",
    minimumRatio: WCAG_NON_TEXT_MINIMUM_RATIO,
  },
];
