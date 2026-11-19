<script lang="ts">
  /*
   * One reconciliation. This route reads who is asking and the account names; everything else is
   * the screen's own, over the live service.
   */
  import { RECONCILIATION_BACK } from "$lib/screen/screen-header.ts";
  import ReconciliationScreen from "$lib/trust/reconciliation/reconciliation-screen.svelte";
  import { liveReconciliationService } from "$lib/trust/reconciliation/reconciliation-service.ts";
  import { FirmTrust } from "$lib/trust/firm-trust.svelte.ts";
  import { TRUST_PERMISSIONS } from "$lib/trust/trust-api.ts";
  import { permissionRefusal } from "$lib/access/refusal.ts";
  import { readSession } from "$lib/matters/matters-api.ts";
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

  /* The account is the reconciliation's own; its name is read from the firm's accounts. */
  let trustAccountId = $state<string | null>(null);
  const accountName = $derived(trust.accountFor(trustAccountId)?.name ?? null);
</script>

{#key data.reconciliationId}
  <ReconciliationScreen
    reconciliationId={data.reconciliationId}
    {accountName}
    back={RECONCILIATION_BACK}
    service={{
      ...liveReconciliationService,
      read: async (reconciliationId) => {
        const outcome = await liveReconciliationService.read(reconciliationId);
        if (outcome.kind === "ok") trustAccountId = outcome.value.reconciliation.trustAccountId;
        return outcome;
      },
    }}
    {manageRefusal}
  />
{/key}
