<script lang="ts">
  /*
   * NOTES on one line: what the line is, a Needs Review switch, every note written on it so far,
   * and a box to add one. Notes are never undone and never removed, and they stay after the
   * reconciliation is finished, so a question asked in October is still there to read in March.
   * Mark Resolved turns Needs Review off and records who did it.
   */
  import ActionDialog from "@magna-carta/design-system/action-dialog";
  import Button from "@magna-carta/design-system/button";
  import Switch from "@magna-carta/design-system/switch";
  import Textarea from "@magna-carta/design-system/textarea";
  import { formatInstant } from "@magna-carta/design-system/formatters";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import type { Failure } from "$lib/api/problem.ts";
  import type {
    TrustBankReconciliationLine,
    TrustBankReconciliationNote,
  } from "./reconciliation-api.ts";
  import { lineKey } from "./reconciliation-model.ts";

  let {
    open = $bindable(false),
    line,
    heading,
    detail,
    notes,
    needsReview,
    refusal,
    onWrite,
  }: {
    open?: boolean;
    line: TrustBankReconciliationLine | null;
    /** The line as a person would say it: "Jordan Smith, $1,000.00". */
    heading: string;
    /** The line's type and date, and its matter where it has one. */
    detail: string;
    /** Every note on the reconciliation; this panel shows the line's own. */
    notes: readonly TrustBankReconciliationNote[];
    needsReview: boolean;
    /** Why this reader may not write here, or undefined where they may. */
    refusal: string | undefined;
    /** Record a note or a review mark. Resolves to the failure, or null. */
    onWrite: (
      line: TrustBankReconciliationLine,
      kind: TrustBankReconciliationNote["kind"],
      body: string | null,
    ) => Promise<Failure | null>;
  } = $props();

  let draft = $state("");
  let busy = $state(false);
  let failure = $state<Failure | null>(null);

  $effect(() => {
    if (open) {
      void line;
      draft = "";
      failure = null;
    }
  });

  const own = $derived(
    line === null ? [] : notes.filter((note) => lineKey(note.line) === lineKey(line)),
  );

  async function write(kind: TrustBankReconciliationNote["kind"], body: string | null): Promise<void> {
    if (line === null) return;
    busy = true;
    failure = await onWrite(line, kind, body);
    busy = false;
    if (failure === null && kind === "note") draft = "";
  }

  function markText(note: TrustBankReconciliationNote): string {
    const who = note.writtenByName ?? "Someone";
    return note.kind === "needs_review" ? `${who} marked this Needs Review` : `${who} marked this resolved`;
  }
</script>

<ActionDialog bind:open kind="reading" {heading} subtitle={{ facts: [detail] }}>
  {#snippet notice()}
    {#if failure !== null}
      <FailureNotice {failure} title="The Note Was Not Saved" fallback="Nothing on this line changed." />
    {/if}
  {/snippet}
  {#snippet fields()}
    <div class="flex flex-col gap-16">
      <div class="flex items-start justify-between gap-12 rounded-md border border-border-default p-12">
        <div class="flex flex-col gap-2">
          <span id="needs-review-label" class="font-medium">Needs Review</span>
          <span class="text-sm text-text-muted">Stays on the review list and the report until resolved.</span>
        </div>
        <Switch
          aria-labelledby="needs-review-label"
          checked={needsReview}
          disabled={busy || refusal !== undefined}
          title={refusal}
          onCheckedChange={(next) => void write(next ? "needs_review" : "resolved", null)}
        />
      </div>

      {#if own.length === 0}
        <p class="text-sm text-text-muted">No notes on this line yet.</p>
      {:else}
        <ol class="flex flex-col gap-12">
          {#each own as note (note.noteId)}
            <li class="flex flex-col gap-4">
              <p class="text-sm">
                <span class="font-medium">{note.kind === "note" ? (note.writtenByName ?? "Someone") : markText(note)}</span>
                <span class="text-text-muted">{formatInstant(note.writtenAt)}</span>
              </p>
              {#if note.kind === "note"}
                <p class="rounded-md bg-surface-sunken p-12 text-sm whitespace-pre-wrap">{note.body}</p>
              {/if}
            </li>
          {/each}
        </ol>
      {/if}

      <div class="flex flex-col gap-8">
        <Textarea
          aria-label="Note"
          placeholder="Note"
          disabled={busy || refusal !== undefined}
          bind:value={draft}
        />
        <div class="flex flex-wrap items-center justify-end gap-8">
          {#if needsReview}
            <Button
              variant="secondary"
              disabled={busy || refusal !== undefined}
              title={refusal}
              onclick={() => void write("resolved", null)}
            >
              Mark Resolved
            </Button>
          {/if}
          <Button
            variant="primary"
            disabled={busy || refusal !== undefined || draft.trim() === ""}
            title={refusal}
            onclick={() => void write("note", draft.trim())}
          >
            Add Note
          </Button>
        </div>
      </div>
    </div>
  {/snippet}
</ActionDialog>
