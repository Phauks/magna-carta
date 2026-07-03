<script module lang="ts">
  /*
   * Checkbox — Tier 2 (Bits UI). `checked`, `indeterminate`, `disabled` are the controls (all apply
   * live via the wrapper's bindings). The toggle behaviour rides the play function; disabled-blocks
   * is a hidden test story. Bits components whitelist controls (see CLAUDE.md). svelte-csf v5.
   */
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import type { ComponentProps } from "svelte";
  import { expect, userEvent } from "storybook/test";
  import Checkbox from "../lib/components/checkbox/index.ts";

  const { Story } = defineMeta({
    title: "Inputs/Checkbox",
    component: Checkbox,
    args: { checked: false, indeterminate: false, disabled: false },
    parameters: {
      controls: { include: ["checked", "indeterminate", "disabled"] },
    },
  });

  type CheckboxStoryArgs = ComponentProps<typeof Checkbox>;
</script>

{#snippet template(args: CheckboxStoryArgs)}
  <Checkbox aria-label="Accept the engagement terms" {...args} />
{/snippet}

<Story
  name="Default"
  {template}
  play={async ({ canvas, step }) => {
    const box = canvas.getByRole("checkbox", { name: "Accept the engagement terms" });
    await step("Starts unchecked", async () => {
      await expect(box).toHaveAttribute("data-state", "unchecked");
    });
    await step("Clicking checks it", async () => {
      await userEvent.click(box);
      await expect(box).toHaveAttribute("data-state", "checked");
    });
  }}
/>

<!-- Behaviour: disabled blocks toggling. Hidden from the catalog, still run by the test addon. -->
<Story
  name="Behaviour"
  tags={["!dev", "!autodocs"]}
  play={async ({ canvas, step }) => {
    const box = canvas.getByRole("checkbox", { name: "Disabled box" });
    await step("Disabled checkbox ignores clicks", async () => {
      await expect(box).toBeDisabled();
      await userEvent.click(box, { pointerEventsCheck: 0 });
      await expect(box).toHaveAttribute("data-state", "unchecked");
    });
  }}
>
  {#snippet template()}
    <Checkbox aria-label="Disabled box" disabled />
  {/snippet}
</Story>
