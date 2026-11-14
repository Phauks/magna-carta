<script lang="ts">
  /*
   * Settings · Firm Brand — how the firm looks, under Firm: its primary mark, and the images it
   * keeps beside it.
   *
   * An office's letterhead prints the primary mark unless that office has set a logo of its own,
   * which is what lets a single-office firm set its identity here once. The office's own logo stays
   * on the office's record, under Offices, because it belongs to the office rather than the firm.
   *
   * Its own page rather than a plate on Firm Profile: what the firm is called and how it looks are
   * different questions, and this is where firm-wide branding grows. Every act on the plate
   * commits at once against the brand-image routes, so the masthead states "applies immediately"
   * and there is no footer. The right to change it is the firm profile's own, because the routes
   * are guarded by that permission.
   */
  import { sessionPermissions } from "$lib/access/session-permissions.svelte.ts";
  import { MANAGE_FIRM_PROFILE_PERMISSION } from "$lib/settings/firm-profile-api.ts";
  import SettingsDescription from "$lib/settings/components/settings-description.svelte";
  import SettingsMasthead from "$lib/settings/components/settings-masthead.svelte";
  import SettingsScrollRegion from "$lib/settings/components/settings-scroll-region.svelte";
  import BrandImagesPlate from "./brand-images-plate.svelte";

  const canEdit = $derived(sessionPermissions.holds(MANAGE_FIRM_PROFILE_PERMISSION));

  $effect(() => {
    void sessionPermissions.load(fetch);
  });
</script>

<svelte:head>
  <title>Firm Brand · Settings · Magna Carta</title>
</svelte:head>

<SettingsMasthead
  sectionId="firm-brand"
  title="Firm Brand"
  posture={canEdit ? "instant" : "readOnly"}
  showHistory={false}
/>

<SettingsScrollRegion>
  <SettingsDescription>
    The firm's logo and the other images it uses.
  </SettingsDescription>

  <BrandImagesPlate {canEdit} />
</SettingsScrollRegion>
