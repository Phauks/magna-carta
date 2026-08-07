<script lang="ts">
  /* TopBar.Link — a text navigation link in the ink band (product/help/status style destinations,
     and the chrome nav on the signed-out surfaces). An anchor, not a button: it goes somewhere.
     The label rides as children; the chrome register and the chrome-accent focus ring come from
     the mc-top-bar-link recipe, matching TopBar.IconButton. */
  import type { HTMLAnchorAttributes } from "svelte/elements";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import type { WithElementRef } from "../../internal/types.ts";

  let {
    href,
    ref = $bindable(null),
    class: className,
    children,
    ...restProps
  }: WithElementRef<HTMLAnchorAttributes, HTMLAnchorElement> & {
    /** A destination URL for the link. */
    href?: string;
  } = $props();
</script>

<a bind:this={ref} {href} class={mergeClasses("mc-top-bar-link", className)} {...restProps}>
  {@render children?.()}
</a>
