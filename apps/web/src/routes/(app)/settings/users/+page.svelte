<script lang="ts">
  /*
   * Settings · Users — the firm administering its members, under Firm. A BESPOKE stub in the
   * Beta Access pattern: rows are honest Soon seams until firm accounts land, when this becomes
   * the roster and roles surface.
   *
   * THE OWNER-SETTLED BOUNDARY: this page is the firm managing its members — "us" (invitations,
   * roles, deactivation). A member's OWN identity and credentials (profile, password, 2FA,
   * sessions) live in the separate Account Settings surface reached from the profile menu —
   * "me" — and the two are never mixed.
   */
  import Badge from "@magna-carta/design-system/badge";
  import Button from "@magna-carta/design-system/button";
  import SettingsCommitFooter from "$lib/settings/components/settings-commit-footer.svelte";
  import SettingsMasthead from "$lib/settings/components/settings-masthead.svelte";
  import SettingsPlate from "$lib/settings/components/settings-plate.svelte";
  import SettingsRow from "$lib/settings/components/settings-row.svelte";
  import type { SettingDefinition } from "$lib/settings/settings-definitions.ts";
  import { SettingsDraft } from "$lib/settings/settings-draft.svelte.ts";
  import { canEditFirmSettings } from "$lib/settings/settings-permissions.ts";

  const canEdit = canEditFirmSettings("firm");
  const draft = new SettingsDraft("users");

  const MEMBERS_DEFINITION: SettingDefinition = {
    id: "users.members",
    sectionId: "users",
    label: "Members",
    description: "The firm's roster — invite, assign roles, deactivate.",
    kind: "text",
    defaultValue: "",
    sensitivity: "open",
  };

  const ROLES_DEFINITION: SettingDefinition = {
    id: "users.roles",
    sectionId: "users",
    label: "Roles & Permissions",
    description: "What each role may see and do across the firm.",
    kind: "text",
    defaultValue: "",
    sensitivity: "open",
  };
</script>

<svelte:head>
  <title>Users · Settings · Magna Carta</title>
</svelte:head>

<SettingsMasthead
  sectionId="users"
  title="Users"
  meta="The firm's members and what their roles allow — managed by the firm, for the firm."
  posture={canEdit ? "draft" : "readOnly"}
  draft={canEdit ? draft : undefined}
/>

<!-- The middle story: the one scroll area, reaching the canvas's true edges (the breathing
     room rides INSIDE it); scrollbar-gutter keeps pages that scroll and pages that do not at
     identical width. Full canvas width (owner-directed): the table uses the space. -->
<div class="min-h-0 grow overflow-y-auto" style="scrollbar-gutter: stable">
  <div class="flex flex-col gap-24 p-24">
  <SettingsPlate heading="Membership">
    <SettingsRow definition={MEMBERS_DEFINITION}>
      {#snippet control()}
        <!-- A management surface, not a value control — the designed-but-not-wired action
             renders disabled + Soon (owner rule) rather than being omitted. -->
        <Button variant="secondary" size="sm" disabled>
          Manage
          <Badge variant="neutral">Soon</Badge>
        </Button>
      {/snippet}
    </SettingsRow>

    <SettingsRow definition={ROLES_DEFINITION}>
      {#snippet control()}
        <Button variant="secondary" size="sm" disabled>
          Manage
          <Badge variant="neutral">Soon</Badge>
        </Button>
      {/snippet}
    </SettingsRow>
  </SettingsPlate>
  </div>
</div>

{#if canEdit}
  <SettingsCommitFooter {draft} />
{/if}
