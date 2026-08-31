<script lang="ts">
  /*
   * Taking earned fees out of a client's trust ledger against a finalized bill.
   *
   * THIS SURFACE IS DESIGNED AND NOT YET SERVED, AND IT RENDERS IN FULL. A transfer names the trust
   * account the money leaves, and nothing lists a firm's trust accounts: the matter-ledger read and
   * the transfer itself both take a trust-account handle, and there is no route that hands one out.
   * So the whole anatomy is here — the ceiling, the delivery fact, the amount — with the act
   * disabled and the dependency named, rather than a control that would be refused for a reason the
   * reader could not have known.
   *
   * WHAT IS ALREADY TRUE AND IS SHOWN. The ceiling is the bill's own unpaid share for this matter,
   * which is read: a transfer may never draw more than that, and the domain refuses the same ceiling
   * by name for any caller that gets past this screen. What is not shown is the trust balance, and
   * it says so rather than displaying a zero that would read as an empty ledger.
   *
   * THE DELIVERY FACT SITS BESIDE THE DECISION AND GATES NOTHING. Several jurisdictions expect the
   * client to have been given the bill before fees are taken. It is recorded, it is shown here, and
   * the firm proceeds knowingly — a hard gate would be satisfied by firms recording deliveries that
   * never happened.
   */
  import * as Dialog from "@magna-carta/design-system/dialog";
  import Button from "@magna-carta/design-system/button";
  import Input from "@magna-carta/design-system/input";
  import Label from "@magna-carta/design-system/label";
  import CircleCheck from "@lucide/svelte/icons/circle-check";
  import Info from "@lucide/svelte/icons/info";
  import Shield from "@lucide/svelte/icons/shield";
  import SoonAffordance from "$lib/maturity/soon-affordance.svelte";
  import { amountFieldText } from "./amount-entry.ts";
  import { matterUnpaidMinor, type InvoiceRow } from "./invoice-standing.ts";

  let {
    open = $bindable(false),
    row,
    matterId,
    money,
    formatDate,
  }: {
    open?: boolean;
    row: InvoiceRow | null;
    matterId: string;
    money: (amountMinor: number) => string;
    formatDate: (isoDate: string) => string;
  } = $props();

  const fieldPrefix = $props.id();

  /** What the trust side is waiting on, as the noun phrase the Soon sentence completes. */
  const TRUST_DEPENDENCY =
    "a read of the firm's trust accounts: both the matter's trust ledger and the transfer itself " +
    "name a trust account, and no route hands one out yet";

  const ceiling = $derived(row === null ? 0 : (matterUnpaidMinor(row, matterId) ?? 0));
  const delivery = $derived(row?.detail?.delivery ?? null);

  let amount = $state("");

  $effect(() => {
    if (!open) return;
    amount = amountFieldText(ceiling);
  });
</script>

<Dialog.Root bind:open>
  <Dialog.Content showClose={false}>
    <Dialog.Title>Apply Trust Funds</Dialog.Title>
    <Dialog.Description>
      {row?.summary.invoiceNumber ?? "This bill"} · earned fees from the client's trust ledger
    </Dialog.Description>

    <div class="flex flex-col gap-16">
      <dl class="flex flex-col gap-4 text-sm">
        <div class="flex items-baseline justify-between gap-16">
          <dt class="text-text-muted">Available In Trust</dt>
          <dd class="text-right text-text-subtle">Not read yet</dd>
        </div>
        <div class="flex items-baseline justify-between gap-16">
          <dt class="text-text-muted">This Matter Still Owes</dt>
          <dd class="text-right tabular-nums">{money(ceiling)} on this bill</dd>
        </div>
        <div class="flex items-baseline justify-between gap-16">
          <dt class="text-text-muted">Ceiling</dt>
          <dd class="text-right tabular-nums">
            {money(ceiling)}
          </dd>
        </div>
      </dl>
      <p class="text-xs text-text-subtle">
        A transfer may not draw more than this matter's own unpaid share of this bill. The ceiling
        will narrow further once the trust ledger can be read, because it is also bounded by what
        the matter's leaf actually holds, net of holds.
      </p>

      {#if delivery !== null && delivery.delivered && delivery.deliveredOn !== null}
        <p class="flex items-start gap-8 text-sm text-text-muted">
          <CircleCheck class="mt-4 size-16 shrink-0" aria-hidden="true" />
          <span>
            A delivery of this bill is on record, first {formatDate(delivery.deliveredOn)}.
          </span>
        </p>
      {:else}
        <p class="flex items-start gap-8 text-sm text-status-warning-subtle-foreground">
          <Info class="mt-4 size-16 shrink-0" aria-hidden="true" />
          <span>
            No delivery of this bill has been recorded. Several jurisdictions expect the client to
            have been given the bill before fees are taken: it is recorded here, shown here, and the
            firm proceeds knowingly. It does not gate.
          </span>
        </p>
      {/if}

      <div class="flex flex-col gap-8">
        <Label for="{fieldPrefix}-amount">Amount To Apply</Label>
        <Input id="{fieldPrefix}-amount" disabled bind:value={amount} />
        <p class="text-xs text-text-muted">
          Applying part of what is owed is ordinary: the rest stays owing and can be applied later.
        </p>
      </div>
    </div>

    <div class="flex flex-wrap items-center justify-end gap-8">
      <span class="mr-auto max-w-sm text-xs text-text-subtle">
        Money leaves trust only against a finalized bill. There is no override.
      </span>
      <Button variant="secondary" onclick={() => (open = false)}>Close</Button>
      <SoonAffordance reason={TRUST_DEPENDENCY} reasonPlacement="line">
        {#snippet control(soon)}
          <Button {...soon}>
            <Shield class="size-16" aria-hidden="true" />
            Apply From Trust
          </Button>
        {/snippet}
      </SoonAffordance>
    </div>
  </Dialog.Content>
</Dialog.Root>
