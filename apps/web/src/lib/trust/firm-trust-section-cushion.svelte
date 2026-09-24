<script lang="ts">
  /*
   * The firm's own money in a client trust account: the bank-charge cushion, and the three acts
   * over it.
   *
   * IT IS OPTED INTO, AND AN ACCOUNT WITHOUT ONE IS IN GOOD ORDER. A 404 on the cushion read is an
   * answer rather than a failure, so the section says the cushion is not open and offers the one
   * act that would open it. The other two are refused until it is, with the reason on them: a
   * control that vanished would teach nobody that the capability exists.
   *
   * EVERY WRITE HERE RE-READS TWO THINGS. The cushion, because its balance and its movements are
   * what this section states; and the account's position, because the firm's own money is one of
   * the figures that position carries, and a screen where one of the two moved and the other did
   * not is a screen that disagrees with itself.
   *
   * THE CHARGE'S CEILING IS THE SERVER'S. A charge larger than the cushion is refused there, with
   * the remedy named, and the panel prints those words: a bank charge is never borne by client
   * money, and the balance moves under the reader too quickly for a browser to be the one that says
   * so.
   */
  import Button from "@magna-carta/design-system/button";
  import * as DefinitionList from "@magna-carta/design-system/definition-list";
  import LoadingRegion from "@magna-carta/design-system/loading-region";
  import FirmBankChargeDialog from "./firm-bank-charge-dialog.svelte";
  import FirmCushionFundDialog from "./firm-cushion-fund-dialog.svelte";
  import FirmCushionOpenDialog from "./firm-cushion-open-dialog.svelte";
  import FirmTrustReadFailure from "./firm-trust-read-failure.svelte";
  import type { FirmTrust } from "./firm-trust.svelte.ts";
  import type { TrustAccountListing } from "./trust-api.ts";
  import {
    CUSHION_NOT_OPENED,
    NO_CUSHION_MOVEMENTS,
    cushionMovementLabel,
    dayText,
  } from "./firm-trust-vocabulary.ts";

  let {
    account,
    trust,
    money,
    firmFundsRefusal,
  }: {
    account: TrustAccountListing;
    /** The store the cushion read lands in, with its own failure. */
    trust: FirmTrust;
    money: (amountMinor: number) => string;
    /** Why this reader may not act on the cushion, or undefined while they may. */
    firmFundsRefusal: string | undefined;
  } = $props();

  const cushion = $derived(trust.cushion);
  const openCushionPosition = $derived(cushion?.kind === "open" ? cushion.position : null);
  /** What the cushion holds, for the panels that act on it. Null while the read has not settled. */
  const balanceText = $derived(
    openCushionPosition === null ? null : money(openCushionPosition.balanceMinor),
  );

  let openOpen = $state(false);
  let fundOpen = $state(false);
  let chargeOpen = $state(false);

  /** Why opening is refused: the capability, or a cushion that is already open on this account. */
  const openingRefusal = $derived.by((): string | undefined => {
    if (firmFundsRefusal !== undefined) return firmFundsRefusal;
    if (cushion === null) return "Reading the bank-charge cushion on this account.";
    return cushion.kind === "open" ? "The cushion is already open on this account." : undefined;
  });

  /** Why funding or charging is refused: the capability, or a cushion nobody has opened yet. */
  const movementRefusal = $derived.by((): string | undefined => {
    if (firmFundsRefusal !== undefined) return firmFundsRefusal;
    if (cushion === null) return "Reading the bank-charge cushion on this account.";
    return cushion.kind === "open" ? undefined : "Open the cushion on this account first.";
  });

  /* The cushion's own figures and the position's Firm Funds are one fact read two ways. */
  function moved(): void {
    trust.reloadCushion(fetch, account.id);
    trust.reloadPosition(fetch, account.id);
  }
</script>

<LoadingRegion
  loading={trust.cushion === null && trust.cushionFailure === null}
  label="Reading the bank-charge cushion on this account"
  failed={trust.cushionFailure !== null}
>
  {#snippet failure()}
    {#if trust.cushionFailure !== null}
      <FirmTrustReadFailure
        failure={trust.cushionFailure}
        title="The Bank-Charge Cushion Could Not Be Read"
        fallback="What the firm's own money in this account comes to is not shown. The account's client ledgers are unaffected."
        onRetry={() => trust.reloadCushion(fetch, account.id)}
      />
    {/if}
  {/snippet}

  <DefinitionList.Root>
    {#if openCushionPosition !== null}
      <DefinitionList.Row term="Balance">
        <span class="tabular-nums">{money(openCushionPosition.balanceMinor)}</span>
      </DefinitionList.Row>
      {#each openCushionPosition.movements as movement (movement.id)}
        <DefinitionList.Row term={cushionMovementLabel(movement.kind)}>
          <span class="tabular-nums">{money(movement.amountMinor)}</span>
          <span aria-hidden="true">·</span>
          {dayText(movement.effectiveDate)}
          {#if movement.reference !== null}
            <span aria-hidden="true">·</span>
            {movement.reference}
          {/if}
        </DefinitionList.Row>
      {:else}
        <DefinitionList.Empty>{NO_CUSHION_MOVEMENTS}</DefinitionList.Empty>
      {/each}
    {:else}
      <DefinitionList.Row term="Balance" empty />
      <DefinitionList.Empty>{CUSHION_NOT_OPENED}</DefinitionList.Empty>
    {/if}
  </DefinitionList.Root>
</LoadingRegion>

<div class="flex flex-wrap items-center gap-8">
  <Button
    variant="secondary"
    size="sm"
    disabled={openingRefusal !== undefined}
    title={openingRefusal}
    onclick={() => (openOpen = true)}
  >
    Open Cushion
  </Button>
  <Button
    variant="secondary"
    size="sm"
    disabled={movementRefusal !== undefined}
    title={movementRefusal}
    onclick={() => (fundOpen = true)}
  >
    Fund Cushion
  </Button>
  <Button
    variant="secondary"
    size="sm"
    disabled={movementRefusal !== undefined}
    title={movementRefusal}
    onclick={() => (chargeOpen = true)}
  >
    Record Bank Charge
  </Button>
</div>

<FirmCushionOpenDialog bind:open={openOpen} {account} onOpened={moved} />

<FirmCushionFundDialog
  bind:open={fundOpen}
  {account}
  cushionBalanceText={balanceText}
  onFunded={moved}
/>

<FirmBankChargeDialog
  bind:open={chargeOpen}
  {account}
  cushionBalanceText={balanceText}
  onRecorded={moved}
/>
