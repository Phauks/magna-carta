<script lang="ts">
  /*
   * The records the firm may already hold for this same person or organization.
   *
   * Identity in a directory is fuzzy on purpose. The same human arrives spelled three ways across a
   * decade of files, changes their name, is entered once by a receptionist and once by an attorney,
   * and is recorded a fourth time as a beneficiary on somebody else's matter. So the firm blocks on
   * three channels at once — how the name SOUNDS, how it is SPELLED, and exact equality on a sealed
   * identifier that nothing had to decrypt to compare — and this pane shows what came back.
   *
   * IT IS RECALL, NOT A VERDICT. The count beside a candidate says how many channels agreed, which
   * is a reason to look, never a finding that two records are the same person. Two people do share
   * a name. The person deciding is the one who knows, which is why the only act offered here opens
   * a window that shows what folding them together would do before it does it.
   *
   * THE CANDIDATES ARRIVE NAMED. The answer carries each candidate's display identity, resolved
   * server-side in one naming read over the whole list, so this pane makes no request per row. The
   * full record is read for exactly one candidate — the one somebody chooses to review — because a
   * merge window has to show both sides field by field and a name is not enough for that.
   */
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import * as DataTable from "@magna-carta/design-system/data-table";
  import Badge from "@magna-carta/design-system/badge";
  import Button from "@magna-carta/design-system/button";
  import LoadingRegion from "@magna-carta/design-system/loading-region";
  import { samplePerson } from "@magna-carta/design-system/loading-fixtures";
  import RotateCcw from "@lucide/svelte/icons/rotate-ccw";
  import {
    findDuplicateCandidates,
    readDirectoryEntity,
    type DirectoryEntityDetail,
    type DuplicateCandidate,
  } from "./directory-api.ts";
  import { entityDetailIdentifier, entityRecordHref } from "./entity-presentation.ts";
  import EntityIdentity from "@magna-carta/design-system/entity-identity";
  import MergeDialog from "./merge-dialog.svelte";

  let {
    entity,
    mayEdit,
    editDisabledReason,
    onMerged,
    onOpenEntity,
  }: {
    entity: DirectoryEntityDetail;
    mayEdit: boolean;
    editDisabledReason?: string;
    onMerged: () => void;
    /**
     * Open a candidate's record some way other than by its address — inside the window this pane
     * already stands in, which swaps its subject rather than stacking a second window. Without it a
     * candidate's name is the link to its address.
     */
    onOpenEntity?: (entityId: string) => void;
  } = $props();

  let candidates = $state<readonly DuplicateCandidate[] | null>(null);
  let readFailure = $state<StatedFailure | null>(null);
  /** The candidate somebody chose to review could not be opened. Said above the list, which stays. */
  let openFailure = $state<StatedFailure | null>(null);
  let reviewing = $state<DirectoryEntityDetail | null>(null);
  let opening = $state<string | null>(null);
  let mergeOpen = $state(false);
  let reloadToken = $state(0);
  /** True while Look again re-searches with the previous answer still in view. */
  let refreshing = $state(false);
  // The record whose near matches last landed. Only a change of RECORD discards what is on screen:
  // looking again keeps the previous answer where the reader is looking and marks the region busy.
  let shownFor: string | null = null;

  /**
   * The shape the list takes while the firm's record is searched: the same rows the real list
   * renders, over the sample vocabulary. Not anybody the firm holds.
   */
  const CANDIDATE_FIXTURE: readonly DuplicateCandidate[] = [
    {
      entityId: "fixture-1",
      signalCount: 2,
      entityKind: "person",
      displayName: samplePerson(0).name,
    },
    {
      entityId: "fixture-2",
      signalCount: 1,
      entityKind: "person",
      displayName: samplePerson(1).name,
    },
  ];

  // Reading the record a person chose to fold. The merge window shows both sides field by field, so
  // it needs the whole record and not just the name — but only for the one they picked.
  async function review(entityId: string): Promise<void> {
    if (opening !== null) return;
    opening = entityId;
    const detail = await readDirectoryEntity(fetch, entityId);
    opening = null;
    if (detail.kind !== "ok") {
      openFailure = stated(detail.failure, "Couldn't open that record.");
      return;
    }
    openFailure = null;
    reviewing = detail.value;
    mergeOpen = true;
  }

  const entityId = $derived(entityDetailIdentifier(entity));

  const askFrom = $derived(
    entity.kind === "person"
      ? {
          kind: "person" as const,
          given: entity.person.given ?? undefined,
          family: entity.person.family ?? undefined,
          excludeEntityId: entity.person.id,
        }
      : {
          kind: "organization" as const,
          legalName: entity.organization.legalName ?? undefined,
          excludeEntityId: entity.organization.id,
        },
  );

  $effect(() => {
    const request = askFrom;
    const id = request.excludeEntityId;
    void reloadToken;
    let cancelled = false;
    if (shownFor === id) {
      refreshing = true;
    } else {
      candidates = null;
    }
    readFailure = null;
    void (async () => {
      const outcome = await findDuplicateCandidates(fetch, request);
      if (cancelled) return;
      refreshing = false;
      if (outcome.kind !== "ok") {
        shownFor = null;
        candidates = [];
        readFailure = stated(
          outcome.failure,
          "Couldn't search for near matches.",
          "Near matches weren't searched.",
        );
        return;
      }
      // The candidate answer NAMES each candidate — the server resolves the whole list in one
      // naming read — so nothing here reads a record per row. The full record is read only for the
      // one candidate somebody chooses to review, because a merge window has to show both sides.
      shownFor = id;
      candidates = outcome.value.data;
    })();
    return () => {
      cancelled = true;
      refreshing = false;
    };
  });

  function lookAgain(): void {
    reloadToken += 1;
  }
