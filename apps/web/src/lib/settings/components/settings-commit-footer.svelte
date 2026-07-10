<script lang="ts">
  /*
   * The settings page's EXIT — the bottom story of the three-story page (owner-settled: header
   * = information, middle = the settings, bottom = the exit). Draft pages only: instant and
   * read-only pages have nothing to exit, and their header badge already states everything.
   *
   * It sits OUTSIDE the scroll area as the content column's last flex child, so it holds the
   * BOTTOM OF THE SCREEN even when the page is short (owner-directed) — no sticky machinery,
   * just the column's structure (header / scrolling middle / this rail). Present from FIRST
   * PAINT: a rail that only appears once something is staged reads as an
   * error toast and hides the page's posture. Fixed geometry in both states — rested it holds a
   * muted "No Changes Pending" and disabled Cancel/Save; staged, ink changes only: the pending
   * badge takes the gilt, Cancel the destructive red (backing out now throws work away), Save
   * the gilt primary — all in the same moment the row gutters bar.
   *
   * The pending count is a badge-dressed BUTTON (nothing in the rail should look editable — a
   * framed box read as a type-in field): it opens the staged-changes popover, every staged
   * entry as `label: old → new`, and choosing one scrolls its row into view. Inert at 0.
   *
   * EVERY save confirms: Save opens the recap dialog listing every staged entry — firm policy
   * is weighty enough that the deliberate recap is the standard exit, not an escalation (owner-
   * settled). One confirmation per save, never per row. The per-definition `confirm` field
   * remains a future escalation seam above this baseline (stronger ceremony — step-up
   * re-authentication — when auth ships).
   */
  import * as AlertDialog from "@magna-carta/design-system/alert-dialog";
  import * as Popover from "@magna-carta/design-system/popover";
  import { badgeClasses } from "@magna-carta/design-system/badge";
  import Button, { buttonClasses } from "@magna-carta/design-system/button";
  import { settingValueLabel } from "$lib/settings/settings-definitions.ts";
  import type { SettingsDraft } from "$lib/settings/settings-draft.svelte.ts";

  let { draft }: { draft: SettingsDraft } = $props();

  let confirmOpen = $state(false);
  let stagedPopoverOpen = $state(false);

  const awake = $derived(draft.stagedCount > 0);

  function requestSave(): void {
    if (draft.stagedCount === 0) return;
    confirmOpen = true;
  }

  function confirmSave(): void {
    draft.save();
    // Bits' AlertDialog.Action does not self-close; the confirm work decides when to close.
    confirmOpen = false;
  }

  // The popover's entries jump to their rows — settings-row.svelte gives every row the stable
  // container id settings-row-<definition id>. A scroll is geometry, not animation.
  function revealStagedRow(definitionId: string): void {
    stagedPopoverOpen = false;
    document.getElementById(`settings-row-${definitionId}`)?.scrollIntoView({ block: "center" });
  }
</script>

<div
  class="flex items-center justify-between gap-16 border-t border-border-strong bg-surface-default px-24 pt-12 pb-24"
>
  <Popover.Root bind:open={stagedPopoverOpen}>
    <Popover.Trigger
      class="{badgeClasses({ variant: awake ? 'accent' : 'neutral' })} tabular-nums"
      disabled={!awake}
      aria-label="{draft.stagedCount} staged {draft.stagedCount === 1 ? 'change' : 'changes'}"
    >
      {#if awake}
        {draft.stagedCount}
        {draft.stagedCount === 1 ? "Change Pending" : "Changes Pending"}
      {:else}
        No Changes Pending
      {/if}
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

  <!-- role="status" is a polite live region: count changes announce without stealing focus
       from the control being edited. -->
  <span class="sr-only" role="status">
    {draft.stagedCount} staged {draft.stagedCount === 1 ? "change" : "changes"}
  </span>

  <div class="flex items-center gap-8">
    <!-- "Cancel", not "Discard" (owner-directed): the everyday word for backing out of unsaved
         edits; the store method keeps its precise name. -->
    <Button
      variant={awake ? "destructive" : "ghost"}
      size="sm"
      disabled={!awake}
      onclick={() => draft.discard()}
    >
      Cancel
    </Button>
    <!-- The gilt is reserved for the live action: Save only takes the primary variant once
         there is something to commit. -->
    <Button
      variant={awake ? "primary" : "secondary"}
      size="sm"
      disabled={!awake}
      onclick={requestSave}
    >
      Save
    </Button>
  </div>
</div>

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
