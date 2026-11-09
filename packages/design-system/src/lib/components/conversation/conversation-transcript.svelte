<script lang="ts">
  /*
   * The transcript — the scrolling record region a reader returns to.
   *
   * `role="log"` is the semantic for exactly this: a sequence a reader comes back to, whose new
   * entries arrive at the end while they are on the page. It carries a polite live region by
   * default, so an answer landing while the member is reading is announced without taking their
   * place, and only the addition is read rather than the whole record.
   *
   * The region is focusable and named, because its content is prose: a scrolling region with no
   * focusable child is unreachable by keyboard alone, and reaching content is not the same thing as
   * operating a control. `label` is optional and has NO default — a name is user-facing copy, and
   * this component holds none; a surface names its own record.
   *
   * It scrolls inside the height it is given rather than growing, which is what lets a long
   * transcript sit above a composer that stays where it is.
   */
  import type { HTMLAttributes } from "svelte/elements";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import type { WithElementRef } from "../../internal/types.ts";
  import type { ConversationArrangement } from "./types.ts";

  let {
    ref = $bindable(null),
    label,
    arrangement = "record",
    class: className,
    children,
    ...restProps
  }: WithElementRef<HTMLAttributes<HTMLDivElement>, HTMLDivElement> & {
    /**
     * The record's accessible name. Name it for the conversation it holds. Optional because the
     * component carries no copy of its own; pass one wherever the surface can say what this record
     * is.
     */
    label?: string;
    /** How the turns are laid out. Defaults to the single-edge record a meeting's chat reads as. */
    arrangement?: ConversationArrangement;
  } = $props();
</script>

<!--
  The tabindex sits on a non-interactive role deliberately: see the note above on reaching prose
  that scrolls.
-->
<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div
  bind:this={ref}
  role="log"
  tabindex="0"
  aria-label={label}
  data-arrangement={arrangement}
  class={mergeClasses("mc-conversation-transcript mc-scrollbar", className)}
  {...restProps}
>
  {@render children?.()}
</div>
