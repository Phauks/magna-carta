<script lang="ts">
  /*
   * Account · Security — how the member signs in and protects their account: password and
   * two-factor.
   *
   * THE PASSWORD IS LIVE. It changes in place, against the standing password rather than an emailed
   * token, and ends every other signed-in device in the same act when asked to
   * ($lib/account/change-password.ts holds the reasoning; the panel is
   * $lib/account/components/change-password-dialog.svelte). It was a disabled Soon seam until
   * 2026-09-18, which made the account surface's one instruction to somebody who feared their
   * account was compromised — reset your password — point at a control that did nothing. Two-factor
   * is still an honest seam: step-up re-authentication lands beside it when it ships.
   *
   * THE ROWS STATE NO DESCRIPTOR. "Password" and "Two-Factor" say what they are; a sentence under
   * each saying so again is the small text the owner struck from this surface (see
   * SettingDefinition.description).
   *
   * Signed-in devices used to be a third seam here and are now their own section
   * (routes/account/sessions), because they are a live list rather than a setting. The account
   * rail is sourced from $lib/account/account-sections.ts — add a section there, never here.
   */
  import Badge from "@magna-carta/design-system/badge";
  import Button from "@magna-carta/design-system/button";
  import Switch from "@magna-carta/design-system/switch";
  import AccountMasthead from "$lib/account/components/account-masthead.svelte";
  import ChangePasswordDialog from "$lib/account/components/change-password-dialog.svelte";
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
    kind: "switch",
    defaultValue: false,
    sensitivity: "open",
  };

  let changingPassword = $state(false);
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
          <Badge variant="neutral">Soon</Badge>
          <Switch disabled aria-label="Two-Factor (arrives with authentication)" />
        {/snippet}
      </SettingsRow>
    </SettingsPlate>
  </div>
</div>

<ChangePasswordDialog bind:open={changingPassword} />
