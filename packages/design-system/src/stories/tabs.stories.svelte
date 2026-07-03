<script module lang="ts">
  /*
   * Tabs — Tier 2 exemplar (the first Bits-UI-backed component; behaviour + a11y from Bits, styling
   * ours). Catalog: one composed showcase (a matter's tabbed detail). Behaviour rides the play
   * function — active `data-state`, keyboard arrow navigation (automatic activation), and a disabled
   * trigger being skipped. The render is an explicit `{template}` snippet (never bare children — with
   * `component` set, svelte-csf would wrap them in a second Tabs.Root). svelte-csf v5.
   */
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import type { ComponentProps } from "svelte";
  import { expect, userEvent } from "storybook/test";
  import * as Tabs from "../lib/components/tabs/index.ts";
  import TabsRoot from "../lib/components/tabs/tabs.svelte";

  const { Story } = defineMeta({
    title: "Layout/Tabs",
    component: TabsRoot,
    // A control only applies live if its prop is in `args` (Storybook spreads the args object;
    // argTypes alone don't put a value in it). `value` is bindable — Bits owns it after mount, so
    // editing it live wouldn't move the tabs (you switch tabs by clicking) — so it's the initial
    // value, NOT a control. orientation + disabled are the two props that visibly change the
    // showcase.
    args: { value: "overview", orientation: "horizontal", disabled: false },
    argTypes: {
      orientation: { control: "select", options: ["horizontal", "vertical"] },
    },
    // Bits' prop types resolve every <div> HTML attribute (aria-*, data-*, on* handlers, the global
    // attributes) into individual controls — hundreds of rows of noise. Whitelist ONLY the props
    // that visibly change this showcase. (Tier 1 native wrappers don't need this — svelte docgen
    // leaves an imported `HTMLXAttributes` opaque — but Bits' `Without<…>` mapped types materialize
    // every member, so EVERY Tier 2+ Bits component sets `controls.include`.)
    parameters: {
      controls: { include: ["orientation", "disabled"] },
    },
  });

  type TabsStoryArgs = ComponentProps<typeof TabsRoot>;
</script>

{#snippet template(args: TabsStoryArgs)}
  <Tabs.Root {...args} class="max-w-md">
    <Tabs.List>
      <Tabs.Trigger value="overview">Overview</Tabs.Trigger>
      <Tabs.Trigger value="time">Time</Tabs.Trigger>
      <Tabs.Trigger value="documents" disabled>Documents</Tabs.Trigger>
    </Tabs.List>
    <Tabs.Content value="overview">Matter overview and key dates.</Tabs.Content>
    <Tabs.Content value="time">Recorded time entries.</Tabs.Content>
    <Tabs.Content value="documents">Filed documents.</Tabs.Content>
  </Tabs.Root>
{/snippet}

<Story
  name="Default"
  {template}
  play={async ({ canvas, step }) => {
    const overview = canvas.getByRole("tab", { name: "Overview" });
    const time = canvas.getByRole("tab", { name: "Time" });
    const documents = canvas.getByRole("tab", { name: "Documents" });

    await step("Selected tab is active and its panel shows", async () => {
      await expect(overview).toHaveAttribute("data-state", "active");
      await expect(canvas.getByText("Matter overview and key dates.")).toBeVisible();
    });

    await step("Disabled trigger cannot be selected", async () => {
      await expect(documents).toBeDisabled();
    });

    await step("Arrow key activates the next enabled tab", async () => {
      // Automatic activation: focusing + ArrowRight switches the tab.
      overview.focus();
      await userEvent.keyboard("{ArrowRight}");
      await expect(time).toHaveAttribute("data-state", "active");
      await expect(canvas.getByText("Recorded time entries.")).toBeVisible();
    });

    await step("Arrow key skips the disabled tab", async () => {
      await userEvent.keyboard("{ArrowRight}");
      await expect(documents).toHaveAttribute("data-state", "inactive");
    });
  }}
/>
