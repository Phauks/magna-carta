<script module lang="ts">
  /*
   * ActionDialog — the one panel an act is asked for in, and RecordWindow's modal peer. The catalog
   * shows it whole: the heading, the subtitle, the notice slot, the body, and one action bar whose
   * two controls are always the same two in the same order.
   *
   * One story per thing that can be wrong independently: a READING kind, which asks for nothing,
   * seats any step it offers in its body, and ends its bar at the way out; the three acting KINDS,
   * which are the variant axis and each carry a different primitive; a commit refused with the
   * reason it is refused, which must never be an absent control; a commit that is NOT SERVED YET,
   * which renders inside the Soon affordance and cannot be pressed or submitted; a commit that the
   * server turns down, where the panel must stand its ground rather than vanish; the guard, which
   * is the one behaviour none of the panels this shell replaces ever had; a CONTEXT PANE, which is
   * the record window's right pane lent to a form and must open at the record width; and the
   * sizing rule, which is a claim about rendered geometry and so is asserted as one — a long form
   * caps at the viewport and its fields alone scroll, while the heading and the commit stay put.
   * Enter committing is asserted on the Default story, since it is what every form does; the
   * textarea's Ctrl+Enter rides a hidden behaviour story. The shell is told nothing about what
   * kind of act it is asking for, so the fixture is deliberately plain.
   *
   * The panel portals to the body, so every play function queries `within(document.body)` rather
   * than the story canvas (the Dialog story sets that pattern). Each story opens from its own
   * trigger and its own piece of state, so the Docs page shows six buttons rather than six panels
   * stacked on each other. Render is always an explicit named `template` snippet.
   */
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import type { ComponentProps } from "svelte";
  import { expect, userEvent, waitFor, within } from "storybook/test";
  import { actionDialogExpansion } from "../lib/internal/frame-expansion.svelte.ts";
  import ActionDialog from "../lib/components/action-dialog/action-dialog.svelte";
  import type { ActionOutcome } from "../lib/components/action-dialog/types.ts";
  import Input from "../lib/components/input/index.ts";
  import Label from "../lib/components/label/index.ts";
  import Textarea from "../lib/components/textarea/index.ts";
  import * as Alert from "../lib/components/alert/index.ts";
  import Button from "../lib/components/button/index.ts";

  const { Story } = defineMeta({
    title: "Overlay/ActionDialog",
    component: ActionDialog,
    args: {
      heading: "Write Off a Balance",
      subtitle: {
        reference: { kind: "Bill", number: "2026-0147" },
        facts: ["this matter still owes $4,120.00"],
      },
      commitLabel: "Write It Off",
    },
    parameters: {
      // Bits' prop types materialize every HTML attribute as a control; whitelist the props that
      // actually change this showcase. Snippets, the bindable `open` and the handlers are not
      // controls — `kind` is the variant axis, so it is one story each rather than a dropdown.
      controls: {
        // `subtitle` is not among them: it is a RecordSubject, and a structured value edited as
        // text in a panel is a control that teaches a reader the wrong shape for the prop.
        include: ["heading", "commitLabel", "commitRefusal", "width", "unsavedChanges"],
      },
    },
  });

  // The props are a union on `kind`, and a template receives the WHOLE union (that is svelte-csf's
  // contract, so a template typed on one arm does not satisfy it). A story spreads its args and
  // then names a kind, and a spread of the union cannot be narrowed by the literal beside it — so
  // each template narrows first. The meta args are the acting arm, the one with a commit; the
  // reading story takes only the props both arms share.
  type ActionDialogProps = ComponentProps<typeof ActionDialog>;
  type ActingProps = Extract<ActionDialogProps, { commitLabel: string }>;
  const acting = (args: ActionDialogProps): ActingProps => args as ActingProps;
</script>

