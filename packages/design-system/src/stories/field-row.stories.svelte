<script module lang="ts">
  /*
   * FieldRow — fields side by side. One story per column count, because the count is the variant
   * axis; what fills the tracks is a LabelledField each, as it is in the panels.
   *
   * The date track is a DatePicker rather than a LabelledField around one, because the picker
   * renders its own label — that is what names its input. Which makes this row
   * the specimen for the one thing the two labels have to agree on: they are separate recipes and
   * must measure the same, or the date field starts a few pixels below the fields beside it.
   */
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import type { ComponentProps } from "svelte";
  import { expect } from "storybook/test";
  import { CalendarDate } from "@internationalized/date";
  import FieldRow from "../lib/components/field-row/field-row.svelte";
  import LabelledField from "../lib/components/labelled-field/index.ts";
  import Input from "../lib/components/input/index.ts";
  import { DatePicker } from "../lib/components/date-picker/index.ts";

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
    <!-- The picker's label and field are siblings with no wrapper of their own, so the track has to
         supply one — two grid items would put the label in the next column. A fixed date, never
         today(): a story that moves with the calendar cannot hold a baseline. -->
    <div class="flex flex-col gap-8">
      <DatePicker label="Effective Date" value={new CalendarDate(2026, 9, 8)} />
    </div>
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
      // The date field is asked for by role and name, the way a reader meets it.
      expect(canvas.getByRole("textbox", { name: "Effective Date" })).toBeVisible();
    });

    await step("The date field takes ONE track — its label and field are not two grid items", () => {
      // The input sits in the field box, and the box in the track.
      const dateTrack = canvas.getByRole("textbox", { name: "Effective Date" }).parentElement
        ?.parentElement;
      expect(dateTrack?.parentElement).toHaveClass("sm:grid-cols-2");
      expect(dateTrack).toContainElement(canvas.getByText("Effective Date"));
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
