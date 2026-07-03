<script lang="ts">
  /*
   * The settings table's header band — one anatomy, three postures. Every settings page seats
   * this full-width strip on the table's opening rule: the small-caps page legend at the start,
   * the COMMIT RAIL at the end, a hairline underneath spanning the full table width. Sticky
   * below the masthead while the page scrolls (geometry, not animation), so the page's posture
   * is never off-screen.
   *
   * The rail is a FIXED slot — the same geometry in every posture, only the contents differ:
   *
   * - draft: a constant engraved legend ("Applies on save") + the count chip + Cancel + Save +
   *   History. The changing sentence of an earlier build is gone: it reflowed the rail and left
   *   staged rows unmarked. Now nothing moves — the chip's figure, its hairline, and Save's gilt
   *   change ink at the same moment the row gutters light.
   * - instant: an engraved legend ("Applies immediately") + History.
   * - read-only: an engraved legend ("Managed by the firm") + History — the one statement of the
   *   page's posture, so the rows carry no separate caption.
   *
   * The History trigger (the pull-out trail) is the rail's constant terminal element in all
   * three postures — the anchor that makes the slot read as one instrument.
   *
   * The count chip is a button opening the staged-changes popover: every staged entry as
   * `label: old → new`; choosing one scrolls its row into view. When the draft carries a change
   * that demands confirmation, Save opens the confirm dialog FIRST and lists every staged entry.
   * One confirmation per save, never per row: the deliberate moment is the commit, and asking at
   * each control would train the user to click through.
   */
  import * as AlertDialog from "@magna-carta/design-system/alert-dialog";
  import * as Popover from "@magna-carta/design-system/popover";
  import Button, { buttonClasses } from "@magna-carta/design-system/button";
  import SettingsLedger from "$lib/settings/components/settings-ledger.svelte";
  import { settingValueLabel } from "$lib/settings/settings-definitions.ts";
  import type { SettingsDraft } from "$lib/settings/settings-draft.svelte.ts";
  import type { SettingsLedgerEntry } from "$lib/settings/settings-ledger-store.svelte.ts";

  let {
    sectionId,
    legend,
    posture,
    draft,
    railLegend,
    showHistory = true,
    restoreAction,
  }: {
    sectionId: string;
    /** The small-caps page legend at the band's start. */
    legend: string;
    posture: "draft" | "instant" | "readOnly";
    /** Required when posture is "draft". */
    draft?: SettingsDraft;
    /** Overrides the posture's default rail legend (e.g. diagnostics pages). */
    railLegend?: string;
    /** Off for pages with no ledger section (the trail would always be empty and untrue). */
    showHistory?: boolean;
    /** Passed through to the history trail — instant pages restore by re-applying. */
    restoreAction?: (entry: SettingsLedgerEntry) => (() => void) | null;
  } = $props();

  let confirmOpen = $state(false);
  let stagedPopoverOpen = $state(false);

  const stagedCount = $derived(posture === "draft" && draft !== undefined ? draft.stagedCount : 0);
  const awake = $derived(stagedCount > 0);

  const RAIL_LEGENDS: Record<typeof posture, string> = {
    draft: "Applies on save",
    instant: "Applies immediately",
    readOnly: "Managed by the firm",
  };

  function requestSave(): void {
    if (draft === undefined) return;
    if (draft.requiresConfirm) {
      confirmOpen = true;
      return;
    }
    draft.save();
  }

  function confirmSave(): void {
    draft?.save();
    // Bits' AlertDialog.Action does not self-close; the confirm work decides when to close.
    confirmOpen = false;
  }

  // The chip's list entries jump to their rows — settings-row.svelte gives every row the stable
  // container id settings-row-<definition id>. A scroll is geometry, not animation.
  function revealStagedRow(definitionId: string): void {
    stagedPopoverOpen = false;
    document.getElementById(`settings-row-${definitionId}`)?.scrollIntoView({ block: "center" });
  }
</script>

