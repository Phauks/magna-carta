<script lang="ts">
  /*
   * Conversation root (Tier 1: native elements, no Bits UI) — the surface a transcript is read and
   * added to.
   *
   * It reads as a RECORD, not a chat window. No bubbles, no avatars, no coloured left/right
   * alignment, and no animated ellipsis while an answer is on its way: a turn is a speaker label
   * over a body, hairline-separated, in the same register the rest of the platform reads its
   * records in. The member's turn and the assistant's are told apart by the label and by the body's
   * weight, never by being pushed to opposite sides of the canvas. The transcript is a work
   * surface, so identity recedes: the only status colour in the whole component is the thin edge on
   * a turn that failed and the subtle chip on the note that says why.
   *
   * The root is a column: the transcript takes the free height and scrolls inside it, and the
   * composer sits at the foot. It is a SCROLLING CHILD, not a growing block — it fills the space it
   * is given (a flex parent, or one it is told to fill) so a long transcript costs the surface
   * around it nothing.
   *
   * IT HOLDS NO COPY. Every user-facing sentence — the speaker labels included — arrives as
   * children, because the words a transcript reads in belong to the surface that owns the
   * conversation, not to the component that draws it.
   */
  import type { HTMLAttributes } from "svelte/elements";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import type { WithElementRef } from "../../internal/types.ts";

  let {
    ref = $bindable(null),
    class: className,
    children,
    ...restProps
  }: WithElementRef<HTMLAttributes<HTMLDivElement>, HTMLDivElement> = $props();
</script>

<div bind:this={ref} class={mergeClasses("mc-conversation", className)} {...restProps}>
  {@render children?.()}
</div>
