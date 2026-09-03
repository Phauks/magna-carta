<script lang="ts">
  /*
   * Tools layout — owns the canvas height and hands the remainder to the page.
   *
   * A full-height tool page (the safe website viewer) sizes with `h-full` against the slot wrapper
   * below; a normal-flow tool page just overflows it and the canvas scrolls. The way back to the
   * listing is NOT here: it was, as one row this layout drew above every tool, until the screen
   * header became one component (screen-header.svelte). Each tool page now names `back="tools"` on
   * its own header, which puts the return in the same place, in the same shape, as on every other
   * screen in the application — and retires this layout's one special case, the suppression of its
   * own row on the /tools index.
   */
  import type { Snippet } from "svelte";

  let { children }: { children: Snippet } = $props();
</script>

<div class="flex h-full min-h-0 flex-col">
  <div class="min-h-0 flex-1">
    {@render children()}
  </div>
</div>
