<script lang="ts">
  /*
   * Settings · Numbering — every number the firm issues, under Practice.
   *
   * ONE REGISTER, ONE PAGE. A firm numbers many things — matters, consultations, enquiries,
   * conflicts checks, custody packets, invoices, time entries, calls — and each used to be decided
   * somewhere of its own, if anywhere. The server lists them all from one register, in one order,
   * and this page is that list: a fold per sequence, each holding the editor for the template that
   * sequence follows, each saved in its own audited write, because a change to one is not a change
   * to another and a firm that has set none of them is numbering from the built-in sequences
   * already.
   *
   * EVERY SEQUENCE FOLDS, AND THE CLOSED PAGE IS THE INVENTORY. The owner asked whether eight
   * sequences wanted a summary at the top or a fold each (2026-09-19); a fold each, because the
   * closed state already IS the summary — every sequence's name beside the number it is issuing
   * today, on one screen, with no second list to drift from the first. The fold's grammar is the
   * product's: the heading is the control, full width, the chevron on it
   * (docs/conventions/design-corrections.md). They start closed rather than open, which the
   * reference-list ruling would otherwise ask for, because closed is the view the owner asked for;
   * a reader opens the one they came to change.
   *
   * THE PAGE IS THE SETTINGS ANATOMY. Masthead, the one scroll region — and only that one, which
   * `pnpm run lint:settings-scroll` now holds — and inside each fold the rows every settings page
   * is made of, with the plate's own Save and Discard as its exit. The settings surface's
   * page-level draft footer is for a page of rows staged together; a scheme is a list edited in
   * place and saved on its own, so each fold keeps its exit and the masthead states the posture
   * without a page draft. The record of a change is the audit row the server writes, not a
   * per-browser ledger.
   *
   * A NUMBER, ONCE DRAWN, IS FROZEN. Saving a scheme reaches only the records numbered from then
   * on, and the line beside each Save says so — once, where the reader is about to act. A single
   * matter's number is set by hand from the matter's own status window, never from here; the guide
   * under docs/user/admin explains the whole of it, so this page carries no paragraph explaining
   * itself.
   */
  import * as Accordion from "@magna-carta/design-system/accordion";
  import Badge from "@magna-carta/design-system/badge";
  import LoadingRegion from "@magna-carta/design-system/loading-region";
  import { sessionPermissions } from "$lib/access/session-permissions.svelte.ts";
  import NumberingSchemeEditor from "$lib/matters/numbering-scheme-editor.svelte";
  import {
    MANAGE_NUMBERING_PERMISSION,
    readNumberingSchemes,
    type NumberingSchemesListing,
  } from "$lib/matters/numbering-api.ts";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import SettingsMasthead from "$lib/settings/components/settings-masthead.svelte";
  import RequestChangeDialog from "$lib/settings/components/request-change-dialog.svelte";
  import SettingsScrollRegion from "$lib/settings/components/settings-scroll-region.svelte";
  import type { SettingDefinition } from "$lib/settings/settings-definitions.ts";

  // The one shared answer to "may this member edit": false until the session read lands, so the
  // page errs read-only for a moment rather than offering an edit it then refuses. Every member
  // sees the inventory (owner ruling, 2026-09-18); only a member holding the key edits it, and the
  // rest carry the Request a change affordance every read-only settings page carries.
  const mayManage = $derived(sessionPermissions.holds(MANAGE_NUMBERING_PERMISSION));
  const readOnly = $derived(sessionPermissions.settled && !mayManage);

  let requestOpen = $state(false);
  let requestDefinition = $state<SettingDefinition | null>(null);
  function openRequest(definition: SettingDefinition): void {
    requestDefinition = definition;
    requestOpen = true;
  }

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
    void load();
  });

  // The loading fixture: the settled anatomy over sample words — one fold per sequence the register
  // lists, each stating a number — so the page is its own skeleton and the canvas does not grow
  // when the read lands.
  const FIXTURE = [
    "Matter Numbers",
    "Consultation Numbers",
    "Intake Numbers",
    "Conflicts Check Numbers",
    "Custody Packet Numbers",
    "Invoice Numbers",
    "Time Entry Numbers",
    "Call and Text Numbers",
  ].map((title, index) => ({ key: `fixture-${index}`, title, example: "2026-0001" }));
</script>

{#snippet foldHeading(title: string, example: string | null, usingDefault: boolean)}
  <span class="flex min-w-0 grow flex-wrap items-center justify-between gap-8 text-start">
    <span class="flex flex-wrap items-center gap-8">
      <span>{title}</span>
      {#if example === null}
        <Badge variant="warning">Not set</Badge>
      {:else if usingDefault}
        <Badge variant="neutral">Built-in sequence</Badge>
      {/if}
    </span>
    <span class="text-sm tabular-nums text-text-muted">{example ?? ""}</span>
  </span>
{/snippet}

<svelte:head>
  <title>Numbering · Settings · Magna Carta</title>
</svelte:head>

<SettingsMasthead
  sectionId="numbering"
  title="Numbering"
  posture={readOnly ? "readOnly" : "draft"}
  showHistory={false}
/>

<SettingsScrollRegion>
  <LoadingRegion
    loading={listing === null && readFailure === null}
    failed={readFailure !== null}
    label="Reading the firm's numbering"
    class="flex flex-col"
  >
    {#snippet fixture()}
      <Accordion.Root type="multiple" class="flex flex-col">
        {#each FIXTURE as plate (plate.key)}
          <Accordion.Item value={plate.key}>
            <Accordion.Trigger>{@render foldHeading(plate.title, plate.example, false)}</Accordion.Trigger>
          </Accordion.Item>
        {/each}
      </Accordion.Root>
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
      <Accordion.Root type="multiple" class="flex flex-col">
        {#each listing.purposes as record (record.purpose)}
          <Accordion.Item value={record.purpose}>
            <Accordion.Trigger>
              {@render foldHeading(record.title, record.example, record.usingDefault)}
            </Accordion.Trigger>
            <Accordion.Content>
              <NumberingSchemeEditor
                {record}
                sample={listing.sample}
                canManage={mayManage}
                onRequestChange={readOnly ? openRequest : undefined}
              />
            </Accordion.Content>
          </Accordion.Item>
        {/each}
      </Accordion.Root>
    {/if}
  </LoadingRegion>
</SettingsScrollRegion>

{#if requestDefinition !== null}
  <RequestChangeDialog bind:open={requestOpen} definition={requestDefinition} />
{/if}
