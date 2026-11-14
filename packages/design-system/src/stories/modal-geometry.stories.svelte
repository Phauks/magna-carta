<script module lang="ts">
  /*
   * The modal geometry specimens — every modal shell, ALREADY OPEN, one story per way a panel can
   * meet the screen. These are what modal-geometry/ measures at every screen size in its matrix,
   * and they are the review surface for each case the sweep names: open one, resize the browser,
   * and watch the gutter hold.
   *
   * No story here has a trigger or a play function, on purpose. The sweep loads a story and
   * measures; a story that opened its panel on a press would race the sweep's own press, and one
   * that closed the panel at the end of its play function would leave nothing to measure. What each
   * story asserts about behaviour is asserted in the shell's own stories (dialog, alert-dialog,
   * action-dialog, record-window); these assert nothing and show one geometry each.
   *
   * Kept off the docs page (eight open panels would stack there) but in the sidebar, because a
   * specimen nobody can open is a specimen nobody reviews. Adding a case is a story here and a row
   * in modal-geometry/matrix.ts.
   */
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import ActionDialog from "../lib/components/action-dialog/action-dialog.svelte";
  import type { ActionOutcome } from "../lib/components/action-dialog/types.ts";
  import * as AlertDialog from "../lib/components/alert-dialog/index.ts";
  import Button from "../lib/components/button/index.ts";
  import * as Dialog from "../lib/components/dialog/index.ts";
  import Input from "../lib/components/input/index.ts";
  import Label from "../lib/components/label/index.ts";
  import RecordWindow from "../lib/components/record-window/record-window.svelte";

  const { Story } = defineMeta({
    title: "Overlay/ModalGeometry",
    component: ActionDialog,
    tags: ["!autodocs"],
    parameters: {
      controls: { include: [] },
    },
  });
</script>

<script lang="ts">
  // Every specimen opens on render. Bound rather than constant so a shell's own close path still
  // has somewhere to write; a reviewer who closes a panel in the catalog reloads to see it again.
  const open = $state({
    dialog: true,
    alertDialog: true,
    form: true,
    withContext: true,
    tooLong: true,
    expanded: true,
    record: true,
    recordTooLong: true,
  });

  async function commit(): Promise<ActionOutcome> {
    return "committed";
  }
</script>

