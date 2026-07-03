<script lang="ts">
  /*
   * The change history trail — a right-side pull-out. History is a META interaction, not page
   * content (the owner's three-zone settings architecture: navigation | the settings themselves |
   * meta), so the trail lives in a drawer off the page's edge and only its quiet trigger spends
   * space in the meta corner.
   *
   * Each entry is one committed change: the setting's label, old → new, and when. Restore never
   * rewrites history: it STAGES the old value through the draft, and saving appends a NEW entry —
   * append-only, like the trust ledger. The store enforces that; this component only ever goes
   * through the draft, never at the entries.
   *
   * The trail is session/device-backed today, hence the honest empty state; the firm audit trail
   * takes over when the backend lands.
   */
  import * as Sheet from "@magna-carta/design-system/sheet";
  import Button, { buttonClasses } from "@magna-carta/design-system/button";
  import History from "@lucide/svelte/icons/history";
  import {
    visibleSettingsForSection,
    type SettingDefinition,
    type SettingValue,
  } from "$lib/settings/settings-definitions.ts";
  import {
    ledgerEntriesForSection,
    type SettingsLedgerEntry,
  } from "$lib/settings/settings-ledger-store.svelte.ts";
  import type { SettingsDraft } from "$lib/settings/settings-draft.svelte.ts";

  let {
    sectionId,
    draft,
    canRestore = true,
  }: {
    sectionId: string;
    draft?: SettingsDraft;
    canRestore?: boolean;
  } = $props();

  // Newest first — sorted here so the trail reads top-down as "most recent" regardless of the
  // order the store appends in. `at` is an ISO timestamp, so string order is time order.
  const entries = $derived(
    [...ledgerEntriesForSection(sectionId)].sort((first, second) =>
      second.at.localeCompare(first.at),
    ),
  );

  // Restoring needs the full definition, but an entry carries only the setting's id and display
  // strings — resolve it from the section's registry. `canEdit: true` because restore is itself
  // an edit surface; rows whose definition no longer exists hide Restore (a retired setting
  // cannot be restored).
  const definitions = $derived(visibleSettingsForSection(sectionId, true));

  /*
   * The ledger stores DISPLAY labels — the strings the user saw — so restoring must map the old
   * label back to the raw value the draft stages. Switches read back from their On/Off labels;
   * free text's label IS its value; option kinds match the label against the definition's
   * options. A label that no longer maps (a retired option) yields undefined and the row hides
   * Restore. The backend audit trail will carry raw values, retiring this mapping.
   */
  function rawValueForLabel(
    definition: SettingDefinition,
    label: string,
  ): SettingValue | undefined {
    if (definition.kind === "switch") {
      if (label === "On") {
        return true;
      }
      if (label === "Off") {
        return false;
      }
      return undefined;
    }
    if (definition.kind === "text") {
      return label;
    }
    return definition.options?.find((option) => option.label === label)?.value;
  }

  function restoreTarget(
    entry: SettingsLedgerEntry,
  ): { definition: SettingDefinition; value: SettingValue } | undefined {
    const definition = definitions.find((candidate) => candidate.id === entry.settingId);
    if (definition === undefined) {
      return undefined;
    }
    const restoredValue = rawValueForLabel(definition, entry.from);
    if (restoredValue === undefined) {
      return undefined;
    }
    return { definition, value: restoredValue };
  }

  function formatTimestamp(at: string): string {
    return new Date(at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  }
</script>

<Sheet.Root>
  <!-- The quiet meta-corner trigger; Sheet.Trigger carries no look of its own, so it wears the
       ghost button recipe. -->
  <Sheet.Trigger class={buttonClasses({ variant: "ghost", size: "default" })}>
    <History class="size-16" aria-hidden="true" />
    Change history
  </Sheet.Trigger>
  <Sheet.Content side="right">
    <Sheet.Title>Change history</Sheet.Title>
    {#if entries.length === 0}
      <p class="text-sm text-text-muted">No changes recorded on this device yet.</p>
    {:else}
      <ul class="flex flex-col gap-12">
        {#each entries as entry (entry.id)}
          {@const target = canRestore && draft !== undefined ? restoreTarget(entry) : undefined}
          <li class="flex items-center justify-between gap-16">
            <div class="flex min-w-0 flex-col gap-4">
              <p class="text-sm">
                <span class="font-medium">{entry.label}</span>
                <span class="text-text-muted tabular-nums">
                  {entry.from} → {entry.to}
                </span>
              </p>
              <p class="text-xs text-text-muted">{formatTimestamp(entry.at)}</p>
            </div>
            {#if target !== undefined}
              <Button
                variant="ghost"
                size="sm"
                onclick={() => draft?.stage(target.definition, target.value)}
              >
                Restore
              </Button>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  </Sheet.Content>
</Sheet.Root>
