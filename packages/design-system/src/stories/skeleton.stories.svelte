<script module lang="ts">
  /*
   * Skeleton — Tier 1 batch. A single story: a typical loading row (circular avatar placeholder
   * beside two text lines), the caller sizing each box with utilities. The aria-hidden check rides
   * the play function (the pulse and its reduced-motion behaviour are VRT concerns). svelte-csf v5.
   */
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import { expect } from "storybook/test";
  import Skeleton from "../lib/components/skeleton/index.ts";

  const { Story } = defineMeta({
    title: "Components/Skeleton",
    component: Skeleton,
  });
</script>

<Story
  name="Default"
  play={async ({ canvasElement }) => {
    const skeleton = canvasElement.querySelector(".mc-skeleton");
    await expect(skeleton).not.toBeNull();
    await expect(skeleton).toHaveAttribute("aria-hidden", "true");
  }}
>
  <div class="flex items-center gap-3">
    <Skeleton class="size-10 rounded-full" />
    <div class="flex flex-col gap-2">
      <Skeleton class="h-4 w-48" />
      <Skeleton class="h-4 w-32" />
    </div>
  </div>
</Story>
