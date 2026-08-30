<script module lang="ts">
  /*
   * RecordWindow — the two-pane window a record opens in, and the only one the product has. The
   * catalog shows it whole: the record on the left, context in tabs on the right, one action bar
   * beneath, and the four header controls in their one order (Edit, Print, expand, close).
   *
   * Three stories, because three things about it can be wrong independently: the plain window, an
   * opening tab chosen by the caller (a record with something waiting shows that tab first), and
   * Edit disabled carrying the reason it is disabled — the state that must never be an absent
   * control. The shell is told nothing about what kind of record it is showing, so the fixture is
   * deliberately plain: it is a record, and that is the whole of what the window knows.
   *
   * The panel portals to the body, so every play function queries `within(document.body)` rather
   * than the story canvas (the Dialog story sets that pattern). Each story opens from its own
   * trigger and its own piece of state, so the Docs page shows three buttons rather than three
   * modal panels stacked on each other. Render is always an explicit named `template` snippet.
   */
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import type { ComponentProps } from "svelte";
  import { expect, userEvent, waitFor, within } from "storybook/test";
  import RecordWindow from "../lib/components/record-window/record-window.svelte";

  const { Story } = defineMeta({
    title: "Overlay/RecordWindow",
    component: RecordWindow,
    args: { heading: "Deposition preparation" },
    parameters: {
      // Bits' prop types materialize every HTML attribute as a control; whitelist the props that
      // actually change this showcase. Snippets and the two bindable flags are not controls.
      controls: { include: ["heading", "defaultTab", "editDisabledReason"] },
    },
  });

  type RecordWindowStoryArgs = ComponentProps<typeof RecordWindow>;
</script>

<script lang="ts">
  // One flag per story, so opening one window leaves the other stories' triggers alone.
  const showing = $state({ plain: false, chosenTab: false, editRefused: false });
  let editedCount = $state(0);
  let printedCount = $state(0);
</script>

{#snippet subtitle()}
  Entry 2026-0147.0042
{/snippet}

{#snippet record()}
  <p>The record's own fields sit here, dense and starting at the top of the pane.</p>
  <p>
    A long line wraps and grows rather than clipping: the one window whose job is to show the record
    whole must never hide part of it behind an ellipsis.
  </p>
  <p>Edited {editedCount} times. Printed {printedCount} times.</p>
{/snippet}

{#snippet attachmentsTab()}
  <p>Two files ride this record. Detaching one leaves the file where it lives.</p>
{/snippet}

{#snippet historyTab()}
  <p>Every event, oldest first, scrolling inside this tab so length costs the window nothing.</p>
{/snippet}

{#snippet actions()}
  <button type="button" class="mc-button mc-button-secondary mc-button-md">Discard</button>
  <button type="button" class="mc-button mc-button-primary mc-button-md">Save</button>
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
    onEdit={() => (editedCount += 1)}
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

    await step("Edit and Print report to the caller and leave the window standing", async () => {
      await userEvent.click(body.getByRole("button", { name: "Edit" }));
      await userEvent.click(body.getByRole("button", { name: "Print" }));
      await expect(body.getByRole("dialog")).toBeVisible();
      await expect(body.getByText("Edited 1 times. Printed 1 times.")).toBeVisible();
    });

    await step("The expand control says what pressing it will do, and flips", async () => {
      const expand = body.getByRole("button", { name: "Fill the screen" });
      await expect(expand).toHaveAttribute("aria-pressed", "false");
      await userEvent.click(expand);
      const shrink = await body.findByRole("button", { name: "Shrink back to a window" });
      await expect(shrink).toHaveAttribute("aria-pressed", "true");
      // Put it back: the choice is remembered for the session, so leaving it on would follow the
      // next story into its own assertions.
      await userEvent.click(shrink);
    });

    await step("The first tab opens, and its panel is the one showing", async () => {
      const panel = within(dialog);
      await expect(panel.getByRole("tab", { name: /Attachments/ })).toHaveAttribute(
        "data-state",
        "active",
      );
      await expect(panel.getByRole("tabpanel")).toHaveTextContent(/Two files ride this record/);
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
    onEdit={() => undefined}
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
    onEdit={() => undefined}
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
    const panel = within(await body.findByRole("dialog"));

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

    await step("Print stays available, because printing is not editing", async () => {
      await expect(panel.getByRole("button", { name: "Print" })).toBeEnabled();
    });
  }}
/>
