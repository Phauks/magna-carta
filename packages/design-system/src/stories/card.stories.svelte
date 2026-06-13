<script module lang="ts">
  /*
   * Card — Tier 1 batch (multi-part composition). Card has no variants, so it is a SINGLE story:
   * one composed matter card, constrained to a realistic width (a card sizes to its container —
   * the component imposes no width). The composition check rides the play function. svelte-csf
   * requires `component` to be a directly imported identifier, so the root is imported on its own.
   */
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import { expect } from "storybook/test";
  import Button from "../lib/components/button/index.ts";
  import * as Card from "../lib/components/card/index.ts";
  import CardRoot from "../lib/components/card/card.svelte";

  const { Story } = defineMeta({
    title: "Components/Card",
    component: CardRoot,
  });
</script>

<Story
  name="Default"
  play={async ({ canvas }) => {
    await expect(canvas.getByText("ACME Holdings — acquisition")).toBeInTheDocument();
    await expect(canvas.getByText("Matter ACME-2026-014 · opened 14 Mar 2026")).toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: "Open matter" })).toBeInTheDocument();
  }}
>
  <Card.Root class="max-w-md">
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
</Story>
