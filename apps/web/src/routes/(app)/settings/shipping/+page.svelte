<script lang="ts">
  /*
   * Settings · Postage Account — the firm's account with the carrier platform, under Integrations.
   *
   * WHY THIS IS A SETTINGS PAGE AND NOT PART OF /shipping. Connecting an account is an administrative
   * act with a different audience from buying a label: the routes here need firm rights, while the
   * register needs only shipping:manage. A member who mails things every day should not have to
   * navigate an area holding a page they cannot open.
   *
   * WHAT IS NOT HERE, DELIBERATELY. The stored key is never shown, never returned by any read, and
   * has no field on this page that could hold it. It is write-only from the app's side — which is why
   * the act on offer is REPLACE rather than edit: there is nothing to edit, because nothing here has
   * ever seen it. That is a property of the credential store rather than a choice this page made.
   *
   * THE WALLET BALANCE IS NOT HERE EITHER, and that is also deliberate. A postage account that has run
   * dry blocks a purchase, and the person who needs to know is the one standing at the confirm step —
   * not an administrator who would have to come looking. It belongs on the buy flow and the register.
   */
  import { createQuery, useQueryClient } from "@tanstack/svelte-query";
  import {
    shippingReadConnectionOptions,
    shippingReadConnectionQueryKey,
  } from "@magna-carta/api-client";
  import Button from "@magna-carta/design-system/button";
  import LabelledField from "@magna-carta/design-system/labelled-field";
  import LoadingRegion from "@magna-carta/design-system/loading-region";
  import PasswordInput from "@magna-carta/design-system/password-input";
  import * as Alert from "@magna-carta/design-system/alert";
  import { toast } from "@magna-carta/design-system/toast";
  import { WriteIntent } from "$lib/api/write-intent.ts";
  import {
    connectPostageAccount,
    disconnectPostageAccount,
  } from "$lib/shipping/shipping-api.ts";
  import SettingsDescription from "$lib/settings/components/settings-description.svelte";
  import SettingsMasthead from "$lib/settings/components/settings-masthead.svelte";
  import SettingsPlate from "$lib/settings/components/settings-plate.svelte";
  import SettingsScrollRegion from "$lib/settings/components/settings-scroll-region.svelte";

  const queryClient = useQueryClient();
  const connection = createQuery(() => shippingReadConnectionOptions());

  // One intent per act, so a double click on either button collapses onto one request server-side
  // rather than recording two. Connecting and disconnecting are different intents and hold their own.
  const connectIntent = new WriteIntent();
  const disconnectIntent = new WriteIntent();

  let apiKey = $state("");
  let confirmingDisconnect = $state(false);
  let submitting = $state(false);

  const connected = $derived(connection.data?.connected === true);
  const status = $derived(connection.data?.status ?? null);
  const busy = $derived(submitting);
  const canSubmit = $derived(apiKey.trim() !== "" && !busy);

  /*
   * What the connection's health means, in the reader's words. The distinction earns its place: "no
   * account" and "the key we hold is being refused" are one press apart on this page and lead to
   * completely different afternoons, and a page that called both "not working" would cost somebody
   * the difference.
   */
  const healthSentence = $derived.by(() => {
    if (!connected) return "No postage account is connected.";
    if (status === "needs_reauth") {
      return "The carrier is refusing the key this firm is connected with. Replacing it below restores postage.";
    }
    if (status === "degraded") {
      return "The carrier has been failing intermittently. Postage still works; failures are being recorded.";
    }
    if (status === "disabled") return "This connection has been disabled.";
    return "Connected. Postage can be rated and bought.";
  });

  async function refreshConnection(): Promise<void> {
    await queryClient.invalidateQueries({ queryKey: shippingReadConnectionQueryKey() });
  }

  async function submitKey(): Promise<void> {
    const replacing = connected;
    submitting = true;
    try {
      const outcome = await connectIntent.submit((key) =>
        connectPostageAccount(apiKey.trim(), key),
      );
      if (outcome.value.error !== undefined) {
        toast.error("The postage account could not be connected.");
        return;
      }
      // Cleared the moment it lands, so the value does not sit in a field behind a tab somebody
      // walks away from. It is already stored; nothing here needs it again.
      apiKey = "";
      await refreshConnection();
      toast.success(replacing ? "Postage key replaced" : "Postage account connected");
    } finally {
      submitting = false;
    }
  }

  async function submitDisconnect(): Promise<void> {
    submitting = true;
    try {
      const outcome = await disconnectIntent.submit((key) => disconnectPostageAccount(key));
      if (outcome.value.error !== undefined) {
        toast.error("The postage account could not be disconnected.");
        return;
      }
      confirmingDisconnect = false;
      await refreshConnection();
      toast.success("Postage account disconnected");
    } finally {
      submitting = false;
    }
  }
