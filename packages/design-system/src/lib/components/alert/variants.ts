/*
 * Alert variant classes, ARIA role, and leading glyph — the house variant pattern (typed record
 * lookups, no DSL), as in button/badge variants.ts.
 *
 * Colour: each variant is the SUBTLE status register — a pale same-hue tint behind deep same-hue
 * text, with a soft same-hue hairline (alert.css). That tint+text pairing is the one the contrast
 * gate guarantees AA across every theme x mode (src/contrast-pairs.ts); it reads as a calm inline
 * callout rather than a saturated block. The solid status panel (status.<v> + -foreground) is kept
 * for the toast intents, which need the higher-emphasis surface.
 *
 * Glyph: a leading Lucide status icon per variant (info, success, warning, danger). The component
 * renders it from this map and it inherits the variant foreground, so the mapping has one home and
 * the icon always matches the text hue.
 *
 * Role: danger/warning are time-sensitive, so they announce assertively (role="alert");
 * info/success are advisory, so they announce politely (role="status"). The component reads the
 * role from here rather than hardcoding it, so the mapping has one home.
 */
import Info from "@lucide/svelte/icons/info";
import CircleCheck from "@lucide/svelte/icons/circle-check";
import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
import CircleAlert from "@lucide/svelte/icons/circle-alert";

export type AlertVariant = "info" | "success" | "warning" | "danger";

/** A Lucide icon component, as imported from `@lucide/svelte/icons/*`. */
type IconComponent = typeof Info;

const VARIANT: Record<AlertVariant, string> = {
  info: "mc-alert-info",
  success: "mc-alert-success",
  warning: "mc-alert-warning",
  danger: "mc-alert-danger",
};

const ICON: Record<AlertVariant, IconComponent> = {
  info: Info,
  success: CircleCheck,
  warning: TriangleAlert,
  danger: CircleAlert,
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

/** The leading status glyph for a variant (rendered with the mc-alert-icon size class). */
export function alertIcon(variant: AlertVariant): IconComponent {
  return ICON[variant];
}

/** The ARIA live-region role for a variant: assertive "alert" vs polite "status". */
export function alertRole(variant: AlertVariant): "alert" | "status" {
  return ROLE[variant];
}
