<script module lang="ts">
  /*
   * SegmentedControl — two to four choices side by side, the chosen one raised. A radio group in
   * behaviour (Bits RadioGroup): one tab stop, arrows move and choose. `disabled` is the control;
   * `value` is fixed per story because Bits owns it at mount.
   */
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import type { ComponentProps } from "svelte";
  import { expect, userEvent } from "storybook/test";
  import * as SegmentedControl from "../lib/components/segmented-control/index.ts";
  import SegmentedControlRoot from "../lib/components/segmented-control/segmented-control.svelte";

  const { Story } = defineMeta({
    title: "Inputs/SegmentedControl",
    component: SegmentedControlRoot,
    args: { value: "billable", disabled: false },
    parameters: {
      controls: { include: ["disabled"] },
    },
  });

  type SegmentedControlStoryArgs = ComponentProps<typeof SegmentedControlRoot>;
</script>

{#snippet template(args: SegmentedControlStoryArgs)}
  <div class="flex max-w-md flex-col gap-4">
    <span id="segmented-billing-label" class="mc-label">Billing</span>
    <SegmentedControl.Root aria-labelledby="segmented-billing-label" {...args}>
      <SegmentedControl.Item value="billable">Billable</SegmentedControl.Item>
      <SegmentedControl.Item value="nonbillable">Non-billable</SegmentedControl.Item>
      <SegmentedControl.Item value="hold" disabled title="Not built yet: holding time off a bill."
        >Hold</SegmentedControl.Item
      >
    </SegmentedControl.Root>
  </div>
{/snippet}

<Story
  name="Default"
  {template}
  play={async ({ canvas, step }) => {
    const group = canvas.getByRole("radiogroup", { name: "Billing" });
    const billable = canvas.getByRole("radio", { name: "Billable" });
    const nonBillable = canvas.getByRole("radio", { name: "Non-billable" });
    const hold = canvas.getByRole("radio", { name: "Hold" });
    await step("Every choice is on screen and Billable is chosen", async () => {
      await expect(group).toBeVisible();
      await expect(billable).toHaveAttribute("data-state", "checked");
      await expect(nonBillable).toHaveAttribute("data-state", "unchecked");
    });
    await step("Pressing a segment chooses it", async () => {
      await userEvent.click(nonBillable);
      await expect(nonBillable).toHaveAttribute("data-state", "checked");
      await expect(billable).toHaveAttribute("data-state", "unchecked");
    });
    await step("Arrow keys move and choose, skipping a refused choice", async () => {
      await userEvent.keyboard("{ArrowLeft}");
      await expect(billable).toHaveFocus();
      await expect(billable).toHaveAttribute("data-state", "checked");
      await userEvent.keyboard("{ArrowRight}{ArrowRight}");
      await expect(hold).toHaveAttribute("data-state", "unchecked");
    });
    await step("A refused choice stays visible and cannot be chosen", async () => {
      await expect(hold).toBeDisabled();
      await expect(hold).toBeVisible();
    });
  }}
/>
