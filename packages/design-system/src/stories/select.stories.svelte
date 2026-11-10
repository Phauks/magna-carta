<script module lang="ts">
  /*
   * Select — Tier 4 (Bits UI), composition-heavy: a form control whose listbox floats from the
   * trigger. Bits owns the portal, Floating UI positioning, the two-level wrapper, full keyboard
   * interaction (open, roving highlight via aria-activedescendant, typeahead, Escape), outside-click
   * dismissal, focus return, the hidden form input, and the scroll buttons when the list overflows.
   * Styling is ours (the mc-select-* recipes + the floating presence). Select holds a VALUE, so it is
   * an Input (catalog taxonomy). `type` ("single" | "multiple") is the variant axis — one story each;
   * the long list shows keyboard open + typeahead + scroll over 26 options. `value`/`open` are
   * Bits-owned at mount, so they are initial state, not controls; `disabled` is the one live control.
   *
   * Root takes an `items` (value/label) list: Bits unmounts the Item components when the listbox
   * closes, so the trigger's Value (and typeahead/autofill) reads the label from `items`, not the
   * unmounted rows — without it the trigger falls back to the raw value after closing. svelte-csf v5.
   *
   * Two things to know before reaching for this on a product screen. The dropdown a screen uses is
   * the Combobox — every place somebody chooses from a set, they can type to narrow it — and Select
   * is the primitive underneath it: these option rows ARE the Combobox's rows, so a change to how a
   * row looks changes both. And the Value's ghost text is the FIELD'S NAME ("Matter", "Tags"), never
   * an instruction to choose one: it disappears the moment there is a selection, which is the moment
   * an instruction would still have been useful.
   */
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import type { ComponentProps } from "svelte";
  import { expect, userEvent, waitFor, within } from "storybook/test";
  import * as Select from "../lib/components/select/index.ts";
  import SelectRoot from "../lib/components/select/select-root.svelte";

  const { Story } = defineMeta({
    title: "Inputs/Select",
    component: SelectRoot,
    args: { type: "single", disabled: false },
    parameters: {
      controls: { include: ["disabled"] },
    },
  });

  type SelectStoryArgs = ComponentProps<typeof SelectRoot>;

  const MATTERS = [
    { value: "acme-merger", label: "Acme merger" },
    { value: "briar-estate", label: "Briar estate" },
    { value: "crest-dispute", label: "Crest dispute", disabled: true },
    { value: "dunn-probate", label: "Dunn probate" },
  ];

  const TAGS = [
    { value: "urgent", label: "Urgent" },
    { value: "billable", label: "Billable" },
    { value: "pro-bono", label: "Pro bono" },
  ];

  // NATO phonetic alphabet — 26 options to exercise typeahead and the overflow scroll buttons.
  const PHONETIC = [
    "Alpha", "Bravo", "Charlie", "Delta", "Echo", "Foxtrot", "Golf", "Hotel", "India", "Juliett",
    "Kilo", "Lima", "Mike", "November", "Oscar", "Papa", "Quebec", "Romeo", "Sierra", "Tango",
    "Uniform", "Victor", "Whiskey", "Xray", "Yankee", "Zulu",
  ];
  const PHONETIC_ITEMS = PHONETIC.map((word) => ({ value: word.toLowerCase(), label: word }));

  // Options longer than their control: the listbox grows toward the start from the control's end
  // edge, never past it. And options longer than the screen: the listbox is capped to the room the
  // screen has, and the rows wrap.
  const WIDE = [
    "Correspondence with opposing counsel regarding the amended scheduling order",
    "Discovery responses and objections served on the second defendant",
    "Memorandum of law in support of the motion for summary judgment",
  ];
  const WIDE_ITEMS = WIDE.map((label) => ({ value: label, label }));
  const OVERLONG = [
    Array.from(
      { length: 6 },
      () => "A label long enough to run past the edge of any screen it is opened on,",
    ).join(" "),
    "A short one",
  ];
  const OVERLONG_ITEMS = OVERLONG.map((label) => ({ value: label, label }));
</script>

