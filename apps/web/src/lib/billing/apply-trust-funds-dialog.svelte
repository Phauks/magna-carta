<script lang="ts">
  /*
   * Taking earned fees out of a client's trust ledger against a finalized bill.
   *
   * THIS SURFACE IS DESIGNED AND NOT YET SERVED, AND IT RENDERS IN FULL. A transfer names the trust
   * account the money leaves, and nothing lists a firm's trust accounts: the matter-ledger read and
   * the transfer itself both take a trust-account handle, and there is no route that hands one out.
   * So the whole anatomy is here — the ceiling, the delivery fact, the amount — with the act
   * disabled and the dependency named, rather than a control that would be refused for a reason the
   * reader could not have known. The shell renders that: `commitSoon` names the dependency, and the
   * commit stands in the bar with its Soon mark, saying what it waits on.
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
  import ActionDialog from "@magna-carta/design-system/action-dialog";
  import type { RecordSubject } from "@magna-carta/design-system/record-reference";
  import type { ActionOutcome } from "@magna-carta/design-system/action-dialog";
  import Input from "@magna-carta/design-system/input";
  import LabelledField from "@magna-carta/design-system/labelled-field";
  import CircleCheck from "@lucide/svelte/icons/circle-check";
  import Info from "@lucide/svelte/icons/info";
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

  /** What the trust side is waiting on, as the noun phrase the Soon sentence completes. */
  const TRUST_DEPENDENCY =
    "choosing a trust account";

  /*
   * The bill being acted on, by its own number. The facts beside it are facts about THAT BILL — what
   * it still owes, what it is worth — never a description of the act, which the heading has already
   * given. Both were in one interpolated string before, which is how a number and a sentence came to
   * share a line behind three different separators across these panels.
   */
  const subtitle = $derived<RecordSubject>({
    reference: { kind: "Bill", number: row?.summary.invoiceNumber ?? null },
  });

  const ceiling = $derived(row === null ? 0 : (matterUnpaidMinor(row, matterId) ?? 0));
  const delivery = $derived(row?.detail?.delivery ?? null);

  let amount = $state("");

  /** Unreachable until the trust read is served: the shell refuses the commit while `commitSoon` is given. */
  async function apply(): Promise<ActionOutcome> {
    return "refused";
  }
</script>

<ActionDialog
  bind:open
  kind="form"
  heading="Apply Trust Funds"
  {subtitle}
  commitLabel="Apply From Trust"
  commitSoon={{ reason: TRUST_DEPENDENCY }}
  unsavedChanges={false}
  onOpen={() => (amount = amountFieldText(ceiling))}
  onCommit={apply}
>
  {#snippet fields()}
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
        <dd class="flex flex-col items-end gap-4 text-right">
          <span class="tabular-nums">{money(ceiling)}</span>
          <!-- What bounds the ceiling is a fact of the ceiling, so it is the row's second line and
               never a paragraph loose beneath the list. -->
          <span class="text-xs text-text-subtle">
            This matter's unpaid share of this bill.
          </span>
        </dd>
      </div>
    </dl>

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
          No delivery of this bill has been recorded. Some jurisdictions expect the client to receive the bill before fees are taken from trust. This doesn't block you.
        </span>
      </p>
    {/if}

    <LabelledField
      label="Amount To Apply"
      hint="Applying part of what is owed is ordinary: the rest stays owing and can be applied later."
    >
      {#snippet children({ props })}
        <Input {...props} disabled bind:value={amount} />
      {/snippet}
    </LabelledField>

    <p class="text-xs text-text-subtle">
      Money leaves trust only against a finalized bill. There is no override.
    </p>
  {/snippet}
</ActionDialog>
