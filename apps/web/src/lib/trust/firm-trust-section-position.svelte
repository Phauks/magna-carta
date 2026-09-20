<script lang="ts">
  /*
   * What one trust account IS, and what it holds today.
   *
   * TWO RUNS OF FACTS, FROM TWO READS. The first run is the account as the roster lists it — its
   * currency, the state whose rules it answers to, the office that holds it, whether it is pooled,
   * whether it is still open — and it is on screen the moment an account is selected. The second is
   * the position, which is computed from dated rows at the moment of asking and arrives on its own
   * read, with its own failure. Keeping them apart is what lets the account keep saying what it is
   * while the figures are still coming, and what stops a failed position read from taking the whole
   * section with it.
   *
   * EVERY FIGURE IS A FACT, SO EVERY FIGURE IS A FACT ROW — except the firm's own cushion, which an
   * account may not have at all. An account that never opened the carve-out has no balance rather
   * than a balance of nothing, and the difference matters on a trust account: the row therefore
   * stands with the empty mark and the line beneath it says the cushion is not open, in the
   * structure rather than beside it.
   */
  import * as DefinitionList from "@magna-carta/design-system/definition-list";
  import Badge from "@magna-carta/design-system/badge";
  import LoadingRegion from "@magna-carta/design-system/loading-region";
  import { sampleAmount, sampleDate } from "@magna-carta/design-system/loading-fixtures";
  import * as DetailsPanel from "$lib/details-panel/index.ts";
  import FirmTrustReadFailure from "./firm-trust-read-failure.svelte";
  import type { FirmTrust } from "./firm-trust.svelte.ts";
  import { positionReading } from "./firm-trust-model.ts";
  import type { TrustAccountListing } from "./trust-api.ts";
  import {
    CUSHION_NOT_OPENED,
    IOLTA_MEANING,
    JURISDICTION_NOT_RECORDED,
    JURISDICTION_NOT_RECORDED_MEANING,
    accountStandingLabel,
    accountStandingMeaning,
    accountStandingTone,
    dayText,
    ioltaLabel,
  } from "./firm-trust-vocabulary.ts";

  let {
    account,
    trust,
    officeName,
    money,
  }: {
    account: TrustAccountListing;
    /** The store the position read lands in, with its own failure. */
    trust: FirmTrust;
    officeName: (locationId: string) => string | null;
    money: (amountMinor: number) => string;
  } = $props();

  const reading = $derived(
    trust.position === null ? null : positionReading(trust.position, money),
  );
</script>

<DetailsPanel.Facts>
  <DetailsPanel.Fact label="Currency" value={account.currency} />
  <DetailsPanel.Fact
    label="Jurisdiction"
    value={account.jurisdiction ?? JURISDICTION_NOT_RECORDED}
    title={account.jurisdiction === null ? JURISDICTION_NOT_RECORDED_MEANING : undefined}
  />
  <DetailsPanel.Fact label="Office" value={officeName(account.locationId) ?? account.locationId} />
  <DetailsPanel.Fact label="IOLTA" value={ioltaLabel(account.iolta)} title={IOLTA_MEANING} />
  <DetailsPanel.Fact label="Standing">
    <Badge
      variant={accountStandingTone(account.status)}
      title={accountStandingMeaning(account.status)}
    >
      {accountStandingLabel(account.status)}
    </Badge>
  </DetailsPanel.Fact>
</DetailsPanel.Facts>

<LoadingRegion
  loading={trust.position === null && trust.positionFailure === null}
  label="Reading what this account holds today"
  failed={trust.positionFailure !== null}
>
  {#snippet failure()}
    <FirmTrustReadFailure
      sentence="This account's position could not be read, so what it holds today is not shown. The ledgers themselves are unaffected."
    />
  {/snippet}

  {#snippet fixture()}
    <DetailsPanel.Facts ruled>
      <DetailsPanel.Fact label="As Of" value={sampleDate(0)} />
      <DetailsPanel.Fact label="Book Balance" value={sampleAmount(0)} />
      <DetailsPanel.Fact label="Client Ledgers" value={sampleAmount(1)} />
      <DetailsPanel.Fact label="Held" value={sampleAmount(2)} />
      <DetailsPanel.Fact label="Matter Ledgers" value="12" />
      <DetailsPanel.Fact label="Awaiting" value="2" />
    </DetailsPanel.Facts>
  {/snippet}

  {#if reading !== null}
    <DetailsPanel.Facts ruled>
      <!-- The day the figures are as of leads them: a balance with no day is a balance nobody can
           check against a statement. -->
      <DetailsPanel.Fact label="As Of" value={dayText(reading.asOfDate)} />
      {#each reading.figures as figure (figure.label)}
        <DetailsPanel.Fact label={figure.label} value={figure.text} />
      {/each}
    </DetailsPanel.Facts>

    <DefinitionList.Root>
      <DefinitionList.Row term="Firm Funds" empty={reading.firmFundsText === null}>
        {#if reading.firmFundsText !== null}
          <span class="tabular-nums">{reading.firmFundsText}</span>
        {/if}
      </DefinitionList.Row>
      {#if reading.firmFundsText === null}
        <DefinitionList.Empty term="Firm Funds">{CUSHION_NOT_OPENED}</DefinitionList.Empty>
      {/if}
    </DefinitionList.Root>
  {/if}
</LoadingRegion>
