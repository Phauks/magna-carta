<script module lang="ts">
  /*
   * RecordWindow — the two-pane window a record opens in, and the only one the product has. The
   * catalog shows it whole: the record on the left, context in tabs on the right, one action bar
   * beneath, and the four header controls in their one order (Edit, Print, expand, close).
   *
   * Six stories, because six things about it can be wrong independently: the plain window; editing
   * happening IN the window rather than somewhere else; an opening tab chosen by the caller; Edit
   * disabled carrying the reason it is disabled — the state that must never be an absent control;
   * and the two halves of the sizing rule, which is a claim about rendered geometry and so is
   * asserted as one. The shell is told nothing about what kind of record it is showing, so the
   * fixture is deliberately plain: it is a record, and that is the whole of what the window knows.
   *
   * The panel portals to the body, so every play function queries `within(document.body)` rather
   * than the story canvas (the Dialog story sets that pattern). Each story opens from its own
   * trigger and its own piece of state, so the Docs page shows six buttons rather than six modal
   * panels stacked on each other. Render is always an explicit named `template` snippet.
   */
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import type { ComponentProps } from "svelte";
  import { expect, userEvent, waitFor, within } from "storybook/test";
  import RecordWindow from "../lib/components/record-window/record-window.svelte";
  import Button from "../lib/components/button/index.ts";
  import Label from "../lib/components/label/index.ts";
  import Textarea from "../lib/components/textarea/index.ts";

  const { Story } = defineMeta({
    title: "Overlay/RecordWindow",
    component: RecordWindow,
    args: { heading: "Deposition preparation" },
    parameters: {
      // Bits' prop types materialize every HTML attribute as a control; whitelist the props that
      // actually change this showcase. Snippets and the three bindable flags are not controls.
      controls: {
        include: [
          "heading",
          "defaultTab",
          "editDisabledReason",
          "saveDisabledReason",
          "unsavedChanges",
        ],
      },
    },
  });

  type RecordWindowStoryArgs = ComponentProps<typeof RecordWindow>;

  /**
   * The geometry a sizing assertion reads off one element, in one call.
   *
   * Deliberately the LAYOUT box (`offsetHeight`/`offsetTop`) rather than the painted one
   * (`getBoundingClientRect`): the panel scale-fades in, and a rect read mid-entrance is the
   * animation's size, not the window's. These four are transform-immune, so a sizing claim can be
   * asserted the moment the panel exists instead of racing its presence.
   */
  function boxOf(element: HTMLElement): {
    height: number;
    top: number;
    scrollHeight: number;
    clientHeight: number;
  } {
    return {
      height: element.offsetHeight,
      top: element.offsetTop,
      scrollHeight: element.scrollHeight,
      clientHeight: element.clientHeight,
    };
  }

  /** One part of the window, found inside the panel under test rather than anywhere on the page. */
  function partOf(panel: HTMLElement, part: string): HTMLElement {
    const element = panel.querySelector<HTMLElement>(`.mc-record-window-${part}`);
    if (element === null) throw new Error(`the window is missing its ${part}`);
    return element;
  }

  /**
   * The header's close control. Found by its marker rather than by its name, because the action bar
   * of a record that is only being read carries a Close of its own and the two must not be confused
   * — they are different gestures with the same word on them.
   */
  function headerCloseOf(panel: HTMLElement): HTMLElement {
    const element = panel.querySelector<HTMLElement>('[data-record-window-action="close"]');
    if (element === null) throw new Error("the window is missing its close control");
    return element;
  }
</script>

