<script module lang="ts">
  /*
   * MergeFieldPicker — Tier 4 (Bits UI, via Popover + Command). A grouped, searchable picker over
   * the firm's merge fields: rows lead with the human label, group under their source, and carry
   * the value type. Search matches the label, the key, the group, and the description, and EVERY
   * typed term must match, so a second word narrows.
   *
   * The picker holds a value (the chosen field's key), so it is an Input in the catalog taxonomy —
   * a composed one, hence Compound Inputs. svelte-csf v5.
   */
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import type { ComponentProps } from "svelte";
  import { expect, userEvent, waitFor, within } from "storybook/test";
  import MergeFieldPicker from "../lib/components/merge-field-picker/merge-field-picker.svelte";
  import type { MergeFieldPickerOption } from "../lib/components/merge-field-picker/types.ts";

  const { Story } = defineMeta({
    title: "Compound Inputs/MergeFieldPicker",
    component: MergeFieldPicker,
    parameters: {
      controls: { include: ["placeholder", "searchPlaceholder", "emptyMessage", "disabled", "invalid"] },
      // The results list scrolls but is driven by the search input's aria-activedescendant (arrow
      // keys move the highlight and scroll it into view), so it needs no tabbable content of its
      // own. axe's scrollable-region-focusable cannot model that and reports a false positive.
      a11y: { config: { rules: [{ id: "scrollable-region-focusable", enabled: false }] } },
    },
  });

  type PickerStoryArgs = ComponentProps<typeof MergeFieldPicker>;

  /*
   * A slice of a firm's catalog, shaped into the picker's structural option type — the adaptation a
   * real consumer writes once (see apps/web/src/lib/document-assembly/picker-options.ts).
   */
  const OPTIONS: readonly MergeFieldPickerOption[] = [
    {
      key: "matter.number",
      label: "Matter number",
      group: "matter",
      groupLabel: "Matter",
      valueTypeLabel: "Text",
      description: "The firm's identifying number for the matter.",
      status: "automatic",
    },
    {
      key: "matter.openedOn",
      label: "Date opened",
      group: "matter",
      groupLabel: "Matter",
      valueTypeLabel: "Date",
      description: "The date the firm opened the matter.",
      status: "automatic",
    },
    {
      key: "matter.retainerAmount",
      label: "Retainer amount",
      group: "matter",
      groupLabel: "Matter",
      valueTypeLabel: "Money",
      description: "The retainer the engagement calls for.",
      status: "manual",
    },
    {
      key: "client.displayName",
      label: "Client name",
      group: "parties",
      groupLabel: "Parties",
      valueTypeLabel: "Text",
      description: "The client's name as it should appear in a document.",
      status: "automatic",
    },
    {
      key: "client.mailingAddress",
      label: "Client mailing address",
      group: "parties",
      groupLabel: "Parties",
      valueTypeLabel: "Address",
      description: "The client's mailing address as a formatted block.",
      status: "automatic",
    },
    {
      key: "client.taxIdentifier",
      label: "Client tax identifier",
      group: "parties",
      groupLabel: "Parties",
      valueTypeLabel: "Text",
      description: "Protected: requires permission to view sensitive identifiers.",
      status: "unavailable",
      disabled: true,
    },
    {
      key: "firm.name",
      label: "Firm name",
      group: "firm",
      groupLabel: "Firm",
      valueTypeLabel: "Text",
      description: "The firm's legal name.",
      status: "automatic",
    },
    {
      key: "location.addressBlock",
      label: "Office address block",
      group: "location",
      groupLabel: "Location",
      valueTypeLabel: "Address",
      description: "The matter's home office address, formatted for a letterhead.",
      status: "automatic",
    },
  ];
</script>

<Story
  name="Merge field picker"
  play={async ({ canvas, step }) => {
    const trigger = canvas.getByRole("combobox", { name: "Merge field" });
    const body = within(document.body);

    await step("Opening shows the fields grouped by where their values come from", async () => {
      await userEvent.click(trigger);
      await waitFor(() => expect(body.getByRole("option", { name: /Matter number/ })).toBeVisible());
      await expect(body.getByText("Parties")).toBeVisible();
      await expect(body.getByText("Location")).toBeVisible();
    });

    const search = body.getByRole("combobox", { name: "Search merge fields" });

    await step("Searching matches the human label, not just the key", async () => {
      await userEvent.type(search, "mailing");
      await waitFor(() =>
        expect(body.queryByRole("option", { name: /Matter number/ })).toBeNull(),
      );
      await expect(body.getByRole("option", { name: /Client mailing address/ })).toBeVisible();
    });

    await step("A second term narrows rather than widening", async () => {
      await userEvent.clear(search);
      await userEvent.type(search, "client name");
      await waitFor(() =>
        expect(body.queryByRole("option", { name: /Client mailing address/ })).toBeNull(),
      );
      await expect(body.getByRole("option", { name: /Client name/ })).toBeVisible();
    });

    await step("Choosing a field commits it and closes the panel", async () => {
      await userEvent.click(body.getByRole("option", { name: /Client name/ }));
      await waitFor(() => expect(body.queryByRole("listbox")).toBeNull());
      // The trigger's accessible name stays the field's label ("Merge field") — the caller's, so it
      // does not change under the user. The SELECTION is what the trigger's text shows.
      await expect(trigger).toHaveTextContent("Client name");
    });
  }}
>
  {#snippet template(args: PickerStoryArgs)}
    <div class="max-w-sm">
      <MergeFieldPicker {...args} options={OPTIONS} aria-label="Merge field" />
    </div>
  {/snippet}
</Story>

<!-- Behaviour: the validation and disabled states, and the no-results message. Hidden; still tested. -->
<Story
  name="Behaviour"
  tags={["!dev", "!autodocs"]}
  play={async ({ canvas, step }) => {
    const body = within(document.body);

    await step("An invalid picker announces itself to assistive technology", async () => {
      const invalid = canvas.getByRole("combobox", { name: "Unresolved field" });
      await expect(invalid).toHaveAttribute("aria-invalid", "true");
    });

    await step("A disabled picker cannot be opened", async () => {
      const off = canvas.getByRole("combobox", { name: "Locked field" });
      await expect(off).toBeDisabled();
    });

    await step("A query matching nothing says so, then a real query brings the list back", async () => {
      await userEvent.click(canvas.getByRole("combobox", { name: "Unresolved field" }));
      const search = body.getByRole("combobox", { name: "Search merge fields" });
      await userEvent.type(search, "zzzzzz");
      await expect(await body.findByText("No merge field matches that search.")).toBeVisible();
      await userEvent.clear(search);
      await userEvent.type(search, "firm");
      await waitFor(() => expect(body.getByRole("option", { name: /Firm name/ })).toBeVisible());
      // Leave the panel closed: an open listbox with rows is fine, an empty one is not.
      await userEvent.keyboard("{Escape}");
      await waitFor(() => expect(body.queryByRole("listbox")).toBeNull());
    });
  }}
>
  {#snippet template()}
    <div class="flex max-w-sm flex-col gap-16">
      <MergeFieldPicker options={OPTIONS} invalid aria-label="Unresolved field" />
      <MergeFieldPicker options={OPTIONS} disabled aria-label="Locked field" />
    </div>
  {/snippet}
</Story>
