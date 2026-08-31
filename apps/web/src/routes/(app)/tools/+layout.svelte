<script lang="ts">
  /*
   * Tools layout — gives every tool page a way back to the listing without the browser's back
   * button. The back affordance sits above the page content, so each present and future tool page
   * inherits it for free rather than remembering to add its own.
   *
   * The listing itself needs no link to itself, so the affordance is suppressed on the `/tools`
   * index: a layout wraps its index route too, and the index is the one pathname that equals the
   * listing's own URL.
   */
  import { page } from "$app/state";
  import BackLink from "$lib/navigation/back-link.svelte";
  import type { Snippet } from "svelte";

  let { children }: { children: Snippet } = $props();

  const toolsListingHref = "/tools";
  const onToolsListing = $derived(page.url.pathname === toolsListingHref);
</script>

<!-- The layout owns the canvas height and hands the remainder to the page: a full-height tool
     page (the safe website viewer) sizes with `h-full` against the slot wrapper below, which
     already excludes the back-affordance row — without this, `h-full` claimed the canvas's whole
     height ON TOP of the nav above it, so the page's bottom edge always sat below the fold. A
     normal-flow tool page just overflows the wrapper and the canvas scrolls it as before. -->
<div class="flex h-full min-h-0 flex-col">
  {#if !onToolsListing}
    <!-- Named for what it is. One link back to the listing is not a breadcrumb trail, and a landmark
       that announces itself as one sends a reader looking for a path that is not there.
       The gap sits tight to the masthead below so the link reads as the title's eyebrow, not a
       separate band above the page.
       The nav is a flex container so the inline-flex link is a flex item rather than a line-box
       inhabitant: a block nav would lead the link down by half the difference between its own
       line-height and the link's, indenting the arrow from the canvas's block-start edge while its
       inline-start edge stayed flush. -->
    <nav aria-label="Back to Tools" class="mb-4 flex shrink-0">
      <BackLink href={toolsListingHref} label="Tools" />
    </nav>
  {/if}

  <div class="min-h-0 flex-1">
    {@render children()}
  </div>
</div>
