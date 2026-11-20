<script lang="ts">
  /*
   * Record a Payment and a recorded deposit over fixtures.
   *
   * A local firm rarely has bills owing and a bank account set up, so this is where the screen is
   * reviewed and photographed. It is the real screen over an in-memory service: lines, the "..."
   * menu, details, the cash count, files shown in the page and Record all work here. Reload to
   * start over. `?bare` drops this preview's own bar, for screenshots of the screen alone.
   *
   * Dev builds only, like the developer console itself, behind the import.meta.env.DEV gate.
   */
  import { page } from "$app/state";
  import Button from "@magna-carta/design-system/button";
  import ScreenHeader from "$lib/screen/screen-header.svelte";
  import { DEVELOPER_CONSOLE_BACK } from "$lib/screen/screen-header.ts";
  import RecordPaymentScreen from "$lib/payments/record-payment-screen.svelte";
  import DepositView from "$lib/payments/deposit-view.svelte";
  import {
    GALLERY_ACCOUNTS,
    GALLERY_BILLS,
    GALLERY_DEPOSIT,
    GALLERY_TODAY,
    RECORD_PAYMENT_GALLERY_STATES,
    galleryDepositService,
    gallerySeed,
    type RecordPaymentGalleryState,
  } from "$lib/payments/record-payment-gallery-fixtures.ts";

  const STATE_LABELS: Readonly<Record<RecordPaymentGalleryState, string>> = {
    blank: "Blank",
    filled: "Four Lines",
    cash: "Cash Counted",
    refused: "Missing Fields",
    deposit: "Recorded Deposit",
  };

  const galleryState = $derived.by((): RecordPaymentGalleryState => {
    const named = page.url.searchParams.get("state");
    return RECORD_PAYMENT_GALLERY_STATES.find((candidate) => candidate === named) ?? "filled";
  });
  const bare = $derived(page.url.searchParams.has("bare"));
  let recorded = $state<string | null>(null);
</script>

{#if import.meta.env.DEV}
  <div class="flex min-h-screen flex-col gap-24 bg-surface-default p-16 text-text-default sm:p-24">
    {#if !bare}
      <ScreenHeader title="Record a Payment" favoritable={false} back={DEVELOPER_CONSOLE_BACK} />
      <p class="text-sm text-text-muted">
        A developer preview over example data, not real matters. Nothing here reaches a server.
      </p>
      <div class="flex flex-wrap gap-8">
        {#each RECORD_PAYMENT_GALLERY_STATES as candidate (candidate)}
          <Button variant={candidate === galleryState ? "secondary" : "ghost"} size="sm" href="?state={candidate}">
            {STATE_LABELS[candidate]}
          </Button>
        {/each}
      </div>
      {#if recorded !== null}
        <p class="text-sm" role="status">{recorded}</p>
      {/if}
    {:else}
      <ScreenHeader
        title={galleryState === "deposit" ? "Deposit" : "Record a Payment"}
        back="billing"
        favoritable={false}
      />
    {/if}
    {#key galleryState}
      {#if galleryState === "deposit"}
        <DepositView
          deposit={GALLERY_DEPOSIT}
          bankName="Wells Fargo"
          service={galleryDepositService}
          unsent={["check-1044-back.png"]}
          onChanged={() => {}}
        />
      {:else}
        <RecordPaymentScreen
          accounts={GALLERY_ACCOUNTS}
          bills={GALLERY_BILLS}
          service={galleryDepositService}
          today={GALLERY_TODAY}
          seed={gallerySeed(galleryState)}
          onRecorded={(depositId, unsent) =>
            (recorded = `Recorded ${depositId}${unsent.length > 0 ? `; not attached: ${unsent.join(", ")}` : ""}.`)}
          onCancel={() => (recorded = "Cancelled.")}
        />
      {/if}
    {/key}
  </div>
{/if}
