<script lang="ts">
  /*
   * HISTORY: every change to this reconciliation, newest first, by whoever made it. Any change
   * still in force can be undone from here, whoever made it; undoing is itself a change and joins
   * the list. Notes are not changes and never appear here, because a note is never undone.
   */
  import ActionDialog from "@magna-carta/design-system/action-dialog";
  import Badge from "@magna-carta/design-system/badge";
  import Button from "@magna-carta/design-system/button";
  import { formatInstant } from "@magna-carta/design-system/formatters";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import type { Failure } from "$lib/api/problem.ts";
  import type {
    TrustBankReconciliationChange,
    TrustBankReconciliationDetail,
  } from "./reconciliation-api.ts";
  import { causeLabel, changeSentence } from "./reconciliation-model.ts";

  let {
    open = $bindable(false),
    detail,
    money,
    refusal,
    onUndo,
  }: {
    open?: boolean;
    detail: TrustBankReconciliationDetail | null;
    money: (minor: number) => string;
    /** Why this reader may not undo, or undefined where they may. */
    refusal: string | undefined;
    onUndo: (change: TrustBankReconciliationChange) => Promise<Failure | null>;
  } = $props();

  let busy = $state<string | null>(null);
  let failure = $state<Failure | null>(null);

  const changes = $derived([...(detail?.changes ?? [])].reverse());

  async function undo(change: TrustBankReconciliationChange): Promise<void> {
    busy = change.changeId;
    failure = await onUndo(change);
    busy = null;
  }
</script>

<ActionDialog bind:open kind="reading" heading="History" width="wide">
  {#snippet notice()}
    {#if failure !== null}
      <FailureNotice {failure} title="That Change Was Not Undone" fallback="Nothing changed." />
    {/if}
  {/snippet}
  {#snippet fields()}
    {#if detail === null || changes.length === 0}
      <p class="text-sm text-text-muted">No changes yet.</p>
    {:else}
      <ol class="flex flex-col divide-y divide-border-default">
        {#each changes as change (change.changeId)}
          {@const cause = causeLabel(change)}
          <li class="flex flex-wrap items-center justify-between gap-8 py-8">
            <div class="flex min-w-0 flex-col gap-2">
              <p class="text-sm">
                {changeSentence(change, detail, money)}
                {#if cause !== null}<Badge variant="neutral">{cause}</Badge>{/if}
              </p>
              <p class="text-xs text-text-muted">
                {change.changedByName ?? "Someone"}, {formatInstant(change.changedAt)}
              </p>
            </div>
            {#if change.canRevert && detail.reconciliation.finishedAt === null}
              <Button
                variant="ghost"
                size="sm"
                disabled={busy !== null || refusal !== undefined}
                title={refusal}
                onclick={() => void undo(change)}
              >
                {busy === change.changeId ? "Undoing" : "Undo"}
              </Button>
            {/if}
          </li>
        {/each}
      </ol>
    {/if}
  {/snippet}
</ActionDialog>
