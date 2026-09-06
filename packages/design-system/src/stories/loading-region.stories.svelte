<script module lang="ts">
  /*
   * LoadingRegion — the one loading state (Feedback, Tier 1). ONE showcase story, on the catalog
   * rule for a component with no variant axis: `loading` is a Control, so the reviewer flips the
   * same region between its shape and its content. The template renders a real table over the
   * sample vocabulary, which is the whole point — the placeholder is the component.
   *
   * The play functions are the behaviour tests. The showcase proves the announcement and the inert
   * fixture; the hidden Behaviour story (absent from the sidebar and the Docs page) proves the rest
   * of the state set — failed first, empty, refreshing, the finished sentence, the stall — with the
   * one test seam the component admits, `stalledAfter`.
   */
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import { expect, waitFor } from "storybook/test";
  import Badge from "../lib/components/badge/index.ts";
  import Button from "../lib/components/button/index.ts";
  import * as DataTable from "../lib/components/data-table/index.ts";
  import EmptyState from "../lib/components/empty-state/index.ts";
  import LoadingRegion from "../lib/components/loading-region/loading-region.svelte";
  import { sampleDate, sampleIndices, sampleMatter } from "../lib/loading-fixtures/index.ts";

  const { Story } = defineMeta({
    title: "Feedback/LoadingRegion",
    component: LoadingRegion,
    parameters: {
      controls: { include: ["loading", "label", "refreshing", "failed", "empty"] },
    },
  });

  const REAL_ROWS = [{ id: "1", name: "Delgado adoption", opened: "Aug 30, 2026", status: "Open" }];
</script>

<script lang="ts">
  // The Behaviour story's driver: the four facts a caller supplies, flipped by its four controls.
  const behaviour = $state({ loading: true, refreshing: false, empty: false, failed: false });
</script>

