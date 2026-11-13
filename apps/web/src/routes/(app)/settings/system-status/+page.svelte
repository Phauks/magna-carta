<script lang="ts">
  /*
   * Settings · System Status — what is running and what works, at page size.
   *
   * IT IS THE VERSION REPORT, NOT A SECOND ONE. The chip in the top bar and this page render the
   * same component (version-report.svelte) over the same reads, so the two can never answer "what
   * is running" differently. The chip is the quick view: the two Workers that serve the app, the
   * features that are not working, and this firm's records. This page is the full one: four counts
   * across the top, then a tab per question — Features, Deployment, Workers, This Firm, and, for a
   * platform operator, Recent Errors — plus the Feature Flags this firm's channel resolves.
   *
   * IT IS ORGANISED BY FEATURE FIRST. A member uses Outlook sync or address suggestions, never
   * `magna-carta-address`, so the first tab says which features work. A platform operator also sees
   * what each feature that is off still needs and the steps that turn it on, because they are the
   * only person who can act on that; the API sends that detail to nobody else.
   *
   * The masthead carries no History trigger: this page has no ledger section — what it shows is
   * reported, not changed by a member, and an always-empty trail would state something untrue about
   * where its history lives (the platform's deploy log). The posture badge is overridden to
   * "Reported by the platform" for the same honesty: nothing here is managed, it is observed.
   */
  import SettingsMasthead from "$lib/settings/components/settings-masthead.svelte";
  import SettingsScrollRegion from "$lib/settings/components/settings-scroll-region.svelte";
  import VersionReport from "$lib/versions/version-report.svelte";
</script>

<svelte:head>
  <title>System Status · Settings · Magna Carta</title>
</svelte:head>

<SettingsMasthead
  sectionId="system-status"
  title="System Status"
  posture="readOnly"
  badgeLabel="Reported by the platform"
  showHistory={false}
/>

<SettingsScrollRegion>
  <VersionReport scope="app" open layout="page" />
</SettingsScrollRegion>
