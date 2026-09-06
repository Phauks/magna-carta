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
   * THE SHAPE IS THE NEW PERSON SCREEN'S. The owner chose the side rail for creating a person, and
   * reading one back is the same document: the record's sections stand as a rail on the left, the
   * chosen section's pane beside it, and on the right what stands about the record as a whole — the
   * roles the host knows it holds, and the record's own facts. The panes are the same components the
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
   * WHILE THE RECORD IS READ, THE WINDOW IS ITS OWN SHAPE. The rail and the first pane render over a
   * sample record inside a loading region, and the context pane's facts likewise, so what appears
   * is the document the reader is about to get and not a set of boxes standing in for it. The rail
   * shows a person's sections because the record's kind is one of the things being read.
   */
  import ActionDialog from "@magna-carta/design-system/action-dialog";
  import * as Alert from "@magna-carta/design-system/alert";
  import Badge from "@magna-carta/design-system/badge";
  import Button from "@magna-carta/design-system/button";
  import * as DataTable from "@magna-carta/design-system/data-table";
  import LoadingRegion from "@magna-carta/design-system/loading-region";
  import { samplePerson } from "@magna-carta/design-system/loading-fixtures";
  import * as Tabs from "@magna-carta/design-system/tabs";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import { readSession, type SessionBootstrap } from "$lib/matters/matters-api.ts";
  import {
    readDirectoryEntity,
    DIRECTORY_EDIT_PERMISSION,
    VIEW_SENSITIVE_IDENTIFIERS_PERMISSION,
    type DirectoryEntityDetail,
  } from "./directory-api.ts";
  import { directoryEntityName, entityMergedIntoIdentifier } from "./entity-presentation.ts";
  import { entitySectionsFor, type EntitySection } from "./entity-sections.ts";
  import {
    entityWindowFacts,
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
  let section = $state("names");
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
      section = "names";
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
      failure = stated(outcome.failure, "This record could not be read.");
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
   * rail, the names pane's rows over sample names, and the facts the context pane lists. Not anybody
   * the firm holds.
   */
  const FIXTURE_SECTIONS: readonly EntitySection[] = entitySectionsFor("person");
  const FIXTURE_NAMES: readonly { name: string; role: string; period: string }[] = [
    { name: samplePerson(0).name, role: "Current", period: "From 2018-06-14" },
    { name: samplePerson(2).name, role: "Former", period: "— to 2018-06-14" },
  ];
  const FIXTURE_FACTS: readonly StandingLine[] = [
    { label: "Kind", value: "Person" },
    { label: "Pronouns", value: "she/her" },
    { label: "Born", value: "1974-03-18" },
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
  const facts = $derived(entity === null ? [] : entityWindowFacts(entity));
  const sections = $derived(entity === null ? [] : entitySectionsFor(entity.kind));
</script>

<!-- The rail, written once for the record and for the shape it takes while it is read. -->
{#snippet sectionRail(entries: readonly EntitySection[])}
  <Tabs.List class="shrink-0" style="width: 11rem">
    {#each entries as entry (entry.id)}
      <Tabs.Trigger value={entry.id}>{entry.label}</Tabs.Trigger>
    {/each}
  </Tabs.List>
{/snippet}

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

<ActionDialog bind:open kind="reading" {heading} {subtitle} width="record" {onDismiss}>
  {#snippet notice()}
    {#if failure !== null}
      <FailureNotice
        failure={failure.failure}
        title="This Record Could Not Be Read"
        fallback={failure.fallback}
        whenSilent={failure.whenSilent}
        onRetry={reread}
      />
    {/if}
  {/snippet}

  {#snippet fields()}
    <!-- A record that could not be read has the notice above and nothing standing in for it. A
         record still being read has its own shape: the rail and the first pane over a sample. -->
    {#if entity !== null || failure === null}
      <LoadingRegion
        loading={entity === null}
        {refreshing}
        label="Reading the directory record"
        onRetry={reread}
        class="flex min-w-0 flex-col"
      >
        {#snippet fixture()}
          <Tabs.Root value="names" orientation="vertical" class="gap-16">
            {@render sectionRail(FIXTURE_SECTIONS)}
            <Tabs.Content value="names" class="min-w-0 flex-auto">
              <section class="flex flex-col gap-16">
                <h3 class="text-sm font-semibold" data-loading-keep>Names on the record</h3>
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
              </section>
            </Tabs.Content>
          </Tabs.Root>
        {/snippet}

        {#if entity !== null}
          <!-- The record's sections as a rail; the chosen one's pane beside it — the New Person
               screen's own arrangement, so a record reads back the way it was entered. -->
          <Tabs.Root bind:value={section} orientation="vertical" class="gap-16">
            {@render sectionRail(sections)}

            <Tabs.Content value="names" class="min-w-0 flex-auto">
              <NamesPane {entity} {mayEdit} {editDisabledReason} onRecorded={recorded} />
            </Tabs.Content>

            <Tabs.Content value="contact" class="min-w-0 flex-auto">
              <ContactPane {entityId} {mayEdit} {editDisabledReason} />
            </Tabs.Content>

            {#if entity.kind === "person"}
              <Tabs.Content value="pronouns" class="min-w-0 flex-auto">
                <PronounsPane
                  person={entity.person}
                  {mayEdit}
                  {editDisabledReason}
                  onRecorded={recorded}
                />
              </Tabs.Content>

              <Tabs.Content value="dates" class="min-w-0 flex-auto">
                <LifeDatesPane
                  person={entity.person}
                  {mayEdit}
                  {editDisabledReason}
                  onRecorded={recorded}
                />
              </Tabs.Content>
            {/if}

            <Tabs.Content value="identifiers" class="min-w-0 flex-auto">
              <IdentifiersPane
                {entityId}
                kind={entity.kind}
                {mayEdit}
                {editDisabledReason}
                {mayReveal}
                {revealDisabledReason}
              />
            </Tabs.Content>

            <Tabs.Content value="duplicates" class="min-w-0 flex-auto">
              <DuplicatesPane
                {entity}
                {mayEdit}
                {editDisabledReason}
                onMerged={recorded}
                onOpenEntity={openEntity}
              />
            </Tabs.Content>

            <!-- One pane, three filters: every relationship, and the membership family read from
                 whichever side this record is on. -->
            <Tabs.Content value="relationships" class="min-w-0 flex-auto">
              <EdgesPane
                {entityId}
                kind={entity.kind}
                {name}
                filter="all"
                {mayEdit}
                {editDisabledReason}
                onOpenEntity={openEntity}
              />
            </Tabs.Content>

            {#if entity.kind === "organization"}
              <Tabs.Content value="people" class="min-w-0 flex-auto">
                <EdgesPane
                  {entityId}
                  kind={entity.kind}
                  {name}
                  filter="people"
                  {mayEdit}
                  {editDisabledReason}
                  onOpenEntity={openEntity}
                />
              </Tabs.Content>
            {:else}
              <Tabs.Content value="organizations" class="min-w-0 flex-auto">
                <EdgesPane
                  {entityId}
                  kind={entity.kind}
                  {name}
                  filter="organizations"
                  {mayEdit}
                  {editDisabledReason}
                  onOpenEntity={openEntity}
                />
              </Tabs.Content>
            {/if}

            <Tabs.Content value="matters" class="min-w-0 flex-auto">
              <MattersPane {entityId} />
            </Tabs.Content>

            {#if entity.kind === "organization"}
              <Tabs.Content value="categories" class="min-w-0 flex-auto">
                <CategoriesPane {entityId} kind={entity.kind} {mayEdit} {editDisabledReason} />
              </Tabs.Content>
            {/if}
          </Tabs.Root>
        {/if}
      </LoadingRegion>
    {/if}
  {/snippet}

  {#snippet context()}
    <div class="flex flex-col gap-16">
      {#if mergedInto !== null}
        <!-- A folded-away record still opens: somebody following an old link lands on something
             that says where the record went, not on a record quietly pretending to stand alone. -->
        <Alert.Root variant="info">
          <Alert.Title>This Record Was Folded Into Another</Alert.Title>
          <Alert.Description>
            It is archived and no longer stands on its own. Everything recorded against it moved to
            the surviving record, and the names it carried still find it.
            <Button variant="secondary" size="sm" class="mt-8" onclick={() => openEntity(mergedInto)}>
              Open the surviving record
            </Button>
          </Alert.Description>
        </Alert.Root>
      {/if}

      {#if standing !== null && standing.lines.length > 0}
        <!-- What the host knows and the directory does not: this record's roles on the matter it
             was opened from, one line per association, the capacity beside the role. It is the
             host's to hand over, so it never waits on the record's read. -->
        <div class="flex flex-col gap-8">
          <SectionHeading label={standing.heading} />
          {@render factLines(standing.lines)}
        </div>
      {/if}

      {#if entity !== null || failure === null}
        <LoadingRegion
          loading={entity === null}
          {refreshing}
          label="Reading this record's own facts"
          onRetry={reread}
          class="flex flex-col gap-8"
        >
          {#snippet fixture()}
            <SectionHeading label="This Record" />
            {@render factLines(FIXTURE_FACTS)}
          {/snippet}
          {#if facts.length > 0}
            <SectionHeading label="This Record" />
            {@render factLines(facts)}
          {/if}
        </LoadingRegion>
      {/if}
    </div>
  {/snippet}
</ActionDialog>
