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
   * sequence whose shape is fixed by ruling is stated with the shape and the reason, so the page is
   * the whole inventory rather than the configurable half of it.
   *
   * THE PAGE IS THE SETTINGS ANATOMY. Masthead, the one scroll region, a plate per sequence, and
   * inside each plate the rows every settings page is made of — what is in force, the scheme to
   * start from, the parts as a table, the preview — with the plate's own Save and Discard as its
   * exit. The settings surface's page-level draft footer is for a page of rows staged together; a
   * scheme is a list edited in place and saved on its own, so each plate keeps its exit and the
   * masthead states the posture without a page draft. The record of a change is the audit row the
   * server writes, not a per-browser ledger.
   *
   * A NUMBER, ONCE DRAWN, IS FROZEN. Saving a scheme reaches only the records numbered from then
   * on, and the line beside each Save says so. A single matter's number is set by hand from the
   * matter's own status window, never from here; the guide under docs/user/admin explains the
   * whole of it, so this page carries no paragraph explaining itself.
   */
  import Badge from "@magna-carta/design-system/badge";
  import LoadingRegion from "@magna-carta/design-system/loading-region";
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
  import { readSession, type SessionBootstrap } from "$lib/matters/matters-api.ts";

  let session = $state<SessionBootstrap | null>(null);
  // Unknown until the session answers; the plates are drawn on the answer, because the listing
  // itself needs the permission and a refused read would say the same thing less well.
  const mayManage = $derived(
    session === null ? null : session.permissions.includes(MANAGE_NUMBERING_PERMISSION),
  );

  /** The register as the server listed it. Null until the read lands. */
  let listing = $state<NumberingSchemesListing | null>(null);
  let readFailure = $state<StatedFailure | null>(null);

  async function load(): Promise<void> {
    const outcome = await readNumberingSchemes(fetch);
    if (outcome.kind !== "ok") {
      readFailure = stated(outcome.failure, "The firm's numbering could not be read.");
      return;
    }
    readFailure = null;
    listing = outcome.value;
  }

  $effect(() => {
    void readSession(fetch).then((outcome) => {
      if (outcome.kind === "ok") session = outcome.value;
    });
  });

  $effect(() => {
    if (mayManage === true) void load();
  });

  /** A scheme-shaped record, narrowed so the editor's prop type says what it takes. */
  function schemeRecord(
    record: NumberingPurposeRecord,
  ): (NumberingPurposeRecord & { purpose: SchemeNumberingPurpose }) | null {
    return isSchemeNumberingPurpose(record.purpose)
      ? (record as NumberingPurposeRecord & { purpose: SchemeNumberingPurpose })
      : null;
  }

  /** The In Force row of a fixed sequence: the shape, and the reason it is not the firm's to change. */
  function fixedDefinition(record: Pick<NumberingPurposeRecord, "purpose" | "drawnWhen" | "fixedShape">): SettingDefinition {
    return {
      id: `numbering.${record.purpose}.in-force`,
      sectionId: "numbering",
      label: "In Force",
      description: `${record.drawnWhen} ${record.fixedShape ?? ""}`.trim(),
      kind: "text",
      defaultValue: "",
      sensitivity: "open",
    };
  }

  /** The loading fixture: one plate in the shape the fixed rows take, over sample words. */
  const FIXTURE_RECORD = {
    purpose: "matter",
    title: "Matter Numbers",
    drawnWhen: "Drawn once, the moment a matter opens, and frozen from then on.",
    fixedShape: null,
    example: "2026-0001",
  } as const;
</script>

{#snippet fixedPlate(
  record: Pick<NumberingPurposeRecord, "purpose" | "title" | "drawnWhen" | "fixedShape" | "example">,
  badge: string | null,
)}
  <SettingsPlate heading={record.title}>
    <SettingsRow definition={fixedDefinition(record)}>
      {#snippet control()}
        <div class="flex flex-col items-end gap-4">
          {#if badge !== null}
            <Badge variant="neutral">{badge}</Badge>
          {/if}
          <p class="text-end text-sm font-medium tabular-nums">{record.example}</p>
        </div>
      {/snippet}
    </SettingsRow>
  </SettingsPlate>
{/snippet}

<svelte:head>
  <title>Numbering · Settings · Magna Carta</title>
</svelte:head>

<SettingsMasthead
  sectionId="numbering"
  title="Numbering"
  posture={mayManage === false ? "readOnly" : "draft"}
  showHistory={false}
/>

<SettingsScrollRegion>
  <SettingsDescription>
    The shape of every number the firm draws: matter, consultation, intake, conflicts check and
    custody numbers as the firm writes them, and the numbers whose shape is fixed. A number is drawn
    once and never changes.
  </SettingsDescription>

  {#if mayManage === false}
    <SettingsPlate heading="Matter Numbers">
      <SettingsPlateNote>
        {permissionRefusal("Reading and changing the firm's numbering", MANAGE_NUMBERING_PERMISSION)}
      </SettingsPlateNote>
    </SettingsPlate>
  {:else if mayManage === true}
    {#if readFailure !== null}
      <FailureNotice
        failure={readFailure.failure}
        title="The Numbering Could Not Be Read"
        fallback={readFailure.fallback}
        onRetry={() => void load()}
      />
    {/if}
    <LoadingRegion
      loading={listing === null && readFailure === null}
      label="Reading the firm's numbering"
      class="flex flex-col gap-24"
    >
      {#snippet fixture()}
        {@render fixedPlate(FIXTURE_RECORD, null)}
      {/snippet}
      {#if listing !== null}
        {#each listing.purposes as record (record.purpose)}
          {@const scheme = schemeRecord(record)}
          {#if scheme !== null}
            <SettingsPlate heading={record.title}>
              <NumberingSchemeEditor record={scheme} sample={listing.sample} canManage />
            </SettingsPlate>
          {:else}
            {@render fixedPlate(record, "Fixed shape")}
          {/if}
        {/each}
      {/if}
    </LoadingRegion>
  {/if}
</SettingsScrollRegion>
