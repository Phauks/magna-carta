<script module lang="ts">
  /*
   * Combobox — Tier 4 (Bits UI), the composition-heavy peak: an editable Input (role="combobox")
   * filtering a floating listbox, with the option rows VIRTUALIZED via the internal VirtualList so the
   * matter picker stays bounded at 10,000 rows. Filtering is consumer-controlled — the query comes
   * from the Input's `oninput` and a `$derived` narrows the list (bits' inputValue is non-bindable).
   * The dropdown reuses the Select listbox surface + option rows. Combobox holds a VALUE, so it is an
   * Input (catalog taxonomy). svelte-csf v5.
   */
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import type { ComponentProps } from "svelte";
  import { expect, userEvent, waitFor, within } from "storybook/test";
  import * as Combobox from "../lib/components/combobox/index.ts";
  import VirtualList from "../lib/internal/virtual-list.svelte";
  import ComboboxRoot from "../lib/components/combobox/combobox-root.svelte";

  const { Story } = defineMeta({
    title: "Inputs/Combobox",
    component: ComboboxRoot,
    args: { type: "single" },
    parameters: {
      controls: { include: ["disabled"] },
      // The virtualized listbox scrolls but is driven by the input's aria-activedescendant (arrow
      // keys scroll the active option into view), so it needs no tabbable content of its own. axe's
      // scrollable-region-focusable can't model that and reports a false positive — disabled here.
      a11y: { config: { rules: [{ id: "scrollable-region-focusable", enabled: false }] } },
    },
  });

  type ComboboxStoryArgs = ComponentProps<typeof ComboboxRoot>;

  // 10,000 matters — the scale the virtualization exists for.
  const MATTERS = Array.from({ length: 10000 }, (_, index) => {
    const id = String(index + 1).padStart(5, "0");
    return { value: `matter-${id}`, label: `Matter ${id}` };
  });
</script>

<script lang="ts">
  let query = $state("");
  const filtered = $derived(
    query.trim() === ""
      ? MATTERS
      : MATTERS.filter((matter) => matter.label.toLowerCase().includes(query.trim().toLowerCase())),
  );
</script>

<Story
  name="Matter picker"
  play={async ({ canvas, step }) => {
    const input = canvas.getByRole("combobox", { name: "Matter" });
    const trigger = canvas.getByRole("button", { name: "Toggle options" });
    const body = within(document.body);

    await step("Opening renders a virtualized window, not all 10,000 rows", async () => {
      await userEvent.click(trigger);
      await body.findByRole("listbox");
      await waitFor(() => expect(body.getAllByRole("option").length).toBeGreaterThan(0));
      // Virtualized: only the visible window (plus buffer) is in the DOM.
      expect(body.getAllByRole("option").length).toBeLessThan(100);
    });

    await step("ArrowDown highlights an option (keyboard works with virtualization)", async () => {
      await userEvent.keyboard("{ArrowDown}");
      await waitFor(() =>
        expect(body.getAllByRole("option").some((o) => o.hasAttribute("data-highlighted"))).toBe(
          true,
        ),
      );
    });

    await step("Typing filters to a single deep match — still virtualized", async () => {
      await userEvent.type(input, "00042");
      await waitFor(() => expect(body.getByRole("option", { name: "Matter 00042" })).toBeVisible());
      expect(body.getAllByRole("option").length).toBeLessThan(100);
    });

    await step("Selecting a matter records it and closes", async () => {
      await userEvent.click(body.getByRole("option", { name: "Matter 00042" }));
      await waitFor(() => expect(body.queryByRole("listbox")).toBeNull());
      await expect(input).toHaveValue("Matter 00042");
    });
  }}
>
  {#snippet template(args: ComboboxStoryArgs)}
    <div class="max-w-sm">
      <Combobox.Root {...args} items={MATTERS}>
        <Combobox.Input
          placeholder="Search matters…"
          aria-label="Matter"
          oninput={(event) => (query = event.currentTarget.value)}
        />
        <Combobox.Content>
          <VirtualList
            items={filtered}
            getKey={(matter) => matter.value}
            itemSize={36}
            style="height: var(--bits-floating-available-height, 18rem)"
          >
            {#snippet item(matter)}
              <Combobox.Item value={matter.value} label={matter.label} />
            {/snippet}
          </VirtualList>
        </Combobox.Content>
      </Combobox.Root>
    </div>
  {/snippet}
</Story>
