<script lang="ts">
  /*
   * Separator — a thin dividing rule (Tier 1: native <div>, no Bits UI). Two a11y modes:
   *   - decorative (default): role="none" + aria-hidden, a purely visual divider screen readers
   *     skip — the common case between visually grouped content.
   *   - semantic (decorative={false}): role="separator" with aria-orientation, announced as a
   *     real boundary (e.g. separating menu sections).
   * The hairline THICKNESS comes from the border-width token (recipe); the cross-axis LENGTH is
   * a layout concern, so the component adds `w-full`/`h-full` per orientation (overridable via
   * class). Vertical separators need a sized flex/grid parent to take height from.
   */
  import type { HTMLAttributes } from "svelte/elements";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import type { WithElementRef } from "../../internal/types.ts";

  type Props = WithElementRef<HTMLAttributes<HTMLDivElement>, HTMLDivElement> & {
    orientation?: "horizontal" | "vertical";
    decorative?: boolean;
  };

  let {
    ref = $bindable(null),
    orientation = "horizontal",
    decorative = true,
    class: className,
    ...restProps
  }: Props = $props();
</script>

<div
  bind:this={ref}
  role={decorative ? "none" : "separator"}
  aria-orientation={decorative ? undefined : orientation}
  class={mergeClasses(
    "mc-separator",
    orientation === "vertical" ? "mc-separator-vertical h-full" : "mc-separator-horizontal w-full",
    className,
  )}
  {...restProps}
></div>
