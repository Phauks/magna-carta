<script lang="ts">
  /*
   * The Checks screen for the account the address names. This route reads who is asking and the
   * account's name; everything else is the screen's own, over the live service.
   */
  import ChecksScreen from "$lib/trust/checks/checks-screen.svelte";
  import { liveTrustChecksService } from "$lib/trust/checks/checks-service.ts";
  import { FirmTrust } from "$lib/trust/firm-trust.svelte.ts";
  import { TRUST_PERMISSIONS } from "$lib/trust/trust-api.ts";
  import { memberDisplay } from "$lib/trust/trust-member-names.ts";
  import { permissionRefusal } from "$lib/access/refusal.ts";
  import { readSession } from "$lib/matters/matters-api.ts";
  import { firmRoster } from "$lib/members/firm-roster.svelte.ts";
  import { TRUST_BACK } from "$lib/screen/screen-header.ts";
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
    void firmRoster.load(fetch);
  });

  const manageRefusal = $derived.by((): string | undefined => {
    if (permissions === null) return "Reading your session.";
    if (!permissions.includes(TRUST_PERMISSIONS.manage)) {
      return permissionRefusal("Printing trust checks", TRUST_PERMISSIONS.manage);
    }
    return undefined;
  });

  const accountName = $derived(trust.accountFor(data.trustAccountId)?.name ?? null);
</script>

{#key data.trustAccountId}
  <ChecksScreen
    trustAccountId={data.trustAccountId}
    {accountName}
    back={TRUST_BACK}
    service={liveTrustChecksService}
    memberName={(identifier) => memberDisplay(identifier, firmRoster.members).text}
    {manageRefusal}
  />
{/key}
