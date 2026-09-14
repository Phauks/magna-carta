<script lang="ts">
  /*
   * Settings · Versions — what is running, and whether this firm's records can be reached, at
   * page size.
   *
   * IT IS THE VERSION REPORT, NOT A SECOND ONE. The chip in the top bar and this page answer the
   * same question, so they render the same component (version-report.svelte) over the same
   * models: every Worker in the fleet under the name it is deployed as, the sync read between the
   * two Workers that serve the app's address, the folds that remember themselves, and the
   * Database section that says what stands between this session and the firm's own data. The
   * chip is the quick view; this is the full one, with room for the rows.
   *
   * The page used to work around an endpoint it said did not exist — decomposing the scan
   * engine's composite version out of the score-histogram route and leaving every other row a
   * seam. GET /api/v1/meta/versions has existed since the chip was built, and the scan engine's
   * own reading now sits beneath the depth it runs against, on File Safety & Scanning.
   *
   * The masthead carries no History trigger: this page has no ledger section — versions are
   * reported facts, not user changes, and an always-empty trail would state something untrue
   * about where their history lives (it is the platform's deploy log, not this device). The
   * posture badge is overridden to "Reported by the platform" for the same honesty: nothing
   * here is managed, it is observed.
   */
  import SettingsDescription from "$lib/settings/components/settings-description.svelte";
  import SettingsMasthead from "$lib/settings/components/settings-masthead.svelte";
  import SettingsPlate from "$lib/settings/components/settings-plate.svelte";
  import SettingsScrollRegion from "$lib/settings/components/settings-scroll-region.svelte";
  import VersionReport from "$lib/versions/version-report.svelte";
</script>

<svelte:head>
  <title>Versions · Settings · Magna Carta</title>
</svelte:head>

<SettingsMasthead
  sectionId="versions"
  title="Versions"
  posture="readOnly"
  badgeLabel="Reported by the platform"
  showHistory={false}
/>

<SettingsScrollRegion>
  <SettingsDescription>
    What is running: every part of the platform, and whether this firm's records can be reached.
  </SettingsDescription>

  <SettingsPlate heading="Build Versions">
    <VersionReport scope="app" open layout="page" />
  </SettingsPlate>
</SettingsScrollRegion>
