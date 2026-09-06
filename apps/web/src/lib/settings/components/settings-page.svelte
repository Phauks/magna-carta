<script lang="ts">
  /*
   * THE STANDARD SETTINGS PAGE — one component, everything data-driven, in the three-story
   * anatomy (header = information, middle = the settings, bottom = the exit). It reads the
   * section from the registry (title = the section's label), derives its posture from the
   * section's commitMode + the permission seam, renders the pinned information masthead, loops
   * the section's plates into rows bound to one page draft, and — on draft pages — pins the
   * commit footer at the column's bottom. Read-only rows carry the per-row change-request
   * affordance, and the pre-scoped composer mounts here.
   *
   * THE MODULARITY CONTRACT:
   * - ADD a setting to an existing page = ONE entry in settings-definitions.ts (id, plate,
   *   label, description, kind, default). Nothing else — the page, plates, draft, history,
   *   request composer, and command palette all derive from the registries.
   * - REMOVE a setting = delete its entry.
   * - ADD a standard settings page = one section in settings-sections.ts + its definitions +
   *   a route file that renders <SettingsPage sectionId="…" meta="…" /> under its
   *   <svelte:head> title. REMOVE a page = delete those.
   * - Bespoke pages (page-local values, seams, diagnostics) compose the SAME parts —
   *   settings-masthead, settings-plate, settings-row (with its `control` snippet for one-off
   *   content) — never re-implementing the pinning, rules, or row grid.
   *
   * Posture: a "draft" section renders the draft flow for members holding the section's edit
   * permission and the engraved read-only table for everyone else; an "instant" section
   * commits each edit the moment it lands (stage + save in one motion, so the ledger append
   * rides the same path as a draft save).
   */
  import RequestChangeDialog from "$lib/settings/components/request-change-dialog.svelte";
  import SettingsCommitFooter from "$lib/settings/components/settings-commit-footer.svelte";
  import SettingsDescription from "$lib/settings/components/settings-description.svelte";
  import SettingsMasthead from "$lib/settings/components/settings-masthead.svelte";
  import SettingsPlate from "$lib/settings/components/settings-plate.svelte";
  import SettingsRow from "$lib/settings/components/settings-row.svelte";
  import {
    platesForSection,
    type SettingDefinition,
    type SettingValue,
  } from "$lib/settings/settings-definitions.ts";
  import { committedSettingValue, SettingsDraft } from "$lib/settings/settings-draft.svelte.ts";
  import { canEditFirmSettings } from "$lib/settings/settings-permissions.ts";
  import { SETTINGS_SECTIONS } from "$lib/settings/settings-sections.ts";

  let {
    sectionId,
    meta,
    preview = false,
  }: {
    sectionId: string;
    /**
     * The one-line descriptor of what this page governs — the page's voice, not registry data.
     * It leads the page's CONTENT, not the header band (settings-description.svelte).
     */
    meta: string;
    /** Demonstration pages: settings not yet in effect (the masthead's Preview badge). */
    preview?: boolean;
  } = $props();

  // All $derived from the sectionId prop (a plain const read of a prop at init is flagged as a
  // non-reactive state read — and derivation also keeps a client-side navigation between two
  // standard pages correct, fresh draft included).
  const section = $derived.by(() => {
    const found = SETTINGS_SECTIONS.find((candidate) => candidate.id === sectionId);
    if (found === undefined) {
      // A page naming an unregistered section is a build defect, not a runtime state.
      throw new Error(`settings-page: unknown section "${sectionId}"`);
    }
    return found;
  });

  const canEdit = $derived(
    section.editPermissionArea === undefined || canEditFirmSettings(section.editPermissionArea),
  );
  const posture = $derived<"draft" | "instant" | "readOnly">(
    section.commitMode === "instant" ? "instant" : canEdit ? "draft" : "readOnly",
  );

  // One draft for the whole page: edits from every row stage into the same batch, so the
  // pending badge and the confirm dialog always describe the page, never one control. Instant
  // pages ride the same draft, committing each edit as it lands.
  const draft = $derived(new SettingsDraft(sectionId));

  function instantFor(definition: SettingDefinition): {
    value: SettingValue;
    apply: (next: SettingValue) => void;
  } {
    return {
      value: committedSettingValue(definition),
      apply: (next) => {
        draft.stage(definition, next);
        draft.save();
      },
    };
  }

  let requestOpen = $state(false);
  let requestDefinition = $state<SettingDefinition | null>(null);

  function openRequest(definition: SettingDefinition): void {
    requestDefinition = definition;
    requestOpen = true;
  }
</script>

<!-- The three-story page: header = information, middle = the settings, bottom = the exit
     (the commit footer, draft pages only). -->
<SettingsMasthead
  {sectionId}
  title={section.label}
  {posture}
  draft={posture === "draft" ? draft : undefined}
  {preview}
/>

<!-- The middle story: the one scroll area, reaching the canvas's true edges (the breathing
     room rides INSIDE it); scrollbar-gutter keeps pages that scroll and pages that do not at
     identical width. Full canvas width (owner-directed): the table uses the space. -->
<div class="mc-scrollbar min-h-0 grow overflow-y-auto" style="scrollbar-gutter: stable">
  <div class="flex flex-col gap-24 p-24">
  <SettingsDescription>{meta}</SettingsDescription>

  {#each platesForSection(sectionId, canEdit) as plate (plate.label)}
    <SettingsPlate heading={plate.label}>
      <!-- Without the edit right, a restricted setting is absent from the plates entirely —
           never a locked box advertising a secret (platesForSection filters by sensitivity). -->
      {#each plate.definitions as definition (definition.id)}
        {#if posture === "draft"}
          <SettingsRow {definition} {draft} />
        {:else if posture === "instant"}
          <SettingsRow {definition} instant={instantFor(definition)} />
        {:else}
          <SettingsRow
            {definition}
            value={committedSettingValue(definition)}
            onRequestChange={openRequest}
          />
        {/if}
      {/each}
    </SettingsPlate>
  {/each}
  </div>
</div>

{#if posture === "draft"}
  <SettingsCommitFooter {draft} />
{/if}

{#if requestDefinition !== null}
  <RequestChangeDialog bind:open={requestOpen} definition={requestDefinition} />
{/if}
