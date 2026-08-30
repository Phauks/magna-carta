<script lang="ts">
  /*
   * What the firm holds for each owner, biggest holders first.
   *
   * THE OWNER COLUMN IS EMPTY, AND THE LINE BENEATH THE TABLE SAYS WHY. The report answers in
   * directory handles and resolves no names — deliberately, because a report that carried them
   * would be a list of the most sensitive things a firm holds with the names attached, and because
   * the register has no business duplicating the directory's display rules. Naming them is the
   * caller's job, and the caller cannot do it: the directory serves one entity per request, so a
   * page of owners would be a request per row, which is the read every listing in this product is
   * written to avoid. A directory read that names many entities in one request is what this column
   * waits on.
   *
   * What is NOT done in the meantime is print the handle. `directoryPerson_01J…` at a person is not
   * an answer, and a column that showed it would look like it was working.
   *
   * CAPPED, NOT PAGED, AND IT SAYS SO. The ordering key is a count the query computes rather than a
   * column any row carries, so a cursor would page by a value that does not exist. `capped` is the
   * difference between "there are no more" and "we stopped counting".
   */
  import * as Alert from "@magna-carta/design-system/alert";
  import * as DataTable from "@magna-carta/design-system/data-table";
  import EmptyState from "@magna-carta/design-system/empty-state";
  import Skeleton from "@magna-carta/design-system/skeleton";
  import { readCustodyHoldingsByOwner, type CustodyHoldingsByOwner } from "./custody-api.ts";

  /** What the owner column waits on, said once and drawn under the table. */
  const OWNER_NAMES_WAIT_ON =
    "a directory read that names many entities in one request. Until it exists, naming a page of owners would be one request per row.";

  let rows = $state<readonly CustodyHoldingsByOwner[] | null>(null);
  let capped = $state(false);
  let failure = $state<string | null>(null);
  let asked = false;

  $effect(() => {
    if (asked) return;
    asked = true;
    void (async () => {
      const outcome = await readCustodyHoldingsByOwner(fetch);
      if (outcome.kind === "ok") {
        rows = outcome.value.data;
        capped = outcome.value.capped;
        return;
      }
      rows = [];
      failure =
        outcome.kind === "transport"
          ? "Nothing answered. The firm's holdings by owner could not be read."
          : (outcome.problem.detail ?? "The firm's holdings by owner could not be read.");
    })();
  });
</script>

<div class="flex flex-col gap-16">
  {#if failure !== null}
    <Alert.Root variant="danger">
      <Alert.Title>Holdings By Owner Could Not Be Read</Alert.Title>
      <Alert.Description>{failure}</Alert.Description>
    </Alert.Root>
  {:else if rows === null}
    <div class="flex flex-col gap-8" aria-busy="true" aria-label="Reading holdings by owner">
      <Skeleton class="h-32 w-full" />
      <Skeleton class="h-32 w-full" />
      <Skeleton class="h-32 w-full" />
    </div>
  {:else if rows.length === 0}
    <EmptyState title="Nothing Held For Anybody Yet">
      A packet cannot be logged without naming at least one person or organization it is held for,
      so this report fills itself the moment the register does.
    </EmptyState>
  {:else}
    <DataTable.Root>
      <DataTable.Caption class="sr-only">What the firm holds, by owner</DataTable.Caption>
      <DataTable.Header>
        <DataTable.Row>
          <DataTable.Head>Owner</DataTable.Head>
          <DataTable.Head data-align="end">In the safe</DataTable.Head>
          <DataTable.Head data-align="end">Out</DataTable.Head>
          <DataTable.Head data-align="end">Items described</DataTable.Head>
          <DataTable.Head data-align="end">Under hold</DataTable.Head>
        </DataTable.Row>
      </DataTable.Header>
      <DataTable.Body>
        {#each rows as row (row.entityId)}
          <DataTable.Row>
            <DataTable.Cell>
              <span class="text-text-muted">—</span>
            </DataTable.Cell>
            <DataTable.Cell data-align="end">{row.packetsHeld}</DataTable.Cell>
            <DataTable.Cell data-align="end">{row.packetsOut}</DataTable.Cell>
            <DataTable.Cell data-align="end">{row.itemsDescribed}</DataTable.Cell>
            <DataTable.Cell data-align="end">{row.packetsUnderHold}</DataTable.Cell>
          </DataTable.Row>
        {/each}
      </DataTable.Body>
    </DataTable.Root>

    <p class="text-xs text-text-muted">
      The Owner column reads empty because the register answers in directory handles and this screen
      cannot name them yet. Not built yet. Waiting on {OWNER_NAMES_WAIT_ON}
    </p>

    {#if capped}
      <p class="text-xs text-text-muted">
        The firm holds property for more owners than are listed here. This is the biggest holders,
        not the whole record.
      </p>
    {/if}
  {/if}
</div>
