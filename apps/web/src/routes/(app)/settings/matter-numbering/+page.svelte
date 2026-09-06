<script lang="ts">
  /*
   * Settings · Matter Numbering — the templates the firm's two sequences follow, under Practice.
   *
   * TWO SCHEMES, ONE PAGE. A firm numbers two things and shapes them separately: the permanent
   * matter number, drawn the moment a matter opens and frozen from then on, and the tentative
   * number a consultation carries until (and after) it opens. Each is its own editor on this page,
   * each saved in its own audited write, because a change to one is not a change to the other and a
   * firm that has set neither is numbering consultations from the built-in sequence already.
   *
   * THE PAGE APPLIES ON SAVE, PER SCHEME. The settings surface's draft-and-footer anatomy is for a
   * page of rows; a scheme is a list edited in place with a live preview beneath it, so each
   * editor carries its own Save and Discard and the masthead states the posture without a page
   * draft. The record of a change is the audit row the server writes, not a per-browser ledger.
   *
   * NO NUMBER BEFORE ACTIVE, AND NONE CHANGED HERE. A matter draws its number when it opens and
   * never before; an intake and a consultation carry none. Saving a scheme reaches only the matters
   * numbered from then on. A single matter's number is set by hand from the matter's own status
   * window, never from here.
   */
  import * as Alert from "@magna-carta/design-system/alert";
  import NumberingSchemeEditor from "$lib/matters/numbering-scheme-editor.svelte";
  import { MANAGE_NUMBERING_PERMISSION } from "$lib/matters/numbering-api.ts";
  import { civilToday } from "$lib/billing/invoice-standing.ts";
  import { permissionRefusal } from "$lib/access/refusal.ts";
  import SettingsMasthead from "$lib/settings/components/settings-masthead.svelte";
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
  meta="The shape of every matter number and consultation number the firm draws."
  posture={mayManage === false ? "readOnly" : "draft"}
  showHistory={false}
/>

<!-- The middle story: the one scroll area, reaching the canvas's true edges (the breathing
     room rides INSIDE it); scrollbar-gutter keeps pages that scroll and pages that do not at
     identical width. -->
<div class="mc-scrollbar min-h-0 grow overflow-y-auto" style="scrollbar-gutter: stable">
  <div class="flex flex-col gap-24 p-24">
    <Alert.Root variant="info">
      <Alert.Title>A Number Is Drawn Once, When The Matter Opens</Alert.Title>
      <Alert.Description>
        A matter number is drawn the moment a matter becomes active and never changes; an intake
        and a consultation carry none. A consultation carries its own tentative number from its own
        sequence, so a consultation the firm never takes on consumes no matter number. Each scheme
        is an ordered list of parts with exactly one counter; a part marked to restart the count
        starts the counter over for each of its values, the way a file room begins at 0001 every
        January. Saving a scheme reaches only the matters numbered from then on.
      </Alert.Description>
    </Alert.Root>

    {#if mayManage === false}
      <p class="text-sm text-text-muted">
        {permissionRefusal("Reading and changing the firm's numbering", MANAGE_NUMBERING_PERMISSION)}
      </p>
    {:else if mayManage === true}
      <NumberingSchemeEditor purpose="matter" canManage {today} />
      <NumberingSchemeEditor purpose="consultation" canManage {today} />
    {/if}
  </div>
</div>
