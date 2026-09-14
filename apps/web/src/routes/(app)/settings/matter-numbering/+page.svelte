<script lang="ts">
  /*
   * Settings · Matter Numbering — the templates the firm's two sequences follow, under Practice.
   *
   * TWO SCHEMES, ONE PAGE. A firm numbers two things and shapes them separately: the permanent
   * matter number, drawn the moment a matter opens and frozen from then on, and the tentative
   * number a consultation carries until (and after) it opens. Each is its own plate on this page,
   * each saved in its own audited write, because a change to one is not a change to the other and a
   * firm that has set neither is numbering consultations from the built-in sequence already.
   *
   * THE PAGE IS THE SETTINGS ANATOMY. Masthead, the one scroll region, a plate per scheme, and
   * inside each plate the rows every settings page is made of — what is in force, the scheme to
   * start from, the parts as a table, the preview — with the plate's own Save and Discard as its
   * exit. The settings surface's page-level draft footer is for a page of rows staged together; a
   * scheme is a list edited in place and saved on its own, so each plate keeps its exit and the
   * masthead states the posture without a page draft. The record of a change is the audit row the
   * server writes, not a per-browser ledger.
   *
   * NO NUMBER BEFORE ACTIVE, AND NONE CHANGED HERE. A matter draws its number when it opens and
   * never before; an intake and a consultation carry none. Saving a scheme reaches only the matters
   * numbered from then on, and the line beside each Save says so. A single matter's number is set
   * by hand from the matter's own status window, never from here; the guide under docs/user/admin
   * explains the whole of it, so this page carries no paragraph explaining itself.
   */
  import NumberingSchemeEditor from "$lib/matters/numbering-scheme-editor.svelte";
  import { MANAGE_NUMBERING_PERMISSION } from "$lib/matters/numbering-api.ts";
  import { numberingPurposeLabel } from "$lib/matters/numbering-scheme.ts";
  import { civilToday } from "$lib/billing/invoice-standing.ts";
  import { permissionRefusal } from "$lib/access/refusal.ts";
  import SettingsDescription from "$lib/settings/components/settings-description.svelte";
  import SettingsMasthead from "$lib/settings/components/settings-masthead.svelte";
  import SettingsPlate from "$lib/settings/components/settings-plate.svelte";
  import SettingsPlateNote from "$lib/settings/components/settings-plate-note.svelte";
  import SettingsScrollRegion from "$lib/settings/components/settings-scroll-region.svelte";
  import { readSession, type SessionBootstrap } from "$lib/matters/matters-api.ts";

  let session = $state<SessionBootstrap | null>(null);
  // Unknown until the session answers; the editors are drawn on the answer, because the scheme
  // read itself needs the permission and a refused read would say the same thing less well.
  const mayManage = $derived(
    session === null ? null : session.permissions.includes(MANAGE_NUMBERING_PERMISSION),
  );
  const today = civilToday();

  $effect(() => {
    void readSession(fetch).then((outcome) => {
      if (outcome.kind === "ok") session = outcome.value;
    });
  });
</script>

<svelte:head>
  <title>Matter Numbering · Settings · Magna Carta</title>
</svelte:head>

<SettingsMasthead
  sectionId="matter-numbering"
  title="Matter Numbering"
  posture={mayManage === false ? "readOnly" : "draft"}
  showHistory={false}
/>

<SettingsScrollRegion>
  <SettingsDescription>
    The shape of every matter number and consultation number the firm draws. A number is drawn
    once, when the matter opens, and never changes.
  </SettingsDescription>

  {#if mayManage === false}
    <SettingsPlate heading={numberingPurposeLabel("matter")}>
      <SettingsPlateNote>
        {permissionRefusal("Reading and changing the firm's numbering", MANAGE_NUMBERING_PERMISSION)}
      </SettingsPlateNote>
    </SettingsPlate>
  {:else if mayManage === true}
    <SettingsPlate heading={numberingPurposeLabel("matter")}>
      <NumberingSchemeEditor purpose="matter" canManage {today} />
    </SettingsPlate>
    <SettingsPlate heading={numberingPurposeLabel("consultation")}>
      <NumberingSchemeEditor purpose="consultation" canManage {today} />
    </SettingsPlate>
  {/if}
</SettingsScrollRegion>
