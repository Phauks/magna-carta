<script module lang="ts">
  /*
   * Accordion — Tier 2 (Bits UI), multi-part. `type` (single vs multiple) is the variant axis, and
   * Bits owns it at mount (a live control wouldn't switch behaviour), so it's ONE STORY PER TYPE
   * with `type` fixed in args — Single collapses the others, Multiple keeps several open. Each story
   * opens a section (or two) at mount via `value` so the behaviour is visible at rest; `value` isn't
   * in controls.include, so it doesn't show as a control. `disabled` is the control. Expand/collapse
   * rides the play function. (Height animation deferred — see accordion.svelte.) svelte-csf v5.
   */
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import type { ComponentProps } from "svelte";
  import { expect, userEvent } from "storybook/test";
  import * as Accordion from "../lib/components/accordion/index.ts";
  import AccordionRoot from "../lib/components/accordion/accordion.svelte";

  const { Story } = defineMeta({
    title: "Layout/Accordion",
    component: AccordionRoot,
    args: { disabled: false },
    parameters: {
      controls: { include: ["disabled"] },
    },
  });

  type AccordionStoryArgs = ComponentProps<typeof AccordionRoot>;
</script>

{#snippet template(args: AccordionStoryArgs)}
  <Accordion.Root {...args} class="max-w-md">
    <Accordion.Item value="scope">
      <Accordion.Trigger>Scope of work</Accordion.Trigger>
      <Accordion.Content>The agreed deliverables and their boundaries.</Accordion.Content>
    </Accordion.Item>
    <Accordion.Item value="fees">
      <Accordion.Trigger>Fees and billing</Accordion.Trigger>
      <Accordion.Content>How time is recorded and how invoices are raised.</Accordion.Content>
    </Accordion.Item>
    <Accordion.Item value="termination">
      <Accordion.Trigger>Termination</Accordion.Trigger>
      <Accordion.Content>How either party may bring the engagement to an end.</Accordion.Content>
    </Accordion.Item>
  </Accordion.Root>
{/snippet}

<!-- single — opening a section collapses the others (the Docs-page Primary). -->
<Story
  name="Single"
  {template}
  args={{ type: "single", value: "scope" }}
  play={async ({ canvas, step }) => {
    const scope = canvas.getByRole("button", { name: "Scope of work" });
    const fees = canvas.getByRole("button", { name: "Fees and billing" });
    await step("Scope opens at rest", async () => {
      await expect(scope).toHaveAttribute("data-state", "open");
    });
    await step("Opening Fees collapses Scope (single)", async () => {
      await userEvent.click(fees);
      await expect(fees).toHaveAttribute("data-state", "open");
      await expect(scope).toHaveAttribute("data-state", "closed");
    });
  }}
/>

<!-- multiple — several sections stay open at once. -->
<Story
  name="Multiple"
  {template}
  args={{ type: "multiple", value: ["scope", "fees"] }}
  play={async ({ canvas, step }) => {
    const scope = canvas.getByRole("button", { name: "Scope of work" });
    const termination = canvas.getByRole("button", { name: "Termination" });
    await step("Scope and Fees are open at rest", async () => {
      await expect(scope).toHaveAttribute("data-state", "open");
    });
    await step("Opening Termination leaves Scope open (multiple)", async () => {
      await userEvent.click(termination);
      await expect(termination).toHaveAttribute("data-state", "open");
      await expect(scope).toHaveAttribute("data-state", "open");
    });
  }}
/>
