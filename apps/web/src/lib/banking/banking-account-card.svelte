<script lang="ts">
  /*
   * One bank account down the left of Banking: its name in the books, the bank and the last four
   * digits, the bank's balance large, then the books' balance and how many of the bank's lines are
   * not in the books. The badge carries the one thing worth seeing first. The whole card is the
   * choice, so pressing anywhere on it selects it.
   */
  import ChoiceRow from "@magna-carta/design-system/choice-row";
  import Badge from "@magna-carta/design-system/badge";
  import BankingBankMark from "./banking-bank-mark.svelte";
  import type { CardBadge } from "./banking-model.ts";

  let {
    title,
    bankName,
    bankLogo,
    bankLine,
    balance,
    booksLine,
    badge,
    selected,
    onSelect,
  }: {
    title: string;
    bankName: string;
    bankLogo: string | null;
    bankLine: string;
    balance: string;
    booksLine: string;
    badge: CardBadge | null;
    selected: boolean;
    onSelect: () => void;
  } = $props();
</script>

<ChoiceRow {selected} class="items-start p-16" onclick={onSelect}>
  <span class="block min-w-0 truncate" {title}>{title}</span>
  {#snippet detail()}
    <span class="flex flex-col gap-4">
      <span class="flex min-w-0 items-center gap-8">
        <BankingBankMark name={bankName} logo={bankLogo} />
        <span class="truncate text-xs text-text-muted">{bankLine}</span>
      </span>
      <span class="text-2xl font-normal text-text-default tabular-nums">{balance}</span>
      <span class="text-xs text-text-muted tabular-nums">{booksLine}</span>
    </span>
  {/snippet}
  {#snippet trailing()}
    {#if badge !== null}
      <Badge variant={badge.tone}>{badge.text}</Badge>
    {/if}
  {/snippet}
</ChoiceRow>
