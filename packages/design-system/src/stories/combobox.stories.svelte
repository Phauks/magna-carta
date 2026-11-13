<script module lang="ts">
  /*
   * Combobox — Tier 4 (Bits UI), the composition-heavy peak, and the product's ONE dropdown: anywhere
   * a person chooses from a set, they can type to narrow it. An editable Input (role="combobox")
   * filters a floating listbox; the option rows are the Select rows (bits builds both listboxes out of
   * the same parts). Filtering is consumer-controlled — the query comes from the Input's `oninput` and
   * a `$derived` narrows the list (bits' inputValue is non-bindable) — which is also what lets a very
   * long list virtualize. Combobox holds a VALUE, so it is an Input (catalog taxonomy). svelte-csf v5.
   *
   * Three things this component is careful about, each of them a correction already issued once:
   *
   *   - The ghost text is the FIELD'S NAME. "Matter", "Document Type" — never a description of the
   *     field and never an instruction about how to type in it.
   *   - A row in the list carries NO RING, focus or selection: the highlight is fill alone, and the
   *     pointer path and the keyboard path produce the same fill. The reasoning is written beside the
   *     row's recipe; the "Firm vocabulary" story measures it in both paths.
   *   - A vocabulary the firm owns can be added to from inside the list that failed to offer the
   *     value, rather than sending somebody to a settings screen mid-sentence.
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
      // The listbox scrolls but is driven by the input's aria-activedescendant (arrow keys scroll the
      // active option into view), so it needs no tabbable content of its own. axe's
      // scrollable-region-focusable cannot model that and reports a false positive — disabled here.
      a11y: { config: { rules: [{ id: "scrollable-region-focusable", enabled: false }] } },
    },
  });

  type ComboboxStoryArgs = ComponentProps<typeof ComboboxRoot>;

  // 10,000 matters — the scale the virtualization exists for.
  const MATTERS = Array.from({ length: 10000 }, (_, index) => {
    const id = String(index + 1).padStart(5, "0");
    return { value: `matter-${id}`, label: `Matter ${id}` };
  });

  /** Waits for the row bits currently considers active, whichever path put it there. */
  async function highlightedRow(body: ReturnType<typeof within>): Promise<HTMLElement> {
    return waitFor(() => {
      const active = body
        .getAllByRole("option")
        .find((row: HTMLElement) => row.hasAttribute("data-highlighted"));
      expect(active).toBeDefined();
      return active as HTMLElement;
    });
  }

  /** What a row draws around itself, which for a listbox row must be nothing at all. */
  function ringOf(row: HTMLElement): { outlineStyle: string; boxShadow: string } {
    const style = getComputedStyle(row);
    return { outlineStyle: style.outlineStyle, boxShadow: style.boxShadow };
  }

  /** Leaves the page clickable for the next story: an open panel keeps the body pointer-inert. */
  async function closeListbox(body: ReturnType<typeof within>): Promise<void> {
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(body.queryByRole("listbox")).toBeNull());
    await waitFor(() => expect(document.body).not.toHaveStyle({ pointerEvents: "none" }));
  }
</script>

