<script module lang="ts">
  /*
   * RadioGroup — Tier 2 (Bits UI), multi-part. A single-select group; `value` (the selected option)
   * and `disabled` are the controls (both apply live — `value` is bindable, bound through the
   * wrapper). Selection behaviour rides the play function. Each item is labelled for a11y. Bits
   * components whitelist controls; svelte-csf needs a directly imported component. svelte-csf v5.
   */
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import type { ComponentProps } from "svelte";
  import { expect, userEvent } from "storybook/test";
  import * as RadioGroup from "../lib/components/radio-group/index.ts";
  import RadioGroupRoot from "../lib/components/radio-group/radio-group.svelte";

  const { Story } = defineMeta({
    title: "Inputs/RadioGroup",
    component: RadioGroupRoot,
    args: { value: "standard", disabled: false },
    argTypes: {
      value: { control: "select", options: ["standard", "reduced", "pro-bono"] },
    },
    parameters: {
      controls: { include: ["value", "disabled"] },
    },
  });

  type RadioGroupStoryArgs = ComponentProps<typeof RadioGroupRoot>;
</script>

{#snippet template(args: RadioGroupStoryArgs)}
  <RadioGroup.Root aria-label="Billing rate" {...args}>
    <div class="flex items-center gap-2">
      <RadioGroup.Item value="standard" aria-label="Standard rate" />
      <span>Standard rate</span>
    </div>
    <div class="flex items-center gap-2">
      <RadioGroup.Item value="reduced" aria-label="Reduced rate" />
      <span>Reduced rate</span>
    </div>
    <div class="flex items-center gap-2">
      <RadioGroup.Item value="pro-bono" aria-label="Pro bono" />
      <span>Pro bono</span>
    </div>
  </RadioGroup.Root>
{/snippet}

<Story
  name="Default"
  {template}
  play={async ({ canvas, step }) => {
    const standard = canvas.getByRole("radio", { name: "Standard rate" });
    const reduced = canvas.getByRole("radio", { name: "Reduced rate" });
    await step("Standard is selected at rest", async () => {
      await expect(standard).toHaveAttribute("data-state", "checked");
    });
    await step("Selecting Reduced deselects Standard", async () => {
      await userEvent.click(reduced);
      await expect(reduced).toHaveAttribute("data-state", "checked");
      await expect(standard).toHaveAttribute("data-state", "unchecked");
    });
  }}
/>
