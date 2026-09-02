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
  import * as Alert from "@magna-carta/design-system/alert";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import * as DataTable from "@magna-carta/design-system/data-table";
  import Badge from "@magna-carta/design-system/badge";
  import Button from "@magna-carta/design-system/button";
  import EmptyState from "@magna-carta/design-system/empty-state";
  import Skeleton from "@magna-carta/design-system/skeleton";
  import RotateCcw from "@lucide/svelte/icons/rotate-ccw";
  import {
    findDuplicateCandidates,
    readDirectoryEntity,
    type DirectoryEntityDetail,
    type DuplicateCandidate,
  } from "./directory-api.ts";
  import { entityDetailIdentifier, entityRecordHref } from "./entity-presentation.ts";
  import EntityIdentity from "./entity-identity.svelte";
  import MergeDialog from "./merge-dialog.svelte";

  let {
    entity,
    mayEdit,
    editDisabledReason,
    onMerged,
  }: {
    entity: DirectoryEntityDetail;
    mayEdit: boolean;
    editDisabledReason?: string;
    onMerged: () => void;
  } = $props();

  let candidates = $state<readonly DuplicateCandidate[] | null>(null);
  let failure = $state<StatedFailure | null>(null);
  let reviewing = $state<DirectoryEntityDetail | null>(null);
  let opening = $state<string | null>(null);
  let mergeOpen = $state(false);
  let reloadToken = $state(0);

  // Reading the record a person chose to fold. The merge window shows both sides field by field, so
  // it needs the whole record and not just the name — but only for the one they picked.
  async function review(entityId: string): Promise<void> {
    if (opening !== null) return;
    opening = entityId;
    const detail = await readDirectoryEntity(fetch, entityId);
    opening = null;
    if (detail.kind !== "ok") {
      failure = stated(detail.failure, "That record could not be opened.");
      return;
    }
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
    void reloadToken;
    let cancelled = false;
    candidates = null;
    failure = null;
    void (async () => {
      const outcome = await findDuplicateCandidates(fetch, request);
      if (cancelled) return;
      if (outcome.kind !== "ok") {
        candidates = [];
        failure = stated(
          outcome.failure,
          "The firm's record could not be searched for near matches.",
          "The firm's record was not searched for near matches.",
        );
        return;
      }
      // The candidate answer NAMES each candidate — the server resolves the whole list in one
      // naming read — so nothing here reads a record per row. The full record is read only for the
      // one candidate somebody chooses to review, because a merge window has to show both sides.
      candidates = outcome.value.data;
    })();
    return () => {
      cancelled = true;
    };
  });
</script>

<section class="flex flex-col gap-16">
  <div class="flex items-center justify-between gap-16">
    <h3 class="text-sm font-semibold">Possible duplicates</h3>
    <Button variant="secondary" onclick={() => (reloadToken += 1)}>
      <RotateCcw class="size-16" aria-hidden="true" />
      Look again
    </Button>
  </div>

  {#if failure !== null}
    <FailureNotice
      failure={failure.failure}
      title="The Near Matches Could Not Be Read"
      fallback={failure.fallback}
      whenSilent={failure.whenSilent}
    />
  {:else if candidates === null}
    <div class="flex flex-col gap-8" aria-busy="true" aria-label="Looking for near matches">
      <Skeleton class="h-32 w-full" />
      <Skeleton class="h-32 w-full" />
    </div>
  {:else if candidates.length === 0}
    <EmptyState title="Nothing Near This Record">
      No other record in the firm's book sounds like this one, is spelled like it, or shares a sealed
      identifier with it.
    </EmptyState>
  {:else}
    <DataTable.Root>
      <DataTable.Caption class="sr-only">
        Records the firm may already hold for the same entity
      </DataTable.Caption>
      <DataTable.Header>
        <DataTable.Row>
          <DataTable.Head>Record</DataTable.Head>
          <DataTable.Head>Why it surfaced</DataTable.Head>
          <DataTable.Head data-align="end">Act</DataTable.Head>
        </DataTable.Row>
      </DataTable.Header>
      <DataTable.Body>
        {#each candidates as candidate (candidate.entityId)}
          <DataTable.Row>
            <DataTable.Cell>
              {#if candidate.entityKind === "unknown" || candidate.displayName === null}
                <span class="text-text-muted">—</span>
              {:else}
                <EntityIdentity
                  kind={candidate.entityKind}
                  name={candidate.displayName}
                  href={entityRecordHref(candidate.entityId)}
                />
              {/if}
            </DataTable.Cell>
            <DataTable.Cell>
              <Badge
                variant="warning"
                title="The three channels are how the name sounds, how it is spelled, and an exact match on a sealed identifier."
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
        {/each}
      </DataTable.Body>
    </DataTable.Root>
  {/if}
</section>

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
