<script lang="ts">
  /* TopBar.IconButton — the quiet icon affordance on the ink (alerts, future chrome controls).
     Callers MUST pass an accessible name (aria-label); the icon rides as children. */
  import type { HTMLButtonAttributes } from "svelte/elements";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import type { WithElementRef } from "../../internal/types.ts";

  let {
    ref = $bindable(null),
    class: className,
    children,
    ...restProps
  }: WithElementRef<HTMLButtonAttributes, HTMLButtonElement> = $props();
</script>

<button
  bind:this={ref}
  type="button"
  class={mergeClasses("mc-top-bar-icon-button", className)}
  {...restProps}
>
  {@render children?.()}
</button>
