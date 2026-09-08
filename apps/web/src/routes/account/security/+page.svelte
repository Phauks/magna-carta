<script lang="ts">
  /*
   * Account · Security — how the member signs in and protects their account: password and
   * two-factor. The higher-ceremony half of the account surface — step-up re-authentication lands
   * here when it ships. Both rows are honest Soon seams until then (a disabled control + the Soon
   * badge), never a faked state.
   *
   * Signed-in devices used to be a third seam here and are now their own section
   * (routes/account/sessions), because they are a live list rather than a setting. The account
   * rail is sourced from $lib/account/account-sections.ts — add a section there, never here.
   */
  import Badge from "@magna-carta/design-system/badge";
  import Button from "@magna-carta/design-system/button";
  import Switch from "@magna-carta/design-system/switch";
  import AccountMasthead from "$lib/account/components/account-masthead.svelte";
  import SettingsPlate from "$lib/settings/components/settings-plate.svelte";
  import SettingsRow from "$lib/settings/components/settings-row.svelte";
  import type { SettingDefinition } from "$lib/settings/settings-definitions.ts";

  const PASSWORD_DEFINITION: SettingDefinition = {
    id: "account.security.password",
    sectionId: "account-security",
    label: "Password",
    description: "The password you sign in with.",
    kind: "text",
    defaultValue: "",
    sensitivity: "open",
  };

  const TWO_FACTOR_DEFINITION: SettingDefinition = {
    id: "account.security.two-factor",
    sectionId: "account-security",
    label: "Two-Factor",
    description: "A second step at sign-in beyond your password.",
    kind: "switch",
    defaultValue: false,
    sensitivity: "open",
  };
</script>

<svelte:head>
  <title>Security · Account · Magna Carta</title>
</svelte:head>

<AccountMasthead title="Security" meta="How you sign in and protect your account." />

<div class="mc-scrollbar min-h-0 grow overflow-y-auto" style="scrollbar-gutter: stable">
  <div class="flex flex-col gap-24 p-24">
    <SettingsPlate heading="Sign-In">
      <SettingsRow definition={PASSWORD_DEFINITION}>
        {#snippet control()}
          <Badge variant="neutral">Soon</Badge>
          <Button variant="secondary" disabled aria-label="Change password (arrives with authentication)">Change…</Button>
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
