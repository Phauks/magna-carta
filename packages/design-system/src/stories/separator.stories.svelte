<script module lang="ts">
  /*
   * Separator — Tier 1 batch. Two genuinely different displays — horizontal vs vertical — which
   * also cover the two a11y modes between them: Horizontal is decorative (role="none", skipped by
   * AT) and Vertical is semantic (role="separator" + aria-orientation). Both demos use the same
   * gap so the spacing reads consistently — the separator imposes no margin of its own; spacing is
   * always the parent layout's job. Each story's check rides its play function. svelte-csf v5.
   */
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import type { ComponentProps } from "svelte";
  import { expect } from "storybook/test";
  import Separator from "../lib/components/separator/index.ts";

  const { Story } = defineMeta({
    title: "Layout/Separator",
    component: Separator,
    argTypes: {
      orientation: { control: "select", options: ["horizontal", "vertical"] },
      decorative: { control: "boolean" },
    },
  });

  type SeparatorStoryArgs = ComponentProps<typeof Separator>;
</script>

<!-- Horizontal, decorative (the default): a visual divider AT skips (no separator role exposed). -->
<Story
  name="Horizontal"
  args={{ orientation: "horizontal", decorative: true }}
  play={async ({ canvas, step }) => {
    await step("Decorative separator is hidden from assistive tech", async () => {
      await expect(canvas.queryByRole("separator")).toBeNull();
    });
  }}
>
  {#snippet template(args: SeparatorStoryArgs)}
    <!-- A 128px-wide container so this rule is the SAME length as the vertical demo's 128px-tall
         rule — both are 1px thick (the border-width token), just rotated. The separator imposes no
         length of its own; it spans whatever its container gives it. -->
    <div class="flex w-32 flex-col gap-3">
      <span>Recent matters</span>
      <Separator {...args} />
      <span>Archived matters</span>
    </div>
  {/snippet}
</Story>

<!-- Vertical, semantic: announced as a real boundary with its orientation (the parent gives height). -->
<Story
  name="Vertical"
  args={{ orientation: "vertical", decorative: false }}
  play={async ({ canvas, step }) => {
    await step("Semantic separator exposes its orientation", async () => {
      const separator = canvas.getByRole("separator");
      await expect(separator).toHaveAttribute("aria-orientation", "vertical");
    });
  }}
>
  {#snippet template(args: SeparatorStoryArgs)}
    <!-- A 128px-tall container — same length as the horizontal demo, so the two read as identical
         1px rules in different orientations. -->
    <div class="flex h-32 items-center gap-3">
      <span>Edit</span>
      <Separator {...args} />
      <span>Archive</span>
    </div>
  {/snippet}
</Story>
