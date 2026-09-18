<script lang="ts">
  /*
   * Loads — how material got in, how far it got, and the two records each delivery produced.
   *
   * A LOAD IS A PROVENANCE RECORD, NOT AN UPLOAD PROGRESS BAR. It is declared BEFORE the material
   * arrives, with a count and a source, and what then arrives is reconciled against that
   * declaration. That ordering is the only reason "everything arrived" can be a finding rather than
   * a claim, and it is why the declared and the actual counts sit side by side here and neither is
   * ever used to correct the other.
   *
   * THE TWO ARTIFACTS ARE THE POINT OF THE WHOLE LANE. At completion a load writes a manifest —
   * what arrived and what it was drawn from — and an exception report naming every document that
   * could not be read with the reason for each. Those are documents a firm hands to another party.
   * They are written once and never regenerated (a re-processing writes a new processing record;
   * the manifest describes what ARRIVED, which does not change), which is why there is no
   * regenerate control here and is not going to be one.
   *
   * THE CUSTODIANS OF RECORD LIVE HERE because they are the thing a load cannot be run without:
   * every review document carries one, and it is the first thing a review is narrowed by.
   *
   * THE SEARCH IS THE SERVER'S, over every load rather than the page in hand. A rolling production
   * can put a great many deliveries in one review set, and a field that narrowed the loads already
   * fetched would answer about the first page and read as the whole provenance record — which is
   * the one thing this screen exists to be. It matches a load's source DESCRIPTION, because a
   * delivery's other columns are counts and an instant and nobody looks for one by its count.
   *
   * BOTH ACTS ARE ONE CREATE CONTROL. This screen used to carry a button per act — New Custodian of
   * Record beside New Load, one secondary and one primary — which is the shape the standing ruling
   * on list screens (docs/conventions/design-corrections.md) names outright: where a screen would
   * carry a button per variant of one action, it carries ONE primary action with a menu instead, at
   * the end of the action row where a reader already looks for it on every other screen. It reads the bare "New" and the menu names the two,
   * because a Custodian of Record is two words the label grammar cannot carry and is not a term the
   * platform gets to shorten. Each choice states its own refusal, so a member who may load but not
   * manage sees why the other is shut rather than finding it missing.
   */
  import * as DataTable from "@magna-carta/design-system/data-table";
  import Badge from "@magna-carta/design-system/badge";
  import Button from "@magna-carta/design-system/button";
  import CreateControl from "@magna-carta/design-system/create-control";
  import FieldLabel from "@magna-carta/design-system/field-label";
  import ScreenSearch from "@magna-carta/design-system/screen-search";
  import { MaturityBadge, soonDependencySentence } from "@magna-carta/design-system/maturity";
  import Download from "@lucide/svelte/icons/download";
  import Import from "@lucide/svelte/icons/import";
  import UserPlus from "@lucide/svelte/icons/user-plus";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { PagedList } from "$lib/matters/paged-list.svelte.ts";
  import { readSession, type SessionBootstrap } from "$lib/matters/matters-api.ts";
  import { permissionRefusal } from "$lib/access/refusal.ts";
  import DeclareLoadDialog from "$lib/discovery/declare-load-dialog.svelte";
  import NewRecordCustodianDialog from "$lib/discovery/new-record-custodian-dialog.svelte";
  import AddMatterFilesDialog from "$lib/discovery/add-matter-files-dialog.svelte";
  import {
    listLoads,
    listRecordCustodians,
    LOAD_DISCOVERY_PERMISSION,
    MANAGE_REVIEW_SETS_PERMISSION,
    type DiscoveryLoad,
    type RecordCustodian,
    type ReviewSet,
  } from "$lib/discovery/discovery-api.ts";
  import {
    deliverableIsBuilt,
    deliverablesScopedTo,
  } from "$lib/discovery/deliverables.ts";
  import { loadLaneEntry, loadStateEntry } from "$lib/discovery/discovery-vocabulary.ts";

  let { data }: { data: { reviewSet: ReviewSet } } = $props();

  const reviewSet = $derived(data.reviewSet);
  const takesMaterial = $derived(reviewSet.state === "open");

  let session = $state<SessionBootstrap | null>(null);
  let custodians = $state<readonly RecordCustodian[]>([]);
  let declareOpen = $state(false);
  let custodianOpen = $state(false);
  let addFilesLoad = $state<DiscoveryLoad | null>(null);
  let addFilesOpen = $state(false);
  let bootstrappedFor = $state<string | null>(null);

  /*
   * The field's own text, and the term the listing is actually on.
   *
   * Two states rather than one because the search leaves the machine: `searchOn="pause"` hands the
   * query over once typing settles and the read runs on THAT, so the field keeps up with the keys
   * while the listing re-reads once per thought. It matches a load's source description, which is
   * the only thing about a delivery a person looks for it by.
   */
  let searchText = $state("");
  let appliedSearch = $state("");
  const searching = $derived(appliedSearch.trim() !== "");

  const list = new PagedList<DiscoveryLoad>("The loads could not be read.");
  const loads = $derived(list.items);

  function read(cursor?: string) {
    const term = appliedSearch.trim() === "" ? undefined : appliedSearch.trim();
    return listLoads(fetch, reviewSet.id, cursor, term);
  }

  // A changed review set OR a changed search is a different question, and therefore a fresh read
  // from the top rather than a filter over what is already here.
  const subject = $derived(`${reviewSet.id}|${appliedSearch.trim()}`);

  $effect(() => {
    const asked = subject;
    if (list.showing(asked)) return;
    list.reset(asked);
    void list.load(read);
  });

  $effect(() => {
    const id = reviewSet.id;
    if (bootstrappedFor === id) return;
    bootstrappedFor = id;
    void readCustodians();
    void (async () => {
      const outcome = await readSession(fetch);
      if (outcome.kind === "ok") session = outcome.value;
    })();
  });

  async function readCustodians(): Promise<void> {
    const outcome = await listRecordCustodians(fetch, reviewSet.id);
    custodians = outcome.kind === "ok" ? outcome.value.data : [];
  }

  function rereadLoads(): void {
    list.reset(subject);
    void list.load(read);
  }

  const mayLoad = $derived(session?.permissions.includes(LOAD_DISCOVERY_PERMISSION) ?? false);
  const mayManage = $derived(
    session?.permissions.includes(MANAGE_REVIEW_SETS_PERMISSION) ?? false,
  );

  const declareRefusal = $derived.by((): string | undefined => {
    if (session === null) return "Reading your session.";
    if (!mayLoad) return permissionRefusal("Declaring a load", "discovery:load");
    if (!takesMaterial) {
      return "This review set takes no more material. Everything already in it still reads.";
    }
    if (custodians.length === 0) {
      return "Every document carries a Custodian of Record. Add one first.";
    }
    return undefined;
  });

  const custodianRefusal = $derived.by((): string | undefined => {
    if (session === null) return "Reading your session.";
    if (!mayManage) {
      return permissionRefusal("Adding a Custodian of Record", "discovery:manageReviewSets");
    }
    if (!takesMaterial) return "This review set takes no more material.";
    return undefined;
  });

  /*
   * Whether a load can still be filled from the matter's own files.
   *
   * Only the two internal lanes resolve a selection with no byte moved; a received production
   * arrives through the ordinary upload gate instead, and this control says so rather than offering
   * a picker that would look at the wrong file record.
   */
  function fillRefusal(load: DiscoveryLoad): string | undefined {
    if (!mayLoad) return permissionRefusal("Adding documents", "discovery:load");
    if (load.lane !== "internal-files") {
      return load.lane === "internal-email"
        ? "Filed email enters as a family from the matter's own email record, which is not built here yet."
        : "This material arrives through the upload gate rather than from the firm's own files.";
    }
    if (load.state === "complete" || load.state === "failed" || load.state === "reversed") {
      return "This load has finished. More material means another load.";
    }
    return undefined;
  }


  const columns = $derived<DataTable.GridColumn<DiscoveryLoad>[]>([
    {
      id: "source",
      label: "Delivery",
      anchored: true,
      value: (load) => load.sourceDescription ?? loadLaneEntry(load.lane).label,
    },
    {
      id: "state",
      label: "State",
      filter: "set",
      value: (load) => loadStateEntry(load.state).label,
    },
    {
      id: "declared",
      label: "Declared",
      type: "number",
      value: (load) => load.declaredDocumentCount,
    },
    { id: "loaded", label: "Arrived", type: "number", value: (load) => load.loadedDocumentCount },
    { id: "processed", label: "Read", type: "number", value: (load) => load.processedCount },
    { id: "exceptions", label: "Not read", type: "number", value: (load) => load.exceptionCount },
    { id: "initiatedAt", label: "Started", type: "date", value: (load) => load.initiatedAt },
  ]);

  const grid = DataTable.createDataTableGrid<DiscoveryLoad>({
    columns: () => columns,
    rows: () => loads ?? [],
    rowKey: (load) => load.id,
    initialSort: { columnId: "initiatedAt", direction: "descending" },
    itemNoun: { singular: "load", plural: "loads" },
  });

  const loadDeliverables = deliverablesScopedTo("load");
  const reviewSetDeliverables = deliverablesScopedTo("review-set");