</script>

<svelte:head><title>Postage Account · Settings · Magna Carta</title></svelte:head>

<SettingsMasthead sectionId="shipping" title="Postage Account" posture="instant" />

<SettingsScrollRegion>
  <SettingsPlate heading="Carrier account">
    <SettingsDescription>
      Postage is bought through the firm's own carrier-platform account. Connecting it here is what
      lets a shipment be rated and a label bought; drafting a shipment never needs it.
    </SettingsDescription>

    <LoadingRegion
      loading={connection.isPending}
      failed={connection.isError}
      label="Reading the postage account"
      onRetry={() => void connection.refetch()}
      class="flex flex-col gap-16"
    >
      {#snippet failure()}
        <p class="py-12 text-sm text-text-muted">
          Whether an account is connected could not be read, so it is not stated rather than guessed
          at.
        </p>
      {/snippet}

      <Alert.Root variant={connected && status === "connected" ? "info" : "warning"}>
        <Alert.Title>{connected ? "Account connected" : "No account connected"}</Alert.Title>
        <Alert.Description>{healthSentence}</Alert.Description>
      </Alert.Root>

      <div class="flex flex-col gap-8">
        <!-- A password field for a value nobody will read back: it keeps the key off the screen
             while it is being pasted, in a room that may not be private. -->
        <LabelledField label={connected ? "Replace the account key" : "Account key"}>
          <PasswordInput bind:value={apiKey} autocomplete="off" disabled={busy} />
        </LabelledField>
        <p class="text-sm text-text-muted">
          The key is stored encrypted and is never shown again — not here, and not by any part of the
          application. If it is lost, issue a new one with the carrier and replace it here.
        </p>
        <div class="flex justify-end">
          <Button disabled={!canSubmit} onclick={() => void submitKey()}>
            {#if submitting}
              Connecting
            {:else if connected}
              Replace Key
            {:else}
              Connect Account
            {/if}
          </Button>
        </div>
      </div>
    </LoadingRegion>
  </SettingsPlate>

  {#if connected}
    <SettingsPlate heading="Disconnect">
      <SettingsDescription>
        Disconnecting stops every carrier operation for this firm and clears the stored key. Drafts
        and the record of what has already been sent are untouched.
      </SettingsDescription>
      <div class="flex items-center justify-end gap-8">
        {#if confirmingDisconnect}
          <span class="me-auto text-sm text-text-muted">
            Nothing can be rated or bought until an account is connected again.
          </span>
          <Button variant="secondary" size="sm" onclick={() => (confirmingDisconnect = false)}>
            Keep Connected
          </Button>
          <Button
            variant="destructive"
            size="sm"
            disabled={busy}
            onclick={() => void submitDisconnect()}
          >
            {submitting ? "Disconnecting" : "Disconnect"}
          </Button>
        {:else}
          <Button variant="secondary" size="sm" onclick={() => (confirmingDisconnect = true)}>
            Disconnect Account
          </Button>
        {/if}
      </div>
    </SettingsPlate>
  {/if}
</SettingsScrollRegion>