<script lang="ts">
  // Data-safe single combobox: the consumer owns the input text so it can be reset to the committed
  // selection. The value MUST be one of the options — so on close the input snaps back to the selected
  // label (or empty), never keeping typed-but-unchosen text.
  let matterQuery = $state("");
  let matterValue = $state("");
  const matterLabel = $derived(MATTERS.find((matter) => matter.value === matterValue)?.label ?? "");
  const matchingMatters = $derived(
    matterQuery.trim() === ""
      ? MATTERS
      : MATTERS.filter((matter) =>
          matter.label.toLowerCase().includes(matterQuery.trim().toLowerCase()),
        ),
  );

  function pickMatter(value: string | string[]): void {
    const next = Array.isArray(value) ? (value[0] ?? "") : value;
    matterValue = next;
    matterQuery = MATTERS.find((matter) => matter.value === next)?.label ?? "";
  }

  // The firm's own document types: a vocabulary that is never finished, so the list it is chosen from
  // is also where a missing one is added.
  let documentTypes = $state(["Contract", "Correspondence", "Pleading", "Invoice"]);
  let typeQuery = $state("");
  let typeValue = $state("");
  const matchingTypes = $derived(
    typeQuery.trim() === ""
      ? documentTypes
      : documentTypes.filter((type) =>
          type.toLowerCase().includes(typeQuery.trim().toLowerCase()),
        ),
  );
  // Nothing typed still offers the row (it reads "Add document type"); an exact match does not, since
  // there is nothing left to add.
  const offersAdd = $derived(
    !documentTypes.some((type) => type.toLowerCase() === typeQuery.trim().toLowerCase()),
  );

  // This picker is CONTROLLED, unlike the other two: the add row reports a reserved value, and the
  // handler replaces it with the entry it just created, so the list has to take the corrected value
  // back rather than keeping the reserved one and showing nothing as chosen. (The `as never` at the
  // call site is there because bits' value is a discriminated union — a string for a single picker,
  // an array for a multiple one — that no wrapper can statically narrow.)
  function pickType(value: string | string[]): void {
    const picked = Array.isArray(value) ? (value[0] ?? "") : value;
    if (Combobox.isAddOption(picked)) {
      const added = typeQuery.trim();
      if (added === "") return;
      if (!documentTypes.includes(added)) documentTypes = [...documentTypes, added];
      typeValue = added;
      typeQuery = added;
      return;
    }
    typeValue = picked;
    typeQuery = picked;
  }

  // The listbox anchors to whatever opened it. Here that is the row, not the field inside it, so the
  // choices arrive beside the row as a flyout rather than under the field.
  let openerElement = $state<HTMLElement | null>(null);
  let folderQuery = $state("");
  let folderValue = $state("");
  const FOLDERS = ["Correspondence", "Discovery", "Pleadings", "Research"];
  const matchingFolders = $derived(
    folderQuery.trim() === ""
      ? FOLDERS
      : FOLDERS.filter((folder) =>
          folder.toLowerCase().includes(folderQuery.trim().toLowerCase()),
        ),
  );

  function pickFolder(value: string | string[]): void {
    const picked = Array.isArray(value) ? (value[0] ?? "") : value;
    folderValue = picked;
    folderQuery = picked;
  }
</script>

