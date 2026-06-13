/*
 * Alert variant classes + ARIA role — the house variant pattern (a typed record lookup, no DSL),
 * as in button/badge variants.ts.
 *
 * Colour: each variant is a SOLID status panel (status.<v> background + status.<v>-foreground
 * text). That pairing is the one the contrast gate guarantees AA across every theme x mode
 * (src/contrast-pairs.ts); a status colour used as TEXT on a light surface is ungated and can
 * fail AA (amber-on-white), so the solid panel is the contrast-safe, token-pure choice. A softer
 * tinted-background alert is a later refinement gated on adding status.*-subtle tokens.
 *
 * Role: danger/warning are time-sensitive, so they announce assertively (role="alert");
 * info/success are advisory, so they announce politely (role="status"). The component reads the
 * role from here rather than hardcoding it, so the mapping has one home.
 */

export type AlertVariant = "info" | "success" | "warning" | "danger";

const VARIANT: Record<AlertVariant, string> = {
  info: "mc-alert-info",
  success: "mc-alert-success",
  warning: "mc-alert-warning",
  danger: "mc-alert-danger",
};

const ROLE: Record<AlertVariant, "alert" | "status"> = {
  info: "status",
  success: "status",
  warning: "alert",
  danger: "alert",
};

/** The full recipe class string for an alert: the base recipe plus its variant. */
export function alertClasses(options: { variant: AlertVariant }): string {
  return `mc-alert ${VARIANT[options.variant]}`;
}

/** The ARIA live-region role for a variant: assertive "alert" vs polite "status". */
export function alertRole(variant: AlertVariant): "alert" | "status" {
  return ROLE[variant];
}