<script lang="ts">
  // One flag per story, so opening one window leaves the other stories' triggers alone.
  const showing = $state({
    plain: false,
    editingInPlace: false,
    chosenTab: false,
    sidePanel: false,
    editRefused: false,
    fitting: false,
    overflowing: false,
  });
  let editing = $state(false);
  let savedCount = $state(0);
  let printedCount = $state(0);
  const draft = $state({ description: "Prepare the deposition outline and circulate it for review." });

  function closeEveryWindow(): void {
    showing.plain = false;
    showing.editingInPlace = false;
    showing.chosenTab = false;
    showing.sidePanel = false;
    showing.editRefused = false;
    showing.fitting = false;
    showing.overflowing = false;
  }

  function save(): void {
    savedCount += 1;
    editing = false;
  }
</script>

{#snippet subtitle()}
  Entry 2026-0147.0042
{/snippet}

<!--
  ONE snippet for both modes. The values and the fields are the same pane in the same geometry, and
  writing them as one thing is what stops them drifting into two layouts that disagree about where
  a field sits.
-->
{#snippet record({ editing: fieldsOpen }: { editing: boolean })}
  {#if fieldsOpen}
    <div class="flex flex-col gap-4">
      <Label for="record-window-story-description">Description</Label>
      <Textarea id="record-window-story-description" rows={2} bind:value={draft.description} />
    </div>
  {:else}
    <p>{draft.description}</p>
  {/if}
  <p>
    A long line wraps and grows rather than clipping: the one window whose job is to show the record
    whole must never hide part of it behind an ellipsis.
  </p>
  <p>Saved {savedCount} times. Printed {printedCount} times.</p>
{/snippet}

{#snippet shortRecord()}
  <p>Two facts and nothing else. A record this short has no reason to scroll.</p>
{/snippet}

{#snippet longRecord()}
  {#each Array.from({ length: 40 }, (_, index) => index + 1) as line (line)}
    <p>
      Paragraph {line} of a record long enough that no screen holds it whole. Past the point where
      the window can grow no further, this pane is the part that moves.
    </p>
  {/each}
{/snippet}

{#snippet attachmentsTab()}
  <p>Two files ride this record. Detaching one leaves the file where it lives.</p>
{/snippet}

{#snippet historyTab()}
  <p>Every event, oldest first, scrolling inside this tab so length costs the window nothing.</p>
{/snippet}

<!--
  The caller's verbs only. While editing, the shell appends the abandon and the commit AFTER
  whatever this renders, so a record kind never names them and never places them.
-->
{#snippet actions({ editing: fieldsOpen }: { editing: boolean })}
  {#if !fieldsOpen}
    <Button variant="secondary" onclick={closeEveryWindow}>Close</Button>
  {/if}
{/snippet}

{#snippet plainTemplate(args: RecordWindowStoryArgs)}
  <button
    type="button"
    class="mc-button mc-button-secondary mc-button-md"
    onclick={() => (showing.plain = true)}
  >
    Open the record
  </button>
  <RecordWindow
    {...args}
    bind:open={showing.plain}
    tabs={[
      { key: "attachments", label: "Attachments", count: 2, content: attachmentsTab },
      { key: "history", label: "History", count: 6, content: historyTab },
    ]}
    {subtitle}
    {record}
    {actions}
    onSave={save}
    onPrint={() => (printedCount += 1)}
  />
{/snippet}

<Story
  name="Default"
  template={plainTemplate}
  play={async ({ canvas, step }) => {
    const body = within(document.body);
    // A previous story's panel locks the page (`pointer-events: none` on the body) until its exit
    // settles, so wait for this story's trigger to be live before pressing it.
    const trigger = canvas.getByRole("button", { name: "Open the record" });
    await waitFor(() => expect(trigger).not.toHaveStyle({ pointerEvents: "none" }));
    await userEvent.click(trigger);
    const dialog = await body.findByRole("dialog");
    // The panel scale-fades in, so poll until the entrance settles rather than reading frame one.
    await waitFor(() => expect(dialog).toBeVisible());

    await step("The heading names the record and the subtitle carries its number", async () => {
      await expect(dialog).toHaveAccessibleName("Deposition preparation");
      await expect(dialog).toHaveAccessibleDescription(/2026-0147\.0042/);
    });

    await step("The header carries exactly Edit, Print, expand and close, in order", async () => {
      const order = [...dialog.querySelectorAll("[data-record-window-action]")].map((element) =>
        element.getAttribute("data-record-window-action"),
      );
      await expect(order).toEqual(["edit", "print", "expand", "close"]);
    });

    await step("Print reports to the caller and leaves the window standing", async () => {
      await userEvent.click(body.getByRole("button", { name: "Print" }));
      await expect(body.getByRole("dialog")).toBeVisible();
      await expect(body.getByText(/Printed 1 times/)).toBeVisible();
    });

    await step("The expand control says what pressing it will do, and flips", async () => {
      const expand = body.getByRole("button", { name: "Fill the screen" });
      await expect(expand).toHaveAttribute("aria-pressed", "false");
      // Rounded at window size: the panel is a sheet lying on top of the application.
      await expect(getComputedStyle(dialog).borderTopLeftRadius).not.toBe("0px");

      await userEvent.click(expand);
      const shrink = await body.findByRole("button", { name: "Shrink back to a window" });
      await expect(shrink).toHaveAttribute("aria-pressed", "true");

      // SQUARE at full screen. There is nothing underneath for it to lie on any more, so a curve
      // reads as four notches of desktop showing through the corners of the application.
      await expect(dialog).toHaveAttribute("data-expanded", "true");
      await expect(getComputedStyle(dialog).borderTopLeftRadius).toBe("0px");
      await expect(getComputedStyle(dialog).borderBottomRightRadius).toBe("0px");

      // Put it back: the choice is remembered for the session, so leaving it on would follow the
      // next story into its own assertions.
      await userEvent.click(shrink);
      await expect(getComputedStyle(dialog).borderTopLeftRadius).not.toBe("0px");
    });

    await step("The first tab opens, and its panel is the one showing", async () => {
      const panel = within(dialog);
      await expect(panel.getByRole("tab", { name: /Attachments/ })).toHaveAttribute(
        "data-state",
        "active",
      );
      await expect(panel.getByRole("tabpanel")).toHaveTextContent(/Two files ride this record/);
    });

    await step("Closing a record nobody changed asks nothing", async () => {
      await userEvent.click(within(partOf(dialog, "actions")).getByRole("button", { name: "Close" }));
      await waitFor(() => expect(body.queryByRole("dialog")).toBeNull());
    });
  }}
/>

{#snippet editingTemplate(args: RecordWindowStoryArgs)}
  <button
    type="button"
    class="mc-button mc-button-secondary mc-button-md"
    onclick={() => (showing.editingInPlace = true)}
  >
    Open the record
  </button>
  <RecordWindow
    {...args}
    bind:open={showing.editingInPlace}
    bind:editing
    tabs={[
      { key: "attachments", label: "Attachments", count: 2, content: attachmentsTab },
      { key: "history", label: "History", count: 6, content: historyTab },
    ]}
    {subtitle}
    {record}
    {actions}
    onSave={save}
    onPrint={() => (printedCount += 1)}
  />
{/snippet}

<Story
  name="EditingInPlace"
  template={editingTemplate}
  play={async ({ canvas, step }) => {
    const body = within(document.body);
    const trigger = canvas.getByRole("button", { name: "Open the record" });
    await waitFor(() => expect(trigger).not.toHaveStyle({ pointerEvents: "none" }));
    await userEvent.click(trigger);
    const dialog = await body.findByRole("dialog");
    await waitFor(() => expect(dialog).toBeVisible());
    const panel = within(dialog);

    await step("Edit turns the left pane into fields, in this same window", async () => {
      await expect(panel.queryByLabelText("Description")).toBeNull();
      await userEvent.click(panel.getByRole("button", { name: "Edit" }));
      await expect(await panel.findByLabelText("Description")).toBeVisible();
      // The same window, not a second one: one dialog on the page throughout.
      await expect(body.getAllByRole("dialog")).toHaveLength(1);
      await expect(dialog).toHaveAttribute("data-editing", "true");
    });

    await step("The tabs stay reachable while the fields are open", async () => {
      await userEvent.click(panel.getByRole("tab", { name: /History/ }));
      await expect(panel.getByRole("tabpanel")).toHaveTextContent(/oldest first/);
      await expect(panel.getByLabelText("Description")).toBeVisible();
    });

    await step("The action bar carries the commit alone; the abandon lives on close", async () => {
      const bar = partOf(dialog, "actions");
      const verbs = [...bar.querySelectorAll("button")].map((control) => control.textContent?.trim());
      await expect(verbs).toEqual(["Save"]);
    });

    await step("A close gesture with unsaved work asks before it throws it away", async () => {
      await userEvent.click(headerCloseOf(dialog));
      const question = await body.findByRole("alertdialog");
      await expect(question).toHaveAccessibleName("Discard Your Changes?");
      await userEvent.click(within(question).getByRole("button", { name: "Keep Editing" }));
      await waitFor(() => expect(body.queryByRole("alertdialog")).toBeNull());
      // Kept: the record is still open and still in its fields.
      await expect(body.getByRole("dialog")).toBeVisible();
      await expect(panel.getByLabelText("Description")).toBeVisible();
    });

    await step("Save hands the change to the caller and the pane reads again", async () => {
      await userEvent.click(panel.getByRole("button", { name: "Save" }));
      await waitFor(() => expect(panel.queryByLabelText("Description")).toBeNull());
      await expect(panel.getByText(/Saved 1 times/)).toBeVisible();
    });
  }}
/>

{#snippet chosenTabTemplate(args: RecordWindowStoryArgs)}
  <button
    type="button"
    class="mc-button mc-button-secondary mc-button-md"
    onclick={() => (showing.chosenTab = true)}
  >
    Open the record
  </button>
  <RecordWindow
    {...args}
    bind:open={showing.chosenTab}
    defaultTab="history"
    tabs={[
      { key: "attachments", label: "Attachments", count: 2, content: attachmentsTab },
      { key: "history", label: "History", count: 6, content: historyTab },
    ]}
    {subtitle}
    {record}
    {actions}
    onSave={save}
    onPrint={() => undefined}
  />
{/snippet}

<Story
  name="OpensOnAChosenTab"
  template={chosenTabTemplate}
  play={async ({ canvas, step }) => {
    const body = within(document.body);
    // The previous story's panel keeps the page locked until its exit settles; wait it out.
    const trigger = canvas.getByRole("button", { name: "Open the record" });
    await waitFor(() => expect(trigger).not.toHaveStyle({ pointerEvents: "none" }));
    await userEvent.click(trigger);
    // Scoped to THIS window: a previous story's panel can still be in the document while its exit
    // presence settles, and an unscoped text query would read that one instead.
    const panel = within(await body.findByRole("dialog"));

    await step("The caller's chosen tab is the one in front of the reader", async () => {
      await expect(panel.getByRole("tab", { name: /History/ })).toHaveAttribute(
        "data-state",
        "active",
      );
      await expect(panel.getByRole("tabpanel")).toHaveTextContent(/oldest first/);
    });
  }}
/>

{#snippet conversationPanel()}
  <p>Three people have said something about this record. The thread stays in view whichever tab is open.</p>
{/snippet}

{#snippet sidePanelTemplate(args: RecordWindowStoryArgs)}
  <button
    type="button"
    class="mc-button mc-button-secondary mc-button-md"
    onclick={() => (showing.sidePanel = true)}
  >
    Open the record
  </button>
  <RecordWindow
    {...args}
    bind:open={showing.sidePanel}
    tabs={[
      { key: "attachments", label: "Attachments", count: 2, content: attachmentsTab },
      { key: "history", label: "History", count: 6, content: historyTab },
    ]}
    aside={conversationPanel}
    asideLabel="Conversation"
    {subtitle}
    {record}
    {actions}
    onSave={save}
    onPrint={() => undefined}
  />
{/snippet}

<Story
  name="CarriesASidePanel"
  template={sidePanelTemplate}
  play={async ({ canvas, step }) => {
    const body = within(document.body);
    const trigger = canvas.getByRole("button", { name: "Open the record" });
    await waitFor(() => expect(trigger).not.toHaveStyle({ pointerEvents: "none" }));
    await userEvent.click(trigger);
    const panel = within(await body.findByRole("dialog"));

    await step("The side panel stands beside the tabs, named for a screen reader", async () => {
      await expect(panel.getByRole("region", { name: "Conversation" })).toHaveTextContent(
        /stays in view/,
      );
    });

    await step("Choosing another tab leaves the side panel where it was", async () => {
      await userEvent.click(panel.getByRole("tab", { name: /History/ }));
      await expect(panel.getByRole("tabpanel")).toHaveTextContent(/oldest first/);
      // Waited for, not read once: the panel fades in, and under a loaded run the fade can still be
      // under way here, which reads as "not visible" for a reason that has nothing to do with the tabs.
      await waitFor(() =>
        expect(panel.getByRole("region", { name: "Conversation" })).toBeVisible(),
      );
    });
  }}
/>

{#snippet editRefusedTemplate(args: RecordWindowStoryArgs)}
  <button
    type="button"
    class="mc-button mc-button-secondary mc-button-md"
    onclick={() => (showing.editRefused = true)}
  >
    Open the record
  </button>
  <RecordWindow
    {...args}
    bind:open={showing.editRefused}
    editDisabledReason="Only the person who entered this record may work it"
    tabs={[{ key: "history", label: "History", count: 6, content: historyTab }]}
    {subtitle}
    {record}
    {actions}
    onSave={save}
    onPrint={() => undefined}
  />
{/snippet}

<Story
  name="EditRefusedWithItsReason"
  template={editRefusedTemplate}
  play={async ({ canvas, step }) => {
    const body = within(document.body);
    // The previous story's panel keeps the page locked until its exit settles; wait it out.
    const trigger = canvas.getByRole("button", { name: "Open the record" });
    await waitFor(() => expect(trigger).not.toHaveStyle({ pointerEvents: "none" }));
    await userEvent.click(trigger);
    const dialog = await body.findByRole("dialog");
    const panel = within(dialog);

    await step("Edit is present and disabled, and says why", async () => {
      const edit = panel.getByRole("button", {
        name: "Edit: Only the person who entered this record may work it",
      });
      await expect(edit).toBeDisabled();
      await expect(edit).toHaveAttribute(
        "title",
        "Only the person who entered this record may work it",
      );
    });

    await step("So the window stays in its reading mode, and says so", async () => {
      await expect(dialog).toHaveAttribute("data-editing", "false");
      await expect(partOf(dialog, "actions").textContent).not.toContain("Save");
    });

    await step("Print stays available, because printing is not editing", async () => {
      await expect(panel.getByRole("button", { name: "Print" })).toBeEnabled();
    });
  }}
/>

{#snippet fittingTemplate(args: RecordWindowStoryArgs)}
  <button
    type="button"
    class="mc-button mc-button-secondary mc-button-md"
    onclick={() => (showing.fitting = true)}
  >
    Open the record
  </button>
  <RecordWindow
    {...args}
    bind:open={showing.fitting}
    tabs={[{ key: "history", label: "History", content: historyTab }]}
    {subtitle}
    record={shortRecord}
    {actions}
    onSave={save}
    onPrint={() => undefined}
  />
{/snippet}

<Story
  name="FitsWithoutScrolling"
  template={fittingTemplate}
  play={async ({ canvas, step }) => {
    const body = within(document.body);
    const trigger = canvas.getByRole("button", { name: "Open the record" });
    await waitFor(() => expect(trigger).not.toHaveStyle({ pointerEvents: "none" }));
    await userEvent.click(trigger);
    const dialog = await body.findByRole("dialog");
    await waitFor(() => expect(dialog).toBeVisible());

    await step("A record that fits sizes to itself rather than to the screen", async () => {
      const panel = boxOf(dialog);
      await expect(panel.height).toBeLessThan(window.innerHeight);
    });

    await step("And scrolls nowhere: not the panel, not either pane", async () => {
      for (const part of ["", "record", "context"]) {
        const element = part === "" ? dialog : partOf(dialog, part);
        const box = boxOf(element);
        await expect(box.scrollHeight).toBeLessThanOrEqual(box.clientHeight);
      }
    });
  }}
/>

{#snippet overflowingTemplate(args: RecordWindowStoryArgs)}
  <button
    type="button"
    class="mc-button mc-button-secondary mc-button-md"
    onclick={() => (showing.overflowing = true)}
  >
    Open the record
  </button>
  <RecordWindow
    {...args}
    bind:open={showing.overflowing}
    tabs={[{ key: "history", label: "History", content: historyTab }]}
    {subtitle}
    record={longRecord}
    {actions}
    onSave={save}
    onPrint={() => undefined}
  />
{/snippet}

<Story
  name="CapsAndScrollsItsBody"
  template={overflowingTemplate}
  play={async ({ canvas, step }) => {
    const body = within(document.body);
    const trigger = canvas.getByRole("button", { name: "Open the record" });
    await waitFor(() => expect(trigger).not.toHaveStyle({ pointerEvents: "none" }));
    await userEvent.click(trigger);
    const dialog = await body.findByRole("dialog");
    await waitFor(() => expect(dialog).toBeVisible());
    const recordPane = partOf(dialog, "record");
    const header = partOf(dialog, "header");
    const bar = partOf(dialog, "actions");

    await step("A record that cannot fit caps at the screen less its gutter", async () => {
      // The stage the panel is centred in is the viewport pulled in by size.modal-gutter on every
      // side; a panel taller than that box shrinks to it, and never to the screen's own edges.
      const stage = dialog.closest<HTMLElement>("[data-modal-stage]")!;
      const gutter = Number.parseFloat(getComputedStyle(stage).insetBlockStart);
      await expect(gutter).toBeGreaterThan(0);
      const panel = boxOf(dialog);
      await expect(Math.abs(panel.height - (window.innerHeight - gutter * 2))).toBeLessThanOrEqual(1);
      // Measured once the entrance scale has settled; a rect taken mid-animation is a few pixels in.
      await waitFor(() =>
        expect(Math.abs(dialog.getBoundingClientRect().top - gutter)).toBeLessThanOrEqual(1),
      );
      // The panel itself still does not scroll — it clips, and the body does the moving.
      await expect(panel.scrollHeight).toBeLessThanOrEqual(panel.clientHeight);
    });

    await step("The record pane is the thing with somewhere to go", async () => {
      await expect(boxOf(recordPane).scrollHeight).toBeGreaterThan(boxOf(recordPane).clientHeight);
    });

    await step("Scrolling it leaves the header and the action bar exactly where they were", async () => {
      const headerTop = boxOf(header).top;
      const barTop = boxOf(bar).top;
      recordPane.scrollTop = recordPane.scrollHeight;
      await waitFor(() => expect(recordPane.scrollTop).toBeGreaterThan(0));
      await expect(boxOf(header).top).toBe(headerTop);
      await expect(boxOf(bar).top).toBe(barTop);
      await expect(dialog.scrollTop).toBe(0);
      await expect(boxOf(dialog).height).toBeLessThanOrEqual(window.innerHeight);
    });

    await step("Put it away", async () => {
      await userEvent.click(headerCloseOf(dialog));
      await waitFor(() => expect(body.queryByRole("dialog")).toBeNull());
    });
  }}
/>
