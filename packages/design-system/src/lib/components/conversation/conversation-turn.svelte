<script lang="ts">
  /*
   * One turn: a speaker label over a body, with anything the turn has to say about itself beneath.
   *
   * `<article>` is the element for a self-contained entry in a record, which is what a turn is; it
   * gives a screen reader a boundary to move between turns by without the component inventing a
   * heading level it cannot know.
   *
   * The speaker and the state are stamped as `data-speaker` / `data-state` so the recipe selects on
   * them and nothing about how a turn LOOKS is decided in this file. A pending turn draws no
   * shimmer, spinner or skeleton: loading in this repository is `LoadingRegion` and nothing else, so
   * a turn whose body has not arrived is simply a turn with no body, drawn quietly.
   */
  import type { HTMLAttributes } from "svelte/elements";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import type { WithElementRef } from "../../internal/types.ts";
  import type { ConversationSpeaker, ConversationTurnState } from "./types.ts";

  let {
    ref = $bindable(null),
    speaker,
    state = "settled",
    class: className,
    children,
    ...restProps
  }: WithElementRef<HTMLAttributes<HTMLElement>, HTMLElement> & {
    /** Whose turn this is: the member who asked, or the assistant that answered. */
    speaker: ConversationSpeaker;
    /** What the turn has come to. Defaults to a turn that has its body. */
    state?: ConversationTurnState;
  } = $props();
</script>

<article
  bind:this={ref}
  data-speaker={speaker}
  data-state={state}
  class={mergeClasses("mc-conversation-turn", className)}
  {...restProps}
>
  {@render children?.()}
</article>
