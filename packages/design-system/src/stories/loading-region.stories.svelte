<script module lang="ts">
  /*
   * LoadingRegion — the one loading state (Feedback, Tier 1). ONE story, on the catalog rule for a
   * component with no variant axis: `loading` is a Control, so the reviewer flips the same region
   * between its shape and its content. The template renders a real labelled-field group and a
   * real table over fixture words, which is the whole point — the placeholder is the component.
   *
   * The play function is the behaviour test: the sentence is present and the fixture is inert
   * while loading, the labels and column heads stay real, and the children render once settled.
   */
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import { expect } from "storybook/test";
  import Badge from "../lib/components/badge/index.ts";
  import Button from "../lib/components/button/index.ts";
  import * as DataTable from "../lib/components/data-table/index.ts";
  import LoadingRegion from "../lib/components/loading-region/loading-region.svelte";

  const { Story } = defineMeta({
    title: "Feedback/LoadingRegion",
    component: LoadingRegion,
    parameters: {
      controls: { include: ["loading", "label"] },
    },
  });

  const FIXTURE_ROWS = [
    { id: "a", name: "Whitmore v. Cascade Ridge Homeowners Association", status: "Open" },
    { id: "b", name: "Estate of Harold Pemberton", status: "Open" },
    { id: "c", name: "Okafor lease renewal", status: "Closed" },
  ];
  const REAL_ROWS = [{ id: "1", name: "Delgado adoption", status: "Open" }];
</script>

<Story
  name="Default"
  args={{ loading: true, label: "Reading the matters on this record" }}
  play={async ({ canvasElement, step }) => {
    const region = canvasElement.querySelector(".mc-loading-region");
    if (!(region instanceof HTMLElement)) throw new Error("the region did not render");
    await step("The state is announced once, by a sentence and aria-busy", async () => {
      await expect(canvasElement.querySelector(".sr-only")).toHaveTextContent(
        "Reading the matters on this record",
      );
      await expect(region).toHaveAttribute("aria-busy", "true");
    });
    await step("The fixture is inert: nothing in it can be pressed or read as real", async () => {
      await expect(region).toHaveAttribute("inert");
      await expect(region).toHaveAttribute("data-mc-loading");
      await expect(region.querySelector("button")).not.toBeNull();
    });
    await step("Column heads stay furniture; the rows are the fixture, not the content", async () => {
      await expect(region.querySelector("th")).toHaveTextContent("Matter");
      await expect(region).toHaveTextContent("Whitmore v. Cascade Ridge");
      await expect(region).not.toHaveTextContent("Delgado adoption");
    });
  }}
>
  {#snippet template(args)}
    <LoadingRegion loading={args.loading} label={args.label} class="flex flex-col gap-8">
      {#snippet fixture()}
        <DataTable.Root>
          <DataTable.Header>
            <DataTable.Row>
              <DataTable.Head>Matter</DataTable.Head>
              <DataTable.Head>Status</DataTable.Head>
            </DataTable.Row>
          </DataTable.Header>
          <DataTable.Body>
            {#each FIXTURE_ROWS as row (row.id)}
              <DataTable.Row>
                <DataTable.Cell>{row.name}</DataTable.Cell>
                <DataTable.Cell><Badge variant="neutral">{row.status}</Badge></DataTable.Cell>
              </DataTable.Row>
            {/each}
          </DataTable.Body>
        </DataTable.Root>
        <Button variant="secondary">Add a matter</Button>
      {/snippet}
      <DataTable.Root>
        <DataTable.Header>
          <DataTable.Row>
            <DataTable.Head>Matter</DataTable.Head>
            <DataTable.Head>Status</DataTable.Head>
          </DataTable.Row>
        </DataTable.Header>
        <DataTable.Body>
          {#each REAL_ROWS as row (row.id)}
            <DataTable.Row>
              <DataTable.Cell>{row.name}</DataTable.Cell>
              <DataTable.Cell><Badge variant="neutral">{row.status}</Badge></DataTable.Cell>
            </DataTable.Row>
          {/each}
        </DataTable.Body>
      </DataTable.Root>
    </LoadingRegion>
  {/snippet}
</Story>