{#snippet matterTable(rows: { id: string; name: string; opened: string; status: string }[])}
  <DataTable.Root>
    <DataTable.Header>
      <DataTable.Row>
        <DataTable.Head>Matter</DataTable.Head>
        <DataTable.Head>Opened</DataTable.Head>
        <DataTable.Head>Status</DataTable.Head>
      </DataTable.Row>
    </DataTable.Header>
    <DataTable.Body>
      {#each rows as row (row.id)}
        <DataTable.Row>
          <DataTable.Cell>{row.name}</DataTable.Cell>
          <DataTable.Cell>{row.opened}</DataTable.Cell>
          <DataTable.Cell><Badge variant="neutral">{row.status}</Badge></DataTable.Cell>
        </DataTable.Row>
      {/each}
    </DataTable.Body>
  </DataTable.Root>
{/snippet}

{#snippet sampleTable()}
  {@render matterTable(
    sampleIndices(3).map((index) => ({
      id: String(index),
      name: sampleMatter(index).title,
      opened: sampleDate(index),
      status: index === 2 ? "Closed" : "Open",
    })),
  )}
  <Button variant="secondary">Add a matter</Button>
{/snippet}

<Story
  name="Default"
  args={{ loading: true, label: "Reading the matters on this record" }}
  play={async ({ canvasElement, step }) => {
    const region = canvasElement.querySelector(".mc-loading-region");
    if (!(region instanceof HTMLElement)) throw new Error("the region did not render");
    await step("The state is announced once, by a status line and aria-busy", async () => {
      await expect(canvasElement.querySelector('[role="status"]')).toHaveTextContent(
        "Reading the matters on this record",
      );
      await expect(region).toHaveAttribute("aria-busy", "true");
    });
    await step("The fixture is inert: nothing in it can be pressed or read as real", async () => {
      await expect(region).toHaveAttribute("inert");
      await expect(region).toHaveAttribute("data-mc-loading");
      await expect(region.querySelector("button")).not.toBeNull();
    });
    await step("Column heads stay furniture; the rows are the sample vocabulary, not the content", async () => {
      await expect(region.querySelector("th")).toHaveTextContent("Matter");
      await expect(region).toHaveTextContent("Whitcombe v. Cascade Ridge");
      await expect(region).not.toHaveTextContent("Delgado adoption");
    });
  }}
>
  {#snippet template(args)}
    <LoadingRegion
      loading={args.loading}
      label={args.label}
      refreshing={args.refreshing}
      failed={args.failed}
      empty={args.empty}
      fixture={sampleTable}
      class="flex flex-col gap-8"
    >
      {#snippet failure()}
        <p data-testid="failure">The matters could not be read.</p>
      {/snippet}
      {#snippet emptyState()}
        <EmptyState title="No matters yet">This record is on no matter.</EmptyState>
      {/snippet}
      {@render matterTable(REAL_ROWS)}
    </LoadingRegion>
  {/snippet}
</Story>

<Story
  name="Behaviour"
  tags={["!dev", "!autodocs"]}
  args={{ loading: true, label: "Reading the matters on this record" }}
  play={async ({ canvasElement, step }) => {
    const status = () => canvasElement.querySelector('[role="status"].sr-only');
    const region = () => canvasElement.querySelector(".mc-loading-region");
    await step("A read that stays in flight past the threshold says so and offers Retry", async () => {
      await waitFor(() =>
        expect(canvasElement.querySelector(".mc-loading-stalled")).toHaveTextContent(
          "Still reading the matters on this record. This is taking longer than it should.",
        ),
      );
      await expect(canvasElement.querySelector(".mc-loading-stalled button")).toHaveTextContent(
        "Retry",
      );
    });
    await step("Settling announces that the read finished and lifts inert", async () => {
      canvasElement.querySelector<HTMLButtonElement>('[data-testid="settle"]')?.click();
      await waitFor(() =>
        expect(status()).toHaveTextContent("Finished reading the matters on this record."),
      );
      await expect(region()).not.toHaveAttribute("inert");
      await expect(region()).not.toHaveAttribute("aria-busy");
      await expect(canvasElement.querySelector(".mc-loading-stalled")).toBeNull();
      await expect(region()).toHaveTextContent("Delgado adoption");
    });
    await step("Refreshing keeps the content and marks the region busy", async () => {
      canvasElement.querySelector<HTMLButtonElement>('[data-testid="refresh"]')?.click();
      await waitFor(() => expect(region()).toHaveAttribute("aria-busy", "true"));
      await expect(region()).toHaveAttribute("data-mc-refreshing");
      await expect(region()).not.toHaveAttribute("data-mc-loading");
      await expect(region()).toHaveTextContent("Delgado adoption");
    });
    await step("An empty answer renders the empty state", async () => {
      canvasElement.querySelector<HTMLButtonElement>('[data-testid="empty"]')?.click();
      await waitFor(() => expect(region()).toHaveTextContent("No matters yet"));
    });
    await step("A failed read renders the failure first, whatever else is true", async () => {
      canvasElement.querySelector<HTMLButtonElement>('[data-testid="fail"]')?.click();
      await waitFor(() =>
        expect(canvasElement.querySelector('[data-testid="failure"]')).toBeInTheDocument(),
      );
      await expect(region()).not.toHaveAttribute("inert");
    });
  }}
>
  {#snippet template(args)}
    <div class="flex gap-8">
      <Button variant="secondary" data-testid="settle" onclick={() => (behaviour.loading = false)}>
        Settle
      </Button>
      <Button variant="secondary" data-testid="refresh" onclick={() => (behaviour.refreshing = true)}>
        Refresh
      </Button>
      <Button variant="secondary" data-testid="empty" onclick={() => (behaviour.empty = true)}>
        Empty
      </Button>
      <Button variant="secondary" data-testid="fail" onclick={() => (behaviour.failed = true)}>
        Fail
      </Button>
    </div>
    <LoadingRegion
      loading={behaviour.loading}
      label={args.label}
      refreshing={behaviour.refreshing}
      empty={behaviour.empty}
      failed={behaviour.failed}
      stalledAfter={10}
      onRetry={() => undefined}
      fixture={sampleTable}
      class="flex flex-col gap-8"
    >
      {#snippet failure()}
        <p data-testid="failure">The matters could not be read.</p>
      {/snippet}
      {#snippet emptyState()}
        <EmptyState title="No matters yet">This record is on no matter.</EmptyState>
      {/snippet}
      {@render matterTable(REAL_ROWS)}
    </LoadingRegion>
  {/snippet}
</Story>
