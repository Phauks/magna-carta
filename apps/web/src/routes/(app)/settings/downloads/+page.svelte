<script lang="ts">
  /*
   * Settings · Downloads — how THIS member takes the files the platform makes them.
   *
   * One choice today, and it is the one the download register changed: exporting generates an item
   * onto the shelf rather than saving a file, so several can be gathered and taken together. A
   * member who preferred the old way turns this on and gets both at once — the file now, and the
   * item on the shelf as well.
   *
   * A member setting at the user tier, so it follows the person between machines. Instant posture:
   * the write lands as the switch moves, because nothing here is a draft anybody reviews.
   *
   * WHERE a file lands is progressive enhancement over one seam. A page can only choose a folder
   * where the File System Access API exists — Chromium today; Firefox and Safari ship only the
   * sandboxed Origin Private File System. So the row appears with a working picker where the browser
   * can, and states the browser's own setting where it cannot, rather than rendering a control that
   * does nothing. The folder itself is per BROWSER because a directory handle cannot be serialized
   * to a server, which is exactly why it does not sit beside the per-member switch above.
   *
   * Both rows are the shared settings row, so the plate keeps one rhythm: the folder row's
   * description states where files land today, and its control column holds the picker.
   */
  import { onMount } from "svelte";
  import { toast } from "@magna-carta/design-system/toast";
  import SettingsDescription from "$lib/settings/components/settings-description.svelte";
  import SettingsMasthead from "$lib/settings/components/settings-masthead.svelte";
  import SettingsPlate from "$lib/settings/components/settings-plate.svelte";
  import SettingsRow from "$lib/settings/components/settings-row.svelte";
  import SettingsScrollRegion from "$lib/settings/components/settings-scroll-region.svelte";
  import type { SettingDefinition } from "$lib/settings/settings-definitions.ts";
  import {
    readDownloadPreferences,
    writeDownloadPreferences,
  } from "$lib/export/download-shelf.ts";
  import Button from "@magna-carta/design-system/button";
  import {
    chooseDownloadFolder,
    chosenFolderName,
    folderPickerSupported,
    forgetDownloadFolder,
  } from "$lib/export/save-target.ts";

  const SAVE_IMMEDIATELY_DEFINITION: SettingDefinition = {
    id: "downloads.save-immediately",
    sectionId: "downloads",
    label: "Save a file as soon as I export",
    description:
      "Exporting adds the file to Downloads so you can collect several at once. Turn this on to also save each file right away.",
    kind: "switch",
    defaultValue: false,
    sensitivity: "open",
  };

  let saveImmediately = $state(false);
  let folderName = $state<string | null>(null);
  const canChooseFolder = folderPickerSupported();

  // The row's description is the fact about where files land TODAY, so it follows the folder.
  // Where the browser lets no page choose, it names the browser's own setting instead — honest
  // rather than absent: Firefox and Safari have the same dialog; they just do not let a page open
  // it.
  const FOLDER_DEFINITION = $derived<SettingDefinition>({
    id: "downloads.folder",
    sectionId: "downloads",
    label: "Download Folder",
    description: !canChooseFolder
      ? 'This browser can\'t let a page choose a folder. Turn on "Always ask where to save files" in your browser settings instead.'
      : folderName === null
        ? "Files go wherever this browser saves downloads."
        : `Files are saved to ${folderName}.`,
    kind: "text",
    defaultValue: "",
    sensitivity: "open",
  });

  onMount(() => {
    void readDownloadPreferences(fetch).then((outcome) => {
      if (outcome.kind === "ok") saveImmediately = outcome.value.saveImmediately;
    });
    void chosenFolderName().then((name) => (folderName = name));
  });

  // Straight from the click: the picker needs transient user activation, and an await ahead of it
  // spends that activation.
  async function pickFolder(): Promise<void> {
    const chosen = await chooseDownloadFolder();
    if (chosen !== null) folderName = chosen;
  }

  async function clearFolder(): Promise<void> {
    await forgetDownloadFolder();
    folderName = null;
  }

  async function apply(next: boolean): Promise<void> {
    const previous = saveImmediately;
    saveImmediately = next;
    const outcome = await writeDownloadPreferences(fetch, { saveImmediately: next });
    if (outcome.kind === "ok") return;
    // Put the switch back where it was: a control that moved and did not save is a setting the
    // member believes they changed.
    saveImmediately = previous;
    toast.error("That preference could not be saved. Try again shortly.");
  }
</script>

<svelte:head>
  <title>Downloads · Settings · Magna Carta</title>
</svelte:head>

<SettingsMasthead sectionId="downloads" title="Downloads" posture="instant" />

<SettingsScrollRegion>
  <SettingsDescription>How you get the files you export.</SettingsDescription>

  <SettingsPlate heading="Exporting">
    <SettingsRow
      definition={SAVE_IMMEDIATELY_DEFINITION}
      instant={{ value: saveImmediately, apply: (next) => void apply(next === true) }}
    />
  </SettingsPlate>
  <SettingsPlate heading="Where Files Land">
    <SettingsRow definition={FOLDER_DEFINITION}>
      {#snippet control()}
        {#if canChooseFolder}
          <Button variant="secondary" size="sm" onclick={() => void pickFolder()}>
            {folderName === null ? "Choose Folder" : "Change"}
          </Button>
          {#if folderName !== null}
            <Button variant="ghost" size="sm" onclick={() => void clearFolder()}>Clear</Button>
          {/if}
        {/if}
      {/snippet}
    </SettingsRow>
  </SettingsPlate>
</SettingsScrollRegion>
