<script lang="ts">
  /*
   * Reverse Bill: a bill entered in error comes off the books, with the matter costs it made.
   *
   * THE REASON IS REQUIRED, because a bill that vanished with no reason is the first question at
   * the year end. A bill with payments, or whose cost is already on a finalized invoice, is refused
   * by the server with the words to act on.
   */
  import ActionDialog, { type ActionOutcome } from "@magna-carta/design-system/action-dialog";
  import type { RecordSubject } from "@magna-carta/design-system/record-reference";
  import * as DefinitionList from "@magna-carta/design-system/definition-list";
  import LabelledField from "@magna-carta/design-system/labelled-field";
  import Textarea from "@magna-carta/design-system/textarea";
  import { todayInUtc } from "@magna-carta/civil-time/civil-date";
  import type { VendorBillSummary } from "@magna-carta/api-client";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import { WriteIntent } from "$lib/api/write-intent.ts";
  import { reverseVendorBill } from "./payables-api.ts";
  import { money } from "./vendor-bill-view.ts";

  let {
    open = $bindable(false),
    bill,
    vendorName,
    onReversed,
  }: {
    open?: boolean;
    bill: VendorBillSummary | null;
    vendorName: string;
    onReversed: () => void;
  } = $props();

  let reason = $state("");
  let failure = $state<StatedFailure | null>(null);
  const intent = new WriteIntent();

  const subtitle = $derived<RecordSubject>({
    facts: bill === null ? [] : [vendorName, bill.billReference ?? "No bill number", money(bill.amountMinor)],
  });
  const refusal = $derived(reason.trim() === "" ? "Give a reason." : undefined);

  async function commit(): Promise<ActionOutcome> {
    if (bill === null) return "refused";
    failure = null;
    const vendorBillId = bill.vendorBillId;
    const { value: outcome } = await intent.submit((key) =>
      reverseVendorBill(vendorBillId, { reason: reason.trim(), reversedOn: todayInUtc() }, key),
    );
    if (outcome.kind !== "ok") {
      failure = stated(outcome.failure, "The bill was not reversed.");
      return "refused";
    }
    onReversed();
    return "committed";
  }
</script>

<ActionDialog
  bind:open
  kind="destructive"
  heading="Reverse Bill"
  {subtitle}
  commitLabel="Reverse Bill"
  commitBusyLabel="Reversing"
  commitRefusal={refusal}
  unsavedChanges={reason.trim() !== ""}
  onOpen={() => {
    reason = "";
    failure = null;
  }}
  onCommit={commit}
>
  {#snippet notice()}
    {#if failure !== null}
      <FailureNotice
        failure={failure.failure}
        title="The Bill Was Not Reversed"
        fallback={failure.fallback}
        whenSilent={failure.whenSilent}
      />
    {/if}
  {/snippet}

  {#snippet fields({ busy })}
    <div class="flex flex-col gap-16">
      <LabelledField necessity="required" label="Reason">
        {#snippet children({ props })}
          <Textarea {...props} rows={3} resizable={false} disabled={busy} bind:value={reason} />
        {/snippet}
      </LabelledField>
      <DefinitionList.Root>
        <DefinitionList.Row term="What Changes">
          The bill comes off what the firm owes, and any cost it put on a matter is voided.
        </DefinitionList.Row>
      </DefinitionList.Root>
    </div>
  {/snippet}
</ActionDialog>
