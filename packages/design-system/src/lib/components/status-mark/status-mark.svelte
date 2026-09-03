<script lang="ts">
  /*
   * StatusMark — the affirmative mark: a disc filled in the success tone with the check knocked out
   * of it (Tier 1, native Lucide glyph, no Bits UI).
   *
   * WHAT IT IS FOR, AND WHY IT IS A COMPONENT. It is the register's answer where a word would say
   * nothing: a Safety column reading "Clean" on nine rows in ten, a requirement that is simply met.
   * It existed as a recipe class three surfaces reached for with their own icon import, and they had
   * already drifted onto two different Lucide glyphs — circle-check in the file manager, the
   * larger-tick circle-check-big in the catalog and the record-window gallery. One mark that reads
   * the same everywhere is the whole point of a register, so the glyph is decided here and nowhere
   * else.
   *
   * HOW IT COLOURS. A Lucide glyph strokes in `currentColor` over `fill: none`, so both halves come
   * from the recipe: the fill paints the disc and the text colour is the AA-gated foreground the
   * fill is paired with, which the check and the circle's own outline then stroke in.
   *
   * IT IS NOT DECORATION. The mark is usually the only thing saying the row is fine, so it carries
   * an accessible name — required, because a mark nobody can hear is a column of nothing for a
   * screen-reader user. A caller that has already said the word in text beside it passes
   * `decorative` instead, which hides the glyph and keeps the sentence.
   */
  import CircleCheck from "@lucide/svelte/icons/circle-check";
  import { mergeClasses } from "../../internal/merge-classes.ts";

  let {
    label,
    decorative = false,
    class: className,
  }: {
    /** What the mark says, for anything that cannot see it. Required unless `decorative`. */
    label?: string;
    /** Hide the mark from assistive technology, where words beside it already carry the meaning. */
    decorative?: boolean;
    class?: string;
  } = $props();
</script>

{#if decorative}
  <CircleCheck class={mergeClasses("mc-status-mark", className)} aria-hidden="true" />
{:else}
  <CircleCheck class={mergeClasses("mc-status-mark", className)} aria-label={label} />
{/if}
