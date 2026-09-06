<script lang="ts">
  /*
   * Firm Usage — the firm's own consumption, assembled from its own records when the page is
   * opened: storage by class, matters by type and by location, the file versioning breakdown, the
   * Directory and member counts, and the AI meters. One GET feeds the whole page (firm-usage-api.ts);
   * everything below the masthead is a table, because every figure here is a quantity.
   *
   * One section is an honest gap rather than an omission: Compute and Activity renders disabled
   * with the one line naming what it waits on — the standing rule that an unserved capability
   * still renders, disabled, honestly.
   */
  import { onMount } from "svelte";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import RefreshCw from "@lucide/svelte/icons/refresh-cw";
  import RotateCcw from "@lucide/svelte/icons/rotate-ccw";
  import * as Alert from "@magna-carta/design-system/alert";
  import Button from "@magna-carta/design-system/button";
  import * as DataTable from "@magna-carta/design-system/data-table";
  import ScreenHeader from "$lib/screen/screen-header.svelte";
  import Skeleton from "@magna-carta/design-system/skeleton";
  import ExportMenu from "$lib/export/export-menu.svelte";
  import { MaturityBadge } from "@magna-carta/design-system/maturity";
  import FieldLabel from "@magna-carta/design-system/field-label";
  import ByLocationTable from "$lib/tools/firm-usage/by-location-table.svelte";
  import { readFirmUsage, type FirmUsageResponse } from "$lib/tools/firm-usage/firm-usage-api.ts";
  import { firmUsageExportDocument } from "$lib/tools/firm-usage/firm-usage-report.ts";
  import {
    formatByteSize,
    formatCount,
    formatShare,
    notMeteredLabel,
  } from "$lib/tools/firm-usage/firm-usage-format.ts";

  let usage = $state<FirmUsageResponse | null>(null);
  let failure = $state<StatedFailure | null>(null);
  let loading = $state(true);

  async function loadUsage(): Promise<void> {
    loading = true;
    failure = null;
    const outcome = await readFirmUsage(fetch);
    if (outcome.kind === "ok") {
      usage = outcome.value;
    } else {
      usage = null;
      failure = stated(outcome.failure, "The firm's usage could not be read.");
    }
    loading = false;
  }

  // onMount runs client-only, so a prerender never issues the read.
  onMount(() => {
    void loadUsage();
  });

  const mattersTotals = $derived(
    usage === null
      ? null
      : usage.mattersByType.reduce(
          (sum, row) => ({
            prospective: sum.prospective + row.prospective,
            open: sum.open + row.open,
            closed: sum.closed + row.closed,
            total: sum.total + row.total,
          }),
          { prospective: 0, open: 0, closed: 0, total: 0 },
        ),
  );

  /** The cells of a totals or subtotal row: a rule above, and the figure set bold. */
  const TOTALS_CELL = "border-t border-border-strong font-semibold";
</script>

<svelte:head><title>Firm Usage · Magna Carta</title></svelte:head>

<ScreenHeader
  title="Firm Usage"
  back="tools"
  class="mb-24"
