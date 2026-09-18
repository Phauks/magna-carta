<script lang="ts">
  /*
   * Loading states — the one loading region, over every shape a screen takes and in every state a
   * read can be in, on one scrollable surface.
   *
   * THIS IS THE REVIEW SURFACE FOR THE LOADING SYSTEM. A loading state cannot be held still on a
   * real screen long enough to look at, so this page renders LoadingRegion over the same sample
   * vocabulary the product's fixtures draw from — a record's labelled fields, a table of rows, a
   * grid of cards — each beside its settled state, so a reviewer sees exactly what a member gets:
   * the frame and the labels real, the values and controls as bones. Below the shapes, the state
   * set: failed first, empty, refreshing, and a read that has stalled (its threshold shortened
   * here through the component's one test seam, so the stall shows in a second and a half rather
   * than fifteen seconds). The placeholder is the component; there is no drawing here to drift.
   *
   * Dev builds only, like the developer console itself — behind the import.meta.env.DEV gate.
   */
  import Badge from "@magna-carta/design-system/badge";
  import Button from "@magna-carta/design-system/button";
  import * as Card from "@magna-carta/design-system/card";
  import * as DataTable from "@magna-carta/design-system/data-table";
  import EmptyState from "@magna-carta/design-system/empty-state";
  import FieldLabel from "@magna-carta/design-system/field-label";
  import Input from "@magna-carta/design-system/input";
  import LabelledField from "@magna-carta/design-system/labelled-field";
  import LoadingRegion from "@magna-carta/design-system/loading-region";
  import {
    SAMPLE_SENTENCE,
    sampleAmount,
    sampleDate,
    sampleIndices,
    sampleMatter,
  } from "@magna-carta/design-system/loading-fixtures";
  import Switch from "@magna-carta/design-system/switch";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import type { Failure } from "$lib/api/problem.ts";
  import ScreenHeader from "$lib/screen/screen-header.svelte";
  import { DEVELOPER_CONSOLE_BACK } from "$lib/screen/screen-header.ts";
  import { applyStaticSkeletons, readStaticSkeletons } from "$lib/developer/static-skeletons.ts";

  let loading = $state(true);
  let staticPlaceholders = $state(readStaticSkeletons());
  let refreshing = $state(true);

  interface Row {
    id: string;
    matter: string;
    client: string;
    opened: string;
    status: "Open" | "Closed";
  }

  // The shape while loading: the sample vocabulary, by index, so the page reads the same every visit.
  const FIXTURE_ROWS: Row[] = sampleIndices(3).map((index) => ({
    id: `sample-${index}`,
    matter: sampleMatter(index).title,
    client: sampleMatter(index).client,
    opened: sampleDate(index),
    status: index === 2 ? "Closed" : "Open",
  }));
  const SETTLED_ROWS: Row[] = [
    { id: "1", matter: "Delgado adoption", client: "Rosa Delgado", opened: "Aug 30, 2026", status: "Open" },
    {
      id: "2",
      matter: "Ross v. Delacroix Holdings",
      client: "Naomi Ross",
      opened: "Jul 12, 2026",
      status: "Open",
    },
  ];

  const record = {
    matterNumber: sampleMatter(0).number,
    responsible: sampleMatter(0).responsible,
    hearing: sampleDate(3),
    trust: sampleAmount(0),
  };

  // A fixed moment and a fixed problem, so the failed state reads the same on every visit.
  const FAILED_READ: Failure = {
    request: "GET /directory/ent_8QK2/matters",
    failedAt: new Date("2026-09-05T21:07:44.318Z"),
    problem: {
      status: 503,
      type: "https://api.magnacarta.esq/problems/upstream-unavailable",
      title: "The directory is unavailable",
      detail: "The matters could not be read just now.",
      errorId: "error_7FQ2K9XW",
    },
  };
</script>

<svelte:head>
  <title>Loading states · Magna Carta</title>
</svelte:head>

