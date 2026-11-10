<script lang="ts">
  /*
   * A line of a search result with the reader's words marked in it.
   *
   * The words are marked with the `mark` element, which is what the element is for, so a screen
   * reader can announce them and a reader's own style sheet can restyle them. The mark is a pale
   * wash of the accent behind the same text colour as the line around it: it says where to look
   * and does not change how the sentence reads, and it does not depend on colour alone to be a
   * legible line of text.
   *
   * The runs are written with no whitespace between them. A space between two elements here
   * would be a space in the middle of a word that was matched by its start.
   */
  import { markedRuns, type TextMark } from "./marked-text.ts";

  let {
    text,
    marks,
  }: {
    text: string;
    /** Where the reader's words are, from the server. Absent or empty draws the text plain. */
    marks?: readonly TextMark[] | null;
  } = $props();

  const runs = $derived(markedRuns(text, marks));
</script>

{#each runs as run, index (index)}{#if run.marked}<mark
      class="rounded-sm bg-accent-subtle text-inherit">{run.text}</mark
    >{:else}{run.text}{/if}{/each}