<script lang="ts">
  const showing = $state({
    form: false,
    confirm: false,
    destructive: false,
    refused: false,
    turnedDown: false,
    guarded: false,
    withContext: false,
    long: false,
    reading: false,
    soon: false,
    keyboard: false,
    stays: false,
    previewed: false,
  });

  let amount = $state("");
  let reason = $state("");
  let committedCount = $state(0);
  let dismissedCount = $state(0);
  let serverRefused = $state(false);

  function closeEveryPanel(): void {
    showing.form = false;
    showing.confirm = false;
    showing.destructive = false;
    showing.refused = false;
    showing.turnedDown = false;
    showing.previewed = false;
    showing.guarded = false;
    showing.withContext = false;
    showing.long = false;
    showing.reading = false;
    showing.soon = false;
    showing.keyboard = false;
    showing.stays = false;
  }

  /** A commit that lands. The shell closes the panel; the caller never writes `open`. */
  async function succeed(): Promise<ActionOutcome> {
    committedCount += 1;
    return "committed";
  }

  /** A commit that lands and has something to show for it. The panel stays, with nothing to ask. */
  async function succeedAndStay(): Promise<ActionOutcome> {
    committedCount += 1;
    return "done";
  }

  /** A commit the server turns down. The panel stays, and the notice slot says why. */
  async function refuse(): Promise<ActionOutcome> {
    serverRefused = true;
    return "refused";
  }

  function resetAmount(): void {
    amount = "";
    reason = "";
    serverRefused = false;
  }
</script>

