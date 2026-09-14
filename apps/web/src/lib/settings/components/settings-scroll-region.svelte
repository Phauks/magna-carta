<script lang="ts">
  /*
   * The settings page's MIDDLE STORY — the one scroll area every settings page scrolls in.
   *
   * The settings content column is a flex stack (header / scrolling middle / exit footer — see the
   * settings +layout), and this is the middle: it takes the remaining height and scrolls inside
   * itself, reaching the canvas's true edges so the scrollbar sits at the actual edge and the
   * breathing room rides INSIDE it. `scrollbar-gutter: stable` keeps a page that scrolls and a page
   * that does not at identical width, so the plates never shift sideways between pages.
   *
   * ONE COMPONENT, NOT A CLASS LIST. Twenty-three pages carried this same four-line comment and the
   * same two divs by copy, which meant the outer spacing of the settings surface was identical by
   * accident and a correction to it was twenty-three edits. The rhythm between the things on a page
   * (the gap between plates, the inset from the edges) is decided here once; the rhythm INSIDE a
   * plate is the row's (settings-row.svelte), never the page's.
   */
  import type { Snippet } from "svelte";

  let { children }: { children: Snippet } = $props();
</script>

<div class="mc-scrollbar min-h-0 grow overflow-y-auto" style="scrollbar-gutter: stable">
  <div class="flex flex-col gap-24 p-24">
    {@render children()}
  </div>
</div>
