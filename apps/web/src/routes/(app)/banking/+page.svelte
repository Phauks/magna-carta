<script lang="ts">
  /*
   * Banking over the live service. This route reads who is asking, so the screen can refuse the
   * acts that need banking:manage, and keeps the selected account in the address.
   */
  import { page } from "$app/state";
  import { replaceState } from "$app/navigation";
  import BankingScreen from "$lib/banking/banking-screen.svelte";
  import { BANKING_PERMISSIONS } from "$lib/banking/banking-model.ts";
  import { liveBankingService } from "$lib/banking/banking-service.ts";
  import { permissionRefusal } from "$lib/access/refusal.ts";
  import { readSession } from "$lib/matters/matters-api.ts";
  import type { PageProps } from "./$types";

  let { data }: PageProps = $props();

  let permissions = $state<readonly string[] | null>(null);
  let bootstrapped = false;

  $effect(() => {
    if (bootstrapped) return;
    bootstrapped = true;
    void (async () => {
      const outcome = await readSession(fetch);
      if (outcome.kind === "ok") permissions = outcome.value.permissions;
    })();
  });

  const manageRefusal = $derived.by((): string | undefined => {
    if (permissions === null) return "Reading your session.";
    if (!permissions.includes(BANKING_PERMISSIONS.manage)) {
      return permissionRefusal("Connecting and managing banks", BANKING_PERMISSIONS.manage);
    }
    return undefined;
  });

  function rememberAccount(accountId: string): void {
    const url = new URL(page.url.href);
    url.searchParams.set("account", accountId);
    replaceState(url, page.state);
  }
</script>

<BankingScreen
  service={liveBankingService}
  {manageRefusal}
  initialAccountId={data.accountId}
  onSelectAccount={rememberAccount}
/>
