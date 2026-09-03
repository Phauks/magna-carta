<script module lang="ts">
  /*
   * FieldRow — fields side by side. One story per column count, because the count is the variant
   * axis; what fills the tracks is a LabelledField each, as it is in the panels.
   */
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import type { ComponentProps } from "svelte";
  import { expect } from "storybook/test";
  import FieldRow from "../lib/components/field-row/field-row.svelte";
  import LabelledField from "../lib/components/labelled-field/index.ts";
  import Input from "../lib/components/input/index.ts";

  const { Story } = defineMeta({
    title: "Layout/FieldRow",
    component: FieldRow,
    args: { columns: 2 },
    argTypes: { columns: { control: "select", options: [2, 3] } },
    parameters: { controls: { include: ["columns"] } },
  });

  type FieldRowStoryArgs = ComponentProps<typeof FieldRow>;
</script>

{#snippet template(args: FieldRowStoryArgs)}
  <FieldRow columns={args.columns}>
    <LabelledField label="Amount">
      {#snippet children({ props })}
        <Input {...props} />
      {/snippet}
    </LabelledField>
    <LabelledField label="Effective Date">
      {#snippet children({ props })}
        <Input {...props} type="date" />
      {/snippet}
    </LabelledField>
    {#if args.columns === 3}
      <LabelledField label="Reference">
        {#snippet children({ props })}
          <Input {...props} />
        {/snippet}
      </LabelledField>
    {/if}
  </FieldRow>
{/snippet}

<Story
  name="TwoAcross"
  {template}
  play={async ({ canvas, step }) => {
    await step("Two tracks above the small breakpoint, and each field is a labelled field", () => {
      const row = canvas.getByLabelText("Amount").closest(".grid");
      expect(row).toHaveClass("sm:grid-cols-2");
      expect(canvas.getByLabelText("Effective Date")).toBeVisible();
    });
  }}
/>

<Story
  name="ThreeAcross"
  args={{ columns: 3 }}
  {template}
  play={async ({ canvas, step }) => {
    await step("Three tracks above the small breakpoint", () => {
      const row = canvas.getByLabelText("Amount").closest(".grid");
      expect(row).toHaveClass("sm:grid-cols-3");
      expect(canvas.getByLabelText("Reference")).toBeVisible();
    });
  }}
/>
