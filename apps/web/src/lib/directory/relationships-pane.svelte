<script lang="ts">
  /*
   * How this record connects to the rest of the firm's book.
   *
   * These edges are what makes an imputed conflict EXPLICABLE. A hit on a company is only a hit on
   * its director because an edge says so, and the edge is the sentence a conflicts report can print
   * back to a reviewer who has to decide whether the firm may act. A relationship nobody can read is
   * a report nobody can check.
   *
   * DIRECTION IS NOT DECORATION. "Is the parent of" and "is a subsidiary of" are one stored row read
   * from opposite ends, so each row says which end this record is on and reads the relationship
   * accordingly. Flattening the two would put a subsidiary in charge of its parent.
   *
   * The far end is named by the same read every list here uses — one request for the page, never one
   * per row — and a far end the directory holds no name for renders as its gap, never as a handle.
   */
  import * as Alert from "@magna-carta/design-system/alert";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import * as DataTable from "@magna-carta/design-system/data-table";
  import Badge from "@magna-carta/design-system/badge";
  import Button from "@magna-carta/design-system/button";
  import EmptyState from "@magna-carta/design-system/empty-state";
  import Skeleton from "@magna-carta/design-system/skeleton";
  import { readDirectoryEdges, type DirectoryEdgeEntry } from "./directory-api.ts";
  import { edgeTypeLabel } from "./directory-vocabulary.ts";
  import EntityIdentity from "@magna-carta/design-system/entity-identity";
  import { entityRecordHref } from "./entity-presentation.ts";

  let { entityId }: { entityId: string } = $props();

  let edges = $state<readonly DirectoryEdgeEntry[] | null>(null);
  let nextCursor = $state<string | null>(null);
  let failure = $state<StatedFailure | null>(null);
  let loadingMore = $state(false);

  $effect(() => {
    const id = entityId;
    let cancelled = false;
    edges = null;
    nextCursor = null;
    failure = null;
    void (async () => {
      const outcome = await readDirectoryEdges(fetch, id);
      if (cancelled) return;
      if (outcome.kind === "ok") {
        edges = outcome.value.data;
        nextCursor = outcome.value.nextCursor;
        return;
      }
      edges = [];
      failure = stated(outcome.failure, "This record's relationships could not be read.");
    })();
    return () => {
      cancelled = true;
    };
  });

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

  /** How the relationship reads from THIS record's end. */
  function reading(edge: DirectoryEdgeEntry): string {
    const label = edgeTypeLabel(edge.edgeType);
    return edge.direction === "outbound" ? label : `${label} (from the other end)`;
  }

  function period(edge: DirectoryEdgeEntry): string {
    const from = edge.validFrom?.slice(0, 10) ?? null;
    const to = edge.validTo?.slice(0, 10) ?? null;
    if (from === null && to === null) return "—";
    if (to === null) return `From ${from ?? "—"}`;
    return `${from ?? "—"} to ${to}`;
  }
</script>

<section class="flex flex-col gap-16">
  <h3 class="text-sm font-semibold">Relationships</h3>

  {#if failure !== null}
    <FailureNotice
      failure={failure.failure}
      title="The Relationships Could Not Be Read"
      fallback={failure.fallback}
      whenSilent={failure.whenSilent}
    />
  {:else if edges === null}
    <div class="flex flex-col gap-8" aria-busy="true" aria-label="Reading this record's relationships">
      <Skeleton class="h-32 w-full" />
      <Skeleton class="h-32 w-full" />
    </div>
  {:else if edges.length === 0}
    <EmptyState title="Nothing Connected To This Record">
      No relationship has been recorded between this record and any other in the firm's book.
    </EmptyState>
  {:else}
    <DataTable.Root>
      <DataTable.Caption class="sr-only">
        How this record connects to others in the firm's book
      </DataTable.Caption>
      <DataTable.Header>
        <DataTable.Row>
          <DataTable.Head>Relationship</DataTable.Head>
          <DataTable.Head>Other record</DataTable.Head>
          <DataTable.Head>In force</DataTable.Head>
        </DataTable.Row>
      </DataTable.Header>
      <DataTable.Body>
        {#each edges as edge (edge.id)}
          <DataTable.Row>
            <DataTable.Cell>
              <span class="flex flex-col gap-4">
                <span>{reading(edge)}</span>
                {#if edge.role !== null && edge.role !== ""}
                  <Badge variant="neutral">{edge.role}</Badge>
                {/if}
              </span>
            </DataTable.Cell>
            <DataTable.Cell>
              {#if edge.farEntityKind === "unknown" || edge.farDisplayName === null}
                <span class="text-text-muted">—</span>
              {:else}
                <EntityIdentity
                  kind={edge.farEntityKind}
                  name={edge.farDisplayName}
                  href={entityRecordHref(edge.farEntityId)}
                />
              {/if}
            </DataTable.Cell>
            <DataTable.Cell>
              <span class="text-text-muted">{period(edge)}</span>
            </DataTable.Cell>
          </DataTable.Row>
        {/each}
      </DataTable.Body>
    </DataTable.Root>

    {#if nextCursor !== null}
      <div>
        <Button variant="secondary" disabled={loadingMore} onclick={loadMore}>
          {loadingMore ? "Reading" : "Show more"}
        </Button>
      </div>
    {/if}
  {/if}
</section>
