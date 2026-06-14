<script module lang="ts">
  /*
   * Progress — Tier 2 (Bits UI). A determinate bar; `value` and `max` are the controls (both in
   * args so they apply live). role="progressbar" with aria-value* is asserted in the play function.
   * Bits components whitelist controls (see CLAUDE.md). svelte-csf v5.
   */
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import type { ComponentProps } from "svelte";
  import { expect } from "storybook/test";
  import Progress from "../lib/components/progress/index.ts";

  const { Story } = defineMeta({
    title: "Feedback/Progress",
    component: Progress,
    args: { value: 60, max: 100 },
    parameters: {
      controls: { include: ["value", "max"] },
    },
  });

  type ProgressStoryArgs = ComponentProps<typeof Progress>;
</script>

{#snippet template(args: ProgressStoryArgs)}
  <div class="max-w-sm">
    <Progress aria-label="Document upload" {...args} />
  </div>
{/snippet}

<Story
  name="Default"
  {template}
  play={async ({ canvas, step }) => {
    await step("Exposes its value to assistive tech", async () => {
      const bar = canvas.getByRole("progressbar", { name: "Document upload" });
      await expect(bar).toHaveAttribute("aria-valuenow", "60");
      await expect(bar).toHaveAttribute("aria-valuemax", "100");
    });
  }}
/>
