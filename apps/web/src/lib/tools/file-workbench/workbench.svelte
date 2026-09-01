<script lang="ts">
  /*
   * The File Workbench: the files, the file, and what has been read about it.
   *
   * The screen owns its own chrome. The masthead is here rather than in the route because every
   * control in it acts on this surface — adding files, and whether the file is drawn beside its
   * readings and on which side. A route that held those would have to reach into the list's grid
   * to do it.
   *
   * ONE CONTAINER, DIVIDED. The list, the file and its readings are parts of a single instrument,
   * so they share one frame and touch across the hairline each resizable edge already draws. They
   * were two floating cards with a gap between them, which read as two tools that happened to be
   * open beside each other rather than as one workbench.
   *
   * THE TABS GOVERN THE FINDINGS AND NOTHING ELSE. They sit on the readings' top edge, spanning
   * that side only: a strip spanning the whole frame reads as though it switched the whole screen,
   * when what it switches is which reading of this one file is on show. The file list does not
   * change when a tab does. Under the strip, the file's own line names the subject every tab
   * shares — inside the readings because that is what they are readings OF, above the scroll so it
   * does not leave with the findings.
   *
   * THE PREVIEW IS THE READER'S. Whether the file is drawn at all, and which side of the readings
   * it sits on, are both theirs and both remembered. Neither is tied to which capability is open:
   * switching from Hash to Metadata is not a reason to rearrange somebody's screen. A file with
   * nothing to draw closes the pane on its own without touching what they chose.
   *
   * There is no separate empty screen. With nothing dropped this is the same panes with nothing in
   * them, each saying what it is missing.
   */
  import * as DataTable from "@magna-carta/design-system/data-table";
  import * as Masthead from "@magna-carta/design-system/masthead";
  import * as Resizable from "@magna-carta/design-system/resizable";
  import * as Tabs from "@magna-carta/design-system/tabs";
  import Button from "@magna-carta/design-system/button";
  import Eye from "@lucide/svelte/icons/eye";
  import EyeOff from "@lucide/svelte/icons/eye-off";
  import PanelLeft from "@lucide/svelte/icons/panel-left";
  import PanelRight from "@lucide/svelte/icons/panel-right";
  import Upload from "@lucide/svelte/icons/upload";
  import FileRail from "./file-rail.svelte";
  import FilePreview from "./file-preview.svelte";
  import FileHeader from "./file-header.svelte";
  import CapabilityPanel from "./capability-panel.svelte";
  import Absence from "./parts/absence.svelte";
  import { overviewCapability } from "./overview.ts";
  import { permittedCapabilities } from "./capabilities.ts";
  import { RAIL_COLUMNS, railColumns } from "./rail-columns.ts";
  import { clipboardTextFor, type RowMenuItem } from "./row-menu.ts";
  import { WorkbenchPreferences } from "./workbench-preferences.svelte.ts";
  import type { CapabilityModule } from "./capability.ts";
  import type { EphemeralFileSource } from "./ephemeral-source.svelte.ts";
  import type { WorkbenchFile } from "./workbench-file.ts";
  import type { Permission } from "@magna-carta/access-control/registry";

  let {
    source,
    permissions,
    capabilityId = $bindable(),
  }: {
    source: EphemeralFileSource;
    /** What the member holds. A capability they lack is hidden in place; nothing reorders. */
    permissions: ReadonlySet<Permission>;
    /** The capability on show. The address can name one, so a tool can open the bench on it. */
    capabilityId: string;
  } = $props();

  const preferences = new WorkbenchPreferences();
  $effect(() => preferences.visibility.followAcrossTabs());
  $effect(() => preferences.side.followAcrossTabs());

  let picker = $state<HTMLInputElement | null>(null);
  let selectedKeys = $state<readonly string[]>([]);
  let activeId = $state<string | null>(null);

  // The grid lives here rather than inside the list: the screen reads and drives its selection
  // (which file the readings are about), and the list can begin at the top of its pane.
  const grid = DataTable.createDataTableGrid<WorkbenchFile>({
    columns: railColumns,
    rows: () => source.files,
    rowKey: (file) => file.id,
    // Newest last is how a person reads a bench they are adding to: the file they just dropped is
    // where they left it, not at the top pushing everything down.
    initialSort: { columnId: RAIL_COLUMNS.added, direction: "ascending" },
    itemNoun: { singular: "file", plural: "files" },
    onSelectionChange: (keys) => {
      selectedKeys = keys;
    },
  });

  // Focus rather than "the first selected": focus is where the reader's attention is, and it
  // survives a range.
  $effect(() => {
    activeId = grid.selection.focus ?? grid.selectedKeys[0] ?? null;
  });

  // A file arriving on an empty bench selects itself. Somebody who drops a file has already said
  // which file they mean, and making them click it again to see what it is buys nothing.
  $effect(() => {
    const first = grid.rowsInView[0];
    if (first !== undefined && grid.selectedKeys.length === 0) grid.rowClick(first.id);
  });

  // Overview leads because it is the synthesis of the rest, not one more thing you can do.
  const tabs = $derived<readonly CapabilityModule[]>([
    overviewCapability,
    ...permittedCapabilities(permissions),
  ]);

  const activeFile = $derived(source.files.find((file) => file.id === activeId) ?? null);
  const selectedFiles = $derived(source.files.filter((file) => selectedKeys.includes(file.id)));
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
    preferences.previewShown && activeFile !== null && activeFile.preview.kind !== "none",
  );

  function openCapability(capability: CapabilityModule): void {
    capabilityId = capability.id;
  }

  function pick(event: Event & { currentTarget: HTMLInputElement }): void {
    if (event.currentTarget.files) void source.add([...event.currentTarget.files]);
    // Cleared so picking the same file twice in a row still fires a change.
    event.currentTarget.value = "";
  }

  async function runRowAction(item: RowMenuItem, file: WorkbenchFile): Promise<void> {
    const text = clipboardTextFor(item, file);
    if (text !== null) await navigator.clipboard.writeText(text);
  }