<div class="sticky z-sticky bg-surface-default" style="inset-block-start: var(--mc-space-0)">
  <div
    class="flex flex-wrap items-center justify-between gap-x-16 gap-y-8 border-b border-border-strong pb-8"
  >
    <p
      class="text-xs font-semibold text-text-default uppercase"
      style="letter-spacing: var(--mc-tracking-caps)"
    >
      {legend}
    </p>

    <div class="flex flex-wrap items-center gap-8">
      <p class="text-xs text-text-muted uppercase" style="letter-spacing: var(--mc-tracking-caps)">
        {railLegend ?? RAIL_LEGENDS[posture]}
      </p>

      {#if posture === "draft" && draft !== undefined}
        <!-- The permanent count chip: hairline-framed, two digits of measure reserved, tabular
             figures. Clean it holds a muted 0; staged it takes default ink and the gilt frame —
             ink changes, geometry never does. Inert at 0 (nothing to list). -->
        <Popover.Root bind:open={stagedPopoverOpen}>
          <Popover.Trigger
            class="inline-flex items-center justify-center rounded-md border px-8 text-xs tabular-nums {awake
              ? 'border-transparent text-text-default'
              : 'border-border-default text-text-muted'}"
            style="min-inline-size: var(--mc-space-40); min-block-size: var(--mc-control-sm);{awake
              ? ' border-color: var(--mc-accent-default);'
              : ''}"
            disabled={!awake}
            aria-label="{stagedCount} staged {stagedCount === 1 ? 'change' : 'changes'}"
          >
            {stagedCount}
          </Popover.Trigger>
          <Popover.Content class="flex flex-col gap-4">
            {#each draft.stagedEntries as entry (entry.definition.id)}
              <Button
                variant="ghost"
                size="sm"
                class="justify-start"
                onclick={() => revealStagedRow(entry.definition.id)}
              >
                <span class="font-medium">{entry.definition.label}:</span>
                <span class="text-text-muted tabular-nums">
                  {settingValueLabel(entry.definition, entry.from)} → {settingValueLabel(
                    entry.definition,
                    entry.to,
                  )}
                </span>
              </Button>
            {/each}
          </Popover.Content>
        </Popover.Root>

        <!-- role="status" is a polite live region: count changes announce without stealing
             focus from the control being edited. -->
        <span class="sr-only" role="status">
          {stagedCount} staged {stagedCount === 1 ? "change" : "changes"}
        </span>

        <!-- "Cancel", not "Discard" (owner-directed): the everyday word for backing out of
             unsaved edits. The store method keeps its precise name. -->
        <Button variant="ghost" disabled={!awake} onclick={() => draft?.discard()}>Cancel</Button>
        <!-- The gilt is reserved for the live action: Save only takes the primary variant once
             there is something to commit. -->
        <Button variant={awake ? "primary" : "secondary"} disabled={!awake} onclick={requestSave}>
          Save
        </Button>
      {/if}

      {#if showHistory}
        <SettingsLedger
          {sectionId}
          {draft}
          canRestore={posture === "draft" && draft !== undefined}
          {restoreAction}
        />
      {/if}
    </div>
  </div>
</div>

{#if posture === "draft" && draft !== undefined}
  <AlertDialog.Root bind:open={confirmOpen}>
    <AlertDialog.Content>
      <AlertDialog.Title>Confirm these changes</AlertDialog.Title>
      <AlertDialog.Description>
        Saving applies every staged change below at once.
      </AlertDialog.Description>
      <ul class="flex flex-col gap-8">
        {#each draft.stagedEntries as entry (entry.definition.id)}
          <li class="text-sm">
            <span class="font-medium">{entry.definition.label}:</span>
            <span class="text-text-muted tabular-nums">
              {settingValueLabel(entry.definition, entry.from)} → {settingValueLabel(
                entry.definition,
                entry.to,
              )}
            </span>
          </li>
        {/each}
      </ul>
      <div class="flex justify-end gap-8">
        <AlertDialog.Cancel class={buttonClasses({ variant: "ghost", size: "default" })}>
          Cancel
        </AlertDialog.Cancel>
        <AlertDialog.Action
          class={buttonClasses({ variant: "primary", size: "default" })}
          onclick={confirmSave}
        >
          Confirm
        </AlertDialog.Action>
      </div>
    </AlertDialog.Content>
  </AlertDialog.Root>
{/if}
