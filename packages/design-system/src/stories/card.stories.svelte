<script module lang="ts">
  /*
   * Card — Tier 1 batch (the Button exemplar pattern applied to a multi-part composition). The
   * story composes the parts via the namespace import (the house idiom) and renders a real
   * Button in the footer. The play function asserts the title and description text render and
   * that the footer action is a reachable button; per-story axe runs clean. svelte-csf v5 API.
   *
   * Card's parts take no args of their own, so a single composed Story is the catalog entry
   * (the variant matrix that Button needs does not apply here).
   */
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import { expect } from "storybook/test";
  import Button from "../lib/components/button/index.ts";
  import * as Card from "../lib/components/card/index.ts";
  // svelte-csf's compile-time analyser requires `component` to be a directly imported component
  // identifier, not a namespace member (Card.Root), so the root is imported on its own here.
  import CardRoot from "../lib/components/card/card.svelte";

  const { Story } = defineMeta({
    title: "Components/Card",
    component: CardRoot,
  });
</script>

{#snippet matterCard()}
  <Card.Root>
    <Card.Header>
      <Card.Title>ACME Holdings — acquisition</Card.Title>
      <Card.Description>Matter ACME-2026-014 · opened 14 Mar 2026</Card.Description>
    </Card.Header>
    <Card.Content>Three active tasks, two documents awaiting review.</Card.Content>
    <Card.Footer>
      <Button variant="primary" size="sm">Open matter</Button>
      <Button variant="ghost" size="sm">Archive</Button>
    </Card.Footer>
  </Card.Root>
{/snippet}

<Story name="Default">
  {@render matterCard()}
</Story>

<Story
  name="Composes its parts"
  play={async ({ canvas }) => {
    await expect(canvas.getByText("ACME Holdings — acquisition")).toBeInTheDocument();
    await expect(canvas.getByText("Matter ACME-2026-014 · opened 14 Mar 2026")).toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: "Open matter" })).toBeInTheDocument();
  }}
>
  {@render matterCard()}
</Story>
