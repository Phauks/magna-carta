<script lang="ts">
  /*
   * The composer: the surface at the foot of the conversation that holds the field.
   *
   * It is a container and a styled surface, and that is the whole of it — it owns neither the
   * Textarea nor the Button. The field (and whatever has to stand with it: a label, an inline hint,
   * the line a surface owes its reader before they type) comes in as children; the send control and
   * anything beside it come in as `actions`, which the recipe packs to the inline end.
   *
   * It sits at the foot and stays there while the transcript scrolls, so the place a member types is
   * never somewhere they have to go looking for.
   */
  import type { Snippet } from "svelte";
  import type { HTMLAttributes } from "svelte/elements";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import type { WithElementRef } from "../../internal/types.ts";

  let {
    ref = $bindable(null),
    actions,
    class: className,
    children,
    ...restProps
  }: WithElementRef<HTMLAttributes<HTMLDivElement>, HTMLDivElement> & {
    /** The send control and anything standing beside it, at the inline end of the composer. */
    actions?: Snippet;
  } = $props();
</script>

<div bind:this={ref} class={mergeClasses("mc-conversation-composer", className)} {...restProps}>
  {@render children?.()}
  {#if actions}
    <div class="mc-conversation-composer-actions">{@render actions()}</div>
  {/if}
</div>