<!-- Single select: grouped matters, a placeholder, one disabled option, and a form name. -->
<Story
  name="Single"
  args={{ name: "matter" }}
  play={async ({ canvas, canvasElement, step }) => {
    const trigger = canvas.getByRole("combobox", { name: "Matter" });
    const body = within(document.body);

    await step("Shows the placeholder until a selection is made", async () => {
      await expect(trigger).toHaveAttribute("data-placeholder");
      await expect(trigger).toHaveTextContent("Matter");
    });

    await step("Clicking the trigger opens the listbox, portaled and visible", async () => {
      await userEvent.click(trigger);
      const listbox = await body.findByRole("listbox");
      // The panel scale-fades in (mc-presence-scale-fade), so poll until the entrance settles.
      await waitFor(() => expect(listbox).toBeVisible());
    });

    await step("A disabled option is not selectable", async () => {
      await expect(body.getByRole("option", { name: "Crest dispute" })).toHaveAttribute(
        "data-disabled",
      );
    });

    await step("Selecting an option sets the value, updates the trigger, and closes", async () => {
      await userEvent.click(body.getByRole("option", { name: "Briar estate" }));
      await waitFor(() => expect(body.queryByRole("listbox")).toBeNull());
      await expect(trigger).toHaveTextContent("Briar estate");
      await expect(trigger).not.toHaveAttribute("data-placeholder");
    });

    await step("The selection submits as a form value via the hidden input", async () => {
      const hidden = canvasElement.querySelector('input[name="matter"]');
      await expect(hidden).toHaveValue("briar-estate");
    });

    await step("Reopening marks the selected option", async () => {
      // Bits leaves a brief pointer-events guard on the body after a close — wait for it to clear.
      await waitFor(() => expect(document.body).not.toHaveStyle({ pointerEvents: "none" }));
      await userEvent.click(trigger);
      await body.findByRole("listbox");
      await expect(body.getByRole("option", { name: "Briar estate" })).toHaveAttribute(
        "aria-selected",
        "true",
      );
    });

    await step("Re-clicking the selected option deselects it and closes, back to empty", async () => {
      // allowDeselect (on by default) returns a single select to the placeholder; like picking a new
      // value, deselecting also closes the listbox so every single-select pick behaves the same.
      await userEvent.click(body.getByRole("option", { name: "Briar estate" }));
      await waitFor(() => expect(body.queryByRole("listbox")).toBeNull());
      await expect(trigger).toHaveAttribute("data-placeholder");
      await expect(trigger).toHaveTextContent("Matter");
      await expect(canvasElement.querySelector('input[name="matter"]')).toHaveValue("");
    });

    await step("Escape closes the listbox and returns focus to the trigger", async () => {
      await waitFor(() => expect(document.body).not.toHaveStyle({ pointerEvents: "none" }));
      await userEvent.click(trigger);
      await body.findByRole("listbox");
      await userEvent.keyboard("{Escape}");
      await waitFor(() => expect(body.queryByRole("listbox")).toBeNull());
      await expect(trigger).toHaveFocus();
    });
  }}
