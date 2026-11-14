<script lang="ts">
  /*
   * Settings · Connected Accounts — the member's OWN accounts at a calendar provider.
   *
   * WHOSE THIS IS. Each member connects their own account and sees only their own. Nobody connects
   * one for a colleague and the firm holds none, which is why this sits under My Settings and not
   * beside the firm's postage account.
   *
   * WHAT CONNECTING DOES, AND ALL IT DOES. It records that the account is connected. Nothing is
   * copied to or from it from this page; what syncs is decided elsewhere, per event type, and the
   * page says so the moment an account connects, because "connected" otherwise reads as "syncing".
   *
   * ONE ACCOUNT, ONE PAGE FOR IT. What is done WITH the account lives on that feature's own page.
   * The owner ruled the two apart: calendar and mail have different consequences, so neither's
   * settings are on the page that merely holds the account they share.
   */
  import { page } from "$app/state";
  import { createQuery, useQueryClient } from "@tanstack/svelte-query";
  import {
    connectedAccountsListOptions,
    connectedAccountsListQueryKey,
  } from "@magna-carta/api-client";
  import ActionDialog from "@magna-carta/design-system/action-dialog";
  import * as Alert from "@magna-carta/design-system/alert";
  import Button from "@magna-carta/design-system/button";
  import LoadingRegion from "@magna-carta/design-system/loading-region";
  import PermissionRequest from "@magna-carta/design-system/permission-request";
  import { toast } from "@magna-carta/design-system/toast";
  import {
    disconnectAccount,
    startCalendarSignIn,
  } from "$lib/calendar-sync/connected-accounts-api.ts";
  import {
    CALENDAR_PROVIDERS,
    calendarRequestFor,
    noticeForOutcome,
    providerFrom,
    providerNames,
    signInOutcomeFrom,
    statusSentence,
    type CalendarProvider,
  } from "$lib/calendar-sync/connected-accounts.ts";
  import SettingsDescription from "$lib/settings/components/settings-description.svelte";
  import SettingsMasthead from "$lib/settings/components/settings-masthead.svelte";
  import SettingsPlate from "$lib/settings/components/settings-plate.svelte";
  import SettingsScrollRegion from "$lib/settings/components/settings-scroll-region.svelte";

  const queryClient = useQueryClient();
  const accounts = createQuery(() => connectedAccountsListOptions());

  // A member holds one calendar account, at one provider. Whichever it is, the other provider's
  // plate says so instead of offering a second connection.
  const connected = $derived(accounts.data?.accounts[0] ?? null);
  // What the return from the provider said, and which provider it was, read from the address the
  // member was sent back to. A return naming no provider is one from before there were two.
  const returned = $derived.by(() => {
    const outcome = signInOutcomeFrom(page.url.searchParams);
    if (outcome === null) return null;
    const provider = providerFrom(page.url.searchParams) ?? "microsoft";
    return { provider, notice: noticeForOutcome(outcome, provider) };
  });

  function available(provider: CalendarProvider): boolean {
    return (
      accounts.data?.providers.some((entry) => entry.provider === provider && entry.available) ===
      true
    );
  }

  let asking = $state(false);
  let askingProvider = $state<CalendarProvider>("microsoft");
  let confirmingDisconnect = $state(false);
  let refused = $state(false);

  const request = $derived(calendarRequestFor(askingProvider));
  const connectedNames = $derived(providerNames(connected?.provider ?? "microsoft"));

  function ask(provider: CalendarProvider): void {
    askingProvider = provider;
    refused = false;
    asking = true;
  }

  async function allow(): Promise<"committed" | "refused"> {
    refused = false;
    const address = await startCalendarSignIn(askingProvider);
    if (address === undefined) {
      refused = true;
      return "refused";
    }
    // A whole-page navigation: a provider's sign-in refuses to be shown inside another page.
    window.location.assign(address);
    return "committed";
  }

  async function disconnect(): Promise<"committed" | "refused"> {
    if (connected === null) return "committed";
    const { product } = providerNames(connected.provider);
    if (!(await disconnectAccount(connected.id))) {
      toast.error("The account could not be disconnected.");
      return "refused";
    }
    await queryClient.invalidateQueries({ queryKey: connectedAccountsListQueryKey() });
    toast.success(`${product} disconnected`);
    return "committed";
  }
