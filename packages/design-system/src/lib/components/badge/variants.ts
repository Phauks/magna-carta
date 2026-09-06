/*
 * Badge variant classes — the house variant pattern (a plain typed record lookup, no DSL),
 * identical in shape to button/variants.ts. The variant surface is a small closed union, so a
 * record is clearer and fully type-checked.
 *
 * Two registers: the SOLID action chips (primary/secondary/destructive/outline) for strong labels,
 * and the PALE-TINT status pills (neutral/success/warning/danger/info/accent) — a pale same-hue tint
 * with deep same-hue text, the calm register for status on a work surface (a matter's Open/Pending/
 * Closed, a "Trust held" gold chip). Statuses use the status.*-subtle token pairs; accent is the gold.
 *
 * `caps` is orthogonal to both registers: it puts the badge's word in the platform's letterspaced
 * small-caps voice, for a badge that labels a standing rather than counting something.
 */

export type BadgeVariant =
  | "primary"
  | "secondary"
  | "destructive"
  | "outline"
  | "neutral"
  | "success"
  | "warning"
  | "danger"
  | "info"
  | "accent";

const VARIANT: Record<BadgeVariant, string> = {
  primary: "mc-badge-primary",
  secondary: "mc-badge-secondary",
  destructive: "mc-badge-destructive",
  outline: "mc-badge-outline",
  neutral: "mc-badge-neutral",
  success: "mc-badge-success",
  warning: "mc-badge-warning",
  danger: "mc-badge-danger",
  info: "mc-badge-info",
  accent: "mc-badge-accent",
};

/** The full recipe class string for a badge: the base recipe, its variant, and the caps register. */
export function badgeClasses(options: { variant: BadgeVariant; caps?: boolean }): string {
  const caps = options.caps === true ? " mc-badge-caps" : "";
  return `mc-badge ${VARIANT[options.variant]}${caps}`;
}
