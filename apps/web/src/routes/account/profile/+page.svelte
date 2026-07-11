<script lang="ts">
  /*
   * Account · Profile — the member's identity within Magna Carta. Every row is an honest Soon
   * seam: profile identity is a person-scoped credential surface, and none of it can function
   * before authentication ships a member profile. Each row swaps its seam for a live control
   * when that arrives; until then the disabled control + Soon badge states the coming choice
   * without faking a value. The seam device (disabled control + Soon) is the same one the
   * settings Text and Beta Access pages use.
   */
  import * as Avatar from "@magna-carta/design-system/avatar";
  import Badge from "@magna-carta/design-system/badge";
  import Button from "@magna-carta/design-system/button";
  import Input from "@magna-carta/design-system/input";
  import AccountMasthead from "$lib/account/components/account-masthead.svelte";
  import SettingsPlate from "$lib/settings/components/settings-plate.svelte";
  import SettingsRow from "$lib/settings/components/settings-row.svelte";
  import type { SettingDefinition } from "$lib/settings/settings-definitions.ts";

  // Page-local seam definitions: rendering through SettingsRow keeps the shared table grid. The
  // kind/defaultValue fields are inert here (the control snippet renders instead), set to honest
  // neutral values.
  const NAME_DEFINITION: SettingDefinition = {
    id: "account.profile.name",
    sectionId: "account-profile",
    label: "Name",
    description: "The name shown across Magna Carta.",
    kind: "text",
    defaultValue: "",
    sensitivity: "open",
  };

  const EMAIL_DEFINITION: SettingDefinition = {
    id: "account.profile.email",
    sectionId: "account-profile",
    label: "Email",
    description: "The address you sign in with and receive notices at.",
    kind: "text",
    defaultValue: "",
    sensitivity: "open",
  };

  const AVATAR_DEFINITION: SettingDefinition = {
    id: "account.profile.avatar",
    sectionId: "account-profile",
    label: "Avatar",
    description: "The picture that represents you to your firm.",
    kind: "text",
    defaultValue: "",
    sensitivity: "open",
  };
</script>

<svelte:head>
  <title>Profile · Account · Magna Carta</title>
</svelte:head>

<AccountMasthead title="Profile" meta="Your identity within Magna Carta." />

<div class="mc-scrollbar min-h-0 grow overflow-y-auto" style="scrollbar-gutter: stable">
  <div class="flex flex-col gap-24 p-24">
    <SettingsPlate heading="Identity">
      <SettingsRow definition={NAME_DEFINITION}>
        {#snippet control()}
          <Badge variant="neutral">Soon</Badge>
          <Input disabled placeholder="—" aria-label="Name (arrives with authentication)" />
        {/snippet}
      </SettingsRow>

      <SettingsRow definition={EMAIL_DEFINITION}>
        {#snippet control()}
          <Badge variant="neutral">Soon</Badge>
          <Input disabled placeholder="—" aria-label="Email (arrives with authentication)" />
        {/snippet}
      </SettingsRow>

      <SettingsRow definition={AVATAR_DEFINITION}>
        {#snippet control()}
          <Badge variant="neutral">Soon</Badge>
          <Avatar.Root>
            <Avatar.Fallback>MC</Avatar.Fallback>
          </Avatar.Root>
          <Button variant="secondary" disabled aria-label="Change avatar (arrives with authentication)">Change…</Button>
        {/snippet}
      </SettingsRow>
    </SettingsPlate>
  </div>
</div>
