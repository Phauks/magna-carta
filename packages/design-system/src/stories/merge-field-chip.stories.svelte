<script module lang="ts">
  /*
   * MergeFieldChip — Tier 1 (native span). The token standing in for an inserted merge field: a
   * status glyph, the field's human label, and the value type. The variant axis is STATUS — whether
   * the reader has to do anything about the field — so there is one story per status. Everything
   * else (the label, the type text, the remove button) is a Control. svelte-csf v5.
   */
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import type { ComponentProps } from "svelte";
  import { expect, fn, userEvent } from "storybook/test";
  import MergeFieldChip from "../lib/components/merge-field-chip/merge-field-chip.svelte";

  const { Story } = defineMeta({
    title: "Data Display/MergeFieldChip",
    component: MergeFieldChip,
    parameters: {
      controls: { include: ["label", "valueTypeLabel", "status", "removeLabel"] },
    },
    argTypes: {
      status: {
        control: "select",
        options: ["automatic", "manual", "unavailable", "invalid"],
      },
    },
  });

  type ChipStoryArgs = ComponentProps<typeof MergeFieldChip>;

  const removeField = fn();
</script>

{#snippet template(args: ChipStoryArgs)}
  <MergeFieldChip {...args} />
{/snippet}

<!-- The calm, expected case: the value arrives from firm data with nobody doing anything. -->
<Story
  name="Filled automatically"
  args={{ label: "Client name", valueTypeLabel: "Text", status: "automatic" }}
  {template}
  play={async ({ canvas, step }) => {
    await step("Reads the human label, never the key path", async () => {
      await expect(canvas.getByText("Client name")).toBeVisible();
    });
    await step("States the status in words, so it is not colour-only", async () => {
      await expect(canvas.getByText("Filled automatically")).toBeInTheDocument();
    });
  }}
/>

<!-- Work waiting for a person — the status the input area exists to surface. -->
<Story
  name="Needs entering"
  args={{ label: "Retainer amount", valueTypeLabel: "Money", status: "manual" }}
  {template}
/>

<!-- The firm's data cannot supply it: an absence, not a fault. -->
<Story
  name="No value available"
  args={{ label: "Opposing party name", valueTypeLabel: "Text", status: "unavailable" }}
  {template}
/>

<!-- The key is not in the catalog at all — the template cannot be used until this resolves. -->
<Story
  name="Not a known field"
  args={{ label: "matter.filingDeadline", valueTypeLabel: "Unknown", status: "invalid" }}
  {template}
/>

<!-- Behaviour: the one interaction a chip owns. Hidden from the catalog, still run by the tests. -->
<Story
  name="Behaviour"
  tags={["!dev", "!autodocs"]}
  play={async ({ canvas, step }) => {
    await step("The remove button carries a name naming the field it removes", async () => {
      const remove = canvas.getByRole("button", { name: "Remove Date opened" });
      await userEvent.click(remove);
      await expect(removeField).toHaveBeenCalled();
    });
  }}
>
  {#snippet template()}
    <MergeFieldChip
      label="Date opened"
      valueTypeLabel="Date"
      status="automatic"
      onRemove={removeField}
    />
  {/snippet}
</Story>
