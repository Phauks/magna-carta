<script module lang="ts">
  /*
   * Skeleton — Tier 1 batch (the Button exemplar pattern: native element + mc-* recipe). The
   * caller sizes each placeholder with utilities; the recipe owns the pulse and shape. The play
   * function asserts the placeholder is hidden from assistive tech (aria-hidden) — the animation
   * itself (and its reduced-motion behaviour) is guarded by visual regression, not a play check.
   * Per-story axe runs clean. svelte-csf v5 API (defineMeta + Story).
   */
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import { expect } from "storybook/test";
  import Skeleton from "../lib/components/skeleton/index.ts";

  const { Story } = defineMeta({
    title: "Components/Skeleton",
    component: Skeleton,
  });
</script>

<!-- A typical loading row: a circular avatar placeholder beside two text lines. -->
<Story name="Default">
  {#snippet template()}
    <div class="flex items-center gap-3">
      <Skeleton class="size-10 rounded-full" />
      <div class="flex flex-col gap-2">
        <Skeleton class="h-4 w-48" />
        <Skeleton class="h-4 w-32" />
      </div>
    </div>
  {/snippet}
</Story>

<Story
  name="Hidden from assistive tech"
  play={async ({ canvasElement }) => {
    const skeleton = canvasElement.querySelector(".mc-skeleton");
    await expect(skeleton).not.toBeNull();
    await expect(skeleton).toHaveAttribute("aria-hidden", "true");
  }}
>
  {#snippet template()}
    <Skeleton class="h-4 w-48" />
  {/snippet}
</Story>
