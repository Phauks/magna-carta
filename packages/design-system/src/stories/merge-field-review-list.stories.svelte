<script module lang="ts">
  /*
   * MergeFieldReviewList — the confirmation surface for placeholders detected in an uploaded
   * document. Every row is a PROPOSAL with a checkbox and the standing line saying nothing has
   * changed; the component has no state that could render as "already converted".
   *
   * Controlled: rows carry `confirmed` and the consumer records the change from `onToggle`. The two
   * stories are the two renders — proposals to review, and the honest empty state. svelte-csf v5.
   */
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import type { ComponentProps } from "svelte";
  import { expect, userEvent, waitFor } from "storybook/test";
  import MergeFieldReviewList from "../lib/components/merge-field-review-list/merge-field-review-list.svelte";
  import type { MergeFieldReviewItem } from "../lib/components/merge-field-review-list/types.ts";

  const { Story } = defineMeta({
    title: "Compound Inputs/MergeFieldReviewList",
    component: MergeFieldReviewList,
    parameters: {
      controls: { include: ["heading", "headingLevel", "guidance", "emptyMessage"] },
    },
    argTypes: {
      headingLevel: { control: "select", options: [2, 3, 4, 5] },
    },
  });

  type ReviewStoryArgs = ComponentProps<typeof MergeFieldReviewList>;

  const INITIAL_ITEMS: readonly MergeFieldReviewItem[] = [
    {
      id: "detected-client-name",
      sourceText: "MERGEFIELD Client_Name",
      sourceLocation: "Page 1, address block",
      proposedLabel: "Client name",
      proposedValueTypeLabel: "Text",
      confidence: "exact",
      note: "A Word mail-merge field whose name matches Client name exactly.",
      confirmed: false,
    },
    {
      id: "detected-matter-description",
      sourceText: "MERGEFIELD Matter_Desc",
      sourceLocation: "Page 1, opening paragraph",
      proposedLabel: "Matter title",
      proposedValueTypeLabel: "Text",
      confidence: "likely",
      note: "An abbreviated name; Matter title is the closest catalog entry.",
      confirmed: false,
    },
    {
      id: "detected-fee-schedule",
      sourceText: "MERGEFIELD Fee_Schedule_Ref",
      sourceLocation: "Page 2, fee section",
      proposedLabel: null,
      confidence: "uncertain",
      note: "Nothing in the catalog fits. Pick a field yourself, or leave this placeholder as text.",
      confirmed: false,
    },
  ];
</script>

<script lang="ts">
  // Controlled from the story, the way a real consumer holds it: the list never decides for itself.
  let items = $state<MergeFieldReviewItem[]>(INITIAL_ITEMS.map((item) => ({ ...item })));

  function recordConfirmation(id: string, confirmed: boolean): void {
    items = items.map((item) => (item.id === id ? { ...item, confirmed } : item));
  }
</script>

<Story
  name="Proposals to confirm"
  play={async ({ canvas, step }) => {
    await step("The standing line says plainly that nothing has changed yet", async () => {
      await expect(canvas.getByText(/Nothing has been changed/)).toBeVisible();
    });

    await step("Each proposal is a checkbox naming the field and the placeholder", async () => {
      await expect(
        canvas.getByRole("checkbox", { name: "Use Client name for MERGEFIELD Client_Name" }),
      ).toBeVisible();
    });

    await step("A proposal with nothing to suggest still asks, rather than guessing", async () => {
      await expect(canvas.getByText("No suggestion")).toBeVisible();
      await expect(
        canvas.getByRole("checkbox", {
          name: "Confirm that MERGEFIELD Fee_Schedule_Ref needs a field chosen for it",
        }),
      ).toBeVisible();
    });

    await step("Confirming a row records it", async () => {
      const row = canvas.getByRole("checkbox", {
        name: "Use Client name for MERGEFIELD Client_Name",
      });
      await expect(row).toHaveAttribute("data-state", "unchecked");
      await userEvent.click(row);
      await waitFor(() => expect(row).toHaveAttribute("data-state", "checked"));
    });
  }}
>
  {#snippet template(args: ReviewStoryArgs)}
    <div class="max-w-2xl">
      <MergeFieldReviewList {...args} {items} onToggle={recordConfirmation} />
    </div>
  {/snippet}
</Story>

<!-- Nothing to review is a real state, and it says so rather than rendering an empty box. -->
<Story
  name="Nothing to review"
  play={async ({ canvas, step }) => {
    await step("Says so in words", async () => {
      await expect(
        canvas.getByText("No placeholders needing review were found in this document."),
      ).toBeVisible();
    });
  }}
>
  {#snippet template(args: ReviewStoryArgs)}
    <div class="max-w-2xl">
      <MergeFieldReviewList {...args} items={[]} />
    </div>
  {/snippet}
</Story>
