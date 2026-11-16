<script lang="ts">
  /*
   * The mark after a label's name that says whether the field must be filled. What it draws is
   * decided by `necessity.ts`, never here and never by a caller.
   */
  import { necessityMark, type FieldNecessity } from "./necessity.ts";

  let { necessity }: { necessity: FieldNecessity | undefined } = $props();
  const mark = $derived(necessityMark(necessity));
</script>

{#if mark !== null}<span
    class="mc-label-necessity"
    data-necessity={necessity}
    aria-hidden={mark.decorative ? "true" : undefined}>{mark.text}</span
  >{/if}
