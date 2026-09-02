<script module lang="ts">
  /*
   * ActionDialog — the one panel an act is asked for in, and RecordWindow's modal peer. The catalog
   * shows it whole: the heading, the subtitle, the notice slot, the body, and one action bar whose
   * two controls are always the same two in the same order.
   *
   * Six stories, because six things about it can be wrong independently: the three KINDS, which are
   * the variant axis and each carry a different primitive and a different dismissal verb; a commit
   * refused with the reason it is refused, which must never be an absent control; a commit that the
   * server turns down, where the panel must stand its ground rather than vanish; and the guard,
   * which is the one behaviour none of the panels this shell replaces ever had. The shell is told
   * nothing about what kind of act it is asking for, so the fixture is deliberately plain.
   *
   * The panel portals to the body, so every play function queries `within(document.body)` rather
   * than the story canvas (the Dialog story sets that pattern). Each story opens from its own
   * trigger and its own piece of state, so the Docs page shows six buttons rather than six panels
   * stacked on each other. Render is always an explicit named `template` snippet.
   */
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import type { ComponentProps } from "svelte";
  import { expect, userEvent, waitFor, within } from "storybook/test";
  import ActionDialog from "../lib/components/action-dialog/action-dialog.svelte";
  import type { ActionOutcome } from "../lib/components/action-dialog/types.ts";
  import Input from "../lib/components/input/index.ts";
  import Label from "../lib/components/label/index.ts";
  import * as Alert from "../lib/components/alert/index.ts";

  const { Story } = defineMeta({
    title: "Overlay/ActionDialog",
    component: ActionDialog,
    args: { heading: "Write Off a Balance", commitLabel: "Write It Off" },
    parameters: {
      // Bits' prop types materialize every HTML attribute as a control; whitelist the props that
      // actually change this showcase. Snippets, the bindable `open` and the handlers are not
      // controls — `kind` is the variant axis, so it is one story each rather than a dropdown.
      controls: {
        include: ["heading", "commitLabel", "commitRefusal", "width", "unsavedChanges"],
      },
    },
  });

  type ActionDialogStoryArgs = ComponentProps<typeof ActionDialog>;
</script>

<script lang="ts">
  const showing = $state({
    form: false,
    confirm: false,
    destructive: false,
    refused: false,
    turnedDown: false,
    guarded: false,
  });

  let amount = $state("");
  let committedCount = $state(0);
  let dismissedCount = $state(0);
  let serverRefused = $state(false);

  function closeEveryPanel(): void {
    showing.form = false;
    showing.confirm = false;
    showing.destructive = false;
    showing.refused = false;
    showing.turnedDown = false;
    showing.guarded = false;
  }

  /** A commit that lands. The shell closes the panel; the caller never writes `open`. */
  async function succeed(): Promise<ActionOutcome> {
    committedCount += 1;
    return "committed";
  }

  /** A commit the server turns down. The panel stays, and the notice slot says why. */
  async function refuse(): Promise<ActionOutcome> {
    serverRefused = true;
    return "refused";
  }

  function resetAmount(): void {
    amount = "";
    serverRefused = false;
  }
</script>