>
  {#snippet actions()}
    <ExportMenu
      disabled={usage === null}
      exportDocument={() => (usage === null ? null : firmUsageExportDocument(usage, new Date()))}
    />
    <Button variant="ghost" disabled={loading} onclick={() => void loadUsage()}>
      <RefreshCw class="size-16" aria-hidden="true" />
      Refresh
    </Button>
  {/snippet}
</ScreenHeader>

{#if failure !== null}
  <FailureNotice
    failure={failure.failure}
    title="The Firm's Usage Could Not Be Read"
    fallback={failure.fallback}
    onRetry={() => void loadUsage()}
  />
{:else if usage === null}
  <!-- Skeletons at the final layout's height: each section keeps its heading, and the block below
       stands in for the table it will become, so the page does not reflow when the data lands. -->
  <div class="flex flex-col gap-24" aria-busy="true" aria-label="Reading the firm's usage">
    {#each ["Storage", "Matters by Type", "Files and Versioning", "By Location", "People and Organizations", "AI Usage", "Compute and Activity"] as sectionTitle (sectionTitle)}
      <section>
        {@render sectionHeading(sectionTitle)}
        <div class="flex flex-col gap-8">
          <Skeleton class="h-32 w-full" />
          <Skeleton class="h-32 w-full" />
          <Skeleton class="h-32 w-full" />
        </div>
      </section>
    {/each}
  </div>
{:else}
  <div class="flex flex-col gap-24">
    <section>
      {@render sectionHeading("Storage")}
      <DataTable.Root>
        <DataTable.Caption class="sr-only">Storage by class</DataTable.Caption>
        <DataTable.Header>
          <DataTable.Row>
            <DataTable.Head>Storage Class</DataTable.Head>
            <DataTable.Head data-align="end">Objects</DataTable.Head>
            <DataTable.Head data-align="end">Size</DataTable.Head>
            <DataTable.Head data-align="end">Share</DataTable.Head>
          </DataTable.Row>
        </DataTable.Header>
        <DataTable.Body>
          <DataTable.Row>
            <DataTable.Cell>Standard</DataTable.Cell>
            <DataTable.Cell data-align="end">
              {formatCount(usage.storage.byStorageClass.standard.objects)}
            </DataTable.Cell>
            <DataTable.Cell data-align="end">
              {formatByteSize(usage.storage.byStorageClass.standard.bytes)}
            </DataTable.Cell>
            <DataTable.Cell data-align="end">
              {formatShare(usage.storage.byStorageClass.standard.bytes, usage.storage.totalBytes)}
            </DataTable.Cell>
          </DataTable.Row>
          <DataTable.Row>
            <DataTable.Cell>Infrequent Access</DataTable.Cell>
            <DataTable.Cell data-align="end">
              {formatCount(usage.storage.byStorageClass.infrequent_access.objects)}
            </DataTable.Cell>
            <DataTable.Cell data-align="end">
              {formatByteSize(usage.storage.byStorageClass.infrequent_access.bytes)}
            </DataTable.Cell>
            <DataTable.Cell data-align="end">
              {formatShare(
                usage.storage.byStorageClass.infrequent_access.bytes,
                usage.storage.totalBytes,
              )}
            </DataTable.Cell>
          </DataTable.Row>
          <DataTable.Row>
            <DataTable.Cell class={TOTALS_CELL}>Total</DataTable.Cell>
            <DataTable.Cell data-align="end" class={TOTALS_CELL}>
              {formatCount(usage.storage.totalObjects)}
            </DataTable.Cell>
            <DataTable.Cell data-align="end" class={TOTALS_CELL}>
              {formatByteSize(usage.storage.totalBytes)}
            </DataTable.Cell>
            <DataTable.Cell data-align="end" class={TOTALS_CELL}>
              {formatShare(usage.storage.totalBytes, usage.storage.totalBytes)}
            </DataTable.Cell>
          </DataTable.Row>
        </DataTable.Body>
      </DataTable.Root>
    </section>

    <section>
      {@render sectionHeading("Matters by Type")}
      <DataTable.Root>
        <DataTable.Caption class="sr-only">Matters by type and status</DataTable.Caption>
        <DataTable.Header>
          <DataTable.Row>
            <DataTable.Head>Matter Type</DataTable.Head>
            <DataTable.Head data-align="end">Prospective</DataTable.Head>
            <DataTable.Head data-align="end">Open</DataTable.Head>
            <DataTable.Head data-align="end">Closed</DataTable.Head>
            <DataTable.Head data-align="end">Total</DataTable.Head>
          </DataTable.Row>
        </DataTable.Header>
        <DataTable.Body>
          {#each usage.mattersByType as row (row.matterTypeName ?? "")}
            <DataTable.Row>
              <DataTable.Cell>
                {#if row.matterTypeName === null}
                  <span class="text-text-muted">No Type Assigned</span>
                {:else}
                  {row.matterTypeName}
                {/if}
              </DataTable.Cell>
              <DataTable.Cell data-align="end">{formatCount(row.prospective)}</DataTable.Cell>
              <DataTable.Cell data-align="end">{formatCount(row.open)}</DataTable.Cell>
              <DataTable.Cell data-align="end">{formatCount(row.closed)}</DataTable.Cell>
              <DataTable.Cell data-align="end">{formatCount(row.total)}</DataTable.Cell>
            </DataTable.Row>
          {/each}
          {#if mattersTotals !== null}
            <DataTable.Row>
              <DataTable.Cell class={TOTALS_CELL}>Total</DataTable.Cell>
              <DataTable.Cell data-align="end" class={TOTALS_CELL}>
                {formatCount(mattersTotals.prospective)}
              </DataTable.Cell>
              <DataTable.Cell data-align="end" class={TOTALS_CELL}>
                {formatCount(mattersTotals.open)}
              </DataTable.Cell>
              <DataTable.Cell data-align="end" class={TOTALS_CELL}>
                {formatCount(mattersTotals.closed)}
              </DataTable.Cell>
              <DataTable.Cell data-align="end" class={TOTALS_CELL}>
                {formatCount(mattersTotals.total)}
              </DataTable.Cell>
            </DataTable.Row>
          {/if}
        </DataTable.Body>
      </DataTable.Root>
    </section>

    <section>
      {@render sectionHeading("Files and Versioning")}
      <DataTable.Root>
        <DataTable.Caption class="sr-only">Files and their versions</DataTable.Caption>
        <DataTable.Header>
          <DataTable.Row>
            <DataTable.Head>Category</DataTable.Head>
            <DataTable.Head data-align="end">Count</DataTable.Head>
            <DataTable.Head data-align="end">Size</DataTable.Head>
          </DataTable.Row>
        </DataTable.Header>
        <DataTable.Body>
          <DataTable.Row>
            <DataTable.Cell>Current Files</DataTable.Cell>
            <DataTable.Cell data-align="end">
              {formatCount(usage.files.currentFiles.count)}
            </DataTable.Cell>
            <DataTable.Cell data-align="end">
              {formatByteSize(usage.files.currentFiles.bytes)}
            </DataTable.Cell>
          </DataTable.Row>
          <DataTable.Row>
            <DataTable.Cell>Prior Versions</DataTable.Cell>
            <DataTable.Cell data-align="end">
              {formatCount(usage.files.priorVersions.count)}
            </DataTable.Cell>
            <DataTable.Cell data-align="end">
              {formatByteSize(usage.files.priorVersions.bytes)}
            </DataTable.Cell>
          </DataTable.Row>
          <!-- The subtotal row: current + prior = all, so All Versions wears the sum's rule. -->
          <DataTable.Row>
            <DataTable.Cell class={TOTALS_CELL}>All Versions</DataTable.Cell>
            <DataTable.Cell data-align="end" class={TOTALS_CELL}>
              {formatCount(usage.files.allVersions.count)}
            </DataTable.Cell>
            <DataTable.Cell data-align="end" class={TOTALS_CELL}>
              {formatByteSize(usage.files.allVersions.bytes)}
            </DataTable.Cell>
          </DataTable.Row>
          <DataTable.Row>
            <DataTable.Cell>Deleted Files</DataTable.Cell>
            <DataTable.Cell data-align="end">
              {formatCount(usage.files.deletedFiles.count)}
            </DataTable.Cell>
            <DataTable.Cell data-align="end">
              {formatByteSize(usage.files.deletedFiles.bytes)}
            </DataTable.Cell>
          </DataTable.Row>
        </DataTable.Body>
      </DataTable.Root>
    </section>

    <section>
      {@render sectionHeading("By Location")}
      <ByLocationTable byLocation={usage.byLocation} />
    </section>

    <section>
      {@render sectionHeading("People and Organizations")}
      <DataTable.Root>
        <DataTable.Caption class="sr-only">Directory and member counts</DataTable.Caption>
        <DataTable.Header>
          <DataTable.Row>
            <DataTable.Head>Record</DataTable.Head>
            <DataTable.Head data-align="end">Count</DataTable.Head>
          </DataTable.Row>
        </DataTable.Header>
        <DataTable.Body>
          <DataTable.Row>
            <DataTable.Cell>People</DataTable.Cell>
            <DataTable.Cell data-align="end">{formatCount(usage.directory.people)}</DataTable.Cell>
          </DataTable.Row>
          <DataTable.Row>
            <DataTable.Cell>Organizations</DataTable.Cell>
            <DataTable.Cell data-align="end">
              {formatCount(usage.directory.organizations)}
            </DataTable.Cell>
          </DataTable.Row>
          <DataTable.Row>
            <DataTable.Cell>Firm Members</DataTable.Cell>
            <DataTable.Cell data-align="end">
              {formatCount(usage.directory.activeMembers)}
            </DataTable.Cell>
          </DataTable.Row>
        </DataTable.Body>
      </DataTable.Root>
    </section>

    <section>
      {@render sectionHeading("AI Usage")}
      <DataTable.Root>
        <DataTable.Caption class="sr-only">The AI meters, all time</DataTable.Caption>
        <DataTable.Header>
          <DataTable.Row>
            <DataTable.Head>Meter</DataTable.Head>
            <DataTable.Head data-align="end">All Time</DataTable.Head>
          </DataTable.Row>
        </DataTable.Header>
        <DataTable.Body>
          <DataTable.Row>
            <DataTable.Cell>Magnus Input Tokens</DataTable.Cell>
            <DataTable.Cell data-align="end">
              {formatCount(usage.aiUsage.magnusTokens.inputTokens)}
            </DataTable.Cell>
          </DataTable.Row>
          <DataTable.Row>
            <DataTable.Cell>Magnus Output Tokens</DataTable.Cell>
            <DataTable.Cell data-align="end">
              {formatCount(usage.aiUsage.magnusTokens.outputTokens)}
            </DataTable.Cell>
          </DataTable.Row>
          <DataTable.Row>
            <DataTable.Cell>Magnus Requests</DataTable.Cell>
            <DataTable.Cell data-align="end">
              {formatCount(usage.aiUsage.magnusTokens.requests)}
            </DataTable.Cell>
          </DataTable.Row>
          <DataTable.Row>
            <DataTable.Cell>Semantic Search Queries</DataTable.Cell>
            <DataTable.Cell data-align="end">
              {formatCount(usage.aiUsage.searchQueries.semantic)}
            </DataTable.Cell>
          </DataTable.Row>
          <DataTable.Row>
            <DataTable.Cell>Full Text Search Queries</DataTable.Cell>
            <DataTable.Cell data-align="end">
              {formatCount(usage.aiUsage.searchQueries.fullText)}
            </DataTable.Cell>
          </DataTable.Row>
          <DataTable.Row>
            <DataTable.Cell>AI Detection Documents</DataTable.Cell>
            <DataTable.Cell data-align="end">
              {formatCount(usage.aiUsage.detection.requests)}
            </DataTable.Cell>
          </DataTable.Row>
          <DataTable.Row>
            <DataTable.Cell>AI Detection Words</DataTable.Cell>
            <DataTable.Cell data-align="end">
              {formatCount(usage.aiUsage.detection.words)}
            </DataTable.Cell>
          </DataTable.Row>
          {#each usage.aiUsage.notMetered as meter (meter)}
            <DataTable.Row>
              <DataTable.Cell>{notMeteredLabel(meter)}</DataTable.Cell>
              <DataTable.Cell data-align="end">
                <span class="text-text-muted">Not yet measured</span>
              </DataTable.Cell>
            </DataTable.Row>
          {/each}
        </DataTable.Body>
      </DataTable.Root>
    </section>

    <section>
      <FieldLabel as="h2" class="mb-4 flex items-center gap-8 border-b border-border-strong pb-8"
      >
        <span>Compute and Activity</span>
        <MaturityBadge stage="soon" />
      </FieldLabel>
      <p class="mb-16 text-xs text-text-muted">
        Waits on the Cloudflare Analytics API credential.
      </p>
      <DataTable.Root aria-disabled="true">
        <DataTable.Caption class="sr-only">Compute and activity, last 30 days</DataTable.Caption>
        <DataTable.Header>
          <DataTable.Row>
            <DataTable.Head>Measure</DataTable.Head>
            <DataTable.Head data-align="end">Last 30 Days</DataTable.Head>
          </DataTable.Row>
        </DataTable.Header>
        <DataTable.Body>
          {#each ["API Requests", "Workers CPU Time", "Data Egress"] as measure (measure)}
            <DataTable.Row>
              <DataTable.Cell>{measure}</DataTable.Cell>
              <DataTable.Cell data-align="end">
                <span class="text-text-muted">Not yet measured</span>
              </DataTable.Cell>
            </DataTable.Row>
          {/each}
        </DataTable.Body>
      </DataTable.Root>
    </section>
  </div>
{/if}

{#snippet sectionHeading(title: string)}
  <FieldLabel as="h2" class="mb-16 border-b border-border-strong pb-8"
  >
    {title}
  </FieldLabel>
{/snippet}
