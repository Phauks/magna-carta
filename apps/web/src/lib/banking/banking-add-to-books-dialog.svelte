<script lang="ts">
  /*
   * Add to Books: the bank's line, and the ways the books already take an entry. Nothing is posted
   * from here. A trust line goes to the Trust screen, opened on that account, where deposits and
   * payments out are recorded against a matter. The operating books have no entry screen yet, which
   * the panel says, and Copy Details carries the line to wherever it is entered.
   *
   * No suggestion ever adds lines together: a bank line is matched one to one or not at all.
   */
  import ActionDialog from "@magna-carta/design-system/action-dialog";
  import Button from "@magna-carta/design-system/button";
  import * as DefinitionList from "@magna-carta/design-system/definition-list";
  import { formatDate } from "@magna-carta/design-system/formatters";
  import { SoonAffordance } from "@magna-carta/design-system/maturity";
  import { toast } from "@magna-carta/design-system/toast";
  import Copy from "@lucide/svelte/icons/copy";
  import Landmark from "@lucide/svelte/icons/landmark";
  import type { BankFeedAccount, BankFeedTransaction } from "./banking-api.ts";
  import {
    accountTitle,
    booksEntryRoute,
    isMoneyIn,
    lineDetailsText,
    lineMagnitudeText,
  } from "./banking-model.ts";

  let {
    open = $bindable(false),
    account,
    line,
  }: {
    open?: boolean;
    account: BankFeedAccount | null;
    line: BankFeedTransaction | null;
  } = $props();

  const route = $derived(account === null ? null : booksEntryRoute(account));
  const currency = $derived(account?.currency ?? "USD");
  const direction = $derived(line !== null && isMoneyIn(line, currency) ? "In" : "Out");

  async function copyDetails(): Promise<void> {
    if (line === null) return;
    try {
      await navigator.clipboard.writeText(lineDetailsText(line, currency));
      toast.success("Copied.");
    } catch {
      toast.error("Couldn't copy. Select the details and copy them instead.");
    }
  }
</script>

<ActionDialog
  bind:open
  kind="reading"
  width="narrow"
  heading="Add to Books"
  subtitle={{ facts: account === null ? [] : [accountTitle(account)] }}
>
  {#snippet fields()}
    {#if line !== null}
      <div class="flex flex-col gap-16">
        <DefinitionList.Root>
          <DefinitionList.Row term="Date">{formatDate(line.postedOn)}</DefinitionList.Row>
          <DefinitionList.Row term="Bank Description">{line.description}</DefinitionList.Row>
          <DefinitionList.Row term={direction}>
            <span class="tabular-nums">
              {lineMagnitudeText(line, currency)}
            </span>
          </DefinitionList.Row>
          {#if line.checkNumber !== null}
            <DefinitionList.Row term="Check Number">{line.checkNumber}</DefinitionList.Row>
          {/if}
        </DefinitionList.Root>

        <div class="flex flex-wrap items-start gap-8">
          {#if route?.kind === "trust"}
            <Button variant="primary" href={route.href}>
              <Landmark class="size-16" aria-hidden="true" />
              Open Trust
            </Button>
          {:else if route?.kind === "operating"}
            <SoonAffordance reason="entering operating payments and deposits" reasonPlacement="line">
              {#snippet control(soon)}
                <Button variant="primary" {...soon}>Enter in Books</Button>
              {/snippet}
            </SoonAffordance>
          {/if}
          <Button variant="secondary" onclick={() => void copyDetails()}>
            <Copy class="size-16" aria-hidden="true" />
            Copy Details
          </Button>
        </div>
        {#if route?.kind === "untied"}
          <p class="text-sm text-text-muted">Tie this bank account to an account in the books first.</p>
        {/if}
      </div>
    {/if}
  {/snippet}
</ActionDialog>
