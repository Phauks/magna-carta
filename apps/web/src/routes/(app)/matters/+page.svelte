<script lang="ts">
  /*
   * Matters — the List archetype's landing. Stage 1 ships the honest EMPTY state (the heritage
   * invitation); stage 2 of the UI roadmap wires the real list (DataTable + saved views + the
   * ledger voice) to the matters API and this page becomes the workhorse.
   */
  import Button from "@magna-carta/design-system/button";
  import EmptyState from "@magna-carta/design-system/empty-state";
  import * as Masthead from "@magna-carta/design-system/masthead";
  import Plus from "@lucide/svelte/icons/plus";
</script>

<svelte:head>
  <title>Matters · Magna Carta</title>
</svelte:head>

<Masthead.Root class="mb-24">
  <Masthead.Heading>
    <Masthead.Title>Matters</Masthead.Title>
    <Masthead.Meta>
      <span>The firm's active docket</span>
    </Masthead.Meta>
  </Masthead.Heading>
  <Masthead.Actions>
    <Button variant="primary" disabled title="Matter creation arrives with the matters surface">
      <Plus class="size-16" aria-hidden="true" />
      New matter
    </Button>
  </Masthead.Actions>
</Masthead.Root>

<EmptyState title="No matters yet">
  Matters are the file of record for everything the firm does — numbering, documents, time, and
  trust all hang from one. The list view arrives here next.
</EmptyState>
