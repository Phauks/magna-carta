<script lang="ts">
  /*
   * Sidebar.GroupTrigger — the group heading, when the group folds.
   *
   * It IS the heading: same recipe, same letterspaced-caps voice, same seat, so a rail whose groups
   * fold does not read as a rail of buttons. What it adds is a chevron that points down while the
   * group is open and toward the inline start while it is folded, and a hit target that spans the
   * heading's whole width — a two-word target at the top of a twenty-row group is a control nobody
   * finds twice.
   *
   * The plain GroupLabel stays for the cases a group cannot fold: the collapsed icon rail (a group
   * with no visible label has nothing to fold BY, and the rail would fold away to nothing) and
   * Customize mode (where every row has to be reachable to arrange).
   */
  import type { HTMLButtonAttributes } from "svelte/elements";
  import ChevronDown from "@lucide/svelte/icons/chevron-down";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import type { WithElementRef } from "../../internal/types.ts";

  let {
    ref = $bindable(null),
    expanded = true,
    class: className,
    children,
    ...restProps
  }: WithElementRef<HTMLButtonAttributes, HTMLButtonElement> & {
    /** Whether the group this heads is showing its items. */
    expanded?: boolean;
  } = $props();
</script>

<button
  bind:this={ref}
  type="button"
  class={mergeClasses("mc-sidebar-group-label mc-sidebar-group-trigger w-full", className)}
  aria-expanded={expanded}
  data-expanded={expanded ? "true" : "false"}
  {...restProps}
>
  <span class="mc-sidebar-group-trigger-label">{@render children?.()}</span>
  <ChevronDown
    class="mc-sidebar-group-chevron size-12 motion-reduce:transition-none {expanded
      ? ''
      : '-rotate-90'}"
    aria-hidden="true"
  />
</button>
