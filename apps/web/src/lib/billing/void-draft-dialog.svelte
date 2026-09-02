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
  import * as Dialog from "@magna-carta/design-system/dialog";
  import Button from "@magna-carta/design-system/button";
  import Input from "@magna-carta/design-system/input";
  import Label from "@magna-carta/design-system/label";
  import { placeholderOf } from "@magna-carta/design-system/formatters";
  import Info from "@lucide/svelte/icons/info";
  import Ban from "@lucide/svelte/icons/ban";
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
  let working = $state(false);
  let failure = $state<StatedFailure | null>(null);

  $effect(() => {
    if (!open) return;
    reason = "";
    failure = null;
  });

  const lineCount = $derived(row?.detail?.lines.length ?? 0);
  const refusal = $derived(
    reason.trim() === "" ? "A reason is required. It is what somebody reads years later." : null,
  );

  async function voidDraft(): Promise<void> {
    if (row === null || working || refusal !== null) return;
    working = true;
    failure = null;
    const outcome = await voidInvoiceDraft(fetch, row.summary.id, reason.trim(), crypto.randomUUID());
    working = false;
    if (outcome.kind === "ok") {
      open = false;
      onVoided();
      return;
    }
    failure = billingFailure(outcome, "The draft is unchanged.");
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Content showClose={false}>
    <Dialog.Title>Void This Draft</Dialog.Title>
    <Dialog.Description>
      {lineCount === 1 ? "1 line" : `${String(lineCount)} lines`} on the draft
    </Dialog.Description>

    {#if failure !== null}
      <FailureNotice
        failure={failure.failure}
        title="Nothing Was Voided"
        fallback={failure.fallback}
      />
    {/if}

    <div class="flex flex-col gap-16">
      <p class="flex items-start gap-8 text-sm text-text-muted">
        <Info class="mt-4 size-16 shrink-0" aria-hidden="true" />
        <span>
          Voiding releases every entry this draft holds back to unbilled work. The voided draft
          stays on the record. Only a draft can be voided: a finalized bill is corrected by a credit
          note, never erased.
        </span>
      </p>
      <div class="flex flex-col gap-8">
        <Label for="{fieldPrefix}-reason">Reason</Label>
        <Input
          id="{fieldPrefix}-reason"
          placeholder={placeholderOf("Reason")}
          disabled={working}
          bind:value={reason}
        />
        <p class="text-xs text-text-muted">Why this draft is being thrown away.</p>
      </div>
    </div>

    <div class="flex flex-wrap items-center justify-end gap-8">
      <Button variant="secondary" disabled={working} onclick={() => (open = false)}>Cancel</Button>
      <Button
        variant="destructive"
        disabled={working || refusal !== null}
        title={refusal ?? "Void this draft and return its work to unbilled"}
        onclick={() => void voidDraft()}
      >
        <Ban class="size-16" aria-hidden="true" />
        {working ? "Voiding" : "Void Draft"}
      </Button>
    </div>
    {#if refusal !== null}
      <p class="text-right text-xs text-text-muted">{refusal}</p>
    {/if}
  </Dialog.Content>
</Dialog.Root>
