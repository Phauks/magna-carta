<script lang="ts">
  /*
   * How this record connects to the rest of the firm's book — every relationship it has, or one
   * side of the membership family: the people inside an organization, or the organizations a
   * person is inside. One pane with a filter rather than three, because the three are one read
   * with one row shape and one way of adding a row, and three copies are three places for the
   * sentence to drift.
   *
   * These edges are what makes an imputed conflict EXPLICABLE. A hit on a company is only a hit on
   * its director because an edge says so, and the edge is the sentence a conflicts report can print
   * back to a reviewer who has to decide whether the firm may act. A relationship nobody can read is
   * a report nobody can check.
   *
   * DIRECTION IS NOT DECORATION. "Is the parent of" and "is a subsidiary of" are one stored row read
   * from opposite ends, so each row reads the type's own sentence with this record on whichever end
   * it stands: "Jane Okafor is an officer of Meridian Holdings" from either record. Flattening the
   * two would put a subsidiary in charge of its parent. The rules that decide the ends of a NEW edge
   * live in edge-draft.ts, where they are tested without a browser.
   *
   * ADDING HAPPENS IN THE PANE, beneath the list, so what is already connected stays in view while
   * the next connection is chosen. Nothing here ends or deletes an edge, because the record serves
   * no such act, and no control is drawn to suggest one.
   *
   * The far end is named by the same read every list here uses — one request for the page, never one
   * per row — and a far end the directory holds no name for renders as its gap, never as a handle.
   */
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import * as Combobox from "@magna-carta/design-system/combobox";
  import * as DataTable from "@magna-carta/design-system/data-table";
  import Badge from "@magna-carta/design-system/badge";
  import Button from "@magna-carta/design-system/button";
  import EntityIdentity from "@magna-carta/design-system/entity-identity";
  import type { PickableEntity } from "@magna-carta/design-system/entity-picker";
  import DirectoryEntityPicker from "./directory-entity-picker.svelte";
  import FieldRow from "@magna-carta/design-system/field-row";
  import Input from "@magna-carta/design-system/input";
  import LabelledField from "@magna-carta/design-system/labelled-field";
  import LoadingRegion from "@magna-carta/design-system/loading-region";
  import { sampleCivilDate, sampleOrganization, samplePerson } from "@magna-carta/design-system/loading-fixtures";
  import Link from "@lucide/svelte/icons/link";
  import {
    createDirectoryEdge,
    readDirectoryEdges,
    type DirectoryEdgeEntry,
    type DirectoryEdgeType,
    type DirectoryEntityKind,
  } from "./directory-api.ts";
  import {
    EDGE_TYPES,
    edgeTypeLabel,
    groupedEdgeTypes,
    type EdgeTypeEntry,
  } from "./directory-vocabulary.ts";
  import { directoryPickerSearch } from "./directory-picker-source.ts";
  import {
    edgeDraftRefusal,
    edgeEndsFor,
    edgeSentenceParts,
    farEndFieldName,
    paneEdgeTypes,
    paneShowsEdge,
    pickerKindsFor,
    UNKNOWN_EDGE_READING,
    type EdgePaneFilter,
  } from "./edge-draft.ts";
  import { entityRecordHref, UNNAMED_ENTITY } from "./entity-presentation.ts";
  import { heldBackRows, visibleRows } from "./record-sections.ts";

  let {
    entityId,
    kind,
    name,
    filter = "all",
    mayEdit,
    editDisabledReason,
    onOpenEntity,
  }: {
    entityId: string;
    /** Which side of the directory this record is on. Decides what may be recorded from it. */
    kind: DirectoryEntityKind;
    /** The record's display name, as the sentence each row reads names it. */
    name: string;
    /** Every edge, or one side of the membership family. */
    filter?: EdgePaneFilter;
    mayEdit: boolean;
    editDisabledReason?: string;
    /**
     * Open the far record some way other than by its address — inside the window this pane already
     * stands in, which swaps its subject rather than stacking a second window. Without it the far
     * name is the link to its address.
     */
    onOpenEntity?: (entityId: string) => void;
  } = $props();

  /*
   * What each filter calls itself and says when it has nothing to list. The empty line is ONE line:
   * it stands in the table's own empty body, under the header row, and the paragraph that used to
   * sit beside it explained the domain term to a reader who was only looking at a short list.
   */
  const PANE_WORDS: Record<
    EdgePaneFilter,
    { heading: string; caption: string; emptyTitle: string; readFailure: string }
  > = {
    all: {
      heading: "Relationships",
      caption: "How this record connects to others in the firm's book",
      emptyTitle: "Nothing Connected To This Record",
      readFailure: "Couldn't load this record's relationships.",
    },
    people: {
      heading: "People",
      caption: "The people inside this organization",
      emptyTitle: "Nobody Recorded In This Organization",
      readFailure: "Couldn't load the people in this organization.",
    },
    organizations: {
      heading: "Organizations",
      caption: "The organizations this person is inside",
      emptyTitle: "No Organization Recorded For This Person",
      readFailure: "Couldn't load this person's organizations.",
    },
  };
  const words = $derived(PANE_WORDS[filter]);

  /** The field names, written once: each is the label beside its control and its ghost text. */
  const RELATIONSHIP_FIELD_NAME = "Relationship";
  const ROLE_FIELD_NAME = "Role";
  const NOTE_FIELD_NAME = "Note";
  /** Inert filler for a line that has nothing to say, so its height never depends on wording. */
  const NOTHING = " ";

  /**
   * The shape the list takes while the record's edges are being read: the same rows the real list
   * renders, one from each end, over the sample vocabulary. The date is in the record's own stored
   * shape, which the vocabulary does not carry.
   */
  const EDGE_FIXTURE: readonly DirectoryEdgeEntry[] = [
    {
      id: "fixture-1",
      edgeType: "officer_of",
      direction: "outbound",
      farEntityId: "fixture-far-1",
      farEntityKind: "organization",
      farDisplayName: sampleOrganization(1).name,
      role: "Company secretary",
      note: null,
      validFrom: sampleCivilDate(2),
      validTo: null,
    },
    {
      id: "fixture-2",
      edgeType: "representation",
      direction: "inbound",
      farEntityId: "fixture-far-2",
      farEntityKind: "person",
      farDisplayName: samplePerson(1).name,
      role: null,
      note: "Appointed by the board",
      validFrom: null,
      validTo: null,
    },
  ];

  // ---- the list --------------------------------------------------------------------------------

  let edges = $state<readonly DirectoryEdgeEntry[] | null>(null);
  let nextCursor = $state<string | null>(null);
  let readFailure = $state<StatedFailure | null>(null);
  let loadingMore = $state(false);
  let reloadToken = $state(0);
  /** True while a list already on screen is being read again, after a write landed. */
  let refreshing = $state(false);
  // The record whose edges last landed. Only a change of RECORD discards what is on screen: a
  // re-read after a write is the same list being read again, and blanking it would flash a
  // placeholder over rows the reader is looking at, so the rows stay and the region is marked busy.
  let shownFor: string | null = null;

  $effect(() => {
    const id = entityId;
    void reloadToken;
    if (shownFor === id) {
      refreshing = true;
    } else {
      edges = null;
      nextCursor = null;
    }
    readFailure = null;
    let cancelled = false;
    void (async () => {
      const outcome = await readDirectoryEdges(fetch, id);
      if (cancelled) return;
      refreshing = false;
      if (outcome.kind === "ok") {
        shownFor = id;
        edges = outcome.value.data;
        nextCursor = outcome.value.nextCursor;
        return;
      }
      shownFor = null;
      edges = [];
      readFailure = stated(outcome.failure, words.readFailure);
    })();
    return () => {
      cancelled = true;
      refreshing = false;
    };
  });

  function retry(): void {
    reloadToken += 1;
  }

  async function loadMore(): Promise<void> {
    const cursor = nextCursor;
    if (cursor === null || loadingMore) return;
    loadingMore = true;
    const outcome = await readDirectoryEdges(fetch, entityId, cursor);
    loadingMore = false;
    if (outcome.kind !== "ok") return;
    edges = [...(edges ?? []), ...outcome.value.data];
    nextCursor = outcome.value.nextCursor;
  }

  /** The rows this pane lists: everything, or the membership family with a far end of its kind. */
  const shown = $derived((edges ?? []).filter((edge) => paneShowsEdge(filter, edge)));
  let expanded = $state(false);
  const listedEdges = $derived(visibleRows(shown, expanded));
  const heldBackEdges = $derived(heldBackRows(shown, expanded));
  const listIsReadable = $derived(edges !== null && readFailure === null);

  function entryOf(edgeType: string): EdgeTypeEntry | null {
    return EDGE_TYPES.find((entry) => entry.edgeType === edgeType) ?? null;
  }

  function farKindOf(edge: DirectoryEdgeEntry): DirectoryEntityKind | null {
    return edge.farEntityKind === "unknown" ? null : edge.farEntityKind;
  }

  function farNameOf(edge: DirectoryEdgeEntry): string {
    return edge.farDisplayName ?? UNNAMED_ENTITY;
  }

  /** The sentence the row reads, in the type's own direction, with the far end as its own piece. */
  function sentenceOf(edge: DirectoryEdgeEntry) {
    const entry = entryOf(edge.edgeType) ?? { reading: UNKNOWN_EDGE_READING };
    return edgeSentenceParts(name, entry, farNameOf(edge), edge.direction);
  }

  function period(edge: DirectoryEdgeEntry): string {
    const from = edge.validFrom?.slice(0, 10) ?? null;
    const to = edge.validTo?.slice(0, 10) ?? null;
    if (from === null && to === null) return "—";
    if (to === null) return `From ${from ?? "—"}`;
    return `${from ?? "—"} to ${to}`;
  }

  // ---- the add row -----------------------------------------------------------------------------

  const identity = $props.id();
  const relationshipInputId = `${identity}-relationship`;

  let adding = $state(false);
  let picked = $state<PickableEntity | null>(null);
  let chosenType = $state<DirectoryEdgeType | null>(null);
  /** What the relationship field reads. Owned here so typed-but-unchosen text is never a value. */
  let typeQuery = $state("");
  let role = $state("");
  let note = $state("");
  let submitting = $state(false);
  let writeFailure = $state<StatedFailure | null>(null);

  const search = directoryPickerSearch(fetch);

  const offered = $derived(paneEdgeTypes(kind, filter));
  const chosenEntry = $derived(
    chosenType === null ? null : (offered.find((entry) => entry.edgeType === chosenType) ?? null),
  );
  const pickerKinds = $derived(pickerKindsFor(kind, chosenEntry, filter));
  const farEndName = $derived(farEndFieldName(pickerKinds));

  /** Narrowed by what has been typed. An empty query offers everything the pane offers. */
  const matchingTypes = $derived.by(() => {
    const needle = typeQuery.trim().toLowerCase();
    if (needle === "") return offered;
    return offered.filter((entry) => entry.label.toLowerCase().includes(needle));
  });
  /** The matching types under their headings, family first and apart from assigned roles. */
  const typeGroups = $derived(groupedEdgeTypes(matchingTypes));
  // The combobox's own item list follows the order the groups draw in, so arrow keys walk the
  // choices in the order the reader sees them.
  const typeItems = $derived(
    typeGroups.flatMap((section) =>
      section.entries.map((entry) => ({ value: entry.edgeType, label: entry.label })),
    ),
  );

  const refusal = $derived(edgeDraftRefusal(kind, { picked, entry: chosenEntry }));
  /** Whether the reader has begun: the refusal line says nothing until they have. */
  const begun = $derived(
    picked !== null || chosenType !== null || typeQuery !== "" || role !== "" || note !== "",
  );
  const refusalLine = $derived(begun && refusal !== undefined ? refusal : NOTHING);

  function openAddRow(): void {
    writeFailure = null;
    adding = true;
  }

  function closeAddRow(): void {
    adding = false;
    picked = null;
    chosenType = null;
    typeQuery = "";
    role = "";
    note = "";
    writeFailure = null;
  }

  function pickType(chosen: string | string[]): void {
    const value = Array.isArray(chosen) ? (chosen[0] ?? "") : chosen;
    if (value === "") {
      chosenType = null;
      typeQuery = "";
      return;
    }
    chosenType = value as DirectoryEdgeType;
    typeQuery = edgeTypeLabel(value);
  }

  async function add(): Promise<void> {
    if (picked === null || chosenEntry === null || refusal !== undefined || submitting) return;
    submitting = true;
    writeFailure = null;
    const trimmedRole = role.trim();
    const trimmedNote = note.trim();
    const outcome = await createDirectoryEdge(
      fetch,
      {
        ...edgeEndsFor({ id: entityId, kind }, picked, chosenEntry),
        edgeType: chosenEntry.edgeType,
        role: trimmedRole === "" ? null : trimmedRole,
        note: trimmedNote === "" ? null : trimmedNote,
      },
      crypto.randomUUID(),
    );
    submitting = false;
    if (outcome.kind === "ok") {
      closeAddRow();
      reloadToken += 1;
      return;
    }
    writeFailure = stated(
      outcome.failure,
      "Couldn't save the relationship.",
      "Couldn't connect. The relationship wasn't saved.",
    );
  }
