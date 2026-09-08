<script lang="ts">
  /*
   * Withdrawing a work-in-progress record — one dialog for every ledger that has the act.
   *
   * This is the one irreversible-feeling act on the ledgers, so it is a confirmation rather than a
   * click, and it is done one record at a time. What the dialog has to make unmissable is that
   * NOTHING IS DELETED: the record freezes, stops counting toward every total, and stays on the
   * ledger as evidence of what was withdrawn.
   *
   * WHAT A LEDGER CONTRIBUTES IS THREE STRINGS AND ONE CALL. The noun it calls its records, the
   * line identifying the one on screen, the sentence saying what withdrawing means in its own terms
   * — and the write itself, which stays at the call site so this file holds no transport and knows
   * about no store. Everything else, including how a refusal reads, is the same on every ledger,
   * which is the point: the cost version of this dialog and the fee version cannot drift into
   * saying different things about the same act.
   */
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import ActionDialog from "@magna-carta/design-system/action-dialog";
  import type { ActionOutcome } from "@magna-carta/design-system/action-dialog";
  import type { ApiOutcome } from "$lib/api/request.ts";

  let {
    open = $bindable(false),
    noun,
    subject,
    consequence,
    commit,
    onVoided,
  }: {
    open?: boolean;
    /** What this ledger calls one of its records, capitalized: "Cost", "Fee". */
    noun: string;
    /** The line naming the record on screen, or null when nothing is open. */
    subject: string | null;
    /** What withdrawing means on this ledger, in its own words. */
    consequence: string;
    /** The write. It stays with the caller, so this dialog holds no transport of its own. */
    commit: () => Promise<ApiOutcome<unknown>>;
    onVoided: () => void;
  } = $props();

  let failure = $state<StatedFailure | null>(null);
  const lowerNoun = $derived(noun.toLowerCase());

  function reset(): void {
    failure = null;
  }

  async function withdraw(): Promise<ActionOutcome> {
    if (subject === null) return "refused";
    failure = null;
    const outcome = await commit();
    if (outcome.kind === "ok") {
      onVoided();
      return "committed";
    }
    failure = stated(
      outcome.failure,
      `The ${lowerNoun} was not voided.`,
      `The ${lowerNoun} was not voided and is unchanged.`,
    );
    return "refused";
  }
</script>

<ActionDialog
  bind:open
  kind="destructive"
  heading="Void {noun}"
  commitLabel="Void {noun}"
  commitBusyLabel="Voiding"
  commitRefusal={subject === null ? `No ${lowerNoun} is open.` : undefined}
  unsavedChanges={false}
  onOpen={reset}
  onCommit={withdraw}
>
  {#snippet subtitle()}{subject ?? ""}{/snippet}

  {#snippet notice()}
    {#if failure !== null}
      <FailureNotice
        failure={failure.failure}
        title="Nothing Changed"
        fallback={failure.fallback}
        whenSilent={failure.whenSilent}
      />
    {/if}
  {/snippet}

  {#snippet fields()}
    <p class="text-sm">
      {consequence} It stays on the record, struck through, with everything it recorded. Nothing is
      deleted.
    </p>
  {/snippet}
</ActionDialog>
