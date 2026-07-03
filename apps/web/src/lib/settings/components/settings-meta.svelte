<script lang="ts">
  /*
   * The settings meta corner — the owner's stated architecture for every settings page splits it
   * into three zones: the NAVIGATION (the section nav on the left), the SETTINGS THEMSELVES (the
   * rows in the content column), and the META INTERACTIONS — the save posture, the change
   * history, and the change request — gathered here, at the top right of the page. The cluster
   * shares the vertical band the Masthead's large title already spends (mount it in
   * Masthead.Actions), so posture chrome costs the page no extra usable space.
   *
   * The save posture is present from first paint: a save cluster that only appears once
   * something is staged reads as an error toast and hides the page's posture — the user should
   * know from the first glance that this page stages changes and commits them together. Rested,
   * the legend states the contract; awake, it becomes the staged count in the ledger voice and
   * Save takes the gilt (reserved for the live action).
   *
   * When the draft carries a change that demands confirmation, Save opens the confirm dialog
   * FIRST and lists every staged entry. One confirmation per save, never per row: the deliberate
   * moment is the commit, and asking at each control would train the user to click through.
   *
   * Posture follows the draft: a page that can edit passes its draft (save cluster + history
   * with restore); a read-only page passes none (history without restore + Request a change).
   */
  import * as AlertDialog from "@magna-carta/design-system/alert-dialog";
  import Button, { buttonClasses } from "@magna-carta/design-system/button";
  import RequestChangeDialog from "$lib/settings/components/request-change-dialog.svelte";
  import SettingsLedger from "$lib/settings/components/settings-ledger.svelte";
  import { settingValueLabel } from "$lib/settings/settings-definitions.ts";
  import type { SettingsDraft } from "$lib/settings/settings-draft.svelte.ts";

  let { sectionId, draft }: { sectionId: string; draft?: SettingsDraft } = $props();

  let confirmOpen = $state(false);
  let requestOpen = $state(false);

  const awake = $derived(draft !== undefined && draft.stagedCount > 0);

  function requestSave(): void {
    if (draft === undefined) {
      return;
    }
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
</script>

<!-- One quiet horizontal cluster, right-aligned by the masthead's Actions slot; on narrow
     widths it wraps naturally rather than growing responsive machinery. -->
<div class="flex flex-wrap items-center justify-end gap-8">
  {#if draft !== undefined}
    {#if awake}
      <p
        class="text-xs text-text-default uppercase tabular-nums"
        style="letter-spacing: var(--mc-tracking-caps)"
      >
        {draft.stagedCount}
        {draft.stagedCount === 1 ? "change" : "changes"} staged
      </p>
    {:else}
      <p class="text-xs text-text-muted uppercase" style="letter-spacing: var(--mc-tracking-caps)">
        Changes apply when you save
      </p>
    {/if}
    <!-- "Cancel", not "Discard" (owner-directed): the everyday word for backing out of
         unsaved edits. The store method keeps its precise name. -->
    <Button variant="ghost" disabled={!awake} onclick={() => draft?.discard()}>Cancel</Button>
    <!-- The gilt is reserved for the live action: Save only takes the primary variant once
         there is something to commit. -->
    <Button variant={awake ? "primary" : "secondary"} disabled={!awake} onclick={requestSave}>
      Save
    </Button>
  {/if}

  <SettingsLedger {sectionId} {draft} canRestore={draft !== undefined} />

  {#if draft === undefined}
    <!-- The honest routing note rides the button's tooltip (the dialog states it in full),
         keeping the corner quiet. -->
    <Button
      variant="ghost"
      title="Requests go to your firm's administrators."
      onclick={() => (requestOpen = true)}
    >
      Request a change
    </Button>
  {/if}
</div>

{#if draft !== undefined}
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
{:else}
  <RequestChangeDialog bind:open={requestOpen} {sectionId} />
{/if}
