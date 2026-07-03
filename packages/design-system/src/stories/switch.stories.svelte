<script module lang="ts">
  /*
   * Switch — Tier 2 (Bits UI). A single on/off control. `checked` and `disabled` are the controls
   * (both apply live — `checked` is bindable, passed through the wrapper's bind:checked). The toggle
   * behaviour rides the play function; the disabled-blocks-toggle case is a hidden test story.
   * Bits components must whitelist controls (see CLAUDE.md). svelte-csf v5.
   */
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import type { ComponentProps } from "svelte";
  import { expect, userEvent } from "storybook/test";
  import Switch from "../lib/components/switch/index.ts";

  const { Story } = defineMeta({
    title: "Inputs/Switch",
    component: Switch,
    args: { checked: false, disabled: false },
    parameters: {
      controls: { include: ["checked", "disabled"] },
    },
  });

  type SwitchStoryArgs = ComponentProps<typeof Switch>;
</script>

{#snippet template(args: SwitchStoryArgs)}
  <Switch aria-label="Email notifications" {...args} />
{/snippet}

<Story
  name="Default"
  {template}
  play={async ({ canvas, step }) => {
    const control = canvas.getByRole("switch", { name: "Email notifications" });
    await step("Starts off", async () => {
      await expect(control).toHaveAttribute("data-state", "unchecked");
    });
    await step("Clicking toggles it on", async () => {
      await userEvent.click(control);
      await expect(control).toHaveAttribute("data-state", "checked");
    });
  }}
/>

<!-- Behaviour: disabled blocks toggling. Hidden from the catalog, still run by the test addon. -->
<Story
  name="Behaviour"
  tags={["!dev", "!autodocs"]}
  play={async ({ canvas, step }) => {
    const control = canvas.getByRole("switch", { name: "Disabled toggle" });
    await step("Disabled switch ignores clicks", async () => {
      await expect(control).toBeDisabled();
      await userEvent.click(control, { pointerEventsCheck: 0 });
      await expect(control).toHaveAttribute("data-state", "unchecked");
    });
  }}
>
  {#snippet template()}
    <Switch aria-label="Disabled toggle" disabled />
  {/snippet}
</Story>
