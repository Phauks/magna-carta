<script lang="ts">
  /*
   * Deleting a draft that never entered review — one dialog for every ledger with the route.
   *
   * DELETING IS NOT VOIDING, and this dialog exists to say so before the press rather than after.
   * A draft nobody has been shown is a typing mistake: there is no record to preserve, so it is
   * removed and leaves nothing behind. Anything submitted, approved, billed or voided is a record
   * somebody may be asked to account for; the server refuses it here and it is withdrawn with Void
   * instead, which keeps it on the ledger.
   *
   * It is destructive in the way Void only feels destructive, so it carries the destructive
   * confirmation and says plainly that the record does not come back.
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
    commit,
    onDeleted,
  }: {
    open?: boolean;
    /** What this ledger calls one of its records, capitalized: "Fee". */
    noun: string;
    /** The line naming the draft on screen, or null when nothing is open. */
    subject: string | null;
    /** The write. It stays with the caller, so this dialog holds no transport of its own. */
    commit: () => Promise<ApiOutcome<unknown>>;
    onDeleted: () => void;
  } = $props();

  let failure = $state<StatedFailure | null>(null);
  const lowerNoun = $derived(noun.toLowerCase());

  function reset(): void {
    failure = null;
  }

  async function remove(): Promise<ActionOutcome> {
    if (subject === null) return "refused";
    failure = null;
    const outcome = await commit();
    if (outcome.kind === "ok") {
      onDeleted();
      return "committed";
    }
    failure = stated(
      outcome.failure,
      `The draft ${lowerNoun} was not deleted.`,
      `The draft ${lowerNoun} was not deleted and is unchanged.`,
    );
    return "refused";
  }
</script>

<ActionDialog
  bind:open
  kind="destructive"
  heading="Delete Draft {noun}"
  commitLabel="Delete Draft"
  commitBusyLabel="Deleting"
  commitRefusal={subject === null ? `No draft ${lowerNoun} is open.` : undefined}
  unsavedChanges={false}
  onOpen={reset}
  onCommit={remove}
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
      The draft is deleted for good. Nothing was submitted or billed from it, so there&rsquo;s no record to keep. To keep a record, void it instead.
    </p>
  {/snippet}
</ActionDialog>
