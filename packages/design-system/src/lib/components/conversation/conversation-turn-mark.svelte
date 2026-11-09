<script lang="ts">
  /*
   * The turn's mark: who is speaking, as a small round token beside the turn in the exchange
   * arrangement. A member's mark is their initials; the assistant's is its letter, set in the
   * product's blackletter face on the chrome surface, so the answers are findable by eye in a long
   * conversation without reading a single label.
   *
   * The mark is presentation and is hidden from assistive technology: the speaker label beside it
   * already says who this is, and reading initials aloud after a full name is noise. The letters are
   * the app's, never this component's.
   */
  import type { HTMLAttributes } from "svelte/elements";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import type { WithElementRef } from "../../internal/types.ts";

  let {
    ref = $bindable(null),
    class: className,
    children,
    ...restProps
  }: WithElementRef<HTMLAttributes<HTMLSpanElement>, HTMLSpanElement> = $props();
</script>

<span
  bind:this={ref}
  aria-hidden="true"
  class={mergeClasses("mc-conversation-turn-mark", className)}
  {...restProps}
>
  {@render children?.()}
</span>
