<script lang="ts">
  /*
   * Loading states — the one loading region, over every shape a screen takes, on one scrollable
   * surface.
   *
   * THIS IS THE REVIEW SURFACE FOR THE LOADING SYSTEM. A loading state cannot be held still on a
   * real screen long enough to look at, so this page renders LoadingRegion over the same fixtures
   * the product's surfaces use — a record's labelled fields, a table of rows, a grid of cards —
   * each beside its settled state, so a reviewer sees exactly what a member gets: the frame and
   * the labels real, the values and controls as bones. The placeholder is the component; there is
   * no drawing here to drift.
   *
   * Dev builds only, like the developer console itself — behind the import.meta.env.DEV gate.
   */
  import Badge from "@magna-carta/design-system/badge";
  import Button from "@magna-carta/design-system/button";
  import * as Card from "@magna-carta/design-system/card";
  import * as DataTable from "@magna-carta/design-system/data-table";
  import FieldLabel from "@magna-carta/design-system/field-label";
  import Input from "@magna-carta/design-system/input";
  import LabelledField from "@magna-carta/design-system/labelled-field";
  import LoadingRegion from "@magna-carta/design-system/loading-region";
  import Switch from "@magna-carta/design-system/switch";
  import ScreenHeader from "$lib/screen/screen-header.svelte";
  import { DEVELOPER_CONSOLE_BACK } from "$lib/screen/screen-header.ts";
  import { applyStaticSkeletons, readStaticSkeletons } from "$lib/developer/static-skeletons.ts";

  let loading = $state(true);
  let staticPlaceholders = $state(readStaticSkeletons());

  interface Row {
    id: string;
    matter: string;
    client: string;
    opened: string;
    status: "Open" | "Closed";
  }

  // Sample words of the right length; a fixture is inert and hidden from assistive technology.
  const FIXTURE_ROWS: Row[] = [
    {
      id: "a",
      matter: "Whitmore v. Cascade Ridge Homeowners Association",
      client: "Eleanor Whitmore",
      opened: "Mar 4, 2026",
      status: "Open",
    },
    {
      id: "b",
      matter: "Estate of Harold Pemberton",
      client: "Judith Pemberton",
      opened: "Jan 22, 2026",
      status: "Open",
    },
    {
      id: "c",
      matter: "Okafor lease renewal",
      client: "M. Okafor Holdings",
      opened: "Nov 9, 2025",
      status: "Closed",
    },
  ];
  const SETTLED_ROWS: Row[] = [
    {
      id: "1",
      matter: "Delgado adoption",
      client: "Rosa Delgado",
      opened: "Aug 30, 2026",
      status: "Open",
    },
    {
      id: "2",
      matter: "Ross v. Delacroix Holdings",
      client: "Naomi Ross",
      opened: "Jul 12, 2026",
      status: "Open",
    },
  ];

  const record = {
    matterNumber: "2026-00417",
    responsible: "M. Okafor",
    hearing: "Oct 14, 2026",
    trust: "$4,250.00",
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
          <p class="text-sm">
            Declaratory relief on the amended covenants and the special assessment levied on the lot.
          </p>
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

{#if import.meta.env.DEV}
  <div class="flex min-h-screen flex-col gap-32 bg-surface-default p-24 text-text-default">
    <header class="flex flex-col gap-4">
      <ScreenHeader title="Loading states" back={DEVELOPER_CONSOLE_BACK} />
      <p class="max-w-prose text-sm text-text-muted">
        The one loading region over every shape a screen takes, each beside its settled state. The
        placeholder is the component rendered over sample words: the frame, the column heads and the
        labels stay real, and the values and controls become bones.
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

    <section class="flex flex-col gap-16">
      <div class="flex flex-col gap-4">
        <h2 class="text-lg font-semibold">A record's fields — no fixture</h2>
        <p class="max-w-prose text-xs text-text-muted">
          The labelled fields render before their values exist, so the children are the shape: the
          labels stay, each control is one bone.
        </p>
      </div>
      <div class="grid gap-16 lg:grid-cols-2">
        <div class="rounded-md border border-border-default p-16">
          <p class="pb-8 text-xs text-text-muted">Loading</p>
          <LoadingRegion {loading} label="Reading this matter">
            {@render fields(loading ? null : record)}
          </LoadingRegion>
        </div>
        <div class="rounded-md border border-border-default p-16">
          <p class="pb-8 text-xs text-text-muted">Settled</p>
          {@render fields(record)}
        </div>
      </div>
    </section>

    <section class="flex flex-col gap-16">
      <div class="flex flex-col gap-4">
        <h2 class="text-lg font-semibold">A table of rows — a fixture</h2>
        <p class="max-w-prose text-xs text-text-muted">
          The rows cannot render on null data, so the fixture is three rows in the same table over
          sample words. The column heads are furniture and stay real.
        </p>
      </div>
      <div class="grid gap-16 lg:grid-cols-2">
        <div class="rounded-md border border-border-default p-16">
          <p class="pb-8 text-xs text-text-muted">Loading</p>
          <LoadingRegion {loading} label="Reading the matters on this record">
            {#snippet fixture()}
              {@render table(FIXTURE_ROWS)}
            {/snippet}
            {@render table(SETTLED_ROWS)}
          </LoadingRegion>
        </div>
        <div class="rounded-md border border-border-default p-16">
          <p class="pb-8 text-xs text-text-muted">Settled</p>
          {@render table(SETTLED_ROWS)}
        </div>
      </div>
    </section>

    <section class="flex flex-col gap-16">
      <div class="flex flex-col gap-4">
        <h2 class="text-lg font-semibold">A grid of cards — a fixture</h2>
        <p class="max-w-prose text-xs text-text-muted">
          Cards keep their edge; the title, the description, the paragraph, the control and the
          badge become bones. A wrapped paragraph keeps to the width of its words.
        </p>
      </div>
      <div class="grid gap-16 lg:grid-cols-2">
        <div class="rounded-md border border-border-default p-16">
          <p class="pb-8 text-xs text-text-muted">Loading</p>
          <LoadingRegion {loading} label="Reading the matters on this record">
            {#snippet fixture()}
              {@render cards(FIXTURE_ROWS.slice(0, 2))}
            {/snippet}
            {@render cards(SETTLED_ROWS)}
          </LoadingRegion>
        </div>
        <div class="rounded-md border border-border-default p-16">
          <p class="pb-8 text-xs text-text-muted">Settled</p>
          {@render cards(SETTLED_ROWS)}
        </div>
      </div>
    </section>
  </div>
{/if}
