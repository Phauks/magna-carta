<script lang="ts">
  /*
   * Cash counted by bill and coin. Each row is how many of one bill or coin; the line's amount
   * becomes the total of the count, so the two cannot disagree. The dollar coin has its own row,
   * so a count of dollar bills and dollar coins reads back the way it was counted.
   */
  import Input from "@magna-carta/design-system/input";
  import FieldLabel from "@magna-carta/design-system/field-label";
  import Label from "@magna-carta/design-system/label";
  import { CASH_BILLS, CASH_COINS, type Denomination } from "./payment-methods.ts";
  import type { DepositLine } from "./deposit-form.svelte.ts";
  import { amountText, countedMinor } from "./deposit-money.ts";

  let { line, disabled = false }: { line: DepositLine; disabled?: boolean } = $props();

  function subtotal(denomination: Denomination): string {
    const pieces = Number(line.cashCount[denomination.key] ?? "");
    return Number.isInteger(pieces) && pieces > 0 ? amountText(countedMinor(denomination.valueMinor, pieces)) : "";
  }
</script>

{#snippet group(title: string, denominations: readonly Denomination[])}
  <div class="flex min-w-0 flex-col gap-4" role="group" aria-labelledby="count-{line.key}-{title}">
    <FieldLabel as="p" id="count-{line.key}-{title}" class="mb-4">{title}</FieldLabel>
    {#each denominations as denomination (denomination.key)}
      <div class="grid grid-cols-3 items-center gap-8">
        <Label for="count-{line.key}-{denomination.key}">{denomination.label}</Label>
        <Input
          id="count-{line.key}-{denomination.key}"
          size="sm"
          inputmode="numeric"
          autocomplete="off"
          class="text-end tabular-nums"
          value={line.cashCount[denomination.key] ?? ""}
          {disabled}
          oninput={(event) => {
            line.cashCount = { ...line.cashCount, [denomination.key]: event.currentTarget.value.replace(/\D/g, "") };
          }}
        />
        <span class="text-end text-sm tabular-nums text-text-muted">{subtotal(denomination)}</span>
      </div>
    {/each}
  </div>
{/snippet}

<div class="flex flex-col gap-8">
  <div class="grid gap-16 @lg:grid-cols-2">
    {@render group("Bills", CASH_BILLS)}
    {@render group("Coins", CASH_COINS)}
  </div>
  <p class="flex justify-end gap-12 text-sm">
    <span class="text-text-muted">Counted</span>
    <strong class="tabular-nums">{line.countedMinor === null ? "0.00" : amountText(line.countedMinor)}</strong>
  </p>
</div>
