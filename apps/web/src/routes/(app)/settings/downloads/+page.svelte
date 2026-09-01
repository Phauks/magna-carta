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
   * WHERE a file lands is deliberately absent. A web page cannot choose the folder — that is the
   * browser's own "ask where to save each file" setting, which already covers every download
   * including the ones whose bytes never pass through the page. The platform-side answer belongs to
   * the desktop app, where it is a real local capability rather than a Chromium-only half of one.
   */
  import { onMount } from "svelte";
  import { toast } from "@magna-carta/design-system/toast";
  import SettingsMasthead from "$lib/settings/components/settings-masthead.svelte";
  import SettingsPlate from "$lib/settings/components/settings-plate.svelte";
  import SettingsRow from "$lib/settings/components/settings-row.svelte";
  import type { SettingDefinition } from "$lib/settings/settings-definitions.ts";
  import {
    readDownloadPreferences,
    writeDownloadPreferences,
  } from "$lib/export/download-shelf.ts";

  const SAVE_IMMEDIATELY_DEFINITION: SettingDefinition = {
    id: "downloads.save-immediately",
    sectionId: "downloads",
    label: "Save a file as soon as I export",
    description:
      "Exporting adds the item to your Downloads so you can gather several and take them together. Turn this on to also save the file straight away, the moment you export it.",
    kind: "switch",
    defaultValue: false,
    sensitivity: "open",
  };

  let saveImmediately = $state(false);

  onMount(() => {
    void readDownloadPreferences(fetch).then((outcome) => {
      if (outcome.kind === "ok") saveImmediately = outcome.value.saveImmediately;
    });
  });

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

<SettingsMasthead
  sectionId="downloads"
  title="Downloads"
  meta="How you take the files the platform makes for you."
  posture="instant"
/>

<div class="mc-scrollbar min-h-0 grow overflow-y-auto" style="scrollbar-gutter: stable">
  <div class="flex flex-col gap-24 p-24">
    <SettingsPlate heading="Exporting">
      <SettingsRow
        definition={SAVE_IMMEDIATELY_DEFINITION}
        instant={{ value: saveImmediately, apply: (next) => void apply(next === true) }}
      />
    </SettingsPlate>
  </div>
</div>
