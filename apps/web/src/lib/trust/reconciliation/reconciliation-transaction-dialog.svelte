<script lang="ts">
  /*
   * ONE TRANSACTION, VIEW ONLY: what it was, whose matter it touched, when it was recorded, and
   * links to where it lives. Ticking and notes stay on the reconciliation screen, so this window
   * asks for nothing.
   */
  import ActionDialog from "@magna-carta/design-system/action-dialog";
  import * as DefinitionList from "@magna-carta/design-system/definition-list";
  import Button from "@magna-carta/design-system/button";
  import { formatDate, formatInstant } from "@magna-carta/design-system/formatters";
  import ArrowRight from "@lucide/svelte/icons/arrow-right";
  import { moneySectionHref } from "$lib/money/money-sections.ts";
  import type { TrustBankReconciliationItem } from "./reconciliation-api.ts";
  import { typeLabel } from "./reconciliation-model.ts";

  let {
    open = $bindable(false),
    item,
    money,
    checksHref,
  }: {
    open?: boolean;
    item: TrustBankReconciliationItem | null;
    money: (minor: number) => string;
    /** The account's Checks screen, for a check. */
    checksHref: string;
  } = $props();

  const heading = $derived.by((): string => {
    if (item === null) return "Transaction";
    const who = item.payeeOrFrom ?? item.description;
    return `${who}, ${money(Math.abs(item.amountMinor))}`;
  });
  const direction = $derived(
    item === null ? "" : item.amountMinor >= 0 ? "Deposit to trust" : "Payment from trust",
  );
  const method = $derived(
    item === null
      ? ""
      : item.number === null
        ? typeLabel(item.type)
        : `${typeLabel(item.type)} ${item.number}`,
  );
</script>

<ActionDialog
  bind:open
  kind="reading"
  heading={heading}
  subtitle={item === null ? undefined : { facts: [direction, formatDate(item.effectiveDate)] }}
>
  {#snippet fields()}
    {#if item !== null}
      <div class="flex flex-col gap-16">
        <DefinitionList.Root>
          <DefinitionList.Row term="Matter" empty={item.matterNumber === null && !item.firmFunds}>
            {#if item.firmFunds}
              Firm funds, the firm's own money for bank charges
            {:else if item.matterId !== null}
              <a
                class="text-text-default underline underline-offset-4"
                href={moneySectionHref(item.matterId, "trust")}
              >
                {[item.matterNumber, item.matterTitle].filter((part) => part !== null).join(" ")}
              </a>
            {/if}
          </DefinitionList.Row>
          <DefinitionList.Row term="Method">{method}</DefinitionList.Row>
          <DefinitionList.Row term="Description">{item.description}</DefinitionList.Row>
          <DefinitionList.Row term="Purpose" empty={item.purpose === null}>{item.purpose}</DefinitionList.Row>
          <DefinitionList.Row term="Date">{formatDate(item.effectiveDate)}</DefinitionList.Row>
          <DefinitionList.Row term="Recorded">{formatInstant(item.recordedAt)}</DefinitionList.Row>
          <DefinitionList.Row term="Cleared">{item.cleared ? "Yes, on this reconciliation" : "Not yet"}</DefinitionList.Row>
        </DefinitionList.Root>
        {#if item.isNew}
          <p class="text-sm text-text-muted">
            New: recorded after this reconciliation was started, dated inside its period.
          </p>
        {/if}
        <div class="flex flex-wrap gap-8">
          {#if item.matterId !== null}
            <Button variant="secondary" href={moneySectionHref(item.matterId, "trust")}>
              <ArrowRight class="size-16" aria-hidden="true" />
              Open in Matter Ledger
            </Button>
          {/if}
          {#if item.type === "check"}
            <Button variant="secondary" href={checksHref}>
              <ArrowRight class="size-16" aria-hidden="true" />
              Open Checks
            </Button>
          {/if}
        </div>
      </div>
    {/if}
  {/snippet}
</ActionDialog>