</script>

<div class="flex min-h-0 flex-1 flex-col gap-16">
  <!-- One compact action row. The search takes the inline end, where it grows toward the inline
       start and leaves the create control and the way back where they were. -->
  <div class="flex items-center gap-8">
    <CreateControl
      title="Declare a load, or name whose records these are."
      choices={[
        {
          label: "New Load",
          icon: Import,
          refusal: declareRefusal,
          onselect: () => (declareOpen = true),
        },
        {
          label: "New Custodian of Record",
          icon: UserPlus,
          refusal: custodianRefusal,
          onselect: () => (custodianOpen = true),
        },
      ]}
    />

    <ScreenSearch
      bind:value={searchText}
      label="Search the loads"
      searchOn="pause"
      fieldClass="w-2xs sm:w-xs"
      class="ms-auto"
      onsearch={(next) => {
        appliedSearch = next;
      }}
    />

    <DataTable.ClearFilters
      {grid}
      narrowing={{
        narrowed: grid.activeFilterCount > 0 || searching,
        summary: "Show every load",
        clear: () => {
          searchText = "";
          appliedSearch = "";
          grid.clearAllFilters();
        },
      }}
    />
  </div>

  {#if custodians.length > 0}
    <p class="text-text-muted text-sm">
      Custodians of Record: {custodians.map((one) => one.displayName).join(" · ")}
    </p>
  {/if}

  {#if list.failure !== null}
    <FailureNotice
      failure={list.failure}
      title="The Loads Could Not Be Read"
      fallback={list.failureMessage ?? undefined}
      onRetry={rereadLoads}
    />
  {:else}
    <DataTable.Grid
      {grid}
      class="min-h-0 flex-1"
      caption="What has been loaded into this review set"
      loading={loads === null}
    >
    </DataTable.Grid>

    <DataTable.GridFooter {grid}>
      {#snippet end()}
        <DataTable.LoadMore
          noun="loads"
          more={list.nextCursor !== null}
          loading={list.loadingMore}
          onLoad={() => void list.loadMore(read)}
        />
      {/snippet}
    </DataTable.GridFooter>
  {/if}

  {#if grid.rowsInView.length > 0}
    <!-- Each load's own records and its remaining way in, beneath the table rather than inside a
         cell: a manifest in two forms and an exception report in two forms is four controls, which
         is a panel and not a column.

         It follows the TABLE, not the read: a reader who has narrowed the list to one delivery is
         asking about that delivery, and panels for the loads they just filtered out would be the
         screen answering a question nobody asked. -->
    <section class="flex flex-col gap-16">
      <FieldLabel as="h2" class="border-b border-border-strong pb-8">Each Load</FieldLabel>
      {#each grid.rowsInView as load (load.id)}
        {@const fill = fillRefusal(load)}
        <div class="border-border flex flex-col gap-8 rounded border p-16">
          <div class="flex flex-wrap items-center gap-8">
            <span class="font-semibold">
              {load.sourceDescription ?? loadLaneEntry(load.lane).label}
            </span>
            <Badge variant={loadStateEntry(load.state).tone} title={loadStateEntry(load.state).meaning}>
              {loadStateEntry(load.state).label}
            </Badge>
            <span class="text-text-muted text-sm tabular-nums">
              {load.loadedDocumentCount.toLocaleString()} arrived against
              {load.declaredDocumentCount.toLocaleString()} declared
            </span>
            {#if !load.reconciliation.declarationMatched && load.state === "complete"}
              <!-- Reported, never corrected. A disagreement between what was claimed and what came
                   is a finding a firm may have to explain, and hiding it would be the platform
                   deciding which of the two numbers to believe. -->
              <Badge variant="warning" title="What arrived is not what was declared. Both numbers stand.">
                Declaration not matched
              </Badge>
            {/if}
          </div>

          <div class="flex flex-wrap items-center gap-8">
            <Button variant="secondary" disabled={fill !== undefined} title={fill} onclick={() => {
              addFilesLoad = load;
              addFilesOpen = true;
            }}>
              Add the matter's files
            </Button>

            {#each loadDeliverables as deliverable (deliverable.id)}
              {#if deliverableIsBuilt(deliverable)}
                {#each deliverable.formats as form (form.format)}
                  {@const ready = load.state === "complete"}
                  <Button
                    variant="ghost"
                    href={ready ? deliverable.href(load.id, form.format) : undefined}
                    disabled={!ready}
                    title={ready
                      ? deliverable.states
                      : "Written once, when every document on this load has reached a terminal state."}
                  >
                    <Download class="size-16" aria-hidden="true" />
                    {deliverable.label} · {form.label}
                  </Button>
                {/each}
              {/if}
            {/each}
          </div>
        </div>
      {/each}
    </section>
  {/if}

  <!-- What this corpus will produce and does not yet. Shown rather than omitted, so a firm can see
       that a privilege log is something this platform intends to write rather than something
       nobody thought about. -->
  <section class="flex flex-col gap-8">
    <FieldLabel as="h2" class="border-b border-border-strong pb-8">Still To Come</FieldLabel>
    <ul class="flex flex-col gap-8">
      {#each reviewSetDeliverables as deliverable (deliverable.id)}
        {#if !deliverableIsBuilt(deliverable)}
          <li class="flex flex-col gap-4">
            <div class="flex items-center gap-8">
              <span class="font-medium">{deliverable.label}</span>
              <MaturityBadge stage="soon" />
            </div>
            <p class="text-text-muted text-sm">
              {deliverable.states}
              {soonDependencySentence(deliverable.waitsOn)}
            </p>
          </li>
        {/if}
      {/each}
    </ul>
  </section>
</div>

<NewRecordCustodianDialog
  bind:open={custodianOpen}
  reviewSetId={reviewSet.id}
  onCreated={() => void readCustodians()}
/>

<DeclareLoadDialog
  bind:open={declareOpen}
  reviewSets={takesMaterial ? [reviewSet] : []}
  reviewSetId={reviewSet.id}
  recordCustodians={custodians}
  onDeclared={() => rereadLoads()}
/>

{#if addFilesLoad !== null}
  <AddMatterFilesDialog
    bind:open={addFilesOpen}
    loadId={addFilesLoad.id}
    matterId={reviewSet.matterId}
    recordCustodians={custodians}
    defaultRecordCustodianId={addFilesLoad.defaultRecordCustodianId}
    onLoaded={rereadLoads}
  />
{/if}
