<script lang="ts">
  /*
   * A section that takes the rest of the screen and keeps it.
   *
   * Most pages are documents: they are as tall as what is on them, and the work canvas scrolls. A
   * few are WORKING SURFACES — the file manager, and the four financial ledgers — where the table
   * scrolls inside itself and the counts footer belongs on the bottom of the screen. Those pages
   * must be exactly as tall as the viewport, whatever is in them, or the page grows a second
   * scrollbar as records arrive and the footer walks off the bottom.
   *
   * The height comes from the matter chrome's own flex column, so this is a link in that chain
   * rather than a height of its own: grow into what is left, and refuse to be floored by content
   * (`min-height: 0`, without which a flex item never shrinks below its content and the chain
   * silently breaks). A percentage would not do — it resolves against an indefinite height and
   * quietly does nothing at all.
   *
   * The bottom margin is cancelled so the surface's own footer lands on the bottom edge rather than
   * a gutter above it. Everything else — running edge to edge, sitting flush under the section
   * strip — is the caller's to add, because those are decisions about the surface and not about
   * its height.
   */
  import type { Snippet } from "svelte";
  import { mergeClasses } from "@magna-carta/design-system/internal/merge-classes";

  let {
    class: className,
    children,
  }: {
    class?: string;
    children: Snippet;
  } = $props();
</script>

<div class={mergeClasses("-mb-24 flex min-h-0 flex-1 flex-col", className)}>
  {@render children()}
</div>
