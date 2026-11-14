<script lang="ts">
  /*
   * The entity window — the one surface a directory record is read and changed in, wherever it
   * opens.
   *
   * IT OPENS OVER THE READER'S WORK AND CLOSES BACK TO IT. A person on a matter's parties tab used
   * to open as a screen in the directory, and the way back at the top of that screen led to the
   * directory's list rather than to the matter the reader had just left — the only path in the
   * product where "back" did not mean the screen above. Opening the record in place ends that: the
   * matter stays where it was, its own way back stays true, and there is no trail to keep track of.
   * The directory's own list opens records the same way (the address carries which one), so a
   * record has ONE shape everywhere and the tabbed record screen no longer exists.
   *
   * THE SHAPE IS THE NEW PERSON SCREEN'S. Reading a record back is the same document as entering
   * one: every section stacked in one scrolling page, the rail on the left jumping between them
   * (record-sections.svelte), so a phone number and an address are read without a press. The
   * record's own facts — pronouns, life dates — stand in the header under the name. The right-hand
   * pane appears only when the host has something to add that the directory does not know: the
   * roles the record holds on the matter it was opened from. The panes are the same components the
   * record screen composed, editing in place through their own add rows; nothing about how a name,
   * a way to reach someone or a sealed identifier is recorded lives here.
   *
   * A RELATED RECORD OPENED FROM INSIDE SWAPS THE SUBJECT. A duplicate candidate, a related
   * organization, the record this one was folded into: each opens in this same window rather than
   * stacking a second one, because two of the same window over each other is a thing a reader has to
   * unwind. `entityId` is therefore bindable — the host that put the window up learns which record it
   * shows, and the directory's list mirrors that into the address.
   *
   * THE PANEL IS THE ACTION DIALOG SHELL, READING KIND: it shows a thing and asks for nothing, so
   * its bar ends at the way out and every exit leaves at once. The record's own acts are seated in
   * their panes — and the two that ask a question of their own (changing the name on the record,
   * folding a duplicate in) open their panel over this one, which is one level and no more.
   *
   * WHILE THE RECORD IS READ, THE WINDOW IS ITS OWN SHAPE. The rail and the first section render
   * over a sample record inside a loading region, so what appears is the document the reader is
   * about to get and not a set of boxes standing in for it. The rail shows a person's sections
   * because the record's kind is one of the things being read.
   */
  import ActionDialog from "@magna-carta/design-system/action-dialog";
  import * as Alert from "@magna-carta/design-system/alert";
  import Badge from "@magna-carta/design-system/badge";
  import Button from "@magna-carta/design-system/button";
  import * as DropdownMenu from "@magna-carta/design-system/dropdown-menu";
  import { toast } from "@magna-carta/design-system/toast";
  import Contact from "@lucide/svelte/icons/contact";
  import Download from "@lucide/svelte/icons/download";
  import FileText from "@lucide/svelte/icons/file-text";
  import FileType from "@lucide/svelte/icons/file-type";
  import Link from "@lucide/svelte/icons/link";
  import Mail from "@lucide/svelte/icons/mail";
  import { exportFilename, saveExport } from "$lib/export/tabular-export.ts";
  import { PdfComposeError, renderPdfExport } from "$lib/export/render-pdf.ts";
  import { renderTextExport } from "$lib/export/render-text.ts";
  import * as DataTable from "@magna-carta/design-system/data-table";
  import LoadingRegion from "@magna-carta/design-system/loading-region";
  import { samplePerson } from "@magna-carta/design-system/loading-fixtures";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import { readSession, type SessionBootstrap } from "$lib/matters/matters-api.ts";
  import {
    readDirectoryContactPoints,
    readDirectoryEntity,
    DIRECTORY_EDIT_PERMISSION,
    VIEW_SENSITIVE_IDENTIFIERS_PERMISSION,
    type DirectoryEntityDetail,
  } from "./directory-api.ts";
  import {
    directoryEntityName,
    entityMergedIntoIdentifier,
    entityRecordHref,
  } from "./entity-presentation.ts";
  import {
    CONTACT_CARD_CONTENT_TYPE,
    contactCard,
    contactCardFilename,
    readContactCardPhoto,
  } from "./contact-card.ts";
  import { readRecordPrintoutParts, recordPrintout } from "./record-printout.ts";
  import { entitySectionsFor, type EntitySection } from "./entity-sections.ts";
  import {
    entityWindowHeading,
    entityWindowSubtitle,
    type EntityStanding,
    type StandingLine,
  } from "./entity-window-model.ts";
  import CategoriesPane from "./categories-pane.svelte";
  import ContactPane from "./contact-pane.svelte";
  import DuplicatesPane from "./duplicates-pane.svelte";
  import EdgesPane from "./edges-pane.svelte";
  import IdentifiersPane from "./identifiers-pane.svelte";
  import LifeDatesPane from "./life-dates-pane.svelte";
  import MattersPane from "./matters-pane.svelte";
  import NamesPane from "./names-pane.svelte";
  import PronounsPane from "./pronouns-pane.svelte";
  import SectionHeading from "./sections/section-heading.svelte";
  import { permissionRefusal } from "$lib/access/refusal.ts";
  import { RECORD_PANEL_BODY_STYLE } from "./record-panel.ts";
  import RecordSections from "./record-sections.svelte";
  import EntityPhoto from "./entity-photo.svelte";

  let {
    open = $bindable(false),
    entityId = $bindable(),
    standing = null,
    onChanged,
    onDismiss,
  }: {
    open?: boolean;
    /** The record on show. Bindable: a related record opened from inside the window swaps it. */
    entityId: string;
    /** What the host knows about the record that the directory does not — its roles on a matter. */
    standing?: EntityStanding | null;
    /** A write landed on the record; a host showing its name on a list re-reads it. */
    onChanged?: () => void;
    /** The reader closed the window. The directory takes the record out of its address on this. */
    onDismiss?: () => void;
  } = $props();

  // ---- the record ------------------------------------------------------------------------------

  let entity = $state<DirectoryEntityDetail | null>(null);
  let failure = $state<StatedFailure | null>(null);
  let reloadToken = $state(0);
  let shownFor = $state<string | null>(null);
  /** True while the record on screen is being read again, after a pane wrote to it. */
  let refreshing = $state(false);

  $effect(() => {
    if (!open) return;
    const id = entityId;
    void reloadToken;
    // Only a change of RECORD discards what is on screen. A re-read after a write is the same
    // record being read again, and blanking it would flash a placeholder over what somebody is
    // reading — so what is on screen stays, and the regions say they are busy.
    if (shownFor !== id) {
      shownFor = id;
      entity = null;
      failure = null;
    } else {
      refreshing = true;
    }
    let cancelled = false;
    void (async () => {
      const outcome = await readDirectoryEntity(fetch, id);
      if (cancelled) return;
      refreshing = false;
      if (outcome.kind === "ok") {
        entity = outcome.value;
        failure = null;
        return;
      }
      failure = stated(outcome.failure, "Couldn't load this record.");
    })();
    return () => {
      cancelled = true;
      refreshing = false;
    };
  });

  function reread(): void {
    reloadToken += 1;
  }

  /** A pane wrote to the record: it is read again here, and the host is told. */
  function recorded(): void {
    reread();
    onChanged?.();
  }

  /** A related record, opened in this same window. */
  function openEntity(id: string): void {
    if (id === entityId) return;
    entityId = id;
  }

  // ---- the shape while the record is read ------------------------------------------------------

  /**
   * The sample record the window takes its shape from while the real one is being read: a person's
   * rail and the names section's rows over sample names. Not anybody the firm holds.
   */
  const FIXTURE_SECTIONS: readonly EntitySection[] = entitySectionsFor("person");
  const FIXTURE_NAMES: readonly { name: string; role: string; period: string }[] = [
    { name: samplePerson(0).name, role: "Current", period: "From 2018-06-14" },
    { name: samplePerson(2).name, role: "Former", period: "— to 2018-06-14" },
  ];

  // ---- who is asking ---------------------------------------------------------------------------

  let session = $state<SessionBootstrap | null>(null);
  let sessionRead = false;

  // Read once, the first time the window opens: a screen that never opens it never pays for it.
  $effect(() => {
    if (!open || sessionRead) return;
    sessionRead = true;
    void (async () => {
      const outcome = await readSession(fetch);
      if (outcome.kind === "ok") session = outcome.value;
    })();
  });

  const mayEdit = $derived(session?.permissions.includes(DIRECTORY_EDIT_PERMISSION) ?? false);
  const editDisabledReason = $derived(
    session === null
      ? "Reading your session."
      : mayEdit
        ? undefined
        : permissionRefusal("Changing a directory record", "directory:edit"),
  );

  const mayReveal = $derived(
    session?.permissions.includes(VIEW_SENSITIVE_IDENTIFIERS_PERMISSION) ?? false,
  );
  const revealDisabledReason = $derived(
    session === null
      ? "Reading your session."
      : mayReveal
        ? undefined
        : permissionRefusal("Reading a sealed identifier", "directory:viewSensitiveIdentifiers"),
  );

  // ---- what the window says --------------------------------------------------------------------

  const heading = $derived(entityWindowHeading(entity));
  const subtitle = $derived(entity === null ? undefined : entityWindowSubtitle(entity));
  const name = $derived(entity === null ? "" : directoryEntityName(entity));
  const mergedInto = $derived(entity === null ? null : entityMergedIntoIdentifier(entity));
  const hasStanding = $derived(standing !== null && standing.lines.length > 0);

  // ---- what can be done with the record ---------------------------------------------------------

  /** The record's own address, whole, so it opens the same record wherever it is pasted. */
  function recordLink(): string {
    return new URL(entityRecordHref(entityId), window.location.origin).href;
  }

  async function copyLink(): Promise<void> {
    try {
      await navigator.clipboard.writeText(recordLink());
      toast.success("Link copied");
    } catch {
      toast.error("Couldn't copy the link. The browser blocked the clipboard.");
    }
  }

  /** A message with the link already in it, in the reader's own mail program. */
  function emailLink(): void {
    const subject = encodeURIComponent(name);
    const body = encodeURIComponent(`${name}\n${recordLink()}`);
    window.location.href = `mailto:?subject=${subject}&body=${body}`;
  }

  /**
   * The record as a contact card. The contact points are read at the moment of the press rather
   * than kept from the contact section, so the card carries what the record holds now.
   */
  async function downloadContactCard(): Promise<void> {
    const shown = entity;
    if (shown === null) return;
    const [outcome, picture] = await Promise.all([
      readDirectoryContactPoints(fetch, entityId),
      readContactCardPhoto(fetch, entityId),
    ]);
    if (outcome.kind !== "ok") {
      toast.error("Couldn't make the contact card because the contact details didn't load.");
      return;
    }
    await saveExport(contactCard(shown, outcome.value, picture), contactCardFilename(shown), CONTACT_CARD_CONTENT_TYPE);
  }

  /**
   * The record as a printout, in the reports' own formats: a PDF from the platform's PDF composer, or
   * plain text built here. Every list is read in full at the moment of the press.
   */
  async function downloadPrintout(format: "pdf" | "text"): Promise<void> {
    const shown = entity;
    if (shown === null) return;
    const parts = await readRecordPrintoutParts(fetch, shown, entityId);
    if (parts === null) {
      toast.error("Couldn't download the record because part of it didn't load.");
      return;
    }
    const printout = recordPrintout(parts);
    if (format === "text") {
      await saveExport(renderTextExport(printout), exportFilename(printout, "txt"), "text/plain;charset=utf-8");
      return;
    }
    try {
      const file = await renderPdfExport(printout);
      await saveExport(file, exportFilename(printout, "pdf"), "application/pdf");
    } catch (error) {
      toast.error(
        error instanceof PdfComposeError ? error.message : "Couldn't make the PDF. Try again.",
      );
    }
  }
  const sections = $derived(entity === null ? [] : entitySectionsFor(entity.kind));
