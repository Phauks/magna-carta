<script module lang="ts">
  /*
   * LabelledField — the label-over-control stack every plain form uses. Two stories: at rest with a
   * hint, and carrying an error. The association is the whole point, so each play asserts it
   * through the accessibility tree — the label reaches the control, the hint and the error are its
   * description — rather than by reading ids.
   */
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import type { ComponentProps } from "svelte";
  import { expect, userEvent } from "storybook/test";
  import LabelledField from "../lib/components/labelled-field/labelled-field.svelte";
  import Input from "../lib/components/input/index.ts";

  const { Story } = defineMeta({
    title: "Inputs/LabelledField",
    component: LabelledField,
    args: { label: "Amount", hint: "What is still owed on this bill, at most." },
    parameters: { controls: { include: ["label", "hint", "error"] } },
  });

  type LabelledFieldStoryArgs = ComponentProps<typeof LabelledField>;
</script>

<script lang="ts">
  let amount = $state("");
</script>

{#snippet template(args: LabelledFieldStoryArgs)}
  <div class="w-3xs">
    <LabelledField {...args}>
      {#snippet children({ props })}
        <Input {...props} bind:value={amount} />
      {/snippet}
    </LabelledField>
  </div>
{/snippet}

<Story
  name="Default"
  {template}
  play={async ({ canvas, step }) => {
    const field = canvas.getByLabelText("Amount");

    await step("The label names the control — clicking it focuses the field", async () => {
      await userEvent.click(canvas.getByText("Amount"));
      expect(field).toHaveFocus();
    });

    await step("The hint is the control's description, not a line beside it", () => {
      expect(field).toHaveAccessibleDescription("What is still owed on this bill, at most.");
      expect(field).not.toHaveAttribute("aria-invalid");
    });
  }}
/>

<Story
  name="WithAnError"
  args={{ error: "More than is owed." }}
  {template}
  play={async ({ canvas, step }) => {
    const field = canvas.getByLabelText("Amount");

    await step("An error marks the control invalid", () => {
      expect(field).toHaveAttribute("aria-invalid", "true");
    });

    await step("And joins the hint in the description, hint first", () => {
      expect(field).toHaveAccessibleDescription(
        "What is still owed on this bill, at most. More than is owed.",
      );
    });
  }}
/>
