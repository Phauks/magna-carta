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
   * THE PREVIEW IS THE READER'S TO KEEP OR CLOSE, on every tab. It is not tied to which capability
   * is open: somebody reading a metadata table often wants the page beside it, and somebody working
   * a long conversion list wants the width. So it is one control that holds across tabs, and a file
   * with nothing to draw closes it on its own without touching what the reader chose.
   *
   * There is no separate empty screen. With nothing dropped this is the same panes with nothing in
   * them, each saying what it is missing.
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
  import { clipboardTextFor, type RowMenuItem } from "./row-menu.ts";
  import type { CapabilityModule } from "./capability.ts";
  import type { EphemeralFileSource } from "./ephemeral-source.svelte.ts";
  import type { WorkbenchFile } from "./workbench-file.ts";
  import type { Permission } from "@magna-carta/access-control/registry";

  let {
    source,
    permissions,
    capabilityId = $bindable(),
    previewOpen = false,
  }: {
    source: EphemeralFileSource;
    /** What the member holds. A capability they lack is hidden in place; nothing reorders. */
    permissions: ReadonlySet<Permission>;
    /** The capability on show, mirrored into the address so a reading can be linked to. */
    capabilityId: string;
    /** Whether the reader wants the file drawn beside its readings. Holds across tabs. */
    previewOpen?: boolean;
  } = $props();

  // Overview leads because it is the synthesis of the rest, not one more thing you can do.
  const tabs = $derived<readonly CapabilityModule[]>([
    overviewCapability,
    ...permittedCapabilities(permissions),
  ]);

  // Selection lives in the grid — it is the product's one table and owns its own rows. The body
  // only needs to know which keys are selected and which row is in focus.
  let selectedKeys = $state<readonly string[]>([]);
  let activeId = $state<string | null>(null);

  const activeFile = $derived(source.files.find((file) => file.id === activeId) ?? null);
  const selectedFiles = $derived(
    source.files.filter((file) => selectedKeys.includes(file.id)),
  );
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
  // The reader's choice, and what this particular file can honour. A file with nothing to draw
  // shows no pane and leaves the choice standing for the next file that has something.
  const previewShown = $derived(
    previewOpen && activeFile !== null && activeFile.preview.kind !== "none",
  );

  function openCapability(capability: CapabilityModule): void {
    capabilityId = capability.id;
  }

  async function runRowAction(item: RowMenuItem, file: WorkbenchFile): Promise<void> {
    const text = clipboardTextFor(item, file);
    if (text !== null) await navigator.clipboard.writeText(text);
  }
</script>

<Resizable.PaneGroup direction="horizontal" autoSaveId="file-workbench-panes" class="min-h-0 flex-1">
  <Resizable.Pane defaultSize={30} minSize={18} maxSize={48}>
    <FileRail
      files={source.files}
      bind:selectedKeys
      bind:activeId
      onFiles={(dropped) => void source.add(dropped)}
      onDiscard={(ids) => source.discard(ids)}
      onRowAction={(item, file) => void runRowAction(item, file)}
    />
  </Resizable.Pane>

  {#if previewShown}
    <Resizable.Handle withHandle />
    <Resizable.Pane defaultSize={30} minSize={18}>
      <FilePreview preview={activeFile!.preview} name={activeFile!.name} />
    </Resizable.Pane>
  {/if}

  <Resizable.Handle withHandle />

  <Resizable.Pane defaultSize={40} minSize={26}>
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
            reason={source.files.length === 0
              ? "Readings appear here once a file is on the workbench."
              : "Choose a file from the list to see what has been read about it."}
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
