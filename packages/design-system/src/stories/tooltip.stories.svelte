<script module lang="ts">
  /*
   * Tooltip — Tier 2 (Bits UI), floating + portal. The bubble shows on hover/focus of the trigger;
   * Bits handles positioning (Floating UI) and the two-level wrapper. A Tooltip.Provider wraps the
   * group (here in the story; apps put one near the root). `disabled` is the control. The hover
   * behaviour rides the play function (delayDuration 0 so it shows instantly). Bits components
   * whitelist controls; svelte-csf needs a directly imported component. svelte-csf v5.
   */
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import type { ComponentProps } from "svelte";
  import { expect, userEvent, within } from "storybook/test";
  import * as Tooltip from "../lib/components/tooltip/index.ts";
  import TooltipRoot from "../lib/components/tooltip/tooltip-root.svelte";

  const { Story } = defineMeta({
    title: "Feedback/Tooltip",
    component: TooltipRoot,
    args: { disabled: false },
    parameters: {
      controls: { include: ["disabled"] },
    },
  });

  type TooltipStoryArgs = ComponentProps<typeof TooltipRoot>;
</script>

{#snippet template(args: TooltipStoryArgs)}
  <Tooltip.Provider delayDuration={0}>
    <Tooltip.Root {...args}>
      <Tooltip.Trigger>Matter reference</Tooltip.Trigger>
      <Tooltip.Content>ACME-2026-014 · opened 14 Mar 2026</Tooltip.Content>
    </Tooltip.Root>
  </Tooltip.Provider>
{/snippet}

<Story
  name="Default"
  {template}
  play={async ({ canvas, step }) => {
    const trigger = canvas.getByRole("button", { name: "Matter reference" });
    await step("Hovering the trigger shows the tooltip", async () => {
      await userEvent.hover(trigger);
      // The content is portaled to the body, so query there.
      const tip = await within(document.body).findByText("ACME-2026-014 · opened 14 Mar 2026");
      await expect(tip).toBeVisible();
    });
  }}
/>
