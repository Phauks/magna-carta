<script lang="ts">
  /*
   * ScrollEdgeHint — the scroll-edge affordance, in one home. A thin neutral rule DRAWS in at an
   * edge of a scroll area while there is more content that way, and leaves instantly by unmount
   * once there is not. It says "there is more this way" where a scrollbar either is not there to
   * say it (the sidebar's nav list hides its own — chrome is one clean plane) or cannot say it on
   * that axis (a register scrolls sideways past its columns).
   *
   * The scrollport is a PROP, not a wrapper: the consumer's element already carries their classes,
   * their handlers and their ref, and taking it over to add an edge rule would put this component
   * between a surface and its own scroll region. So the hint watches an element it does not own.
   *
   * IT MUST BE RENDERED INSIDE A POSITIONED SHELL THAT IS THE SCROLLPORT'S OWN BOX — the rules are
   * absolutely positioned and resolve against the nearest positioned ancestor, so a shell that is
   * larger than the scrollport (or missing entirely) lands them somewhere else on the screen
   * without any error to read. The shape is a `relative` flex column holding the scrollport at
   * `min-h-0 grow`, with the hint after it; sidebar-content.svelte and data-table-grid.svelte are
   * the two worked examples.
   *
   * State comes from the scrollport's own scroll event plus a ResizeObserver over BOTH the
   * scrollport and its first element child: the scrollport's own resize catches the viewport
   * changing, and the child's catches the content growing or shrinking — a table gaining rows or a
   * column being widened moves the far edge without a scroll event ever firing. The rules cost no
   * layout, so a consumer pays nothing for the ones that are not drawn.
   */
  import { mergeClasses } from "../../internal/merge-classes.ts";

  type Props = {
    /** The scrollport whose edges are watched. Owned by the consumer; this component only reads it. */
    element: HTMLElement | null;
    /** Which pair of edges is drawn: the block (top/bottom) pair, the inline pair, or both. */
    axis?: "block" | "inline" | "both";
    /** Classes merged onto every rule the hint renders. */
    class?: string;
  };

  let { element, axis = "both", class: className }: Props = $props();

  let moreAtBlockStart = $state(false);
  let moreAtBlockEnd = $state(false);
  let moreAtInlineStart = $state(false);
  let moreAtInlineEnd = $state(false);

  const drawsBlockEdges = $derived(axis === "block" || axis === "both");
  const drawsInlineEdges = $derived(axis === "inline" || axis === "both");

  function updateEdges(): void {
    const scrollport = element;
    if (scrollport === null) return;
    /*
     * The inline offset is read through Math.abs because a right-to-left writing mode scrolls into
     * NEGATIVE scrollLeft in every modern engine: the origin stays at the inline start, which is on
     * the right. Its magnitude is the distance travelled from the start edge either way, which is
     * the only thing the two rules need to know.
     */
    const inlineOffset = Math.abs(scrollport.scrollLeft);
    // A pixel of tolerance at the far edge: fractional scroll metrics must never trap a rule on.
    moreAtBlockStart = scrollport.scrollTop > 0;
    moreAtBlockEnd = scrollport.scrollTop + scrollport.clientHeight < scrollport.scrollHeight - 1;
    moreAtInlineStart = inlineOffset > 0;
    moreAtInlineEnd = inlineOffset + scrollport.clientWidth < scrollport.scrollWidth - 1;
  }

  $effect(() => {
    const scrollport = element;
    if (scrollport === null) return;
    updateEdges();
    scrollport.addEventListener("scroll", updateEdges, { passive: true });
    const observer = new ResizeObserver(updateEdges);
    observer.observe(scrollport);
    // A scrollport rendering nothing yet has no child to measure; its own resize still applies.
    const content = scrollport.firstElementChild;
    if (content !== null) observer.observe(content);
    return () => {
      scrollport.removeEventListener("scroll", updateEdges);
      observer.disconnect();
    };
  });
</script>

{#if drawsBlockEdges && moreAtBlockStart}
  <span
    aria-hidden="true"
    data-edge="block-start"
    class={mergeClasses("mc-scroll-edge-hint", className)}
  ></span>
{/if}
{#if drawsBlockEdges && moreAtBlockEnd}
  <span
    aria-hidden="true"
    data-edge="block-end"
    class={mergeClasses("mc-scroll-edge-hint", className)}
  ></span>
{/if}
{#if drawsInlineEdges && moreAtInlineStart}
  <span
    aria-hidden="true"
    data-edge="inline-start"
    class={mergeClasses("mc-scroll-edge-hint", className)}
  ></span>
{/if}
{#if drawsInlineEdges && moreAtInlineEnd}
  <span
    aria-hidden="true"
    data-edge="inline-end"
    class={mergeClasses("mc-scroll-edge-hint", className)}
  ></span>
{/if}
