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
   */
  import ActionDialog from "@magna-carta/design-system/action-dialog";
  import * as Alert from "@magna-carta/design-system/alert";
  import Button from "@magna-carta/design-system/button";
  import Skeleton from "@magna-carta/design-system/skeleton";
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
  import { entitySectionsFor } from "./entity-sections.ts";
  import {
    entityWindowFacts,
    entityWindowHeading,
    entityWindowSubtitle,
    type EntityStanding,
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

  $effect(() => {
    if (!open) return;
    const id = entityId;
    void reloadToken;
    // Only a change of RECORD discards what is on screen. A re-read after a write is the same
    // record being read again, and blanking it would flash a skeleton over what somebody is reading.
    if (shownFor !== id) {
      shownFor = id;
      entity = null;
      failure = null;
      section = "names";
    }
    let cancelled = false;
    void (async () => {
      const outcome = await readDirectoryEntity(fetch, id);
      if (cancelled) return;
      if (outcome.kind === "ok") {
        entity = outcome.value;
        failure = null;
        return;
      }
      failure = stated(outcome.failure, "This record could not be read.");
    })();
    return () => {
      cancelled = true;
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
        : "Changing a directory record needs the directory:edit permission, which this account does not hold.",
  );

  const mayReveal = $derived(
    session?.permissions.includes(VIEW_SENSITIVE_IDENTIFIERS_PERMISSION) ?? false,
  );
  const revealDisabledReason = $derived(
    session === null
      ? "Reading your session."
      : mayReveal
        ? undefined
        : "Reading a sealed identifier needs the directory:viewSensitiveIdentifiers permission, which this account does not hold.",
  );

  // ---- what the window says --------------------------------------------------------------------

  const heading = $derived(entityWindowHeading(entity));
  const subtitle = $derived(entity === null ? undefined : entityWindowSubtitle(entity));
  const name = $derived(entity === null ? "" : directoryEntityName(entity));
  const mergedInto = $derived(entity === null ? null : entityMergedIntoIdentifier(entity));
  const facts = $derived(entity === null ? [] : entityWindowFacts(entity));
  const sections = $derived(entity === null ? [] : entitySectionsFor(entity.kind));
</script>

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
    {#if entity === null}
      {#if failure === null}
        <div class="flex flex-col gap-16" aria-busy="true" aria-label="Reading the directory record">
          <Skeleton class="h-32 w-full max-w-md" />
          <Skeleton class="h-32 w-full" />
          <Skeleton class="h-32 w-full" />
        </div>
      {/if}
    {:else}
      <!-- The record's sections as a rail; the chosen one's pane beside it — the New Person
           screen's own arrangement, so a record reads back the way it was entered. -->
      <Tabs.Root bind:value={section} orientation="vertical" class="gap-16">
        <Tabs.List class="shrink-0" style="width: 11rem">
          {#each sections as entry (entry.id)}
            <Tabs.Trigger value={entry.id}>{entry.label}</Tabs.Trigger>
          {/each}
        </Tabs.List>

        <Tabs.Content value="names" class="min-w-0 flex-auto">
          <NamesPane {entity} {mayEdit} {editDisabledReason} onRecorded={recorded} />
        </Tabs.Content>

        <Tabs.Content value="contact" class="min-w-0 flex-auto">
          <ContactPane {entityId} {mayEdit} {editDisabledReason} />
        </Tabs.Content>

        {#if entity.kind === "person"}
          <Tabs.Content value="pronouns" class="min-w-0 flex-auto">
            <PronounsPane person={entity.person} {mayEdit} {editDisabledReason} onRecorded={recorded} />
          </Tabs.Content>

          <Tabs.Content value="dates" class="min-w-0 flex-auto">
            <LifeDatesPane person={entity.person} {mayEdit} {editDisabledReason} onRecorded={recorded} />
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
             was opened from, one line per association, the capacity beside the role. -->
        <div class="flex flex-col gap-8">
          <SectionHeading label={standing.heading} />
          <dl class="grid gap-x-12 gap-y-4 text-sm" style="grid-template-columns: auto minmax(0, 1fr)">
            {#each standing.lines as line, index (index)}
              <dt class="text-text-muted">{line.label}</dt>
              <dd class="text-right">{line.value}</dd>
            {/each}
          </dl>
        </div>
      {/if}

      {#if facts.length > 0}
        <div class="flex flex-col gap-8">
          <SectionHeading label="This Record" />
          <dl class="grid gap-x-12 gap-y-4 text-sm" style="grid-template-columns: auto minmax(0, 1fr)">
            {#each facts as line (line.label)}
              <dt class="text-text-muted">{line.label}</dt>
              <dd class="text-right">{line.value}</dd>
            {/each}
          </dl>
        </div>
      {/if}
    </div>
  {/snippet}
</ActionDialog>
