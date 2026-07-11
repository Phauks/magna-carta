<script lang="ts">
  /*
   * The change history trail — a right-side pull-out. History is a meta interaction, not page
   * content, so the trail lives in a drawer off the page's edge and only its quiet icon-only
   * trigger (owner-directed: the button, no announcement) spends space beside the page title.
   *
   * Each entry is one committed change: the setting's label, old → new, and when. Restore never
   * rewrites history: on a draft page it STAGES the old value through the draft, and saving
   * appends a NEW entry — append-only, like the trust ledger. The store enforces that; this
   * component only ever goes through the draft (or the page's restoreAction), never at the
   * entries. Instant pages pass `restoreAction` — their restore re-APPLIES immediately and the
   * page appends the new entry itself, the same append-only discipline by another route.
   *
   * The trail is session/device-backed today, hence the honest empty state; the firm audit trail
   * takes over when the backend lands.
   */
  import * as Sheet from "@magna-carta/design-system/sheet";
  import * as Tooltip from "@magna-carta/design-system/tooltip";
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
    restoreAction,
  }: {
    sectionId: string;
    draft?: SettingsDraft;
    canRestore?: boolean;
    /**
     * Overrides the built-in stage-through-the-draft restore. The page resolves the entry in its
     * own vocabulary and returns the action to run — or null when the entry cannot be restored
     * (hides the button). Instant pages use this to apply-and-append.
     */
    restoreAction?: (entry: SettingsLedgerEntry) => (() => void) | null;
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

  function restoreHandler(entry: SettingsLedgerEntry): (() => void) | null {
    if (restoreAction !== undefined) {
      return restoreAction(entry);
    }
    if (!canRestore || draft === undefined) {
      return null;
    }
    const definition = definitions.find((candidate) => candidate.id === entry.settingId);
    if (definition === undefined) {
      return null;
    }
    const restoredValue = rawValueForLabel(definition, entry.from);
    if (restoredValue === undefined) {
      return null;
    }
    return () => draft?.stage(definition, restoredValue);
  }

  function formatTimestamp(at: string): string {
    return new Date(at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  }

  // The sheet opens programmatically from the tooltip's button: Tooltip.Trigger and
  // Sheet.Trigger both render real button elements, so composing them would nest
  // button-in-button — instead the tooltip's button drives the bound open state, and Bits
  // still returns focus to it when the sheet closes.
  let historyOpen = $state(false);
</script>

<Tooltip.Root>
  <Tooltip.Trigger
    class={buttonClasses({ variant: "ghost", size: "sm" })}
    aria-label="Change history"
    onclick={() => (historyOpen = true)}
  >
    <History class="size-16" aria-hidden="true" />
  </Tooltip.Trigger>
  <Tooltip.Content>Change history</Tooltip.Content>
</Tooltip.Root>

<Sheet.Root bind:open={historyOpen}>
  <Sheet.Content side="right">
    <Sheet.Title>Change history</Sheet.Title>
    {#if entries.length === 0}
      <p class="text-sm text-text-muted">No changes recorded on this device yet.</p>
    {:else}
      <ul class="flex flex-col gap-12">
        {#each entries as entry (entry.id)}
          {@const handler = restoreHandler(entry)}
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
            {#if handler !== null}
              <Button variant="ghost" size="sm" onclick={handler}>Restore</Button>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  </Sheet.Content>
</Sheet.Root>
