<script module lang="ts">
  /*
   * Card — Tier 1 batch (multi-part composition). Card has no variants, so it is a SINGLE story:
   * one composed matter card, constrained to a realistic width (a card sizes to its container —
   * the component imposes no width). The composition check rides the play function. svelte-csf
   * requires `component` to be a directly imported identifier, so the root is imported on its own.
   *
   * The render MUST be an explicit `{template}` snippet (as every other story does), NOT bare
   * `<Story>` children: with `component` set, svelte-csf renders that component with args and slots
   * bare children INSIDE it — here that wrapped the card in a second, full-width CardRoot (two
   * nested cards). The template snippet is the whole render, so no auto-wrapping happens.
   */
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import { expect } from "storybook/test";
  import Button from "../lib/components/button/index.ts";
  import * as Card from "../lib/components/card/index.ts";
  import CardRoot from "../lib/components/card/card.svelte";

  const { Story } = defineMeta({
    title: "Data Display/Card",
    component: CardRoot,
  });
</script>

{#snippet template()}
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
{/snippet}

<Story
  name="Default"
  {template}
  play={async ({ canvas, step }) => {
    await step("Composed parts (title, description, action) all render", async () => {
      await expect(canvas.getByText("ACME Holdings — acquisition")).toBeInTheDocument();
      await expect(
        canvas.getByText("Matter ACME-2026-014 · opened 14 Mar 2026"),
      ).toBeInTheDocument();
      await expect(canvas.getByRole("button", { name: "Open matter" })).toBeInTheDocument();
    });
  }}
/>
