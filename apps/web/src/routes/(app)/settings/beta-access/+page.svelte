<script lang="ts">
  /*
   * Settings · Beta Access — the firm's stance toward pre-release features, under the Platform
   * band. A BESPOKE page composing the standard parts (settings-masthead, settings-plate,
   * settings-row): both rows are honest seams today, so it cannot ride the registry-driven
   * settings-page composition yet —
   *
   * - Release Channel: the firm's channel (stable/beta/alpha) lives on the control plane and no
   *   member-reachable endpoint exposes it yet, so the value is the same em-dash seam the
   *   Versions page uses — never a faked number. It joins the aggregated versions payload when
   *   that endpoint ships (requirement filed in docs/research/fable-backend-review-2026-07.md).
   * - Participate in the Beta Program: the opt-in becomes a real firm draft setting (a
   *   definitions-registry entry, at which point this page collapses into the standard
   *   settings-page composition) when the release-channel frontend ships. Until then the row's
   *   control slot carries a disabled control WITH the "Soon" badge — the deliberate
   *   honest-seam device (the badge states why the control is inert), distinct from the
   *   dead-control rule the engraved rows follow: this control's job is to announce a coming
   *   choice, not to state a current value.
   *
   * Neither row is a definitions-registry entry yet, so with the edit right the exit footer
   * renders rested (No Changes Pending, Cancel/Save disabled) with nothing stageable — that
   * formality is deliberate: the page already speaks the draft contract its future settings
   * will land in.
   */
  import Badge from "@magna-carta/design-system/badge";
  import Switch from "@magna-carta/design-system/switch";
  import SettingsCommitFooter from "$lib/settings/components/settings-commit-footer.svelte";
  import SettingsDescription from "$lib/settings/components/settings-description.svelte";
  import SettingsMasthead from "$lib/settings/components/settings-masthead.svelte";
  import SettingsPlate from "$lib/settings/components/settings-plate.svelte";
  import SettingsRow from "$lib/settings/components/settings-row.svelte";
  import type { SettingDefinition } from "$lib/settings/settings-definitions.ts";
  import { SettingsDraft } from "$lib/settings/settings-draft.svelte.ts";
  import { canEditFirmSettings } from "$lib/settings/settings-permissions.ts";

  const canEdit = canEditFirmSettings("firm");

  // One draft for the whole page, same as every draft-posture firm page — empty today (no
  // stageable rows), carrying the future settings when they register.
  const draft = new SettingsDraft("beta-access");

  // Page-local definitions for the seam rows: rendering through SettingsRow keeps the shared
  // table grid; the em-dash is the honest "not reported yet" value.
  const RELEASE_CHANNEL_DEFINITION: SettingDefinition = {
    id: "beta-access.release-channel",
    sectionId: "beta-access",
    label: "Release Channel",
    description: "Which release stream the firm's deployment follows — stable, beta, or alpha.",
    kind: "text",
    defaultValue: "—",
    sensitivity: "open",
  };

  const BETA_PROGRAM_DEFINITION: SettingDefinition = {
    id: "beta-access.beta-program",
    sectionId: "beta-access",
    label: "Participate in the Beta Program",
    description:
      "Opt the whole firm into beta features before general release — every member sees them, " +
      "so the choice carries firm-wide weight.",
    kind: "switch",
    defaultValue: false,
    sensitivity: "open",
  };
</script>

<svelte:head>
  <title>Beta Access · Settings · Magna Carta</title>
</svelte:head>

<SettingsMasthead
  sectionId="beta-access"
  title="Beta Access"
  posture={canEdit ? "draft" : "readOnly"}
  draft={canEdit ? draft : undefined}
/>

<!-- The middle story: the one scroll area, reaching the canvas's true edges (the breathing
     room rides INSIDE it); scrollbar-gutter keeps pages that scroll and pages that do not at
     identical width. Full canvas width (owner-directed): the table uses the space. -->
<div class="mc-scrollbar min-h-0 grow overflow-y-auto" style="scrollbar-gutter: stable">
  <div class="flex flex-col gap-24 p-24">
  <SettingsDescription>Early access to features before general release — a choice the firm makes as a firm.</SettingsDescription>

  <SettingsPlate heading="Release Program">
    <SettingsRow definition={RELEASE_CHANNEL_DEFINITION} value="—" />

    <SettingsRow definition={BETA_PROGRAM_DEFINITION}>
      {#snippet control()}
        <Badge variant="neutral">Soon</Badge>
        <Switch
          disabled
          aria-label="Participate in the Beta Program (arrives with the release-channel controls)"
        />
      {/snippet}
    </SettingsRow>
  </SettingsPlate>
  </div>
</div>

{#if canEdit}
  <!-- The exit rail, rested with nothing stageable — the deliberate formality (see the head
       comment). -->
  <SettingsCommitFooter {draft} />
{/if}