{#snippet subtitle()}
  Invoice 2026-0147 · this matter still owes $4,120.00
{/snippet}

{#snippet notice()}
  {#if serverRefused}
    <Alert.Root variant="danger">
      <Alert.Title>Nothing Was Written Off</Alert.Title>
      <Alert.Description>
        The bill was finalized while this was open, so the balance can no longer be given up here.
      </Alert.Description>
    </Alert.Root>
  {/if}
{/snippet}

<!--
  ONE snippet renders the fields at rest and while the commit is in flight — it is handed `busy`
  rather than being swapped for a second snippet, which is what stops the two drifting into two
  layouts that disagree about where a field sits.
-->
{#snippet fields({ busy }: { busy: boolean })}
  <div class="flex flex-col gap-8">
    <Label for="action-dialog-story-amount">Amount</Label>
    <Input id="action-dialog-story-amount" disabled={busy} bind:value={amount} />
  </div>
  <p class="text-sm text-text-muted">Written off {committedCount} times this session.</p>
{/snippet}

{#snippet questionBody()}
  <p>
    A draft bill is discarded outright rather than kept. Nothing has been sent to the client, so
    there is nothing on the books to reverse.
  </p>
{/snippet}

{#snippet formTemplate(args: ActionDialogStoryArgs)}
  <button
    type="button"
    class="mc-button mc-button-secondary mc-button-md"
    onclick={() => (showing.form = true)}
  >
    Write off a balance
  </button>
  <ActionDialog
    {...args}
    bind:open={showing.form}
    kind="form"
    unsavedChanges={false}
    {subtitle}
    {notice}
    {fields}
    onOpen={resetAmount}
    onCommit={succeed}
    onDismiss={() => (dismissedCount += 1)}
  />
{/snippet}

{#snippet confirmTemplate(args: ActionDialogStoryArgs)}
  <button
    type="button"
    class="mc-button mc-button-secondary mc-button-md"
    onclick={() => (showing.confirm = true)}
  >
    Discard the draft
  </button>
  <ActionDialog
    {...args}
    heading="Discard This Draft Bill?"
    commitLabel="Discard the Draft"
    bind:open={showing.confirm}
    kind="confirm"
    unsavedChanges={false}
    fields={questionBody}
    onCommit={succeed}
  />
{/snippet}

{#snippet destructiveTemplate(args: ActionDialogStoryArgs)}
  <button
    type="button"
    class="mc-button mc-button-secondary mc-button-md"
    onclick={() => (showing.destructive = true)}
  >
    Void the cost
  </button>
  <ActionDialog
    {...args}
    heading="Void This Cost?"
    commitLabel="Void the Cost"
    bind:open={showing.destructive}
    kind="destructive"
    unsavedChanges={false}
    fields={questionBody}
    onCommit={succeed}
  />
{/snippet}

{#snippet refusedTemplate(args: ActionDialogStoryArgs)}
  <button
    type="button"
    class="mc-button mc-button-secondary mc-button-md"
    onclick={() => (showing.refused = true)}
  >
    Write off with nothing entered
  </button>
  <ActionDialog
    {...args}
    bind:open={showing.refused}
    kind="form"
    unsavedChanges={false}
    commitRefusal="Say how much the firm is giving up."
    {subtitle}
    {fields}
    onCommit={succeed}
  />
{/snippet}

{#snippet turnedDownTemplate(args: ActionDialogStoryArgs)}
  <button
    type="button"
    class="mc-button mc-button-secondary mc-button-md"
    onclick={() => (showing.turnedDown = true)}
  >
    Write off against a finalized bill
  </button>
  <ActionDialog
    {...args}
    bind:open={showing.turnedDown}
    kind="form"
    unsavedChanges={false}
    {subtitle}
    {notice}
    {fields}
    onOpen={resetAmount}
    onCommit={refuse}
  />
{/snippet}

{#snippet guardedTemplate(args: ActionDialogStoryArgs)}
  <button
    type="button"
    class="mc-button mc-button-secondary mc-button-md"
    onclick={() => (showing.guarded = true)}
  >
    Write off with work in progress
  </button>
  <ActionDialog
    {...args}
    bind:open={showing.guarded}
    kind="form"
    unsavedChanges
    {subtitle}
    {fields}
    onCommit={succeed}
  />
{/snippet}

<Story
  name="Default"
  template={formTemplate}
  play={async ({ canvas, step }) => {
    const body = within(document.body);
    const trigger = canvas.getByRole("button", { name: "Write off a balance" });
    await waitFor(() => expect(trigger).not.toHaveStyle({ pointerEvents: "none" }));
    await userEvent.click(trigger);
    const panel = await body.findByRole("dialog");
    // The panel scale-fades in, so poll until the entrance settles rather than reading frame one.
    await waitFor(() => expect(panel).toBeVisible());
    const inside = within(panel);

    await step("A form is a dialog, and says so where anything can read it", async () => {
      expect(panel).toHaveAttribute("data-modal-shell", "action-dialog");
      expect(panel).toHaveAttribute("data-action-kind", "form");
    });

    await step("The footer is the dismissal then the commit, in that order", () => {
      // Read off the action bar rather than the panel: the corner dismiss is rendered after the
      // children, so "last button in the panel" is the ✕, not the commit.
      const bar = panel.querySelector(".mc-action-dialog-actions");
      const marked = [...(bar?.querySelectorAll("[data-action-dialog-action]") ?? [])];
      expect(marked.map((control) => control.getAttribute("data-action-dialog-action"))).toEqual([
        "dismiss",
        "commit",
      ]);
      expect(marked[0]?.textContent?.trim()).toBe("Cancel");
      expect(marked[1]?.textContent?.trim()).toBe("Write It Off");
    });

    await step("A form keeps the corner dismiss, because something begun can be resumed", () => {
      expect(inside.getByRole("button", { name: "Close" })).toBeVisible();
    });

    await step("Committing closes the panel — the caller never writes `open`", async () => {
      await userEvent.click(inside.getByRole("button", { name: "Write It Off" }));
      await waitFor(() => expect(body.queryByRole("dialog")).not.toBeInTheDocument());
    });

    closeEveryPanel();
  }}
/>

<Story
  name="Confirm"
  template={confirmTemplate}
  play={async ({ canvas, step }) => {
    const body = within(document.body);
    const trigger = canvas.getByRole("button", { name: "Discard the draft" });
    await waitFor(() => expect(trigger).not.toHaveStyle({ pointerEvents: "none" }));
    await userEvent.click(trigger);
    const panel = await body.findByRole("alertdialog");
    await waitFor(() => expect(panel).toBeVisible());
    const inside = within(panel);

    await step("A question takes the alertdialog role, not the dialog one", () => {
      expect(panel).toHaveAttribute("data-action-kind", "confirm");
    });

    await step("It walks away with the same word every panel uses", () => {
      expect(inside.getByRole("button", { name: "Cancel" })).toBeVisible();
    });

    await step("A question has no incidental dismiss — no corner control", () => {
      expect(inside.queryByRole("button", { name: "Close" })).not.toBeInTheDocument();
    });

    await step("Declining closes it", async () => {
      await userEvent.click(inside.getByRole("button", { name: "Cancel" }));
      await waitFor(() => expect(body.queryByRole("alertdialog")).not.toBeInTheDocument());
    });

    closeEveryPanel();
  }}
/>

<Story
  name="Destructive"
  template={destructiveTemplate}
  play={async ({ canvas, step }) => {
    const body = within(document.body);
    const trigger = canvas.getByRole("button", { name: "Void the cost" });
    await waitFor(() => expect(trigger).not.toHaveStyle({ pointerEvents: "none" }));
    await userEvent.click(trigger);
    const panel = await body.findByRole("alertdialog");
    await waitFor(() => expect(panel).toBeVisible());
    const inside = within(panel);

    await step("An act that takes something away says so in its commit", () => {
      expect(inside.getByRole("button", { name: "Void the Cost" })).toHaveClass(
        "mc-button-destructive",
      );
    });

    await step("It is still a question, and walks away with the same one word", () => {
      expect(inside.getByRole("button", { name: "Cancel" })).toBeVisible();
    });

    closeEveryPanel();
  }}
/>

<Story
  name="CommitRefusedWithItsReason"
  template={refusedTemplate}
  play={async ({ canvas, step }) => {
    const body = within(document.body);
    const trigger = canvas.getByRole("button", { name: "Write off with nothing entered" });
    await waitFor(() => expect(trigger).not.toHaveStyle({ pointerEvents: "none" }));
    await userEvent.click(trigger);
    const panel = await body.findByRole("dialog");
    await waitFor(() => expect(panel).toBeVisible());
    const inside = within(panel);

    await step("The commit is DISABLED and present, never absent", async () => {
      const commit = inside.getByRole("button", {
        name: "Write It Off: Say how much the firm is giving up.",
      });
      expect(commit).toBeVisible();
      expect(commit).toBeDisabled();
    });

    await step("It carries the reason it is refused, where the refusal is caused", () => {
      expect(
        inside.getByRole("button", {
          name: "Write It Off: Say how much the firm is giving up.",
        }),
      ).toHaveAttribute("title", "Say how much the firm is giving up.");
    });

    closeEveryPanel();
  }}
/>

<Story
  name="ARefusedCommitLeavesThePanelStanding"
  template={turnedDownTemplate}
  play={async ({ canvas, step }) => {
    const body = within(document.body);
    const trigger = canvas.getByRole("button", { name: "Write off against a finalized bill" });
    await waitFor(() => expect(trigger).not.toHaveStyle({ pointerEvents: "none" }));
    await userEvent.click(trigger);
    const panel = await body.findByRole("dialog");
    await waitFor(() => expect(panel).toBeVisible());
    const inside = within(panel);

    await step("The commit is pressed and the server turns it down", async () => {
      await userEvent.click(inside.getByRole("button", { name: "Write It Off" }));
    });

    await step("The panel stays — a refusal the reader cannot see is a panel doing nothing", () => {
      expect(panel).toBeVisible();
    });

    await step("And the notice slot carries what the caller put in it", async () => {
      expect(await inside.findByText("Nothing Was Written Off")).toBeVisible();
    });

    closeEveryPanel();
  }}
/>

<Story
  name="AskingBeforeItDiscards"
  template={guardedTemplate}
  play={async ({ canvas, step }) => {
    const body = within(document.body);
    const trigger = canvas.getByRole("button", { name: "Write off with work in progress" });
    await waitFor(() => expect(trigger).not.toHaveStyle({ pointerEvents: "none" }));
    await userEvent.click(trigger);
    const panel = await body.findByRole("dialog");
    await waitFor(() => expect(panel).toBeVisible());

    await step("Escape does not throw the work away — it asks", async () => {
      await userEvent.keyboard("{Escape}");
      const question = await body.findByRole("alertdialog");
      await waitFor(() => expect(question).toBeVisible());
      expect(within(question).getByText("Discard Your Changes?")).toBeVisible();
    });

    await step("Keeping the work leaves the panel exactly where it was", async () => {
      const question = await body.findByRole("alertdialog");
      await userEvent.click(within(question).getByRole("button", { name: "Keep Editing" }));
      await waitFor(() => expect(body.queryByRole("alertdialog")).not.toBeInTheDocument());
      expect(await body.findByRole("dialog")).toBeVisible();
    });

    await step("Discarding is the deliberate answer, and only then does the panel go", async () => {
      await userEvent.keyboard("{Escape}");
      const question = await body.findByRole("alertdialog");
      await userEvent.click(within(question).getByRole("button", { name: "Discard Changes" }));
      await waitFor(() => expect(body.queryByRole("dialog")).not.toBeInTheDocument());
    });

    closeEveryPanel();
  }}
/>
