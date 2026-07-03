<script lang="ts">
  /* TopBar.Search — the command-palette trigger: a quiet inset BUTTON on the ink (the palette
     dialog owns real input focus). Children are the invitation label; `shortcut` renders the
     quiet chrome keycap (pass the platform's actual chord, e.g. "Ctrl K" / "⌘K"). */
  import Search from "@lucide/svelte/icons/search";
  import type { HTMLButtonAttributes } from "svelte/elements";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import type { WithElementRef } from "../../internal/types.ts";

  let {
    shortcut,
    ref = $bindable(null),
    class: className,
    children,
    ...restProps
  }: WithElementRef<HTMLButtonAttributes, HTMLButtonElement> & {
    /** The keyboard chord shown in the trailing keycap (e.g. "Ctrl K"). Omit to hide the keycap. */
    shortcut?: string;
  } = $props();
</script>

<button
  bind:this={ref}
  type="button"
  class={mergeClasses("mc-top-bar-search", className)}
  {...restProps}
>
  <Search class="size-16" aria-hidden="true" />
  <span class="mc-top-bar-search-label">{@render children?.()}</span>
  {#if shortcut}
    <kbd class="mc-top-bar-keycap">{shortcut}</kbd>
  {/if}
</button>
