<script lang="ts">
  /*
   * Opening a draft bill.
   *
   * THE CLIENT IS SHOWN, NEVER CHOSEN. An invoice belongs to one client and may bill several of that
   * client's matters; this matter's client is resolved from its own party record, so offering a
   * picker would be inviting somebody to bill the wrong person for work they did not commission.
   *
   * WHAT A DRAFT IS. A working document. Nothing is asserted to anybody, no number is drawn, and no
   * work is locked — which is why the footer says so beside the control rather than after it.
   *
   * A SECOND DRAFT IS ALLOWED AND IS USUALLY A MISTAKE. Two drafts cannot claim the same entry: the
   * claim itself is the guarantee, and the second one is refused by name. The dialog says that where
   * a draft is already open, so nobody discovers it one claim at a time.
   */
  import * as Alert from "@magna-carta/design-system/alert";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import type { StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import * as Dialog from "@magna-carta/design-system/dialog";
  import Button from "@magna-carta/design-system/button";
  import Input from "@magna-carta/design-system/input";
  import Label from "@magna-carta/design-system/label";
  import Info from "@lucide/svelte/icons/info";
  import Plus from "@lucide/svelte/icons/plus";
  import { billingFailure, createInvoice } from "./billing-api.ts";
  import { civilDatePlusDays, civilToday } from "./invoice-standing.ts";

  let {
    open = $bindable(false),
    clientEntityId,
    clientName,
    matterNumber,
    aDraftIsOpen,
    onOpened,
  }: {
    open?: boolean;
    /** The client the matter's own party record resolves to. */
    clientEntityId: string;
    clientName: string;
    matterNumber: string | null;
    /** Whether this client already has a draft standing open. */
    aDraftIsOpen: boolean;
    /** The draft was opened. The register re-reads and selects it. */
    onOpened: (invoiceId: string) => void;
  } = $props();

  const fieldPrefix = $props.id();

  let periodStart = $state("");
  let periodEnd = $state("");
  let working = $state(false);
  let failure = $state<StatedFailure | null>(null);

  // A fresh opening starts from a fresh month: the period a firm bills is almost always the one just
  // finished, and carrying the last dialog's dates into this one is how a bill gets the wrong period.
  $effect(() => {
    if (!open) return;
    const today = civilToday();
    periodStart = `${today.slice(0, 8)}01`;
    periodEnd = today;
    failure = null;
  });

  async function openDraft(): Promise<void> {
    if (working) return;
    working = true;
    failure = null;
    const outcome = await createInvoice(
      fetch,
      {
        clientEntityId,
        currency: "USD",
        billingPeriodStart: periodStart === "" ? null : periodStart,
        billingPeriodEnd: periodEnd === "" ? null : periodEnd,
      },
      // A retried open must not raise a second draft against the same client.
      crypto.randomUUID(),
    );
    working = false;
    if (outcome.kind === "ok") {
      open = false;
      onOpened(outcome.value.invoiceId);
      return;
    }
    failure = billingFailure(outcome, "No draft was opened.");
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Content showClose={false}>
    <Dialog.Title>Draft a Bill</Dialog.Title>
    <Dialog.Description>
      {clientName}{matterNumber === null ? "" : ` · Matter ${matterNumber}`}
    </Dialog.Description>

    {#if failure !== null}
      <FailureNotice
        failure={failure.failure}
        title="Nothing Was Opened"
        fallback={failure.fallback}
      />
    {/if}

    <div class="flex flex-col gap-16">
      <p class="flex items-start gap-8 text-sm text-text-muted">
        <Info class="mt-4 size-16 shrink-0" aria-hidden="true" />
        <span>
          An invoice belongs to one client and may bill several of that client's matters. This
          matter's client is resolved from its own party record: it is shown, never chosen.
        </span>
      </p>

      <div class="grid gap-12 sm:grid-cols-2">
        <div class="flex flex-col gap-8">
          <Label for="{fieldPrefix}-period-start">Billing Period Starts</Label>
          <Input
            id="{fieldPrefix}-period-start"
            type="date"
            disabled={working}
            bind:value={periodStart}
          />
        </div>
        <div class="flex flex-col gap-8">
          <Label for="{fieldPrefix}-period-end">Billing Period Ends</Label>
          <Input
            id="{fieldPrefix}-period-end"
            type="date"
            disabled={working}
            bind:value={periodEnd}
          />
        </div>
      </div>
      <p class="text-xs text-text-muted">
        The period is what the bill says it covers. The issue and due dates are drawn at
        finalization, from {civilToday()} and {civilDatePlusDays(civilToday(), 30)} by default.
      </p>

      {#if aDraftIsOpen}
        <p class="text-xs text-status-warning-subtle-foreground">
          A draft for this client is already open. A second draft cannot claim the same entries: a
          claim held by one draft is refused to another, by name.
        </p>
      {/if}
    </div>

    <div class="flex flex-wrap items-center justify-end gap-8">
      <span class="mr-auto max-w-sm text-xs text-text-subtle">
        Opens a draft: a working document, voidable, asserting nothing to anybody.
      </span>
      <Button variant="secondary" disabled={working} onclick={() => (open = false)}>Cancel</Button>
      <Button disabled={working} onclick={() => void openDraft()}>
        <Plus class="size-16" aria-hidden="true" />
        {working ? "Opening" : "Open Draft"}
      </Button>
    </div>
  </Dialog.Content>
</Dialog.Root>