<!-- The scale case: 10,000 matters, virtualized, so the caller owns the scroller. -->
<Story
  name="Matter picker"
  play={async ({ canvas, step }) => {
    const input = canvas.getByRole("combobox", { name: "Matter" });
    const trigger = canvas.getByRole("button", { name: "Toggle options" });
    const body = within(document.body);

    await step("The ghost text is the field's name, not an instruction", async () => {
      await expect(input).toHaveAttribute("placeholder", "Matter");
    });

    await step("Clicking the text box itself opens the list, and typing still works", async () => {
      await userEvent.click(input);
      await body.findByRole("listbox");
      await expect(input).toHaveFocus();
      await expect(input).toHaveAttribute("aria-expanded", "true");
      await userEvent.keyboard("{Escape}");
      await waitFor(() => expect(body.queryByRole("listbox")).toBeNull());
      await waitFor(() => expect(document.body).not.toHaveStyle({ pointerEvents: "none" }));
    });

    await step("Opening renders a virtualized window, not all 10,000 rows", async () => {
      await userEvent.click(trigger);
      await body.findByRole("listbox");
      await waitFor(() => expect(body.getAllByRole("option").length).toBeGreaterThan(0));
      // Virtualized: only the visible window (plus buffer) is in the DOM.
      expect(body.getAllByRole("option").length).toBeLessThan(100);
    });

    await step("ArrowDown highlights an option (keyboard works with virtualization)", async () => {
      await userEvent.keyboard("{ArrowDown}");
      await highlightedRow(body);
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

    await step("Typing a non-match then closing snaps back to the selection", async () => {
      await waitFor(() => expect(document.body).not.toHaveStyle({ pointerEvents: "none" }));
      await userEvent.click(trigger);
      await body.findByRole("listbox");
      await userEvent.clear(input);
      await userEvent.type(input, "zzzzz");
      await expect(input).toHaveValue("zzzzz");
      // Dismiss without choosing — the input must not keep text that is not a value.
      await userEvent.click(document.body);
      await waitFor(() => expect(body.queryByRole("listbox")).toBeNull());
      await expect(input).toHaveValue("Matter 00042");
      await waitFor(() => expect(document.body).not.toHaveStyle({ pointerEvents: "none" }));
    });
  }}
>
  {#snippet template(args: ComboboxStoryArgs)}
    <div class="max-w-sm">
      <Combobox.Root
        {...args}
        items={MATTERS}
        inputValue={matterQuery}
        onValueChange={pickMatter}
        onOpenChange={(open) => {
          // Closing settles the text on the truth: the selected label, or empty.
          if (!open) matterQuery = matterLabel;
        }}
      >
        <Combobox.Input
          fieldName="Matter"
          aria-label="Matter"
          oninput={(event) => (matterQuery = event.currentTarget.value)}
        />
        <Combobox.Content virtualized>
          <VirtualList
            items={matchingMatters}
            getKey={(matter) => matter.value}
            itemSize={36}
            style="max-height: min(var(--bits-floating-available-height, 18rem), 18rem)"
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

<!--
  A vocabulary the firm owns: filter and add. Also the story that measures the row highlight, because
  a plain list makes the two interaction paths easy to compare.
-->
<Story
  name="Firm vocabulary"
  play={async ({ canvas, step }) => {
    const input = canvas.getByRole("combobox", { name: "Document Type" });
    const trigger = canvas.getByRole("button", { name: "Toggle options" });
    const body = within(document.body);
    let fillFromPointer = "";

    await step("The ghost text is the field's name", async () => {
      await expect(input).toHaveAttribute("placeholder", "Document Type");
    });

    await step("Opening offers the firm's types and, last, the add row", async () => {
      await userEvent.click(trigger);
      const listbox = await body.findByRole("listbox");
      // The panel scale-fades in, so poll until the entrance settles before reading the rows.
      await waitFor(() => expect(listbox).toBeVisible());
      await expect(body.getByRole("option", { name: "Contract" })).toBeVisible();
      // Nothing typed yet, so the row names the field it will add to and waits, visible but muted,
      // rather than hiding until a keystroke nobody knew to make.
      const addRow = body.getByRole("option", { name: "Add document type" });
      await expect(addRow).toBeVisible();
      await expect(addRow).toHaveAttribute("data-disabled");
    });

    await step("The list opens end-aligned to the FIELD, its end edge on the field's", async () => {
      // The component's default, written nowhere here. Bits would anchor to the text box inside the
      // field; the list is anchored to the bordered field a person sees, so its edge sits on the
      // field's edge and not short of the chevron.
      const listbox = body.getByRole("listbox");
      await expect(listbox).toHaveAttribute("data-align", "end");
      const field = input.closest<HTMLElement>(".mc-combobox-input-wrapper");
      expect(field).not.toBeNull();
      await waitFor(() => {
        const panel = listbox.getBoundingClientRect();
        const box = (field as HTMLElement).getBoundingClientRect();
        expect(Math.abs(panel.right - box.right)).toBeLessThanOrEqual(1);
        expect(panel.width).toBeGreaterThanOrEqual(box.width - 1);
      });
    });

    await step("A row highlighted by the pointer draws no ring — fill alone", async () => {
      const row = body.getByRole("option", { name: "Correspondence" });
      const atRest = getComputedStyle(row).backgroundColor;
      await userEvent.hover(row);
      await waitFor(() => expect(row).toHaveAttribute("data-highlighted"));
      expect(ringOf(row)).toEqual({ outlineStyle: "none", boxShadow: "none" });
      // The fill is the whole signal, so it has to actually differ from a resting row.
      fillFromPointer = getComputedStyle(row).backgroundColor;
      expect(fillFromPointer).not.toEqual(atRest);
    });

    await step("The keyboard path draws no ring either, and uses the same fill", async () => {
      input.focus();
      await userEvent.keyboard("{ArrowDown}");
      const row = await highlightedRow(body);
      expect(ringOf(row)).toEqual({ outlineStyle: "none", boxShadow: "none" });
      expect(getComputedStyle(row).backgroundColor).toEqual(fillFromPointer);
    });

    await step("Typing a value the firm does not have leaves the add row naming it", async () => {
      await userEvent.clear(input);
      await userEvent.type(input, "Affidavit");
      await waitFor(() => expect(body.getByRole("option", { name: 'Add "Affidavit"' })).toBeVisible());
      // The vocabulary offered nothing, so the add row is the whole list rather than a dead end.
      await expect(body.getAllByRole("option")).toHaveLength(1);
    });

    await step("Choosing it adds the value and selects it, without leaving the field", async () => {
      await userEvent.click(body.getByRole("option", { name: 'Add "Affidavit"' }));
      await waitFor(() => expect(body.queryByRole("listbox")).toBeNull());
      await expect(input).toHaveValue("Affidavit");
      await waitFor(() => expect(document.body).not.toHaveStyle({ pointerEvents: "none" }));
    });

    await step("The added value is now an ordinary choice, and offers no second add", async () => {
      await userEvent.click(trigger);
      const listbox = await body.findByRole("listbox");
      await waitFor(() => expect(listbox).toBeVisible());
      await expect(body.getByRole("option", { name: "Affidavit" })).toBeVisible();
      await expect(body.queryByRole("option", { name: 'Add "Affidavit"' })).toBeNull();
      await closeListbox(body);
    });
  }}
>
  {#snippet template(args: ComboboxStoryArgs)}
    <!-- Stood off the viewport edge as a field is in the app's canvas: flush against the edge,
         Bits would hold the list the collision padding in, and the alignment step measures the
         list's edge against the field's. -->
    <div class="max-w-sm p-24">
      <Combobox.Root
        {...args}
        items={documentTypes.map((type) => ({ value: type, label: type }))}
        value={typeValue as never}
        inputValue={typeQuery}
        onValueChange={pickType}
        onOpenChange={(open) => {
          if (!open) typeQuery = typeValue;
        }}
      >
        <Combobox.Input
          fieldName="Document Type"
          aria-label="Document Type"
          oninput={(event) => (typeQuery = event.currentTarget.value)}
        />
        <Combobox.Content>
          {#each matchingTypes as type (type)}
            <Combobox.Item value={type} label={type} />
          {/each}
          {#if offersAdd}
            <Combobox.AddOption fieldName="Document Type" query={typeQuery} />
          {/if}
        </Combobox.Content>
      </Combobox.Root>
    </div>
  {/snippet}
</Story>

<!--
  Anchored, never modal. The panel positions itself against whatever opened it; passing that element
  as `customAnchor` with side/align is how a listbox opened from a menu arrives as a flyout beside its
  menu item instead of jumping to the middle of the screen.
-->
<Story
  name="Flyout beside its opener"
  play={async ({ canvas, step }) => {
    const trigger = canvas.getByRole("button", { name: "Toggle options" });
    const body = within(document.body);

    await step("Opening anchors the panel beside the opener, not under the field", async () => {
      await userEvent.click(trigger);
      const listbox = await body.findByRole("listbox");
      await waitFor(() => expect(listbox).toBeVisible());
      // Bits reports where it landed. The opener is deliberately narrow so there is room to its
      // inline-end; a flip would mean the story's layout changed, and this is where that shows up.
      await waitFor(() => expect(listbox).toHaveAttribute("data-side", "right"));
      await expect(listbox).toHaveAttribute("data-align", "start");
    });

    await step("It is a panel, not a dialog: nothing is trapped and nothing is dimmed", async () => {
      const listbox = body.getByRole("listbox");
      await expect(listbox).not.toHaveAttribute("aria-modal");
      expect(document.querySelector('[role="dialog"]')).toBeNull();
      expect(document.querySelector('[role="alertdialog"]')).toBeNull();
      await closeListbox(body);
    });
  }}
>
  {#snippet template(args: ComboboxStoryArgs)}
    <div bind:this={openerElement} class="flex max-w-sm items-center gap-8">
      <Combobox.Root
        {...args}
        items={FOLDERS.map((folder) => ({ value: folder, label: folder }))}
        inputValue={folderQuery}
        onValueChange={pickFolder}
        onOpenChange={(open) => {
          if (!open) folderQuery = folderValue;
        }}
      >
        <Combobox.Input
          fieldName="Destination Folder"
          aria-label="Destination Folder"
          oninput={(event) => (folderQuery = event.currentTarget.value)}
        />
        <Combobox.Content customAnchor={openerElement} side="right" align="start">
          {#each matchingFolders as folder (folder)}
            <Combobox.Item value={folder} label={folder} />
          {/each}
        </Combobox.Content>
      </Combobox.Root>
    </div>
  {/snippet}
</Story>