>
  {#snippet template(args: SelectStoryArgs)}
    <Select.Root {...args} items={MATTERS}>
      <Select.Trigger class="max-w-sm" aria-label="Matter">
        <Select.Value placeholder="Matter" />
      </Select.Trigger>
      <Select.Content>
        <Select.Group>
          <Select.GroupHeading>Active</Select.GroupHeading>
          <Select.Item value="acme-merger" label="Acme merger" />
          <Select.Item value="briar-estate" label="Briar estate" />
          <Select.Item value="crest-dispute" label="Crest dispute" disabled />
        </Select.Group>
        <Select.Group>
          <Select.GroupHeading>Closed</Select.GroupHeading>
          <Select.Item value="dunn-probate" label="Dunn probate" />
        </Select.Group>
      </Select.Content>
    </Select.Root>
  {/snippet}
</Story>

<!-- Multiple select: choosing several keeps the listbox open; the trigger joins the labels. -->
<Story
  name="Multiple"
  args={{ type: "multiple" }}
  play={async ({ canvas, step }) => {
    const trigger = canvas.getByRole("combobox", { name: "Tags" });
    const body = within(document.body);

    await step("Opens the listbox", async () => {
      await userEvent.click(trigger);
      await body.findByRole("listbox");
    });

    await step("Picking out of order keeps the listbox open and marks both", async () => {
      // Pick Billable before Urgent — the reverse of their order in the list.
      await userEvent.click(body.getByRole("option", { name: "Billable" }));
      await waitFor(() =>
        expect(body.getByRole("option", { name: "Billable" })).toHaveAttribute(
          "aria-selected",
          "true",
        ),
      );
      // type="multiple" does not close on select — the listbox stays mounted for the next pick.
      await expect(body.queryByRole("listbox")).not.toBeNull();
      await userEvent.click(body.getByRole("option", { name: "Urgent" }));
      await waitFor(() =>
        expect(body.getByRole("option", { name: "Urgent" })).toHaveAttribute(
          "aria-selected",
          "true",
        ),
      );
    });

    await step("Closing, the trigger joins the labels in list order, not pick order", async () => {
      await userEvent.keyboard("{Escape}");
      await waitFor(() => expect(body.queryByRole("listbox")).toBeNull());
      // Urgent precedes Billable in the list, so it reads "Urgent, Billable" despite the pick order.
      await expect(trigger).toHaveTextContent("Urgent, Billable");
    });
  }}
>
  {#snippet template(args: SelectStoryArgs)}
    <Select.Root {...args} items={TAGS}>
      <Select.Trigger class="max-w-sm" aria-label="Tags">
        <Select.Value placeholder="Tags" />
      </Select.Trigger>
      <Select.Content>
        <Select.Item value="urgent" label="Urgent" />
        <Select.Item value="billable" label="Billable" />
        <Select.Item value="pro-bono" label="Pro bono" />
      </Select.Content>
    </Select.Root>
  {/snippet}
</Story>

<!-- Long list: 26 options exercise keyboard open, typeahead, and the overflow scroll buttons. -->
<Story
  name="Long list"
  play={async ({ canvas, step }) => {
    const trigger = canvas.getByRole("combobox", { name: "Code word" });
    const body = within(document.body);

    await step("Opens from the keyboard", async () => {
      trigger.focus();
      await userEvent.keyboard("{ArrowDown}");
      await body.findByRole("listbox");
    });

    await step("Opens end-aligned to the trigger, its end edge on the trigger's", async () => {
      // The component's default, written nowhere in this story: a listbox aligns to the end of the
      // control that opens it and never extends past that edge.
      const listbox = body.getByRole("listbox");
      await expect(listbox).toHaveAttribute("data-align", "end");
      // The panel scale-fades in, so poll until its box has settled where Bits placed it.
      await waitFor(() => {
        const panel = listbox.getBoundingClientRect();
        const control = trigger.getBoundingClientRect();
        expect(Math.abs(panel.right - control.right)).toBeLessThanOrEqual(1);
        expect(panel.width).toBeGreaterThanOrEqual(control.width - 1);
      });
    });

    await step("Typeahead jumps to a far matching option", async () => {
      await userEvent.keyboard("z");
      await waitFor(() =>
        expect(body.getByRole("option", { name: "Zulu" })).toHaveAttribute("data-highlighted"),
      );
    });

    await step("Enter selects the highlighted option and closes", async () => {
      await userEvent.keyboard("{Enter}");
      await waitFor(() => expect(body.queryByRole("listbox")).toBeNull());
      await expect(trigger).toHaveTextContent("Zulu");
    });
  }}
>
  {#snippet template(args: SelectStoryArgs)}
    <!-- Stood off the viewport edge as a control is in the app's canvas: flush against the edge,
         Bits would hold the listbox the collision padding in, and the alignment step measures
         the panel's edge against the trigger's. -->
    <div class="p-24">
      <Select.Root {...args} items={PHONETIC_ITEMS}>
        <Select.Trigger class="max-w-sm" aria-label="Code word">
          <Select.Value placeholder="Code word" />
        </Select.Trigger>
        <Select.Content>
          {#each PHONETIC as word (word)}
            <Select.Item value={word.toLowerCase()} label={word} />
          {/each}
        </Select.Content>
      </Select.Root>
    </div>
  {/snippet}
</Story>

<!--
  Behaviour: a disabled select does not open, and the listbox's width is the component's — it grows
  from the control's end edge toward the start and never past that edge, and a list wider than the
  screen is capped to the screen with its rows wrapped. The wide controls sit at the right of the
  canvas, where a control that opens a list usually is. Hidden from the catalog, run by the test
  addon.
-->
<Story
  name="Behaviour"
  tags={["!dev", "!autodocs"]}
  play={async ({ canvas, step }) => {
    const body = within(document.body);

    await step("A disabled select does not open", async () => {
      const trigger = canvas.getByRole("combobox", { name: "Disabled select" });
      await expect(trigger).toHaveAttribute("data-disabled");
      await userEvent.click(trigger, { pointerEventsCheck: 0 });
      await expect(body.queryByRole("listbox")).toBeNull();
    });

    await step("Long options grow the listbox toward the start of the control, never past its end", async () => {
      const trigger = canvas.getByRole("combobox", { name: "Wide options" });
      await userEvent.click(trigger);
      const listbox = await body.findByRole("listbox");
      await waitFor(() => {
        const panel = listbox.getBoundingClientRect();
        const control = trigger.getBoundingClientRect();
        expect(panel.width).toBeGreaterThan(control.width);
        expect(panel.right).toBeLessThanOrEqual(control.right + 1);
        expect(panel.left).toBeGreaterThanOrEqual(0);
      });
      await userEvent.keyboard("{Escape}");
      await waitFor(() => expect(body.queryByRole("listbox")).toBeNull());
    });

    await step("Options wider than the screen are capped to it, and their rows wrap", async () => {
      await waitFor(() => expect(document.body).not.toHaveStyle({ pointerEvents: "none" }));
      const trigger = canvas.getByRole("combobox", { name: "Overlong options" });
      await userEvent.click(trigger);
      const listbox = await body.findByRole("listbox");
      await waitFor(() => {
        const panel = listbox.getBoundingClientRect();
        expect(panel.left).toBeGreaterThanOrEqual(0);
        expect(panel.right).toBeLessThanOrEqual(window.innerWidth);
      });
      const [overlong, short] = body.getAllByRole("option");
      expect(overlong).toBeDefined();
      expect(short).toBeDefined();
      // A wrapped row stands taller than a one-line row.
      expect((overlong as HTMLElement).getBoundingClientRect().height).toBeGreaterThan(
        (short as HTMLElement).getBoundingClientRect().height * 1.5,
      );
      await userEvent.keyboard("{Escape}");
      await waitFor(() => expect(body.queryByRole("listbox")).toBeNull());
    });
  }}
>
  {#snippet template()}
    <!-- Padded like the app's canvas, so no control is flush against the viewport edge; the wide
         triggers shed the trigger's baked full width so the listbox has a narrower control to
         grow past. -->
    <div class="flex flex-col gap-16 p-24">
      <Select.Root type="single" disabled>
        <Select.Trigger class="max-w-sm" aria-label="Disabled select">
          <Select.Value placeholder="Unavailable" />
        </Select.Trigger>
        <Select.Content>
          <Select.Item value="x" label="Unavailable option" />
        </Select.Content>
      </Select.Root>
      <div class="flex justify-end">
        <Select.Root type="single" items={WIDE_ITEMS}>
          <Select.Trigger class="w-auto" aria-label="Wide options">
            <Select.Value placeholder="Wide options" />
          </Select.Trigger>
          <Select.Content>
            {#each WIDE as label (label)}
              <Select.Item value={label} {label} />
            {/each}
          </Select.Content>
        </Select.Root>
      </div>
      <div class="flex justify-end">
        <Select.Root type="single" items={OVERLONG_ITEMS}>
          <Select.Trigger class="w-auto" aria-label="Overlong options">
            <Select.Value placeholder="Overlong options" />
          </Select.Trigger>
          <Select.Content>
            {#each OVERLONG as label (label)}
              <Select.Item value={label} {label} />
            {/each}
          </Select.Content>
        </Select.Root>
      </div>
    </div>
  {/snippet}
</Story>
