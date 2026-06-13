<script module lang="ts">
  /*
   * Separator — Tier 1 batch (the Button exemplar pattern: native element + mc-* recipe). Play
   * functions assert the two a11y modes: decorative renders role="none" (skipped by AT), and
   * decorative={false} renders role="separator" with the right aria-orientation. Per-story axe
   * runs clean. svelte-csf v5 API (defineMeta + Story).
   */
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import type { ComponentProps } from "svelte";
  import { expect } from "storybook/test";
  import Separator from "../lib/components/separator/index.ts";

  const { Story } = defineMeta({
    title: "Components/Separator",
    component: Separator,
    args: { orientation: "horizontal", decorative: true },
    argTypes: {
      orientation: { control: "select", options: ["horizontal", "vertical"] },
      decorative: { control: "boolean" },
    },
  });

  type SeparatorStoryArgs = ComponentProps<typeof Separator>;
</script>

<!-- Horizontal decorative divider between two stacked rows. -->
<Story name="Horizontal" args={{ orientation: "horizontal" }}>
  {#snippet template(args: SeparatorStoryArgs)}
    <div>Recent matters</div>
    <Separator {...args} />
    <div>Archived matters</div>
  {/snippet}
</Story>

<!-- Vertical divider inside a sized row (the parent gives it height via utility classes). -->
<Story name="Vertical" args={{ orientation: "vertical" }}>
  {#snippet template(args: SeparatorStoryArgs)}
    <div class="flex h-6 items-center gap-3">
      <span>Edit</span>
      <Separator {...args} />
      <span>Archive</span>
    </div>
  {/snippet}
</Story>

<!-- ----- behavior assertions (play functions) ------------------------------------------- -->

<Story
  name="Decorative separators are hidden from assistive tech"
  args={{ decorative: true }}
  play={async ({ canvas }) => {
    // role="none" removes it from the accessibility tree, so no separator role is exposed.
    await expect(canvas.queryByRole("separator")).toBeNull();
  }}
>
  {#snippet template(args: SeparatorStoryArgs)}
    <Separator {...args} />
  {/snippet}
</Story>

<Story
  name="Semantic separators expose role and orientation"
  args={{ decorative: false, orientation: "vertical" }}
  play={async ({ canvas }) => {
    const separator = canvas.getByRole("separator");
    await expect(separator).toHaveAttribute("aria-orientation", "vertical");
  }}
>
  {#snippet template(args: SeparatorStoryArgs)}
    <Separator {...args} />
  {/snippet}
</Story>
