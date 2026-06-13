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
   * into a "union type too complex to represent" under svelte-check. `href`/`type` are pulled
   * out so each renders on the right element only. WithElementRef adds the bindable `ref`.
   */
  import type { HTMLAnchorAttributes, HTMLButtonAttributes } from "svelte/elements";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import type { WithElementRef } from "../../internal/types.ts";
  import { buttonClasses, type ButtonSize, type ButtonVariant } from "./variants.ts";

  type Props = WithElementRef<HTMLButtonAttributes> &
    WithElementRef<HTMLAnchorAttributes> & {
      variant?: ButtonVariant;
      size?: ButtonSize;
    };

  let {
    variant = "primary",
    size = "default",
    ref = $bindable(null),
    href,
    type = "button",
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
  <button bind:this={ref} {type} class={mergeClasses(buttonClasses({ variant, size }), className)} {...restProps}>
    {@render children?.()}
  </button>
{/if}
