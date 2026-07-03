<script lang="ts">
  /*
   * Table — the styled <table> root, wrapped in a horizontal-scroll container so wide tables scroll
   * in place rather than stretching the page. `ref` binds the <table> itself. The mc-table recipe
   * owns the look; the parts (Header/Body/Row/Head/Cell/Caption) carry the rest. Behaviour
   * (sorting/selection/visibility) is the table-core adapter the consumer wires in — these parts are
   * presentation only.
   */
  import type { HTMLTableAttributes } from "svelte/elements";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import type { WithElementRef } from "../../internal/types.ts";

  let {
    ref = $bindable(null),
    class: className,
    children,
    ...restProps
  }: WithElementRef<HTMLTableAttributes, HTMLTableElement> = $props();
</script>

<div class="mc-table-scroll mc-scrollbar w-full">
  <table bind:this={ref} class={mergeClasses("mc-table w-full", className)} {...restProps}>
    {@render children?.()}
  </table>
</div>