{#snippet fields({ busy }: { busy: boolean })}
  <div class="flex flex-col gap-8">
    <Label for="modal-geometry-amount">Amount</Label>
    <Input id="modal-geometry-amount" disabled={busy} />
  </div>
{/snippet}

<!-- Long enough that no screen in the matrix holds it whole: the case where the stage must cap. -->
{#snippet longFields({ busy }: { busy: boolean })}
  {#each Array.from({ length: 24 }, (_, index) => index + 1) as line (line)}
    <div class="flex flex-col gap-8">
      <Label for="modal-geometry-field-{line}">Field {line}</Label>
      <Input id="modal-geometry-field-{line}" disabled={busy} />
    </div>
  {/each}
{/snippet}

{#snippet clientContext()}
  <p class="text-sm">Acme Holdings Pty Ltd. Two open matters, nothing outstanding on the ledger.</p>
{/snippet}

{#snippet subtitle()}
  Entry 2026-0147.0042
{/snippet}

{#snippet record({ editing }: { editing: boolean })}
  <p>{editing ? "The fields would stand here." : "Two facts and nothing else."}</p>
  <p>A record this short has no reason to scroll, so the window is exactly as tall as this.</p>
{/snippet}

<!--
  Ends in a link so the scrolling pane holds something focusable and a keyboard can reach it: a
  pane of prose alone fails axe's scrollable-region-focusable, and a specimen that stays open is
  checked where a story that closes itself is not.
-->
{#snippet longRecord()}
  {#each Array.from({ length: 40 }, (_, index) => index + 1) as line (line)}
    <p>
      Paragraph {line} of a record long enough that no screen holds it whole. Past the point where
      the window can grow no further, this pane is the part that moves.
    </p>
  {/each}
  <p><a href="/matters/ACME-2026-014" class="text-text-link underline">Open the matter</a></p>
{/snippet}

{#snippet historyTab()}
  <p>Every event, oldest first, scrolling inside this tab so length costs the window nothing.</p>
{/snippet}

{#snippet actions({ editing }: { editing: boolean })}
  {#if !editing}
    <Button variant="secondary" onclick={() => undefined}>Close</Button>
  {/if}
{/snippet}

{#snippet dialogTemplate()}
  <Dialog.Root bind:open={open.dialog}>
    <Dialog.Content>
      <Dialog.Title>Matter details</Dialog.Title>
      <Dialog.Description>A short panel opens at the height of what is in it.</Dialog.Description>
      <p class="text-sm">Acme Holdings Pty Ltd, open, responsible attorney Dana Okoye.</p>
    </Dialog.Content>
  </Dialog.Root>
{/snippet}

{#snippet alertDialogTemplate()}
  <AlertDialog.Root bind:open={open.alertDialog}>
    <AlertDialog.Content>
      <AlertDialog.Title>Delete this document?</AlertDialog.Title>
      <AlertDialog.Description>
        A question is always centred, and never touches the screen.
      </AlertDialog.Description>
      <div class="mc-card-footer justify-end">
        <AlertDialog.Cancel class="mc-button mc-button-ghost mc-button-md">Cancel</AlertDialog.Cancel>
        <AlertDialog.Action
          class="mc-button mc-button-destructive mc-button-md"
          onclick={() => (open.alertDialog = false)}
        >
          Delete
        </AlertDialog.Action>
      </div>
    </AlertDialog.Content>
  </AlertDialog.Root>
{/snippet}

{#snippet formTemplate()}
  <ActionDialog
    heading="Write Off a Balance"
    subtitle={{
      reference: { kind: "Bill", number: "2026-0147" },
      facts: ["this matter still owes $4,120.00"],
    }}
    commitLabel="Write It Off"
    bind:open={open.form}
    kind="form"
    unsavedChanges={false}
    {fields}
    onCommit={commit}
  />
{/snippet}

{#snippet withContextTemplate()}
  <ActionDialog
    heading="Open a Matter"
    subtitle={{ facts: ["A context pane opens the panel at the record width"] }}
    commitLabel="Open the Matter"
    bind:open={open.withContext}
    kind="form"
    unsavedChanges={false}
    {fields}
    context={clientContext}
    onCommit={commit}
  />
{/snippet}

{#snippet tooLongTemplate()}
  <ActionDialog
    heading="Write Off a Balance"
    subtitle={{ facts: ["A form that does not fit caps at the screen less its gutter"] }}
    commitLabel="Write It Off"
    bind:open={open.tooLong}
    kind="form"
    unsavedChanges={false}
    fields={longFields}
    onCommit={commit}
  />
{/snippet}

{#snippet expandedTemplate()}
  <ActionDialog
    heading="Write Off a Balance"
    subtitle={{ facts: ["Expanded, the panel is the screen"] }}
    commitLabel="Write It Off"
    bind:open={open.expanded}
    expanded={true}
    kind="form"
    unsavedChanges={false}
    fields={longFields}
    onCommit={commit}
  />
{/snippet}

{#snippet recordTemplate()}
  <RecordWindow
    heading="Deposition preparation"
    bind:open={open.record}
    tabs={[{ key: "history", label: "History", content: historyTab }]}
    {subtitle}
    {record}
    {actions}
    onSave={() => undefined}
    onPrint={() => undefined}
  />
{/snippet}

{#snippet recordTooLongTemplate()}
  <RecordWindow
    heading="Deposition preparation"
    bind:open={open.recordTooLong}
    tabs={[{ key: "history", label: "History", content: historyTab }]}
    {subtitle}
    record={longRecord}
    {actions}
    onSave={() => undefined}
    onPrint={() => undefined}
  />
{/snippet}

<Story name="Dialog" template={dialogTemplate} />
<Story name="AlertDialog" template={alertDialogTemplate} />
<Story name="ActionDialogForm" template={formTemplate} />
<Story name="ActionDialogWithContext" template={withContextTemplate} />
<Story name="ActionDialogTooLong" template={tooLongTemplate} />
<Story name="ActionDialogExpanded" template={expandedTemplate} />
<Story name="RecordWindow" template={recordTemplate} />
<Story name="RecordWindowTooLong" template={recordTooLongTemplate} />
