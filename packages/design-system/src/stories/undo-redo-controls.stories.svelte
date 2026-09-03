<script module lang="ts">
  /*
   * UndoRedoControls — the product's one pair of history controls. The stories show the states the
   * pair actually takes: nothing to walk back through, a stack with something in it, the stack
   * opened and several steps taken at once, and a walk that stopped because a step refused.
   *
   * Each story renders the pair the way a surface does: the controls beside the live region the
   * SURFACE owns. The controls never speak for themselves — what is announced comes back through
   * `onOutcome` once the inverses have answered, and that is the contract these stories pin.
   * svelte-csf v5.
   */
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import { expect, userEvent, waitFor, within } from "storybook/test";
  import UndoRedoControls from "../lib/components/history/undo-redo-controls.svelte";
  import {
    historyAnnouncement,
    HistoryStack,
    type HistoryOutcome,
  } from "../lib/components/history/history-stack.svelte.ts";

  const { Story } = defineMeta({
    title: "Actions/UndoRedoControls",
    component: UndoRedoControls,
    parameters: { controls: { disable: true } },
  });

  /** A stack of steps that do nothing but be walked, for stories that are about the controls. */
  function stackOf(...labels: readonly string[]): HistoryStack {
    const history = new HistoryStack();
    for (const label of labels) history.push({ label, undo: () => {}, redo: () => {} });
    return history;
  }

  /** A stack whose one step refuses, for the story about a walk that stopped. */
  function refusingStack(label: string): HistoryStack {
    const history = new HistoryStack();
    history.push({
      label,
      undo: () => Promise.reject(new Error("the write refused")),
      redo: () => {},
    });
    return history;
  }
</script>

<script lang="ts">
  const emptyStack = stackOf();
  const shortStack = stackOf("the rename", "moving 3 files to Discovery");
  const deepStack = stackOf("the first move", "the rename", "moving 3 files to Discovery");
  const stoppedStack = refusingStack("the move that refuses");
  const toolbarStack = stackOf("the description on this entry");

  // One holder per story rather than one shared: the docs page renders every story at once, and a
  // shared line would show the last story's words under all four.
  let emptyNote = $state("");
  let shortNote = $state("");
  let deepNote = $state("");
  let stoppedNote = $state("");
  let toolbarNote = $state("");
</script>

{#snippet strip(history: HistoryStack, note: string, say: (spoken: string) => void)}
  <div class="flex items-center gap-8 border-t border-border-default p-8">
    <UndoRedoControls
      {history}
      onOutcome={(outcome: HistoryOutcome) => say(historyAnnouncement(outcome) ?? "")}
    />
    <span class="text-xs text-text-muted" role="status" aria-live="polite">{note}</span>
  </div>
{/snippet}

<Story
  name="Nothing to walk back through"
  play={async ({ canvas, step }) => {
    await step("Both halves are disabled, and each says why rather than sitting blank", async () => {
      await expect(canvas.getByRole("button", { name: "Nothing to undo yet" })).toBeDisabled();
      await expect(canvas.getByRole("button", { name: "Nothing to redo" })).toBeDisabled();
    });
  }}
>
  {#snippet template()}
    {@render strip(emptyStack, emptyNote, (spoken) => (emptyNote = spoken))}
  {/snippet}
</Story>

<Story
  name="A stack with something in it"
  play={async ({ canvas, step }) => {
    await step("The control names what pressing it will do", async () => {
      await expect(
        canvas.getByRole("button", { name: "Undo moving 3 files to Discovery" }),
      ).toBeEnabled();
    });
    await step("One press walks one step, and the surface says what it was", async () => {
      await userEvent.click(
        canvas.getByRole("button", { name: "Undo moving 3 files to Discovery" }),
      );
      await expect(canvas.getByRole("status")).toHaveTextContent(
        "Undid moving 3 files to Discovery.",
      );
    });
    await step("What was walked back is now ahead, and redo names it too", async () => {
      await expect(
        canvas.getByRole("button", { name: "Redo moving 3 files to Discovery" }),
      ).toBeEnabled();
    });
  }}
>
  {#snippet template()}
    {@render strip(shortStack, shortNote, (spoken) => (shortNote = spoken))}
  {/snippet}
</Story>

<Story
  name="The stack, opened"
  play={async ({ canvas, step }) => {
    const body = within(document.body);
    /*
     * The list is read off the rows rather than asserted item by item: the order and the numbering
     * ARE the contract, and a per-row visibility check would race the panel's own fade-in for a
     * fact the row list already states.
     */
    await step("The caret lists the steps newest first, numbered", async () => {
      await userEvent.click(canvas.getByRole("button", { name: "Undo history" }));
      const menu = within(await body.findByRole("menu"));
      const rows = await menu.findAllByRole("menuitem");
      await expect(rows.map((row) => row.textContent?.trim())).toEqual([
        "1. moving 3 files to Discovery",
        "2. the rename",
        "3. the first move",
      ]);
    });
    await step("Choosing the third walks all three, and the count is announced", async () => {
      await userEvent.click(within(await body.findByRole("menu")).getByText("3. the first move"));
      await expect(canvas.getByRole("status")).toHaveTextContent(
        "Undid 3 steps, back through the first move.",
      );
    });
    /*
     * The wait is not tidying up: the panel leaves on an exit animation, and the story's own axe
     * pass runs the moment the play returns. A menu caught half-gone is an empty `role="menu"`,
     * which fails aria-required-children for a reason that is about the animation and not about
     * this control.
     */
    await step("The menu closes behind the choice", async () => {
      await waitFor(() => expect(body.queryByRole("menu")).toBeNull());
    });
  }}
>
  {#snippet template()}
    {@render strip(deepStack, deepNote, (spoken) => (deepNote = spoken))}
  {/snippet}
</Story>

<Story
  name="A walk that stopped"
  play={async ({ canvas, step }) => {
    await step("The refusal is stated, and nothing claims the record moved", async () => {
      await userEvent.click(canvas.getByRole("button", { name: "Undo the move that refuses" }));
      await expect(canvas.getByRole("status")).toHaveTextContent(
        "the move that refuses could not be undone. Nothing changed.",
      );
    });
    await step("The step is still there, so pressing again retries the same act", async () => {
      await expect(canvas.getByRole("button", { name: "Undo the move that refuses" })).toBeEnabled();
    });
  }}
>
  {#snippet template()}
    {@render strip(stoppedStack, stoppedNote, (spoken) => (stoppedNote = spoken))}
  {/snippet}
</Story>

<Story
  name="In a toolbar of secondary buttons"
  play={async ({ canvas, step }) => {
    await step("The pair takes the surrounding register and behaves identically", async () => {
      const undo = canvas.getByRole("button", { name: "Undo the description on this entry" });
      await expect(undo).toBeEnabled();
      await userEvent.click(undo);
      await expect(canvas.getByRole("status")).toHaveTextContent(
        "Undid the description on this entry.",
      );
    });
  }}
>
  {#snippet template()}
    <!--
      The register is the only thing a surface varies, and it is a fact about the chrome the pair
      sits in rather than about undo: quiet in a counts footer, bordered in a toolbar of secondary
      buttons. Everything else — the wording, the split, the order — is the control's.
    -->
    <div class="flex items-center gap-8 p-8">
      <UndoRedoControls
        history={toolbarStack}
        variant="secondary"
        onOutcome={(outcome: HistoryOutcome) =>
          (toolbarNote = historyAnnouncement(outcome) ?? "")}
      />
      <span class="text-xs text-text-muted" role="status" aria-live="polite">{toolbarNote}</span>
    </div>
  {/snippet}
</Story>
