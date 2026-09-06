<script module lang="ts">
  /*
   * ScrollEdgeHint — Tier 1. The gilt scroll-edge rule: a thin gold hairline that draws in at the
   * edge of a scroll area while more content lies that way, and leaves the moment it does not. The
   * sidebar draws the block pair over a hidden scrollbar; the table grid draws the inline pair,
   * where a scrollbar cannot say that the record continues past the frame's side.
   *
   * There is no variant axis to enumerate — `axis` picks which pair is watched and is a Control —
   * so the catalog is one Docs Primary showcase, with the component's own logic on a hidden,
   * test-only story so the same box is not rendered twice on the Docs page. svelte-csf v5.
   */
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import type { ComponentProps } from "svelte";
  import { expect, waitFor } from "storybook/test";
  import ScrollEdgeHint from "../lib/components/scroll-edge-hint/index.ts";

  const { Story } = defineMeta({
    title: "Layout/Scroll Edge Hint",
    component: ScrollEdgeHint,
    args: { axis: "both" },
    argTypes: {
      axis: { control: "select", options: ["block", "inline", "both"] },
    },
    parameters: {
      // The scrollport is the consumer's own element, not a value anyone sets from a panel.
      controls: { include: ["axis"] },
    },
  });

  type ScrollEdgeHintStoryArgs = ComponentProps<typeof ScrollEdgeHint>;

  // Filler content: a three-by-three block of squares, wider and taller than the box holding it.
  const fillerBlocks = [0, 1, 2, 3, 4, 5, 6, 7, 8];
</script>

<script lang="ts">
  // One scrollport per harness, so a story's assertions read the box that story is about.
  let showcaseScrollport = $state<HTMLDivElement | null>(null);
  let fittingScrollport = $state<HTMLDivElement | null>(null);
  let overflowingScrollport = $state<HTMLDivElement | null>(null);
</script>

<!-- The showcase and Docs Primary: a small box whose content runs past it in both directions, so
     the rules are visible at rest and follow the box as it is scrolled. The scrollport takes focus
     because a scrollable region has to be reachable from the keyboard. -->
{#snippet template(args: ScrollEdgeHintStoryArgs)}
  <div class="relative flex size-96 flex-col">
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <div
      bind:this={showcaseScrollport}
      class="mc-scrollbar min-h-0 w-full grow overflow-auto"
      tabindex="0"
      role="group"
      aria-label="Scroll area"
    >
      <div class="grid w-max grid-cols-3 gap-16 p-16">
        {#each fillerBlocks as blockIndex (blockIndex)}
          <div class="size-64 bg-surface-sunken"></div>
        {/each}
      </div>
    </div>
    <ScrollEdgeHint element={showcaseScrollport} axis={args.axis} />
  </div>
{/snippet}

<Story name="Default" {template} />

<!-- Behaviour: what the hint guarantees — silence while everything fits, the far-edge rules while
     it does not, and the pair swapping when the reader arrives at the far edge. Tagged out of the
     sidebar and the Docs page, but still run by the test addon. -->
<Story
  name="Behaviour"
  tags={["!dev", "!autodocs"]}
  play={async ({ canvasElement, step }) => {
    const fitting = canvasElement.querySelector("[data-testid='fitting-frame']");
    const overflowing = canvasElement.querySelector("[data-testid='overflowing-frame']");
    const edgesOf = (frame: Element | null): string[] =>
      [...(frame?.querySelectorAll("[data-edge]") ?? [])].map(
        (rule) => rule.getAttribute("data-edge") ?? "",
      );

    await step("Content that fits its box draws no rule at all", async () => {
      // The overflowing box beside it is what proves the watches have run: a fitting box renders
      // nothing, so an assertion made before first paint would pass for the wrong reason.
      await waitFor(() => expect(edgesOf(overflowing)).not.toEqual([]));
      await expect(edgesOf(fitting)).toEqual([]);
    });

    await step("Content running past the box draws the far-edge rules only", async () => {
      await waitFor(() =>
        expect(edgesOf(overflowing)).toEqual(["block-end", "inline-end"]),
      );
    });

    await step("Scrolling to the far corner swaps them for the start rules", async () => {
      const scrollport = overflowingScrollport;
      await expect(scrollport).not.toBeNull();
      if (scrollport === null) return;
      scrollport.scrollTo({
        top: scrollport.scrollHeight,
        left: scrollport.scrollWidth,
        behavior: "instant",
      });
      await waitFor(() =>
        expect(edgesOf(overflowing)).toEqual(["block-start", "inline-start"]),
      );
    });
  }}
>
  {#snippet template()}
    <div class="flex gap-32">
      <div class="relative flex size-96 flex-col" data-testid="fitting-frame">
        <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
        <div
          bind:this={fittingScrollport}
          class="mc-scrollbar min-h-0 w-full grow overflow-auto"
          tabindex="0"
          role="group"
          aria-label="Scroll area that fits"
        >
          <div class="size-48 bg-surface-sunken"></div>
        </div>
        <ScrollEdgeHint element={fittingScrollport} axis="both" />
      </div>
      <div class="relative flex size-96 flex-col" data-testid="overflowing-frame">
        <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
        <div
          bind:this={overflowingScrollport}
          class="mc-scrollbar min-h-0 w-full grow overflow-auto"
          tabindex="0"
          role="group"
          aria-label="Scroll area that overflows"
        >
          <div class="grid w-max grid-cols-3 gap-16">
            {#each fillerBlocks as blockIndex (blockIndex)}
              <div class="size-64 bg-surface-sunken"></div>
            {/each}
          </div>
        </div>
        <ScrollEdgeHint element={overflowingScrollport} axis="both" />
      </div>
    </div>
  {/snippet}
</Story>
