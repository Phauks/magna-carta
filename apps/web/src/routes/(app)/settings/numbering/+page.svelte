<script lang="ts">
  /*
   * Settings · Numbering — every number the firm issues, under Practice.
   *
   * ONE REGISTER, ONE PAGE. A firm numbers many things — matters, consultations, enquiries,
   * conflicts checks, custody packets, invoices, time entries, calls — and each used to be decided
   * somewhere of its own, if anywhere. The server lists them all from one register, in one order,
   * and this page is that list: a plate per sequence. A sequence the firm shapes gets the scheme
   * editor, each saved in its own audited write, because a change to one is not a change to another
   * and a firm that has set none of them is numbering from the built-in sequences already. A
   * sequence whose shape is fixed by ruling is stated with the shape, so the page is the whole
   * inventory rather than the configurable half of it; why it is fixed is the user guide's to say.
   *
   * THE PAGE IS THE SETTINGS ANATOMY. Masthead, the one scroll region, a plate per sequence, and
   * inside each plate the rows every settings page is made of — what is in force, the scheme to
   * start from, the parts as a table, the preview — with the plate's own Save and Discard as its
   * exit. The settings surface's page-level draft footer is for a page of rows staged together; a
   * scheme is a list edited in place and saved on its own, so each plate keeps its exit and the
   * masthead states the posture without a page draft. The record of a change is the audit row the
   * server writes, not a per-browser ledger. The loading fixture is the settled anatomy — one plate
   * per sequence, each with its In Force row — so the canvas does not grow when the read lands.
   *
   * A NUMBER, ONCE DRAWN, IS FROZEN. Saving a scheme reaches only the records numbered from then
   * on, and the line beside each Save says so — once, where the reader is about to act. A single
   * matter's number is set by hand from the matter's own status window, never from here; the guide
   * under docs/user/admin explains the whole of it, so this page carries no paragraph explaining
   * itself.
   */
  import LoadingRegion from "@magna-carta/design-system/loading-region";
  import { sessionPermissions } from "$lib/access/session-permissions.svelte.ts";
  import NumberingSchemeEditor from "$lib/matters/numbering-scheme-editor.svelte";
  import {
    MANAGE_NUMBERING_PERMISSION,
    readNumberingSchemes,
    type NumberingSchemesListing,
  } from "$lib/matters/numbering-api.ts";
  import {
    isSchemeNumberingPurpose,
    type NumberingPurposeRecord,
    type SchemeNumberingPurpose,
  } from "$lib/matters/numbering-scheme.ts";
  import { permissionRefusal } from "$lib/access/refusal.ts";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import SettingsDescription from "$lib/settings/components/settings-description.svelte";
  import SettingsMasthead from "$lib/settings/components/settings-masthead.svelte";
  import SettingsPlate from "$lib/settings/components/settings-plate.svelte";
  import SettingsPlateNote from "$lib/settings/components/settings-plate-note.svelte";
  import SettingsRow from "$lib/settings/components/settings-row.svelte";
  import SettingsScrollRegion from "$lib/settings/components/settings-scroll-region.svelte";
  import type { SettingDefinition } from "$lib/settings/settings-definitions.ts";

  // The one shared answer to "may this member edit": false until the session read lands, so the
  // page errs read-only for a moment rather than offering an edit it then refuses.
  const mayManage = $derived(sessionPermissions.holds(MANAGE_NUMBERING_PERMISSION));

  /** The register as the server listed it. Null until the read lands. */
  let listing = $state<NumberingSchemesListing | null>(null);
  let readFailure = $state<StatedFailure | null>(null);

  async function load(): Promise<void> {
    readFailure = null;
    const outcome = await readNumberingSchemes(fetch);
    if (outcome.kind !== "ok") {
      readFailure = stated(outcome.failure, "The firm's numbering could not be read.");
      return;
    }
    listing = outcome.value;
  }

  $effect(() => {
    void sessionPermissions.load(fetch);
  });

  $effect(() => {
    if (mayManage) void load();
  });

  /** A scheme-shaped record, narrowed so the editor's prop type says what it takes. */
  function schemeRecord(
    record: NumberingPurposeRecord,
  ): (NumberingPurposeRecord & { purpose: SchemeNumberingPurpose }) | null {
    return isSchemeNumberingPurpose(record.purpose)
      ? (record as NumberingPurposeRecord & { purpose: SchemeNumberingPurpose })
      : null;
  }

  /** What a fixed plate renders from: a purpose's row on the listing, or the fixture's sample words. */
  interface FixedPlate {
    readonly key: string;
    readonly title: string;
    readonly fixedShape: string | null;
    readonly example: string | null;
  }

  /** The In Force row of a fixed sequence: the number the sample renders, and the shape under it. */
  function fixedDefinition(plate: FixedPlate): SettingDefinition {
    return {
      id: `numbering.${plate.key}.in-force`,
      sectionId: "numbering",
      label: "In Force",
      description: `Fixed shape. ${plate.fixedShape ?? ""}`.trim(),
      kind: "text",
      defaultValue: "",
      sensitivity: "open",
    };
  }

  // The loading fixture: the settled anatomy over sample words — one plate per sequence the
  // register lists, each with its In Force row — so the page is its own skeleton.
  const FIXTURE_PLATES = [
    "Matter Numbers",
    "Consultation Numbers",
    "Intake Numbers",
    "Conflicts Check Numbers",
    "Custody Numbers",
    "Invoice Numbers",
    "Time Entry Numbers",
    "Call and Text Numbers",
  ].map(
    (title, index): FixedPlate => ({
      key: `fixture-${index}`,
      title,
      fixedShape: 'Year, 4 digits, restarts the count · "-" · Counter, 4 digits',
      example: "2026-0001",
    }),
  );

  function fixedPlateOf(record: NumberingPurposeRecord): FixedPlate {
    return {
      key: record.purpose,
      title: record.title,
      fixedShape: record.fixedShape,
      example: record.example,
    };
  }
