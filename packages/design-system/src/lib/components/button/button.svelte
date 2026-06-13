<script lang="ts">
  /*
   * Button — a native element (no Bits UI; a button/anchor needs no headless behavior).
   * It is an <a> when an `href` prop is present, a <button type="button"> otherwise, so the
   * same styled control serves both actions and navigation. Styling is the mc-button recipe
   * (src/lib/styles/components.css); callers layer Tailwind utilities via `class`, merged last
   * so they win (mergeClasses is the single class-merge path).
   *
   * Props are the relaxed INTERSECTION of button and anchor attributes (the shadcn-svelte
   * pattern), not a discriminated union: `HTMLButtonAttributes & HTMLAnchorAttributes` keeps
   * every attribute available and typecheck-clean, where `& ({href}&Anchor | Button)` explodes
   * into a "union type too complex to represent" under svelte-check. The commonly-controlled
   * attributes (`href`, `disabled`) are declared EXPLICITLY (with JSDoc) so docgen lists them
   * under the catalog's "Properties" group with descriptions, instead of leaving them in the
   * anonymous attribute spread where the catalog cannot surface them. `href`/`type`/`disabled`
   * are pulled out so each renders on the right element only (an anchor cannot be `disabled`).
   * WithElementRef adds the bindable `ref`.
   */
  import type { HTMLAnchorAttributes, HTMLButtonAttributes } from "svelte/elements";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import type { WithElementRef } from "../../internal/types.ts";
  import { buttonClasses, type ButtonSize, type ButtonVariant } from "./variants.ts";

  type Props = WithElementRef<HTMLButtonAttributes> &
    WithElementRef<HTMLAnchorAttributes> & {
      /** Visual style of the button. */
      variant?: ButtonVariant;
      /** Control height and padding. */
      size?: ButtonSize;
      /** A destination URL. When set, the button renders as an anchor (`<a href>`) styled as a button instead of a `<button>`. */
      href?: string;
      /** Disables the button so it cannot be focused or clicked; renders muted. (Ignored when `href` is set — anchors cannot be disabled.) */
      disabled?: boolean;
    };

  let {
    variant = "primary",
    size = "default",
    ref = $bindable(null),
    href,
    type = "button",
    disabled,
    class: className,
    children,
    ...restProps
  }: Props = $props();
</script>

{#if href}
  <a bind:this={ref} {href} class={mergeClasses(buttonClasses({ variant, size }), className)} {...restProps}>
    {@render children?.()}
  </a>
{:else}
  <button
    bind:this={ref}
    {type}
    {disabled}
    class={mergeClasses(buttonClasses({ variant, size }), className)}
    {...restProps}
  >
    {@render children?.()}
  </button>
{/if}