</script>

<!-- A definition list of what stands against a record, keyed by position: a host may list one
     role twice under the same label. -->
{#snippet factLines(lines: readonly StandingLine[])}
  <dl class="grid gap-x-12 gap-y-4 text-sm" style="grid-template-columns: auto minmax(0, 1fr)">
    {#each lines as line, index (index)}
      <dt class="text-text-muted">{line.label}</dt>
      <dd class="text-right">{line.value}</dd>
    {/each}
  </dl>
{/snippet}

<!-- What the host knows and the directory does not: this record's roles on the matter it was opened
     from, one line per association, the capacity beside the role. It is the host's to hand over, so
     it never waits on the record's read — and with nothing handed over there is no right-hand pane
     at all, rather than a column kept open for nothing. -->
{#snippet standingPane()}
  {#if standing !== null}
    <div class="mc-scrollbar flex flex-col gap-8 overflow-y-auto" style={RECORD_PANEL_BODY_STYLE}>
      <SectionHeading label={standing.heading} />
      {@render factLines(standing.lines)}
    </div>
  {/if}
{/snippet}

<!-- The names, over sample rows, for the shape the window takes while the record is read. -->
{#snippet fixtureNames()}
  <DataTable.Root>
    <DataTable.Caption class="sr-only">The names this record carries</DataTable.Caption>
    <DataTable.Header>
      <DataTable.Row>
        <DataTable.Head>Name</DataTable.Head>
        <DataTable.Head>Role</DataTable.Head>
        <DataTable.Head>In use</DataTable.Head>
      </DataTable.Row>
    </DataTable.Header>
    <DataTable.Body>
      {#each FIXTURE_NAMES as entry (entry.name)}
        <DataTable.Row>
          <DataTable.Cell>{entry.name}</DataTable.Cell>
          <DataTable.Cell>
            <Badge variant="neutral">{entry.role}</Badge>
          </DataTable.Cell>
          <DataTable.Cell>
            <span class="text-text-muted">{entry.period}</span>
          </DataTable.Cell>
        </DataTable.Row>
      {/each}
    </DataTable.Body>
  </DataTable.Root>
{/snippet}

{#snippet recordPhoto()}
  <EntityPhoto {entityId} {name} {mayEdit} />
{/snippet}

{#snippet recordMenu()}
  <DropdownMenu.Item onSelect={() => void copyLink()}>
    <Link class="size-16" aria-hidden="true" />
    Copy Link
  </DropdownMenu.Item>
  <DropdownMenu.Item onSelect={emailLink}>
    <Mail class="size-16" aria-hidden="true" />
    Email Link
  </DropdownMenu.Item>
  <DropdownMenu.Separator />
  <DropdownMenu.Sub>
    <!-- The menu opens against the window's right edge, so the formats open inward, to the left. -->
    <DropdownMenu.SubTrigger submenuSide="left">
      <Download class="size-16" aria-hidden="true" />
      Download
    </DropdownMenu.SubTrigger>
    <DropdownMenu.SubContent side="left">
      <DropdownMenu.Item onSelect={() => void downloadPrintout("pdf")}>
        <FileText class="size-16" aria-hidden="true" />
        PDF
      </DropdownMenu.Item>
      <DropdownMenu.Item onSelect={() => void downloadPrintout("text")}>
        <FileType class="size-16" aria-hidden="true" />
        Plain Text
      </DropdownMenu.Item>
      <DropdownMenu.Item onSelect={() => void downloadContactCard()}>
        <Contact class="size-16" aria-hidden="true" />
        Contact Card (.vcf)
      </DropdownMenu.Item>
    </DropdownMenu.SubContent>
  </DropdownMenu.Sub>
{/snippet}

<ActionDialog
  bind:open
  kind="reading"
  {heading}
  {subtitle}
  width="record"
  context={hasStanding ? standingPane : undefined}
  menu={entity !== null ? recordMenu : undefined}
  leading={entity !== null ? recordPhoto : undefined}
  {onDismiss}
>
  {#snippet notice()}
    {#if failure !== null}
      <FailureNotice
        failure={failure.failure}
        title="Couldn't Load This Record"
        fallback={failure.fallback}
        whenSilent={failure.whenSilent}
        onRetry={reread}
      />
    {/if}
    {#if mergedInto !== null}
      <!-- A folded-away record still opens: somebody following an old link lands on something
           that says where the record went, not on a record quietly pretending to stand alone. -->
      <Alert.Root variant="info">
        <Alert.Title>This Record Was Folded Into Another</Alert.Title>
        <Alert.Description>
          This record is archived. Everything on it moved to the surviving record, and its names still find it.
          <Button variant="secondary" size="sm" class="mt-8" onclick={() => openEntity(mergedInto)}>
            Open the surviving record
          </Button>
        </Alert.Description>
      </Alert.Root>
    {/if}
  {/snippet}

  {#snippet fields()}
    <!-- A record that could not be read has the notice above and nothing standing in for it. A
         record still being read has its own shape: the rail and the first section over a sample. -->
    {#if entity !== null || failure === null}
      <LoadingRegion
        loading={entity === null}
        {refreshing}
        label="Reading the directory record"
        onRetry={reread}
        class="flex min-w-0 flex-col"
      >
        {#snippet fixture()}
          <RecordSections sections={FIXTURE_SECTIONS}>
            {#snippet section(part)}
              {#if part.id === "names"}
                {@render fixtureNames()}
              {/if}
            {/snippet}
          </RecordSections>
        {/snippet}

        {#if entity !== null}
          <!-- Every section stacked in one scrolling page, the rail beside it jumping between
               them — the New Person screen's own arrangement, so a record reads back the way it
               was entered. ONE HEIGHT (record-panel.ts): the page scrolls inside the panel rather
               than the panel growing with the record. -->
          <RecordSections {sections} label="Sections of {name}">
            {#snippet section(part)}
              <!-- The guard is for the type checker: these sections render only once the record
                   is read, under the loading region above. -->
              {#if entity !== null}
              {#if part.id === "names"}
                <NamesPane {entity} {mayEdit} {editDisabledReason} onRecorded={recorded} />
              {:else if part.id === "contact"}
                <ContactPane {entityId} {mayEdit} {editDisabledReason} />
              {:else if part.id === "address"}
                <!-- The same read, the other half of it. An address is a form whose shape is the
                     country's, so it stands beside the one-line ways to reach somebody, not inside
                     the list of them. -->
                <ContactPane {entityId} {mayEdit} {editDisabledReason} channel="addresses" />
              {:else if part.id === "about" && entity.kind === "person"}
                <div class="flex flex-col gap-24">
                  <PronounsPane person={entity.person} {mayEdit} {editDisabledReason} onRecorded={recorded} />
                  <LifeDatesPane person={entity.person} {mayEdit} {editDisabledReason} onRecorded={recorded} />
                </div>
              {:else if part.id === "identifiers"}
                <IdentifiersPane
                  {entityId}
                  kind={entity.kind}
                  {mayEdit}
                  {editDisabledReason}
                  {mayReveal}
                  {revealDisabledReason}
                />
              {:else if part.id === "duplicates"}
                <DuplicatesPane
                  {entity}
                  {mayEdit}
                  {editDisabledReason}
                  onMerged={recorded}
                  onOpenEntity={openEntity}
                />
              {:else if part.id === "relationships" || part.id === "people" || part.id === "organizations"}
                <!-- One pane, three filters: every relationship, and the membership family read
                     from whichever side this record is on. -->
                <EdgesPane
                  {entityId}
                  kind={entity.kind}
                  {name}
                  filter={part.id === "people" ? "people" : part.id === "organizations" ? "organizations" : "all"}
                  {mayEdit}
                  {editDisabledReason}
                  onOpenEntity={openEntity}
                />
              {:else if part.id === "matters"}
                <MattersPane {entityId} />
              {:else if part.id === "categories"}
                <CategoriesPane {entityId} kind={entity.kind} {mayEdit} {editDisabledReason} />
              {/if}
              {/if}
            {/snippet}
          </RecordSections>
        {/if}
      </LoadingRegion>
    {/if}
  {/snippet}
</ActionDialog>
