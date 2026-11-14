<script lang="ts">
  /*
   * Returning a record to the person who wrote it down — one dialog for every ledger with review.
   *
   * THE REASON IS THE ACT. A kick-back with no reason is a rejection with no instruction in it: the
   * recorder is left to guess what to change, and the audit trail records that somebody was unhappy
   * rather than what was wrong. So the control refuses until a reason is written, and says so before
   * it is pressed rather than after.
   *
   * The record returns to draft and becomes editable again. Nothing about it is removed. As with
   * the void dialog beside it, a ledger contributes its noun, the line naming the record and the
   * write itself; the wording of the act is here so two ledgers cannot describe it differently.
   */
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import ActionDialog from "@magna-carta/design-system/action-dialog";
  import type { ActionOutcome } from "@magna-carta/design-system/action-dialog";
  import Label from "@magna-carta/design-system/label";
  import Textarea from "@magna-carta/design-system/textarea";
  import { placeholderOf } from "@magna-carta/design-system/formatters";
  import type { ApiOutcome } from "$lib/api/request.ts";

  let {
    open = $bindable(false),
    noun,
    subject,
    commit,
    onKickedBack,
  }: {
    open?: boolean;
    /** What this ledger calls one of its records, capitalized: "Cost", "Fee". */
    noun: string;
    /** The line naming the record being returned, or null when nothing is open. */
    subject: string | null;
    /** The write, given the reason. It stays with the caller. */
    commit: (reason: string) => Promise<ApiOutcome<unknown>>;
    /** The record is a draft again. The consumer re-reads its ledger. */
    onKickedBack: () => void;
  } = $props();

  const fieldPrefix = $props.id();
  const lowerNoun = $derived(noun.toLowerCase());

  let reason = $state("");
  let failure = $state<StatedFailure | null>(null);

  // A fresh opening is a fresh reason: reopening on another record must never carry the last one's.
  function reset(): void {
    reason = "";
    failure = null;
  }

  const refusal = $derived.by((): string | undefined => {
    if (subject === null) return `No ${lowerNoun} is open.`;
    if (reason.trim() === "") return "Enter the reason: it is recorded for the recorder to act on";
    return undefined;
  });

  async function send(): Promise<ActionOutcome> {
    if (subject === null) return "refused";
    failure = null;
    const outcome = await commit(reason.trim());
    if (outcome.kind === "ok") {
      onKickedBack();
      return "committed";
    }
    failure = stated(
      outcome.failure,
      `The ${lowerNoun} was not returned.`,
      `The ${lowerNoun} was not returned and is unchanged.`,
    );
    return "refused";
  }
</script>

<ActionDialog
  bind:open
  heading="Kick Back {noun}"
  commitLabel="Kick Back"
  commitBusyLabel="Returning"
  commitRefusal={refusal}
  unsavedChanges={reason.trim() !== ""}
  onOpen={reset}
  onCommit={send}
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

  {#snippet fields({ busy }: { busy: boolean })}
    <div class="flex flex-col gap-8">
      <Label for="{fieldPrefix}-reason">Reason</Label>
      <Textarea
        id="{fieldPrefix}-reason"
        rows={3}
        placeholder={placeholderOf("Reason")}
        disabled={busy}
        bind:value={reason}
      />
      <p class="text-xs text-text-muted">
        Say what needs to change before this {lowerNoun} can be approved. It goes back as a draft to the person who recorded it, and the reason is saved in the audit trail.
      </p>
    </div>
  {/snippet}
</ActionDialog>