</script>

{#snippet fixedPlate(plate: FixedPlate)}
  <SettingsPlate heading={plate.title}>
    <SettingsRow definition={fixedDefinition(plate)} value={plate.example ?? ""} />
  </SettingsPlate>
{/snippet}

<svelte:head>
  <title>Numbering · Settings · Magna Carta</title>
</svelte:head>

<SettingsMasthead
  sectionId="numbering"
  title="Numbering"
  posture={sessionPermissions.settled && !mayManage ? "readOnly" : "draft"}
  showHistory={false}
/>

<SettingsScrollRegion>
  <SettingsDescription>
    The shape of every number the firm draws: matter, consultation, intake, conflicts check and
    custody numbers as the firm writes them, and the numbers whose shape is fixed.
  </SettingsDescription>

  {#if sessionPermissions.settled && !mayManage}
    <!-- A refusal is not an absence of data, so it draws no frame. -->
    <SettingsPlateNote>
      {permissionRefusal("Reading and changing the firm's numbering", MANAGE_NUMBERING_PERMISSION)}
    </SettingsPlateNote>
  {:else}
    <LoadingRegion
      loading={listing === null && readFailure === null}
      failed={readFailure !== null}
      label="Reading the firm's numbering"
      class="flex flex-col gap-24"
    >
      {#snippet fixture()}
        {#each FIXTURE_PLATES as plate (plate.key)}
          {@render fixedPlate(plate)}
        {/each}
      {/snippet}
      {#snippet failure()}
        {#if readFailure !== null}
          <FailureNotice
            failure={readFailure.failure}
            title="The Numbering Could Not Be Read"
            fallback={readFailure.fallback}
            onRetry={() => void load()}
          />
        {/if}
      {/snippet}
      {#if listing !== null}
        {#each listing.purposes as record (record.purpose)}
          {@const scheme = schemeRecord(record)}
          {#if scheme !== null}
            <SettingsPlate heading={record.title}>
              <NumberingSchemeEditor record={scheme} sample={listing.sample} canManage />
            </SettingsPlate>
          {:else}
            {@render fixedPlate(fixedPlateOf(record))}
          {/if}
        {/each}
      {/if}
    </LoadingRegion>
  {/if}
</SettingsScrollRegion>
