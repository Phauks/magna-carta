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
    startOutlookSignIn,
  } from "$lib/calendar-sync/connected-accounts-api.ts";
  import {
    noticeForOutcome,
    OUTLOOK_CALENDAR_REQUEST,
    signInOutcomeFrom,
    statusSentence,
  } from "$lib/calendar-sync/connected-accounts.ts";
  import SettingsDescription from "$lib/settings/components/settings-description.svelte";
  import SettingsMasthead from "$lib/settings/components/settings-masthead.svelte";
  import SettingsPlate from "$lib/settings/components/settings-plate.svelte";
  import SettingsScrollRegion from "$lib/settings/components/settings-scroll-region.svelte";

  const queryClient = useQueryClient();
  const accounts = createQuery(() => connectedAccountsListOptions());

  const outlookAvailable = $derived(
    accounts.data?.providers.some(
      (provider) => provider.provider === "microsoft" && provider.available,
    ) === true,
  );
  const outlook = $derived(
    accounts.data?.accounts.find((account) => account.provider === "microsoft") ?? null,
  );
  // What the return from Microsoft said, read from the address the member was sent back to.
  const returnNotice = $derived.by(() => {
    const outcome = signInOutcomeFrom(page.url.searchParams);
    return outcome === null ? null : noticeForOutcome(outcome);
  });

  let asking = $state(false);
  let confirmingDisconnect = $state(false);
  let refused = $state(false);

  async function allow(): Promise<"committed" | "refused"> {
    refused = false;
    const address = await startOutlookSignIn();
    if (address === undefined) {
      refused = true;
      return "refused";
    }
    // A whole-page navigation: Microsoft's sign-in refuses to be shown inside another page.
    window.location.assign(address);
    return "committed";
  }

  async function disconnect(): Promise<"committed" | "refused"> {
    if (outlook === null) return "committed";
    if (!(await disconnectAccount(outlook.id))) {
      toast.error("The account could not be disconnected.");
      return "refused";
    }
    await queryClient.invalidateQueries({ queryKey: connectedAccountsListQueryKey() });
    toast.success("Outlook disconnected");
    return "committed";
  }
</script>

<svelte:head><title>Connected Accounts · Settings · Magna Carta</title></svelte:head>

<SettingsMasthead sectionId="connected-accounts" title="Connected Accounts" posture="instant" />

<SettingsScrollRegion>
  <SettingsPlate heading="Outlook">
    <SettingsDescription>
      Your own Microsoft 365 account. Connecting it is what lets your Magna Carta events reach your
      Outlook calendar. Only you can see or use this connection.
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
          Whether an account is connected could not be read, so it is not stated rather than guessed
          at.
        </p>
      {/snippet}

      {#if returnNotice !== null}
        <Alert.Root variant={returnNotice.tone}>
          <Alert.Title>{returnNotice.title}</Alert.Title>
          <Alert.Description>{returnNotice.description}</Alert.Description>
        </Alert.Root>
      {/if}

      {#if outlook !== null}
        <div class="flex flex-wrap items-center gap-12">
          <div class="me-auto flex min-w-0 flex-col gap-2">
            <span class="truncate text-sm font-medium">
              {outlook.accountLabel ?? "Microsoft 365 account"}
            </span>
            <span class="text-sm text-text-muted">{statusSentence(outlook.status)}</span>
          </div>
          {#if outlookAvailable}
            <Button variant="secondary" size="sm" onclick={() => (asking = true)}>
              Connect Again
            </Button>
          {/if}
          <Button variant="secondary" size="sm" onclick={() => (confirmingDisconnect = true)}>
            Disconnect
          </Button>
        </div>
      {:else if outlookAvailable}
        <div class="flex items-center gap-12">
          <span class="me-auto text-sm text-text-muted">No Outlook account is connected.</span>
          <Button onclick={() => (asking = true)}>Connect Outlook</Button>
        </div>
      {:else}
        <p class="text-sm text-text-muted">
          Outlook cannot be connected in this workspace yet. It has not been registered with
          Microsoft.
        </p>
      {/if}
    </LoadingRegion>
  </SettingsPlate>
</SettingsScrollRegion>

<PermissionRequest
  bind:open={asking}
  heading={OUTLOOK_CALENDAR_REQUEST.heading}
  askedBy={OUTLOOK_CALENDAR_REQUEST.askedBy}
  grants={OUTLOOK_CALENDAR_REQUEST.grants}
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
  heading="Disconnect Outlook"
  commitLabel="Disconnect"
  commitBusyLabel="Disconnecting"
  unsavedChanges={false}
  onCommit={disconnect}
>
  {#snippet fields()}
    <p class="text-sm">
      Magna Carta forgets its sign-in to this account. Nothing in your Outlook calendar is changed.
      To connect it again you sign in to Microsoft again.
    </p>
  {/snippet}
</ActionDialog>
