/*
 * Button variant classes — the house variant pattern: a plain typed function mapping
 * options to the recipe class names defined in src/lib/styles/components.css. No DSL
 * (no cva/tailwind-variants): the variant surface is a small closed union, so a record
 * lookup is clearer and fully type-checked. Sibling components copy this exact shape.
 */

export type ButtonVariant = "primary" | "accent" | "secondary" | "destructive" | "ghost";
export type ButtonSize = "sm" | "default" | "lg" | "icon" | "icon-sm";

const VARIANT: Record<ButtonVariant, string> = {
  primary: "mc-button-primary",
  accent: "mc-button-accent",
  secondary: "mc-button-secondary",
  destructive: "mc-button-destructive",
  ghost: "mc-button-ghost",
};

const SIZE: Record<ButtonSize, string> = {
  sm: "mc-button-sm",
  default: "mc-button-md",
  lg: "mc-button-lg",
  icon: "mc-button-icon",
  "icon-sm": "mc-button-icon-sm",
};

/** The full recipe class string for a button: the base recipe plus its variant and size. */
export function buttonClasses(options: { variant: ButtonVariant; size: ButtonSize }): string {
  return `mc-button ${VARIANT[options.variant]} ${SIZE[options.size]}`;
}
