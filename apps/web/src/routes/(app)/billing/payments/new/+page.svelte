<script lang="ts">
  /*
   * Record a Payment, on its own page (owner's pick, 2026-11-20). Opened from Billing, or from one
   * bill's Record a Payment, which starts the first line on that bill (`?invoice=…&matter=…`).
   * Once recorded it goes to the deposit's own page.
   */
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import { createQuery } from "@tanstack/svelte-query";
  import { billingOpenBillsOptions, ledgerChartOptions } from "@magna-carta/api-client";
  import { failureOf } from "$lib/api/api-client.ts";
  import { queryClient } from "$lib/api/screen-data.ts";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import LoadingRegion from "@magna-carta/design-system/loading-region";
  import ScreenHeader from "$lib/screen/screen-header.svelte";
  import RecordPaymentScreen from "$lib/payments/record-payment-screen.svelte";
  import { depositAccountsFrom } from "$lib/payments/deposit-form.svelte.ts";
  import { liveDepositService } from "$lib/payments/deposit-service.ts";
  import { civilToday } from "$lib/billing/invoice-standing.ts";

  const billsRead = createQuery(() => billingOpenBillsOptions());
  const chartRead = createQuery(() => ledgerChartOptions());

  // The bank feed's logos join here once it is on main: until then every account shows its
  // bank's initials, which is what an account with no feed shows anyway.
  const accounts = $derived(depositAccountsFrom(chartRead.data?.operatingAccounts ?? []));

  const start = $derived.by(() => {
    const invoiceId = page.url.searchParams.get("invoice");
    const matterId = page.url.searchParams.get("matter");
    return invoiceId !== null && matterId !== null ? { invoiceId, matterId } : undefined;
  });

  async function recorded(depositId: string, unsent: readonly string[]): Promise<void> {
    await queryClient.invalidateQueries();
    const query = unsent.length === 0 ? "" : `?unsent=${encodeURIComponent(unsent.join("\n"))}`;
    await goto(`/billing/deposits/${encodeURIComponent(depositId)}${query}`);
  }
</script>

<svelte:head><title>Record a Payment · Magna Carta</title></svelte:head>

<div class="flex flex-col gap-24">
  <ScreenHeader title="Record a Payment" back="billing" favoritable={false} />

  {#if billsRead.isError || chartRead.isError}
    <FailureNotice
      failure={failureOf(billsRead.error ?? chartRead.error)}
      subject="The bills and bank accounts"
      fallback="The bills and bank accounts couldn't be read."
      onRetry={() => {
        void billsRead.refetch();
        void chartRead.refetch();
      }}
    />
  {:else}
    {@const reading = billsRead.isPending || chartRead.isPending}
    <LoadingRegion loading={reading} label="Reading the bills and bank accounts">
      <!-- The form takes its default account when it is made, so it is made again once the reads land. -->
      {#key reading}
        <RecordPaymentScreen
      {accounts}
      bills={billsRead.data?.bills ?? []}
      service={liveDepositService}
      today={civilToday()}
      {start}
      onRecorded={(depositId, unsent) => void recorded(depositId, unsent)}
      onCancel={() => void goto("/billing")}
        />
      {/key}
    </LoadingRegion>
  {/if}
</div>