</script>

<svelte:head><title>Connected Accounts · Settings · Magna Carta</title></svelte:head>

<SettingsMasthead sectionId="connected-accounts" title="Connected Accounts" posture="instant" />

<SettingsScrollRegion>
  {#each CALENDAR_PROVIDERS as provider (provider)}
    {@const names = providerNames(provider)}
    {@const account = connected?.provider === provider ? connected : null}
    <SettingsPlate heading={names.product}>
      <SettingsDescription>
        Your own {names.account}. Connecting it is what lets your Magna Carta events reach your
        {names.product}. Only you can see or use this connection.
      </SettingsDescription>

      <LoadingRegion
        loading={accounts.isPending}
        failed={accounts.isError}
        label="Reading your connected accounts"
        onRetry={() => void accounts.refetch()}
        class="flex flex-col gap-16"
      >
        {#snippet failure()}
          <p class="py-12 text-sm text-text-muted">
            Whether an account is connected could not be read, so it is not stated rather than
            guessed at.
          </p>
        {/snippet}

        {#if returned !== null && returned.provider === provider}
          <Alert.Root variant={returned.notice.tone}>
            <Alert.Title>{returned.notice.title}</Alert.Title>
            <Alert.Description>{returned.notice.description}</Alert.Description>
          </Alert.Root>
        {/if}

        {#if account !== null}
          <div class="flex flex-wrap items-center gap-12">
            <div class="me-auto flex min-w-0 flex-col gap-2">
              <span class="truncate text-sm font-medium">
                {account.accountLabel ?? names.account}
              </span>
              <span class="text-sm text-text-muted">
                {statusSentence(account.status, provider)}
              </span>
            </div>
            {#if available(provider)}
              <Button variant="secondary" size="sm" onclick={() => ask(provider)}>
                Connect Again
              </Button>
            {/if}
            <Button variant="secondary" size="sm" onclick={() => (confirmingDisconnect = true)}>
              Disconnect
            </Button>
          </div>
        {:else if connected !== null}
          <p class="text-sm text-text-muted">
            Your {providerNames(connected.provider).product} account is connected. Disconnect it to
            connect {names.product} instead.
          </p>
        {:else if available(provider)}
          <div class="flex items-center gap-12">
            <span class="me-auto text-sm text-text-muted">
              No {names.account} is connected.
            </span>
            <Button onclick={() => ask(provider)}>Connect {names.product}</Button>
          </div>
        {:else}
          <p class="text-sm text-text-muted">
            {names.product} cannot be connected in this workspace yet. It has not been registered
            with {names.company}.
          </p>
        {/if}
      </LoadingRegion>
    </SettingsPlate>
  {/each}
</SettingsScrollRegion>

<PermissionRequest
  bind:open={asking}
  heading={request.heading}
  askedBy={request.askedBy}
  grants={request.grants}
  onAllow={allow}
>
  {#snippet notice()}
    {#if refused}
      <Alert.Root variant="danger">
        <Alert.Description>
          The sign-in could not be started. Nothing was connected.
        </Alert.Description>
      </Alert.Root>
    {/if}
  {/snippet}
</PermissionRequest>

<ActionDialog
  bind:open={confirmingDisconnect}
  kind="confirm"
  width="narrow"
  heading="Disconnect {connectedNames.product}"
  commitLabel="Disconnect"
  commitBusyLabel="Disconnecting"
  unsavedChanges={false}
  onCommit={disconnect}
>
  {#snippet fields()}
    <p class="text-sm">
      Magna Carta forgets its sign-in to this account. Nothing in your {connectedNames.product} is
      changed. To connect it again you sign in to {connectedNames.company} again.
    </p>
  {/snippet}
</ActionDialog>
