<script lang="ts">
  /*
   * Account · Security — how the member signs in and protects their account: password and
   * two-factor.
   *
   * THE PASSWORD IS LIVE. It changes in place, against the standing password rather than an emailed
   * token, and ends every other signed-in device in the same act when asked to
   * ($lib/account/change-password.ts holds the reasoning; the panel is
   * $lib/account/components/change-password-dialog.svelte).
   *
   * SO IS TWO-FACTOR. It was the account surface's last Soon seam until 2026-09-24: the server had
   * verified a code at sign-in since the auth backend shipped, and no screen could set one up, so
   * nobody could reach it. Adding it, removing it and replacing the recovery codes each open their
   * own panel ($lib/account/components/), and $lib/account/two-factor.ts holds the order that makes
   * setting up safe — the account only starts asking once a code has proved the authenticator has
   * the secret.
   *
   * WHAT THE ROW OFFERS FOLLOWS THE ACCOUNT, and never both at once. Off, it offers Add; on, it
   * offers Remove, and the Recovery Codes row appears beneath it. Adding is not offered while
   * two-factor is on, because in the pinned plugin that call would replace a working secret without
   * asking for a code, and the member's authenticator would stop matching the moment it returned.
   *
   * THE ROWS STATE NO DESCRIPTOR. "Password" and "Two-Factor" say what they are; a sentence under
   * each saying so again is the small text the owner struck from this surface (see
   * SettingDefinition.description).
   *
   * Signed-in devices used to be a third seam here and are now their own section
   * (routes/account/sessions), because they are a live list rather than a setting. The account
   * rail is sourced from $lib/account/account-sections.ts — add a section there, never here.
   */
  import { onMount } from "svelte";
  import Badge from "@magna-carta/design-system/badge";
  import Button from "@magna-carta/design-system/button";
  import AccountMasthead from "$lib/account/components/account-masthead.svelte";
  import ChangePasswordDialog from "$lib/account/components/change-password-dialog.svelte";
  import ReplaceRecoveryCodesDialog from "$lib/account/components/replace-recovery-codes-dialog.svelte";
  import RemoveTwoFactorDialog from "$lib/account/components/remove-two-factor-dialog.svelte";
  import TwoFactorSetupDialog from "$lib/account/components/two-factor-setup-dialog.svelte";
  import { readTwoFactorAccount, type TwoFactorAccount } from "$lib/account/two-factor.ts";
  import SettingsPlate from "$lib/settings/components/settings-plate.svelte";
  import SettingsRow from "$lib/settings/components/settings-row.svelte";
  import type { SettingDefinition } from "$lib/settings/settings-definitions.ts";

  const PASSWORD_DEFINITION: SettingDefinition = {
    id: "account.security.password",
    sectionId: "account-security",
    label: "Password",
    kind: "text",
    defaultValue: "",
    sensitivity: "open",
  };

  const TWO_FACTOR_DEFINITION: SettingDefinition = {
    id: "account.security.two-factor",
    sectionId: "account-security",
    label: "Two-Factor",
    kind: "text",
    defaultValue: "",
    sensitivity: "open",
  };

  const RECOVERY_CODES_DEFINITION: SettingDefinition = {
    id: "account.security.recovery-codes",
    sectionId: "account-security",
    label: "Recovery Codes",
    kind: "text",
    defaultValue: "",
    sensitivity: "open",
  };

  let changingPassword = $state(false);
  let settingUpTwoFactor = $state(false);
  let removingTwoFactor = $state(false);
  let replacingRecoveryCodes = $state(false);

  // Null until the first read returns. The row offers nothing while it is null rather than a
  // guess: offering Add to an account that is already on is the one wrong answer that costs
  // the member their working authenticator.
  let account = $state<TwoFactorAccount | null>(null);

  async function readAccount(): Promise<void> {
    account = await readTwoFactorAccount();
  }

  onMount(() => {
    void readAccount();
  });
</script>

<svelte:head>
  <title>Security · Account · Magna Carta</title>
</svelte:head>

<AccountMasthead title="Security" />

<div class="mc-scrollbar min-h-0 grow overflow-y-auto" style="scrollbar-gutter: stable">
  <div class="flex flex-col gap-24 p-24">
    <SettingsPlate heading="Sign-In">
      <SettingsRow definition={PASSWORD_DEFINITION}>
        {#snippet control()}
          <Button variant="secondary" onclick={() => (changingPassword = true)}>Change…</Button>
        {/snippet}
      </SettingsRow>

      <SettingsRow definition={TWO_FACTOR_DEFINITION}>
        {#snippet control()}
          {#if account?.standing === "on"}
            <Badge variant="success">On</Badge>
            <Button variant="secondary" onclick={() => (removingTwoFactor = true)}>
              Remove…
            </Button>
          {:else if account?.standing === "off"}
            <Button variant="secondary" onclick={() => (settingUpTwoFactor = true)}>
              Add…
            </Button>
          {:else if account?.standing === "unknown"}
            <Button variant="secondary" onclick={() => void readAccount()}>Try Again</Button>
          {/if}
        {/snippet}
      </SettingsRow>

      {#if account?.standing === "on"}
        <SettingsRow definition={RECOVERY_CODES_DEFINITION}>
          {#snippet control()}
            <Button variant="secondary" onclick={() => (replacingRecoveryCodes = true)}>
              Replace…
            </Button>
          {/snippet}
        </SettingsRow>
      {/if}
    </SettingsPlate>
  </div>
</div>

<ChangePasswordDialog bind:open={changingPassword} />
<TwoFactorSetupDialog
  bind:open={settingUpTwoFactor}
  accountAddress={account?.address ?? null}
  onTurnedOn={() => void readAccount()}
/>
<RemoveTwoFactorDialog bind:open={removingTwoFactor} onRemoved={() => void readAccount()} />
<ReplaceRecoveryCodesDialog
  bind:open={replacingRecoveryCodes}
  accountAddress={account?.address ?? null}
/>
