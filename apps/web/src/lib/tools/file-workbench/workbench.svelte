<script lang="ts">
  /*
   * The workbench body: the files, the file, and what has been read about it.
   *
   * Three panes a person can drag, the same shape as the matter file manager, because it is meant
   * to become the same component: this host supplies dropped files and no history, and a matter
   * supplies its documents plus Versions and History. The body takes files, never a matter id.
   *
   * THE TABS SIT OVER THE FINDINGS THEY GOVERN. They belong to the right pane and nothing else:
   * a strip spanning the full width reads as though it switched the whole screen, when what it
   * actually switches is which reading of this one file is on show. The file list and the file
   * itself do not change when a tab does, so the tabs do not sit above them.
   *
   * There is no separate empty screen. With nothing dropped this is the same three panes with
   * nothing in them, each saying what it is missing.
   */
  import * as Resizable from "@magna-carta/design-system/resizable";
  import * as Tabs from "@magna-carta/design-system/tabs";
  import FileRail from "./file-rail.svelte";
  import FilePreview from "./file-preview.svelte";
  import FileHeader from "./file-header.svelte";
  import CapabilityPanel from "./capability-panel.svelte";
  import Absence from "./parts/absence.svelte";
  import { overviewCapability } from "./overview.ts";
  import { permittedCapabilities } from "./capabilities.ts";
  import {
    applySelection,
    EMPTY_SELECTION,
    reconcile,
    selectAll,
    type SelectionGesture,
    type SelectionState,
  } from "./selection.ts";
  import type { CapabilityModule } from "./capability.ts";
  import type { EphemeralFileSource } from "./ephemeral-source.svelte.ts";
  import type { Permission } from "@magna-carta/access-control/registry";

  let {
    source,
    permissions,
    capabilityId = $bindable(),
  }: {
    source: EphemeralFileSource;
    /** What the member holds. A capability they lack is hidden in place; nothing reorders. */
    permissions: ReadonlySet<Permission>;
    /** The capability on show, mirrored into the address so a reading can be linked to. */
    capabilityId: string;
  } = $props();

  // Overview leads because it is the synthesis of the rest, not one more thing you can do.
  const tabs = $derived<readonly CapabilityModule[]>([
    overviewCapability,
    ...permittedCapabilities(permissions),
  ]);

  let selection = $state<SelectionState>(EMPTY_SELECTION);

  // Files arrive and are discarded while the selection stands, so it is reconciled against the list
  // rather than trusted: a bulk action must never name a file that is no longer on the workbench.
  $effect(() => {
    const ids = source.files.map((file) => file.id);
    const next = reconcile(selection, ids);
    if (
      next.activeId !== selection.activeId ||
      next.selected.size !== selection.selected.size ||
      [...next.selected].some((id) => !selection.selected.has(id))
    ) {
      selection = next;
    }
  });

  const activeFile = $derived(
    source.files.find((file) => file.id === selection.activeId) ?? null,
  );
  const selectedFiles = $derived(source.files.filter((file) => selection.selected.has(file.id)));
  const activeCapability = $derived(
    tabs.find((capability) => capability.id === capabilityId) ?? overviewCapability,
  );
  // A `selection`-scoped capability acts on everything selected; every other one on the file in
  // focus. Conversion is the reason this distinction exists.
  const capabilityFiles = $derived(
    activeCapability.scope === "selection" && selectedFiles.length > 0
      ? selectedFiles
      : activeFile
        ? [activeFile]
        : [],
  );

  function select(gesture: SelectionGesture): void {
    selection = applySelection(
      selection,
      gesture,
      source.files.map((file) => file.id),
    );
  }

  function openCapability(capability: CapabilityModule): void {
    capabilityId = capability.id;
  }
</script>

<Resizable.PaneGroup direction="horizontal" autoSaveId="file-workbench-panes" class="min-h-0 flex-1">
  <Resizable.Pane defaultSize={20} minSize={14} maxSize={26}>
    <FileRail
      files={source.files}
      arriving={source.arriving}
      {selection}
      onSelect={select}
      onSelectAll={() => (selection = selectAll(source.files.map((file) => file.id)))}
      onClear={() => (selection = EMPTY_SELECTION)}
      onFiles={(dropped) => void source.add(dropped)}
    />
  </Resizable.Pane>

  {#if activeFile !== null && activeFile.preview.kind !== "none"}
    <Resizable.Handle withHandle />
    <Resizable.Pane defaultSize={36} minSize={22}>
      <FilePreview preview={activeFile.preview} name={activeFile.name} />
    </Resizable.Pane>
  {/if}

  <Resizable.Handle withHandle />

  <Resizable.Pane defaultSize={44} minSize={28}>
    <Tabs.Root bind:value={capabilityId} class="h-full min-h-0 gap-12 p-20 pt-16">
      {#if activeFile !== null}
        <FileHeader file={activeFile} />
      {/if}
      <Tabs.List class="flex-wrap">
        {#each tabs as capability (capability.id)}
          {@const applicable = activeFile === null || capability.applies(activeFile).applies}
          <Tabs.Trigger
            value={capability.id}
            title={capability.description}
            class={applicable ? undefined : "opacity-50"}
          >
            {capability.label}
          </Tabs.Trigger>
        {/each}
      </Tabs.List>

      <div class="min-h-0 flex-1 overflow-y-auto pt-16">
        {#if activeFile === null}
          <Absence
            kind="not-run"
            reason="Readings appear here once a file is on the workbench."
          />
        {:else}
          <!-- The stage mark is not repeated here: a capability that is not served yet renders
               its own control disabled with the Soon mark beside it, and a second badge above the
               panel would say the same thing twice. -->
          <CapabilityPanel
            capability={activeCapability}
            file={activeFile}
            files={capabilityFiles}
            onOpenCapability={openCapability}
          />
        {/if}
      </div>
    </Tabs.Root>
  </Resizable.Pane>
</Resizable.PaneGroup>
