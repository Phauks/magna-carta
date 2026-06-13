/*
 * Badge variant classes — the house variant pattern (a plain typed record lookup, no DSL),
 * identical in shape to button/variants.ts. The variant surface is a small closed union, so a
 * record is clearer and fully type-checked. Legal-domain status badges (the gold "Trust held"
 * chip, etc.) register here as their slices land — they are not invented ahead of need.
 */

export type BadgeVariant = "default" | "secondary" | "destructive" | "outline";

const VARIANT: Record<BadgeVariant, string> = {
  default: "mc-badge-default",
  secondary: "mc-badge-secondary",
  destructive: "mc-badge-destructive",
  outline: "mc-badge-outline",
};

/** The full recipe class string for a badge: the base recipe plus its variant. */
export function badgeClasses(options: { variant: BadgeVariant }): string {
  return `mc-badge ${VARIANT[options.variant]}`;
}