</script>

<section class="flex flex-col gap-16">
  <LoadingRegion
    loading={edges === null}
    {refreshing}
    failed={readFailure !== null}
    label="Reading this record's {words.heading.toLowerCase()}"
    onRetry={retry}
    class="flex flex-col gap-8"
  >
    {#snippet failure()}
      {#if readFailure !== null}
        <FailureNotice
          failure={readFailure.failure}
          title="The {words.heading} Could Not Be Read"
          fallback={readFailure.fallback}
          whenSilent={readFailure.whenSilent}
          onRetry={retry}
        />
      {/if}
    {/snippet}
    {#snippet fixture()}
      {@render edgeTable(EDGE_FIXTURE)}
    {/snippet}
    {@render edgeTable(listedEdges)}
  </LoadingRegion>

  {#if listIsReadable && heldBackEdges > 0}
    <!-- The record is one scrolling page, so a long list stops at its first few rows rather than
         pushing every section after it out of reach. -->
    <div>
      <Button variant="secondary" onclick={() => (expanded = true)}>
        Show All {shown.length}{nextCursor === null ? "" : "+"}
      </Button>
    </div>
  {:else if listIsReadable && nextCursor !== null}
    <div>
      <Button variant="secondary" disabled={loadingMore} onclick={loadMore}>
        {loadingMore ? "Reading" : "Show more"}
      </Button>
    </div>
  {/if}

  {#if listIsReadable}
    {#if adding}
      <!--
        Inline, beneath the list, so what is already connected stays in view while the next
        connection is chosen. Who first, because the relationship is a fact about that link, and
        the field for who narrows to the kind the relationship admits once one is chosen. A form is
        never full-width.
      -->
      <div class="flex max-w-xl flex-col gap-16">
        {#if writeFailure !== null}
          <FailureNotice
            failure={writeFailure.failure}
            title="Relationship Not Saved"
            fallback={writeFailure.fallback}
            whenSilent={writeFailure.whenSilent}
          />
        {/if}

        <FieldRow columns={2}>
          <LabelledField label={farEndName}>
            {#snippet children({ props })}
              <DirectoryEntityPicker
                {search}
                kinds={pickerKinds}
                excluded={[entityId]}
                bind:value={picked}
                label={farEndName}
                inputId={props.id}
                disabled={submitting}
              />
            {/snippet}
          </LabelledField>

          <LabelledField label={RELATIONSHIP_FIELD_NAME} id={relationshipInputId}>
            {#snippet children({ props })}
              <Combobox.Root
                type="single"
                items={typeItems}
                value={(chosenType ?? "") as never}
                inputValue={typeQuery}
                onValueChange={pickType}
                onOpenChange={(open) => {
                  // Closing settles the text on the truth: the chosen type, or empty when none is.
                  if (!open) typeQuery = chosenType === null ? "" : edgeTypeLabel(chosenType);
                }}
                disabled={submitting}
              >
                <Combobox.Input
                  id={props.id}
                  fieldName={RELATIONSHIP_FIELD_NAME}
                  oninput={(event) => (typeQuery = event.currentTarget.value)}
                />
                <Combobox.Content>
                  {#each typeGroups as section (section.group)}
                    <Combobox.Group>
                      <Combobox.GroupHeading>{section.heading}</Combobox.GroupHeading>
                      {#each section.entries as entry (entry.edgeType)}
                        <Combobox.Item value={entry.edgeType} label={entry.label} />
                      {/each}
                    </Combobox.Group>
                  {/each}
                </Combobox.Content>
              </Combobox.Root>
            {/snippet}
          </LabelledField>
        </FieldRow>

        <FieldRow columns={2}>
          <LabelledField label={ROLE_FIELD_NAME}>
            {#snippet children({ props })}
              <Input {...props} bind:value={role} disabled={submitting} />
            {/snippet}
          </LabelledField>
          <LabelledField label={NOTE_FIELD_NAME}>
            {#snippet children({ props })}
              <Input {...props} bind:value={note} disabled={submitting} />
            {/snippet}
          </LabelledField>
        </FieldRow>

        <!--
          One visible line for why Add is refused, once somebody has begun, so the row never opens on
          an instruction. It stays mounted with inert filler otherwise, so nothing under it moves.
        -->
        <p class="text-xs text-text-muted" aria-live="polite">{refusalLine}</p>

        <div class="flex justify-end gap-8">
          <Button variant="secondary" disabled={submitting} onclick={closeAddRow}>Cancel</Button>
          <Button
            variant="primary"
            disabled={refusal !== undefined || submitting}
            title={refusal}
            aria-label={refusal === undefined ? undefined : `Add: ${refusal}`}
            onclick={add}
          >
            {submitting ? "Adding" : "Add"}
          </Button>
        </div>
      </div>
    {:else}
      <div class="flex flex-col gap-4">
        <div>
          <Button
            variant="secondary"
            disabled={!mayEdit}
            title={mayEdit ? undefined : editDisabledReason}
            aria-label={mayEdit || editDisabledReason === undefined
              ? undefined
              : `Add: ${editDisabledReason}`}
            onclick={openAddRow}
          >
            <Link class="size-16" aria-hidden="true" />
            Add…
          </Button>
        </div>
        <p class="text-xs text-text-muted">
          {mayEdit || editDisabledReason === undefined ? NOTHING : editDisabledReason}
        </p>
      </div>
    {/if}
  {/if}
</section>

<!-- One table for the rows, for the shape they take while they are read, and for the empty body
     they leave behind when there are none, so the three cannot drift. -->
{#snippet edgeTable(rows: readonly DirectoryEdgeEntry[])}
  <DataTable.Root>
    <DataTable.Caption class="sr-only">{words.caption}</DataTable.Caption>
    <DataTable.Header>
      <DataTable.Row>
        <DataTable.Head>Relationship</DataTable.Head>
        <DataTable.Head>Note</DataTable.Head>
        <DataTable.Head>In force</DataTable.Head>
      </DataTable.Row>
    </DataTable.Header>
    <DataTable.Body>
      {#each rows as edge (edge.id)}
        {@const sentence = sentenceOf(edge)}
        <DataTable.Row>
          <DataTable.Cell>
            <span class="flex flex-col gap-4">
              <span class="flex flex-wrap items-center gap-4">
                {#if sentence.before !== ""}
                  <span>{sentence.before}</span>
                {/if}
                <EntityIdentity
                  kind={farKindOf(edge)}
                  name={sentence.far}
                  href={onOpenEntity === undefined ? entityRecordHref(edge.farEntityId) : undefined}
                  onOpen={onOpenEntity === undefined
                    ? undefined
                    : () => onOpenEntity(edge.farEntityId)}
                />
                {#if sentence.after !== ""}
                  <span>{sentence.after}</span>
                {/if}
              </span>
              {#if entryOf(edge.edgeType) === null || (edge.role !== null && edge.role !== "")}
                <span class="flex flex-wrap items-center gap-4">
                  {#if entryOf(edge.edgeType) === null}
                    <Badge variant="neutral">{edgeTypeLabel(edge.edgeType)}</Badge>
                  {/if}
                  {#if edge.role !== null && edge.role !== ""}
                    <Badge variant="neutral">{edge.role}</Badge>
                  {/if}
                </span>
              {/if}
            </span>
          </DataTable.Cell>
          <DataTable.Cell>
            <span class="text-text-muted">{edge.note ?? "—"}</span>
          </DataTable.Cell>
          <DataTable.Cell>
            <span class="text-text-muted">{period(edge)}</span>
          </DataTable.Cell>
        </DataTable.Row>
      {:else}
        <DataTable.EmptyRow columns={3} title={words.emptyTitle} />
      {/each}
    </DataTable.Body>
  </DataTable.Root>
{/snippet}
