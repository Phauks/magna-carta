<script lang="ts">
  /*
   * The check stock editor for the account the address names. This route reads who is asking and
   * the account's name; everything else is the editor's own, over the live service.
   */
  import CheckStockEditor from "$lib/trust/checks/check-stock-editor.svelte";
  import { liveTrustChecksService } from "$lib/trust/checks/checks-service.ts";
  import { FirmTrust } from "$lib/trust/firm-trust.svelte.ts";
  import { TRUST_PERMISSIONS } from "$lib/trust/trust-api.ts";
  import { permissionRefusal } from "$lib/access/refusal.ts";
  import { readSession } from "$lib/matters/matters-api.ts";
  import { TRUST_CHECKS_BACK } from "$lib/screen/screen-header.ts";
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
      return permissionRefusal("Setting up check stock", TRUST_PERMISSIONS.manage);
    }
    return undefined;
  });

  const accountName = $derived(trust.accountFor(data.trustAccountId)?.name ?? null);
</script>

{#key data.trustAccountId}
  <CheckStockEditor
    trustAccountId={data.trustAccountId}
    {accountName}
    back={TRUST_CHECKS_BACK}
    service={liveTrustChecksService}
    {manageRefusal}
  />
{/key}
