<script module lang="ts">
  /*
   * Skeleton — Tier 1 batch. A single story: a typical loading row (circular avatar placeholder
   * beside two text lines), the caller sizing each box with utilities. The aria-hidden check rides
   * the play function (the pulse and its reduced-motion behaviour are VRT concerns). svelte-csf v5.
   *
   * The render MUST be an explicit `{template}` snippet, NOT bare `<Story>` children: with
   * `component` set, svelte-csf renders that component with args and slots bare children inside it
   * — and Skeleton is a leaf `<div>` with no `{@render children()}`, so the content was dropped
   * entirely (an empty, size-less skeleton — nothing visible). The template snippet IS the render.
   */
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import { expect } from "storybook/test";
  import Skeleton from "../lib/components/skeleton/index.ts";

  const { Story } = defineMeta({
    title: "Feedback/Skeleton",
    component: Skeleton,
  });
</script>

{#snippet template()}
  <div class="flex items-center gap-3">
    <Skeleton class="size-10 rounded-full" />
    <div class="flex flex-col gap-2">
      <Skeleton class="h-4 w-48" />
      <Skeleton class="h-4 w-32" />
    </div>
  </div>
{/snippet}

<Story
  name="Default"
  {template}
  play={async ({ canvasElement, step }) => {
    await step("Placeholder is hidden from assistive tech", async () => {
      const skeleton = canvasElement.querySelector(".mc-skeleton");
      await expect(skeleton).not.toBeNull();
      await expect(skeleton).toHaveAttribute("aria-hidden", "true");
    });
  }}
/>