</script>

<section class="flex flex-col gap-16">
  <!-- The section's heading is the record's own (record-sections.svelte); its acts stand here. -->
  <div class="flex items-center justify-end gap-16">
    <Button variant="secondary" disabled={refreshing} onclick={lookAgain}>
      <RotateCcw class="size-16" aria-hidden="true" />
      Look again
    </Button>
  </div>

  {#if openFailure !== null}
    <FailureNotice
      failure={openFailure.failure}
      title="Couldn't Open That Record"
      fallback={openFailure.fallback}
      whenSilent={openFailure.whenSilent}
    />
  {/if}

  <LoadingRegion
    loading={candidates === null}
    {refreshing}
    failed={readFailure !== null}
    label="Looking for near matches"
    onRetry={lookAgain}
    class="flex flex-col gap-8"
  >
    {#snippet failure()}
      {#if readFailure !== null}
        <FailureNotice
          failure={readFailure.failure}
          title="Couldn't Load Near Matches"
          fallback={readFailure.fallback}
          whenSilent={readFailure.whenSilent}
          onRetry={lookAgain}
        />
      {/if}
    {/snippet}
    {#snippet fixture()}
      {@render candidateTable(CANDIDATE_FIXTURE)}
    {/snippet}
    {@render candidateTable(candidates ?? [])}
  </LoadingRegion>
</section>

<!-- One table for the rows, for the shape they take while they are read, and for the empty body
     they leave behind when there are none, so the three cannot drift. -->
{#snippet candidateTable(rows: readonly DuplicateCandidate[])}
  <DataTable.Root>
    <DataTable.Caption class="sr-only">
      Records that may be the same person or organization
    </DataTable.Caption>
    <DataTable.Header>
      <DataTable.Row>
        <DataTable.Head>Record</DataTable.Head>
        <DataTable.Head>Why it surfaced</DataTable.Head>
        <DataTable.Head data-align="end">Act</DataTable.Head>
      </DataTable.Row>
    </DataTable.Header>
    <DataTable.Body>
      {#each rows as candidate (candidate.entityId)}
        <DataTable.Row>
          <DataTable.Cell>
            {#if candidate.entityKind === "unknown" || candidate.displayName === null}
              <span class="text-text-muted">—</span>
            {:else}
              <EntityIdentity
                kind={candidate.entityKind}
                name={candidate.displayName}
                href={onOpenEntity === undefined ? entityRecordHref(candidate.entityId) : undefined}
                onOpen={onOpenEntity === undefined
                  ? undefined
                  : () => onOpenEntity(candidate.entityId)}
              />
            {/if}
          </DataTable.Cell>
          <DataTable.Cell>
            <Badge
              variant="warning"
              title="Matches are found by sound, spelling, and exact identifiers."
            >
              {candidate.signalCount} of 3 channels agreed
            </Badge>
          </DataTable.Cell>
          <DataTable.Cell data-align="end">
            <Button
              variant="secondary"
              disabled={!mayEdit || opening !== null}
              title={editDisabledReason}
              onclick={() => void review(candidate.entityId)}
            >
              {opening === candidate.entityId ? "Opening" : "Review and fold"}
            </Button>
          </DataTable.Cell>
        </DataTable.Row>
      {:else}
        <DataTable.EmptyRow columns={3} title="Nothing Near This Record" />
      {/each}
    </DataTable.Body>
  </DataTable.Root>
{/snippet}

{#if reviewing !== null}
  {#key entityId + entityDetailIdentifier(reviewing)}
    <MergeDialog
      bind:open={mergeOpen}
      left={entity}
      right={reviewing}
      {mayEdit}
      {editDisabledReason}
      onMerged={() => {
        reviewing = null;
        onMerged();
      }}
    />
  {/key}
{/if}
