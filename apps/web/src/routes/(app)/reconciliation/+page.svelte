<script lang="ts">
  /*
   * The Reconciliation list for the account the address names, or the firm's first open account.
   * This route reads who is asking and the firm's accounts; everything else is the screen's own,
   * over the live service.
   */
  import { goto } from "$app/navigation";
  import EmptyState from "@magna-carta/design-system/empty-state";
  import ReconciliationListScreen from "$lib/trust/reconciliation/reconciliation-list-screen.svelte";
  import { liveReconciliationService } from "$lib/trust/reconciliation/reconciliation-service.ts";
  import { FirmTrust } from "$lib/trust/firm-trust.svelte.ts";
  import { TRUST_PERMISSIONS } from "$lib/trust/trust-api.ts";
  import { defaultEffectiveDate } from "$lib/trust/trust-write-requests.ts";
  import { permissionRefusal } from "$lib/access/refusal.ts";
  import { readSession } from "$lib/matters/matters-api.ts";
  import ScreenHeader from "$lib/screen/screen-header.svelte";
  import type { PageProps } from "./$types";

  let { data }: PageProps = $props();

  const trust = new FirmTrust();
  let permissions = $state<readonly string[] | null>(null);
  let bootstrapped = false;

  $effect(() => {
    if (bootstrapped) return;
    bootstrapped = true;
    void (async () => {
      const outcome = await readSession(fetch);
      if (outcome.kind === "ok") permissions = outcome.value.permissions;
    })();
    void trust.loadAccounts(fetch);
  });

  const manageRefusal = $derived.by((): string | undefined => {
    if (permissions === null) return "Reading your session.";
    if (!permissions.includes(TRUST_PERMISSIONS.manage)) {
      return permissionRefusal("Reconciling a trust account", TRUST_PERMISSIONS.manage);
    }
    return undefined;
  });

  const trustAccountId = $derived(
    data.trustAccountId ??
      trust.accounts?.find((account) => account.status === "open")?.id ??
      trust.accounts?.[0]?.id ??
      null,
  );
  const account = $derived(trust.accountFor(trustAccountId));
  const today = $derived(defaultEffectiveDate(account?.timeZone ?? ""));
</script>

{#if trustAccountId !== null}
  {#key trustAccountId}
    <ReconciliationListScreen
      {trustAccountId}
      accounts={trust.accounts}
      service={liveReconciliationService}
      {manageRefusal}
      {today}
      onAccountChange={(next) =>
        void goto(`/reconciliation?account=${encodeURIComponent(next)}`, { replaceState: true })}
    />
  {/key}
{:else if trust.accounts !== null}
  <div class="flex flex-col gap-16">
    <ScreenHeader title="Reconciliation" />
    <EmptyState title="No trust accounts yet">
      <p>Open a trust account on the Trust screen first.</p>
    </EmptyState>
  </div>
{/if}