{#snippet table(rows: Row[])}
  <DataTable.Root>
    <DataTable.Caption class="sr-only">Matters on this record</DataTable.Caption>
    <DataTable.Header>
      <DataTable.Row>
        <DataTable.Head>Matter</DataTable.Head>
        <DataTable.Head>Client</DataTable.Head>
        <DataTable.Head>Opened</DataTable.Head>
        <DataTable.Head>Status</DataTable.Head>
      </DataTable.Row>
    </DataTable.Header>
    <DataTable.Body>
      {#each rows as row (row.id)}
        <DataTable.Row>
          <DataTable.Cell>{row.matter}</DataTable.Cell>
          <DataTable.Cell><span class="text-text-muted">{row.client}</span></DataTable.Cell>
          <DataTable.Cell>{row.opened}</DataTable.Cell>
          <DataTable.Cell><Badge variant="neutral">{row.status}</Badge></DataTable.Cell>
        </DataTable.Row>
      {/each}
    </DataTable.Body>
  </DataTable.Root>
{/snippet}

{#snippet cards(rows: Row[])}
  <div class="grid gap-12 sm:grid-cols-2">
    {#each rows as row (row.id)}
      <Card.Root>
        <Card.Header>
          <Card.Title>{row.matter}</Card.Title>
          <Card.Description>{row.client}, opened {row.opened}</Card.Description>
        </Card.Header>
        <Card.Content>
          <p class="text-sm">{SAMPLE_SENTENCE}</p>
        </Card.Content>
        <Card.Footer class="flex items-center gap-8">
          <Button variant="secondary">Open</Button>
          <Badge variant="neutral">{row.status}</Badge>
        </Card.Footer>
      </Card.Root>
    {/each}
  </div>
{/snippet}

{#snippet fields(values: typeof record | null)}
  <div class="grid gap-12 sm:grid-cols-2">
    <LabelledField label="Matter number">
      {#snippet children({ props })}
        <Input {...props} value={values?.matterNumber ?? ""} readonly />
      {/snippet}
    </LabelledField>
    <LabelledField label="Responsible attorney">
      {#snippet children({ props })}
        <Input {...props} value={values?.responsible ?? ""} readonly />
      {/snippet}
    </LabelledField>
    <LabelledField label="Next hearing">
      {#snippet children({ props })}
        <Input {...props} value={values?.hearing ?? ""} readonly />
      {/snippet}
    </LabelledField>
    <LabelledField label="Trust balance">
      {#snippet children({ props })}
        <Input {...props} value={values?.trust ?? ""} readonly />
      {/snippet}
    </LabelledField>
  </div>
{/snippet}

{#snippet pair(title: string, note: string, left: import("svelte").Snippet, right: import("svelte").Snippet)}
  <section class="flex flex-col gap-16">
    <div class="flex flex-col gap-4">
      <h2 class="text-lg font-semibold">{title}</h2>
      <p class="max-w-prose text-xs text-text-muted">{note}</p>
    </div>
    <div class="grid gap-16 lg:grid-cols-2">
      <div class="rounded-md border border-border-default p-16">
        <p class="pb-8 text-xs text-text-muted">Loading</p>
        {@render left()}
      </div>
      <div class="rounded-md border border-border-default p-16">
        <p class="pb-8 text-xs text-text-muted">Settled</p>
        {@render right()}
      </div>
    </div>
  </section>
{/snippet}

{#snippet fieldsLoading()}
  <LoadingRegion {loading} label="Reading this matter">
    {@render fields(loading ? null : record)}
  </LoadingRegion>
{/snippet}
{#snippet fieldsSettled()}
  {@render fields(record)}
{/snippet}
{#snippet tableLoading()}
  <LoadingRegion {loading} label="Reading the matters on this record">
    {#snippet fixture()}
      {@render table(FIXTURE_ROWS)}
    {/snippet}
    {@render table(SETTLED_ROWS)}
  </LoadingRegion>
{/snippet}
{#snippet tableSettled()}
  {@render table(SETTLED_ROWS)}
{/snippet}
{#snippet cardsLoading()}
  <LoadingRegion {loading} label="Reading the matters on this record">
    {#snippet fixture()}
      {@render cards(FIXTURE_ROWS.slice(0, 2))}
    {/snippet}
    {@render cards(SETTLED_ROWS)}
  </LoadingRegion>
{/snippet}
{#snippet cardsSettled()}
  {@render cards(SETTLED_ROWS)}
{/snippet}

{#if import.meta.env.DEV}
  <div class="flex min-h-screen flex-col gap-32 bg-surface-default p-24 text-text-default">
    <header class="flex flex-col gap-4">
      <ScreenHeader title="Loading states" favoritable={false} back={DEVELOPER_CONSOLE_BACK} />
      <p class="max-w-prose text-sm text-text-muted">
        The one loading region over every shape a screen takes, each beside its settled state, and
        then every state a read can be in. The placeholder is the component rendered over the sample
        vocabulary: the frame, the column heads and the labels stay real, and the values and
        controls become bones.
      </p>
      <div class="flex flex-wrap items-center gap-24 pt-8">
        <div class="flex items-center gap-8">
          <Switch bind:checked={loading} aria-label="Loading" />
          <FieldLabel as="span">Loading</FieldLabel>
        </div>
        <div class="flex items-center gap-8">
          <Switch
            bind:checked={staticPlaceholders}
            onCheckedChange={(on) => applyStaticSkeletons(on)}
            aria-label="Static placeholders"
          />
          <FieldLabel as="span">Static placeholders</FieldLabel>
        </div>
      </div>
    </header>

    {@render pair(
      "A record's fields — no fixture",
      "The labelled fields render before their values exist, so the children are the shape: the labels stay, each control is one bone.",
      fieldsLoading,
      fieldsSettled,
    )}
    {@render pair(
      "A table of rows — a fixture",
      "The rows cannot render on null data, so the fixture is three rows in the same table over the sample vocabulary. The column heads are furniture and stay real.",
      tableLoading,
      tableSettled,
    )}
    {@render pair(
      "A grid of cards — a fixture",
      "Cards keep their edge; the title, the description, the paragraph, the control and the badge become bones, one bar per wrapped line.",
      cardsLoading,
      cardsSettled,
    )}

    <section class="flex flex-col gap-16">
      <div class="flex flex-col gap-4">
        <h2 class="text-lg font-semibold">The state set</h2>
        <p class="max-w-prose text-xs text-text-muted">
          The same region holding a failed read (first, whatever else is true), an empty answer, a
          re-read of something already on screen, and a read that has stalled.
        </p>
      </div>
      <div class="grid gap-16 lg:grid-cols-2">
        <div class="rounded-md border border-border-default p-16">
          <p class="pb-8 text-xs text-text-muted">Failed</p>
          <LoadingRegion loading={false} failed label="Reading the matters on this record">
            {#snippet failure()}
              <FailureNotice
                failure={FAILED_READ}
                subject="The matters"
                onRetry={() => undefined}
                onReport={() => undefined}
                onStepUp={() => undefined}
                onRequestAccess={() => undefined}
              />
            {/snippet}
            {@render table(SETTLED_ROWS)}
          </LoadingRegion>
        </div>
        <div class="rounded-md border border-border-default p-16">
          <p class="pb-8 text-xs text-text-muted">Empty</p>
          <LoadingRegion loading={false} empty label="Reading the matters on this record">
            {#snippet emptyState()}
              <!-- structured-empty-allow: this is the gallery that demonstrates the loading
                   region's five postures side by side, and the empty posture is the thing being
                   shown. A table drawn in its place would demonstrate nothing. -->
              <EmptyState title="On no matter yet">
                This record has not been made a party to any matter.
              </EmptyState>
            {/snippet}
            {@render table(SETTLED_ROWS)}
          </LoadingRegion>
        </div>
        <div class="rounded-md border border-border-default p-16">
          <div class="flex items-center justify-between pb-8">
            <p class="text-xs text-text-muted">Refreshing</p>
            <div class="flex items-center gap-8">
              <Switch bind:checked={refreshing} aria-label="Refreshing" />
              <FieldLabel as="span">Refreshing</FieldLabel>
            </div>
          </div>
          <LoadingRegion loading={false} {refreshing} label="Reading the matters on this record">
            {@render table(SETTLED_ROWS)}
          </LoadingRegion>
        </div>
        <div class="rounded-md border border-border-default p-16">
          <p class="pb-8 text-xs text-text-muted">Stalled (the threshold shortened to a second and a half)</p>
          <LoadingRegion
            loading
            stalledAfter={1500}
            onRetry={() => undefined}
            label="Reading the matters on this record"
          >
            {#snippet fixture()}
              {@render table(FIXTURE_ROWS)}
            {/snippet}
            {@render table(SETTLED_ROWS)}
          </LoadingRegion>
        </div>
      </div>
    </section>
  </div>
{/if}
