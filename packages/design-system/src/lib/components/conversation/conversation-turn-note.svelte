<script lang="ts">
  /*
   * The quiet meta line beneath a body: when the turn was recorded, that the answer was built from
   * part of the conversation, or why there is no answer at all.
   *
   * Two tones and no more. `quiet` states a fact and stays out of the way. `warning` is something
   * the reader has to weigh before relying on the answer, and it takes the status register's SUBTLE
   * trio — a pale same-hue tint with its own deep same-hue text and hairline, which is the pairing
   * the contrast gate covers. The solid register is for an edge moment that must interrupt, and a
   * transcript is a work surface.
   */
  import type { HTMLAttributes } from "svelte/elements";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import type { WithElementRef } from "../../internal/types.ts";
  import type { ConversationNoteTone } from "./types.ts";

  let {
    ref = $bindable(null),
    tone = "quiet",
    class: className,
    children,
    ...restProps
  }: WithElementRef<HTMLAttributes<HTMLParagraphElement>, HTMLParagraphElement> & {
    /** How the line reads. Defaults to the quiet register a fact is stated in. */
    tone?: ConversationNoteTone;
  } = $props();
</script>

<p
  bind:this={ref}
  data-tone={tone}
  class={mergeClasses("mc-conversation-turn-note", className)}
  {...restProps}
>
  {@render children?.()}
</p>