<!-- The subtitle is a string on the meta args, as it is in most panels. This snippet is the other
     arm — the one for a subtitle that carries markup — and one story renders it to prove it. -->
{#snippet subtitleWithMarkup()}
  <span class="font-semibold">Invoice 2026-0147</span> · this matter still owes $4,120.00
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

{#snippet formTemplate(args: ActionDialogProps)}
  <button
    type="button"
    class="mc-button mc-button-secondary mc-button-md"
    onclick={() => (showing.form = true)}
  >
    Write off a balance
  </button>
  <ActionDialog
    {...acting(args)}
    bind:open={showing.form}
    kind="form"
    unsavedChanges={false}
    {notice}
    {fields}
    onOpen={resetAmount}
    onCommit={succeed}
    onDismiss={() => (dismissedCount += 1)}
  />
{/snippet}

{#snippet confirmTemplate(args: ActionDialogProps)}
  <button
    type="button"
    class="mc-button mc-button-secondary mc-button-md"
    onclick={() => (showing.confirm = true)}
  >
    Discard the draft
  </button>
  <ActionDialog
    {...acting(args)}
    heading="Discard This Draft Bill"
    commitLabel="Discard the Draft"
    bind:open={showing.confirm}
    kind="confirm"
    unsavedChanges={false}
    fields={questionBody}
    onCommit={succeed}
  />
{/snippet}

{#snippet destructiveTemplate(args: ActionDialogProps)}
  <button
    type="button"
    class="mc-button mc-button-secondary mc-button-md"
    onclick={() => (showing.destructive = true)}
  >
    Void the cost
  </button>
  <ActionDialog
    {...acting(args)}
    heading="Void This Cost"
    commitLabel="Void the Cost"
    bind:open={showing.destructive}
    kind="destructive"
    unsavedChanges={false}
    fields={questionBody}
    onCommit={succeed}
  />
{/snippet}

{#snippet refusedTemplate(args: ActionDialogProps)}
  <button
    type="button"
    class="mc-button mc-button-secondary mc-button-md"
    onclick={() => (showing.refused = true)}
  >
    Write off with nothing entered
  </button>
  <ActionDialog
    {...acting(args)}
    bind:open={showing.refused}
    kind="form"
    unsavedChanges={false}
    commitRefusal="Say how much the firm is giving up."
    {fields}
    onCommit={succeed}
  />
{/snippet}

{#snippet turnedDownTemplate(args: ActionDialogProps)}
  <button
    type="button"
    class="mc-button mc-button-secondary mc-button-md"
    onclick={() => (showing.turnedDown = true)}
  >
    Write off against a finalized bill
  </button>
  <ActionDialog
    {...acting(args)}
    bind:open={showing.turnedDown}
    kind="form"
    unsavedChanges={false}
    {notice}
    {fields}
    onOpen={resetAmount}
    onCommit={refuse}
  />
{/snippet}

{#snippet clientContext()}
  <div class="flex flex-col gap-12">
    <p class="text-sm font-semibold">Acme Holdings Pty Ltd</p>
    <p class="text-xs text-text-muted">
      Four open matters, none overdue. The clearance this matter needs has been run against the
      directory and came back clean.
    </p>
    <p class="text-xs text-text-muted">
      Everything past the fields' own measure belongs to this pane: it is the side that can use the
      room.
    </p>
  </div>
{/snippet}

{#snippet longFields({ busy }: { busy: boolean })}
  {#each Array.from({ length: 24 }, (_, index) => index + 1) as line (line)}
    <div class="flex flex-col gap-8">
      <Label for="action-dialog-story-long-{line}">Field {line}</Label>
      <Input id="action-dialog-story-long-{line}" disabled={busy} />
    </div>
  {/each}
{/snippet}

{#snippet contextTemplate(args: ActionDialogProps)}
  <button
    type="button"
    class="mc-button mc-button-secondary mc-button-md"
    onclick={() => (showing.withContext = true)}
  >
    Open a matter
  </button>
  <ActionDialog
    {...acting(args)}
    heading="Open a Matter"
    commitLabel="Open the Matter"
    bind:open={showing.withContext}
    kind="form"
    width="narrow"
    unsavedChanges={false}
    {fields}
    context={clientContext}
    onCommit={succeed}
  />
{/snippet}

{#snippet longTemplate(args: ActionDialogProps)}
  <button
    type="button"
    class="mc-button mc-button-secondary mc-button-md"
    onclick={() => (showing.long = true)}
  >
    Write off with a long form
  </button>
  <ActionDialog
    {...acting(args)}
    bind:open={showing.long}
    kind="form"
    unsavedChanges={false}
    subtitle={subtitleWithMarkup}
    fields={longFields}
    onCommit={succeed}
  />
{/snippet}

{#snippet statusReading({ busy }: { busy: boolean })}
  <dl class="flex flex-col gap-8 text-sm">
    <div class="grid grid-cols-2 items-center gap-16">
      <dt class="text-text-muted">Status</dt>
      <!-- The step sits on the fact it changes, not at the foot of the window: somebody may have
           opened this to read the pane beside it, and the corner is where a hand goes by habit. -->
      <dd class="flex flex-wrap items-center gap-8">
        <span class="font-semibold uppercase">Open</span>
        <Button variant="secondary" size="sm" disabled={busy}>Close Matter</Button>
      </dd>
    </div>
  </dl>
{/snippet}

{#snippet paperFile()}
  <dl class="flex flex-col gap-8 text-sm">
    <div class="grid grid-cols-2 items-baseline gap-16">
      <dt class="text-text-muted">Kept at</dt>
      <dd class="text-text-subtle">Not recorded</dd>
    </div>
  </dl>
{/snippet}

{#snippet readingTemplate(args: ActionDialogProps)}
  <button
    type="button"
    class="mc-button mc-button-secondary mc-button-md"
    onclick={() => (showing.reading = true)}
  >
    Read the status
  </button>
  <ActionDialog
    kind="reading"
    heading="Matter Status"
    width={args.width}
    bind:open={showing.reading}
    fields={statusReading}
    context={paperFile}
  />
{/snippet}

{#snippet previewedTemplate(args: ActionDialogProps)}
  <button
    type="button"
    class="mc-button mc-button-secondary mc-button-md"
    onclick={() => (showing.previewed = true)}
  >
    Record a call
  </button>
  <!-- A record quoted out loud is identified BEFORE it is saved. The number is a draft, held for this
       panel until it saves or is cancelled, and the shell marks it in italics in one place. -->
  <ActionDialog
    {...acting(args)}
    heading="Record a Call"
    subtitle={{
      reference: { kind: "Call", number: "2026-09-08-0042", standing: "draft" },
    }}
    commitLabel="Record It"
    bind:open={showing.previewed}
    kind="form"
    unsavedChanges={false}
    {fields}
    onCommit={succeed}
  />
{/snippet}

{#snippet soonTemplate(args: ActionDialogProps)}
  <button
    type="button"
    class="mc-button mc-button-secondary mc-button-md"
    onclick={() => (showing.soon = true)}
  >
    Apply trust funds
  </button>
  <ActionDialog
    {...acting(args)}
    heading="Apply Trust Funds"
    subtitle={{
      reference: { kind: "Matter", number: "2026-0147" },
      facts: ["trust held: $2,500.00"],
    }}
    commitLabel="Apply the Funds"
    bind:open={showing.soon}
    kind="form"
    unsavedChanges={false}
    {fields}
    commitSoon={{ reason: "choosing a trust account" }}
    onCommit={succeed}
  />
{/snippet}

{#snippet reasonFields({ busy }: { busy: boolean })}
  <div class="flex flex-col gap-8">
    <Label for="action-dialog-story-reason">Reason</Label>
    <Textarea id="action-dialog-story-reason" disabled={busy} bind:value={reason} />
  </div>
{/snippet}

{#snippet keyboardTemplate(args: ActionDialogProps)}
  <button
    type="button"
    class="mc-button mc-button-secondary mc-button-md"
    onclick={() => (showing.keyboard = true)}
  >
    Write off with a reason
  </button>
  <ActionDialog
    {...acting(args)}
    bind:open={showing.keyboard}
    kind="form"
    unsavedChanges={false}
    fields={reasonFields}
    onOpen={resetAmount}
    onCommit={succeed}
  />
{/snippet}

{#snippet reportFields({ busy, done }: { busy: boolean; done: boolean })}
  {#if done}
    <p class="text-sm">Sent. It was recorded as <span class="font-semibold">REF-2026-0147</span>.</p>
  {:else}
    <div class="flex flex-col gap-8">
      <Label for="action-dialog-story-report">What happened</Label>
      <Input id="action-dialog-story-report" disabled={busy} bind:value={amount} />
    </div>
  {/if}
{/snippet}

{#snippet staysTemplate(args: ActionDialogProps)}
  <button
    type="button"
    class="mc-button mc-button-secondary mc-button-md"
    onclick={() => (showing.stays = true)}
  >
    Send a report
  </button>
  <ActionDialog
    {...acting(args)}
    heading="Send a Report"
    subtitle={{ facts: ["Support reads these in the order they arrive"] }}
    commitLabel="Send the Report"
    commitBusyLabel="Sending"
    bind:open={showing.stays}
    kind="form"
    unsavedChanges={false}
    fields={reportFields}
    onOpen={resetAmount}
    onCommit={succeedAndStay}
  />
{/snippet}

{#snippet guardedTemplate(args: ActionDialogProps)}
  <button
    type="button"
    class="mc-button mc-button-secondary mc-button-md"
    onclick={() => (showing.guarded = true)}
  >
    Write off with work in progress
  </button>
  <ActionDialog
    {...acting(args)}
    bind:open={showing.guarded}
    kind="form"
    unsavedChanges
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

    await step("A notice with nothing to say costs the frame no height", () => {
      // The caller's notice snippet renders nothing at rest; the band it would fill collapses
      // rather than standing as sixteen pixels of padding above the action bar.
      const band = panel.querySelector<HTMLElement>(".mc-modal-frame-notice");
      expect(band).not.toBeNull();
      expect(getComputedStyle(band!).display).toBe("none");
    });

    await step("The commit is the pane's own submit, so Enter in a field presses it", () => {
      const commit = inside.getByRole("button", { name: "Write It Off" });
      expect(commit).toHaveAttribute("type", "submit");
      expect(commit.getAttribute("form")).toBe(panel.querySelector("form")?.id);
    });

    await step("Enter in a field commits and closes the panel — the caller wired nothing", async () => {
      await userEvent.type(inside.getByLabelText("Amount"), "120{Enter}");
      await waitFor(() => expect(body.queryByRole("dialog")).not.toBeInTheDocument());
      expect(committedCount).toBeGreaterThan(0);
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

    await step("A question has no incidental dismiss — no corner control, and nothing to expand", () => {
      expect(panel.querySelector('[data-action-dialog-action="expand"]')).toBeNull();
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

<Story
  name="WithAContextPane"
  template={contextTemplate}
  play={async ({ canvas, step }) => {
    const body = within(document.body);
    const trigger = canvas.getByRole("button", { name: "Open a matter" });
    await waitFor(() => expect(trigger).not.toHaveStyle({ pointerEvents: "none" }));
    await userEvent.click(trigger);
    const panel = await body.findByRole("dialog");
    await waitFor(() => expect(panel).toBeVisible());

    await step("The fields and the context stand side by side in the frame's two panes", () => {
      expect(panel.querySelector(".mc-modal-frame-pane")).not.toBeNull();
      expect(panel.querySelector(".mc-modal-frame-context")).not.toBeNull();
    });

    await step("A context pane opens the panel at the record width, whatever was asked for", () => {
      // The template asked for `narrow`; two panes have a geometry of their own, and the shell
      // decides it rather than letting a caller find out by eye.
      expect(panel).toHaveClass("max-w-record-window");
      expect(panel).not.toHaveClass("max-w-md");
    });

    await step("Focus lands on the first field, not on the header's own dismiss", () => {
      expect(document.activeElement).toBe(panel.querySelector("input"));
    });

    closeEveryPanel();
  }}
/>

<Story
  name="CapsAndScrollsItsFields"
  template={longTemplate}
  play={async ({ canvas, step }) => {
    const body = within(document.body);
    const trigger = canvas.getByRole("button", { name: "Write off with a long form" });
    await waitFor(() => expect(trigger).not.toHaveStyle({ pointerEvents: "none" }));
    await userEvent.click(trigger);
    const panel = (await body.findByRole("dialog")) as HTMLElement;
    await waitFor(() => expect(panel).toBeVisible());
    const pane = panel.querySelector<HTMLElement>(".mc-modal-frame-pane");
    const bar = panel.querySelector<HTMLElement>(".mc-modal-frame-actions");
    if (pane === null || bar === null) throw new Error("the frame's pane and action bar must exist");

    await step("A subtitle given as a snippet renders its markup", () => {
      expect(within(panel).getByText("Invoice 2026-0147")).toHaveClass("font-semibold");
    });

    await step("A form that does not fit caps at the viewport rather than growing past it", () => {
      expect(panel.offsetHeight).toBeLessThanOrEqual(window.innerHeight);
    });

    await step("The panel itself does not scroll — only its fields do", async () => {
      await expect(panel.scrollHeight).toBeLessThanOrEqual(panel.clientHeight);
      await expect(pane.scrollHeight).toBeGreaterThan(pane.clientHeight);
    });

    await step("The commit stays put while the fields scroll beneath it", async () => {
      const before = bar.getBoundingClientRect().top;
      pane.scrollTop = pane.scrollHeight;
      await waitFor(() => expect(pane.scrollTop).toBeGreaterThan(0));
      expect(bar.getBoundingClientRect().top).toBe(before);
      expect(bar.getBoundingClientRect().bottom).toBeLessThanOrEqual(window.innerHeight);
    });

    closeEveryPanel();
  }}
/>

<Story
  name="Reading"
  template={readingTemplate}
  play={async ({ canvas, step }) => {
    const body = within(document.body);
    const trigger = canvas.getByRole("button", { name: "Read the status" });
    await waitFor(() => expect(trigger).not.toHaveStyle({ pointerEvents: "none" }));
    await userEvent.click(trigger);
    const panel = await body.findByRole("dialog");
    await waitFor(() => expect(panel).toBeVisible());

    await step("A reading panel asks for nothing: its bar ends at the way out", () => {
      const marked = [...panel.querySelectorAll("[data-action-dialog-action]")].map((control) =>
        control.getAttribute("data-action-dialog-action"),
      );
      expect(marked).not.toContain("commit");
      // Two controls are named Close here — the corner and the bar's — and both are meant to be:
      // a reading panel leaves the same way from either. The bar's is the one the kind changes.
      const dismiss = panel.querySelector('[data-action-dialog-action="dismiss"]');
      expect(dismiss).toBeVisible();
      expect(dismiss).toHaveAccessibleName("Close");
    });

    await step("It leaves through Close, not Cancel — nothing was begun", () => {
      const bar = panel.querySelector(".mc-action-dialog-actions");
      expect(bar?.textContent?.trim()).toBe("Close");
    });

    await step("The step it offers is seated in the body, beside the fact it changes", () => {
      expect(within(panel).getByRole("button", { name: "Close Matter" })).toBeVisible();
    });

    await step("Escape leaves at once — a reading panel has nothing to lose", async () => {
      await userEvent.keyboard("{Escape}");
      await waitFor(() => expect(body.queryByRole("dialog")).not.toBeInTheDocument());
      expect(body.queryByRole("alertdialog")).not.toBeInTheDocument();
    });

    closeEveryPanel();
  }}
/>

<Story
  name="NotBuiltYet"
  template={soonTemplate}
  play={async ({ canvas, step }) => {
    const body = within(document.body);
    const trigger = canvas.getByRole("button", { name: "Apply trust funds" });
    await waitFor(() => expect(trigger).not.toHaveStyle({ pointerEvents: "none" }));
    await userEvent.click(trigger);
    const panel = await body.findByRole("dialog");
    await waitFor(() => expect(panel).toBeVisible());
    const inside = within(panel);
    const commit = inside.getByRole("button", { name: "Apply the Funds" });

    await step("The commit renders, disabled, with the Soon mark beside it", () => {
      expect(commit).toBeVisible();
      expect(commit).toBeDisabled();
      expect(inside.getByText("Soon")).toBeVisible();
    });

    await step("It says what it waits on, as the control's own description", () => {
      expect(commit).toHaveAccessibleDescription(
        "Not built yet: choosing a trust account.",
      );
    });

    await step("Enter cannot submit past a commit that is not served", async () => {
      await userEvent.type(inside.getByLabelText("Amount"), "120{Enter}");
      expect(panel).toBeVisible();
      expect(committedCount).toBe(0);
    });

    await step("The way out is unchanged", async () => {
      await userEvent.click(inside.getByRole("button", { name: "Cancel" }));
      await waitFor(() => expect(body.queryByRole("dialog")).not.toBeInTheDocument());
    });

    closeEveryPanel();
  }}
/>

<!-- Behaviour with nothing to show: a textarea's Enter must go on meaning a new line, and the
     modified Enter is what reaches the commit from inside it. -->
<Story
  name="CommitsFromATextareaOnModifiedEnter"
  tags={["!dev", "!autodocs"]}
  template={keyboardTemplate}
  play={async ({ canvas, step }) => {
    const body = within(document.body);
    const trigger = canvas.getByRole("button", { name: "Write off with a reason" });
    await waitFor(() => expect(trigger).not.toHaveStyle({ pointerEvents: "none" }));
    await userEvent.click(trigger);
    const panel = await body.findByRole("dialog");
    await waitFor(() => expect(panel).toBeVisible());
    const field = within(panel).getByLabelText("Reason");
    const before = committedCount;

    await step("Enter in a textarea is a new line, not a commit", async () => {
      await userEvent.type(field, "Agreed with the client{Enter}on the phone");
      expect(panel).toBeVisible();
      expect(field).toHaveValue("Agreed with the client\non the phone");
      expect(committedCount).toBe(before);
    });

    await step("Ctrl+Enter commits from inside it", async () => {
      await userEvent.keyboard("{Control>}{Enter}{/Control}");
      await waitFor(() => expect(body.queryByRole("dialog")).not.toBeInTheDocument());
      expect(committedCount).toBe(before + 1);
    });

    closeEveryPanel();
  }}
/>

<Story
  name="StaysToShowWhatHappened"
  template={staysTemplate}
  play={async ({ canvas, step }) => {
    const body = within(document.body);
    const trigger = canvas.getByRole("button", { name: "Send a report" });
    await waitFor(() => expect(trigger).not.toHaveStyle({ pointerEvents: "none" }));
    await userEvent.click(trigger);
    const panel = await body.findByRole("dialog");
    await waitFor(() => expect(panel).toBeVisible());
    const inside = within(panel);

    await step("The commit lands and reports done — the panel stays", async () => {
      await userEvent.click(inside.getByRole("button", { name: "Send the Report" }));
      expect(await inside.findByText("REF-2026-0147")).toBeVisible();
      expect(panel).toBeVisible();
    });

    await step("With nothing left to ask, the bar ends at Close and the commit is gone", () => {
      const marked = [...panel.querySelectorAll("[data-action-dialog-action]")].map((control) =>
        control.getAttribute("data-action-dialog-action"),
      );
      expect(marked).not.toContain("commit");
      expect(panel.querySelector('[data-action-dialog-action="dismiss"]')).toHaveAccessibleName(
        "Close",
      );
    });

    await step("And there is nothing to lose, so Escape leaves at once", async () => {
      await userEvent.keyboard("{Escape}");
      await waitFor(() => expect(body.queryByRole("dialog")).not.toBeInTheDocument());
      expect(body.queryByRole("alertdialog")).not.toBeInTheDocument();
    });

    closeEveryPanel();
  }}
/>

<Story
  name="FillsTheScreen"
  template={formTemplate}
  play={async ({ canvas, step }) => {
    const body = within(document.body);
    const trigger = canvas.getByRole("button", { name: "Write off a balance" });
    await waitFor(() => expect(trigger).not.toHaveStyle({ pointerEvents: "none" }));
    await userEvent.click(trigger);
    const panel = await body.findByRole("dialog");
    await waitFor(() => expect(panel).toBeVisible());
    const expand = within(panel).getByRole("button", { name: "Fill the screen" });

    await step("A form offers to fill the screen, from the corner, before the way out", () => {
      const controls = [...panel.querySelectorAll(".mc-modal-frame-header-action")].map(
        (control) => control.getAttribute("data-action-dialog-action"),
      );
      expect(controls).toEqual(["expand", "close"]);
      expect(expand).toHaveAttribute("aria-pressed", "false");
    });

    await step("Pressing it drops the width cap and the frame takes the viewport", async () => {
      await userEvent.click(expand);
      await waitFor(() => expect(panel).toHaveAttribute("data-expanded", "true"));
      // The panel scale-fades in, so poll until the entrance settles rather than reading one frame.
      await waitFor(() =>
        expect(Math.round(panel.getBoundingClientRect().width)).toBe(window.innerWidth),
      );
      expect(within(panel).getByRole("button", { name: "Shrink back to a window" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
    });

    await step("The choice is remembered for the session, so the next form opens the same way", async () => {
      await userEvent.click(within(panel).getByRole("button", { name: "Cancel" }));
      await waitFor(() => expect(body.queryByRole("dialog")).not.toBeInTheDocument());
      expect(actionDialogExpansion.expanded).toBe(true);
      // The scrim's pointer lock lifts a beat after the panel has gone.
      await waitFor(() => expect(trigger).not.toHaveStyle({ pointerEvents: "none" }));
      await userEvent.click(trigger);
      const again = await body.findByRole("dialog");
      await waitFor(() => expect(again).toHaveAttribute("data-expanded", "true"));
      await userEvent.click(within(again).getByRole("button", { name: "Shrink back to a window" }));
      await waitFor(() => expect(again).toHaveAttribute("data-expanded", "false"));
    });

    closeEveryPanel();
    actionDialogExpansion.expanded = false;
  }}
/>

<Story
  name="NumberedBeforeItIsSaved"
  template={previewedTemplate}
  play={async ({ canvas, step }) => {
    const body = within(document.body);
    const trigger = canvas.getByRole("button", { name: "Record a call" });
    await waitFor(() => expect(trigger).not.toHaveStyle({ pointerEvents: "none" }));
    await userEvent.click(trigger);
    const panel = await body.findByRole("dialog");
    await waitFor(() => expect(panel).toBeVisible());

    await step("The panel states the number the record would take", () => {
      expect(within(panel).getByText("2026-09-08-0042")).toBeVisible();
    });

    await step("And says it is drawn by the save rather than held for this panel", () => {
      expect(within(panel).getByText("drawn when this is saved")).toBeVisible();
    });

    await step("The figures are tabular, so two references stack digit under digit", () => {
      const number = within(panel).getByText("2026-09-08-0042");
      expect(getComputedStyle(number).fontVariantNumeric).toContain("tabular-nums");
    });

    closeEveryPanel();
  }}
/>
