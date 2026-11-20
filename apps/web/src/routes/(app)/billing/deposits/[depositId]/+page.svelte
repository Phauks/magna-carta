<script lang="ts">
  /*
   * One recorded deposit, read back: where it went, its lines and fees, the totals, and its notes
   * and files. Record a Payment lands here, naming any file it could not attach (`?unsent=`).
   */
  import { page } from "$app/state";
  import { createQuery } from "@tanstack/svelte-query";
  import { billingDepositOptions, ledgerChartOptions } from "@magna-carta/api-client";
  import { formatDate } from "@magna-carta/design-system/formatters";
  import LoadingRegion from "@magna-carta/design-system/loading-region";
  import { failureOf } from "$lib/api/api-client.ts";
  import ScreenHeader from "$lib/screen/screen-header.svelte";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import DepositView from "$lib/payments/deposit-view.svelte";
  import { depositFixture } from "$lib/payments/deposit-fixture.ts";
  import { liveDepositService } from "$lib/payments/deposit-service.ts";
  import { moneyText as money } from "$lib/payments/deposit-money.ts";

  const depositId = $derived(page.params.depositId ?? "");
  const depositRead = createQuery(() => billingDepositOptions({ path: { depositId } }));
  const chartRead = createQuery(() => ledgerChartOptions());

  const account = $derived(
    (chartRead.data?.operatingAccounts ?? []).find(
      (candidate) => candidate.ledgerAccountId === depositRead.data?.depositToAccountId,
    ),
  );
  const unsent = $derived(
    (page.url.searchParams.get("unsent") ?? "").split("\n").filter((name) => name !== ""),
  );
</script>

<svelte:head><title>Deposit · Magna Carta</title></svelte:head>

<div class="flex flex-col gap-24">
  <ScreenHeader title="Deposit" back="billing">
    {#snippet meta()}
      {#if depositRead.data !== undefined}
        {formatDate(depositRead.data.depositedOn)} · {money(depositRead.data.depositMinor)}
      {/if}
    {/snippet}
  </ScreenHeader>

  <LoadingRegion
    loading={depositRead.isPending}
    label="Reading the deposit"
    failed={depositRead.isError}
    onRetry={() => void depositRead.refetch()}
  >
    {#snippet failure()}
      <FailureNotice
        failure={failureOf(depositRead.error)}
        subject="The deposit"
        fallback="The deposit couldn't be read."
        onRetry={() => void depositRead.refetch()}
      />
    {/snippet}
    {#snippet fixture()}
      <DepositView deposit={depositFixture()} service={liveDepositService} canWrite={false} onChanged={() => {}} />
    {/snippet}
    {#if depositRead.data !== undefined}
      <DepositView
        deposit={depositRead.data}
        bankName={account?.bankName ?? null}
        service={liveDepositService}
        {unsent}
        onChanged={() => void depositRead.refetch()}
      />
    {/if}
  </LoadingRegion>
</div>
