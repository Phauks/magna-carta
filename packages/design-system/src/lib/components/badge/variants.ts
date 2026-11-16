/*
 * Badge variant classes — the house variant pattern (a plain typed record lookup, no DSL),
 * identical in shape to button/variants.ts. The variant surface is a small closed union, so a
 * record is clearer and fully type-checked.
 *
 * Two registers: the SOLID action chips (primary/secondary/destructive/outline) for strong labels,
 * and the STATUS MARKS (neutral/success/warning/danger/info/accent) — a dot in the status hue before
 * a plain word, the calm register for status on a work surface (a matter's Open/Pending/Closed).
 *
 * `caps` is retired: badges read in sentence case with every other label. The option is kept so
 * existing call sites compile, and its class changes nothing.
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
