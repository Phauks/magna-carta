<script lang="ts">
  /*
   * Voiding a draft.
   *
   * ONLY A DRAFT CAN BE VOIDED. A finalized bill is corrected by a credit note, never erased, and
   * saying that here is what stops somebody looking for this control on a bill that has one.
   *
   * THE WORK COMES BACK. Voiding releases every entry the draft holds to unbilled work — the draft
   * itself stays on the record, so the attempt is visible rather than vanished. The reason is
   * required by the route, and it is what somebody reads later when they ask why a period has two
   * drafts and one bill.
   */
  import * as Alert from "@magna-carta/design-system/alert";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import type { StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import ActionDialog from "@magna-carta/design-system/action-dialog";
  import type { ActionOutcome } from "@magna-carta/design-system/action-dialog";
  import Input from "@magna-carta/design-system/input";
  import Label from "@magna-carta/design-system/label";
  import { placeholderOf } from "@magna-carta/design-system/formatters";
  import Info from "@lucide/svelte/icons/info";
  import { billingFailure, voidInvoiceDraft } from "./billing-api.ts";
  import type { InvoiceRow } from "./invoice-standing.ts";

  let {
    open = $bindable(false),
    row,
    onVoided,
  }: {
    open?: boolean;
    row: InvoiceRow | null;
    onVoided: () => void;
  } = $props();

  const fieldPrefix = $props.id();

  let reason = $state("");
  let failure = $state<StatedFailure | null>(null);

  function reset(): void {
    reason = "";
    failure = null;
  }

  const lineCount = $derived(row?.detail?.lines.length ?? 0);
  const refusal = $derived.by((): string | undefined => {
    if (row === null) return "No draft is open.";
    if (reason.trim() === "") {
      return "A reason is required.";
    }
    return undefined;
  });

  async function voidDraft(): Promise<ActionOutcome> {
    if (row === null) return "refused";
    failure = null;
    const outcome = await voidInvoiceDraft(fetch, row.summary.id, reason.trim(), crypto.randomUUID());
    if (outcome.kind === "ok") {
      onVoided();
      return "committed";
    }
    failure = billingFailure(outcome, "The draft is unchanged.");
    return "refused";
  }
</script>

<ActionDialog
  bind:open
  kind="destructive"
  heading="Void This Draft"
  commitLabel="Void Draft"
  commitBusyLabel="Voiding"
  commitRefusal={refusal}
  unsavedChanges={reason.trim() !== ""}
  onOpen={reset}
  onCommit={voidDraft}
>
  {#snippet subtitle()}
    {lineCount === 1 ? "1 line" : `${String(lineCount)} lines`} on the draft
  {/snippet}

  {#snippet notice()}
    {#if failure !== null}
      <FailureNotice
        failure={failure.failure}
        title="Nothing Was Voided"
        fallback={failure.fallback}
      />
    {/if}
  {/snippet}

  {#snippet fields({ busy })}
    <div class="flex flex-col gap-16">
      <p class="flex items-start gap-8 text-sm text-text-muted">
        <Info class="mt-4 size-16 shrink-0" aria-hidden="true" />
        <span>
          Voiding returns every entry on this draft to unbilled. The voided draft stays on record. To correct a finalized bill, add a credit note instead.
        </span>
      </p>
      <div class="flex flex-col gap-8">
        <Label for="{fieldPrefix}-reason">Reason</Label>
        <Input
          id="{fieldPrefix}-reason"
          placeholder={placeholderOf("Reason")}
          disabled={busy}
          bind:value={reason}
        />
        <p class="text-xs text-text-muted">Why this draft is being thrown away.</p>
      </div>
    </div>
  {/snippet}
</ActionDialog>