</script>

{#snippet readings()}
  <!-- No frame of its own: the surrounding container is the frame, and the resizable edge beside
       this pane is the only line that belongs between the two. -->
  <div class="flex h-full min-h-0 flex-col">
    <Tabs.Root bind:value={capabilityId} class="min-h-0 flex-1 gap-0">
      <Tabs.List class="flex-wrap bg-surface-raised px-8">
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

      {#if activeFile !== null}
        <div class="border-b border-border-default px-16 py-12">
          <FileHeader file={activeFile} />
        </div>
      {/if}

      <div class="mc-scrollbar min-h-0 flex-1 overflow-y-auto p-16">
        {#if activeFile === null}
          <Absence
            kind="not-run"
            reason={source.files.length === 0
              ? "Readings appear here once a file is on the workbench."
              : "Choose a file from the list to see what has been read about it."}
          />
        {:else}
          <!-- The stage mark is not repeated here: a capability that is not served yet renders its
               own control disabled with the Soon mark beside it, and a second badge above the panel
               would say the same thing twice. -->
          <CapabilityPanel
            capability={activeCapability}
            file={activeFile}
            files={capabilityFiles}
            onOpenCapability={openCapability}
          />
        {/if}
      </div>
    </Tabs.Root>
  </div>
{/snippet}

{#snippet filePane()}
  <Resizable.Pane defaultSize={26} minSize={16}>
    <div class="flex h-full min-h-0 flex-col">
      <FilePreview preview={activeFile!.preview} name={activeFile!.name} />
    </div>
  </Resizable.Pane>
{/snippet}

<div class="flex h-full min-h-0 flex-col gap-16">
  <Masthead.Root>
    <Masthead.Heading>
      <Masthead.Title>File Workbench</Masthead.Title>
      <!-- The file count is not here. It belongs to the list, in the list's own footer beside the
           selection, which is where a reader looks for both. What IS here is the lifetime, because
           nothing else on the screen says it. -->
      <Masthead.Meta>
        <span>Runs outside any matter</span>
        <Masthead.MetaSeparator />
        <span>Nothing is filed</span>
        <Masthead.MetaSeparator />
        <span>Nothing leaves this browser, and closing this page clears it</span>
      </Masthead.Meta>
    </Masthead.Heading>
    <Masthead.Actions>
      <Button variant="secondary" size="sm" onclick={() => picker?.click()}>
        <Upload class="size-16" aria-hidden="true" />
        Add Files
      </Button>
      <Button
        variant="secondary"
        size="sm"
        aria-pressed={preferences.previewShown}
        title={preferences.previewShown
          ? "Hide the file and give the readings the width"
          : "Show the file beside its readings"}
        onclick={() => preferences.togglePreview()}
      >
        {#if preferences.previewShown}
          <EyeOff class="size-16" aria-hidden="true" />
          Hide Preview
        {:else}
          <Eye class="size-16" aria-hidden="true" />
          Show Preview
        {/if}
      </Button>
      {#if preferences.previewShown}
        <Button
          variant="secondary"
          size="icon"
          title={preferences.previewSide === "left"
            ? "Move the file to the right of its readings"
            : "Move the file to the left of its readings"}
          aria-label="Swap which side the file is drawn on"
          onclick={() => preferences.swapSide()}
        >
          {#if preferences.previewSide === "left"}
            <PanelRight class="size-16" aria-hidden="true" />
          {:else}
            <PanelLeft class="size-16" aria-hidden="true" />
          {/if}
        </Button>
      {/if}
      <!-- The real control, off-screen but reached through the button above it: a file picker is
           the one thing a page cannot open without a native input. -->
      <input
        bind:this={picker}
        type="file"
        multiple
        class="sr-only"
        aria-label="Add files to the workbench"
        onchange={pick}
      />
    </Masthead.Actions>
  </Masthead.Root>

  <!-- The one frame. Everything below is inside it and touches across the resizable edges, which
       are the only lines drawn between the parts — the handles carry no grip, because the edge is
       already the affordance and a grip drawn on it is furniture on a work surface. -->
  <div
    class="flex min-h-0 flex-1 overflow-hidden rounded-md border border-border-default bg-surface-default"
  >
    <Resizable.PaneGroup
      direction="horizontal"
      autoSaveId="file-workbench-panes"
      class="min-h-0 flex-1"
    >
      <Resizable.Pane defaultSize={34} minSize={20} maxSize={52}>
        <FileRail
          {grid}
          files={source.files}
          activeId={activeFile?.id ?? null}
          onFiles={(dropped) => void source.add(dropped)}
          onDiscard={(ids) => source.discard(ids)}
          onRowAction={(item, file) => void runRowAction(item, file)}
          onAddFiles={() => picker?.click()}
        />
      </Resizable.Pane>

      <Resizable.Handle />

      {#if previewShown && preferences.previewSide === "left"}
        {@render filePane()}
        <Resizable.Handle />
      {/if}

      <Resizable.Pane defaultSize={40} minSize={26}>
        {@render readings()}
      </Resizable.Pane>

      {#if previewShown && preferences.previewSide === "right"}
        <Resizable.Handle />
        {@render filePane()}
      {/if}
    </Resizable.PaneGroup>
  </div>
</div>
