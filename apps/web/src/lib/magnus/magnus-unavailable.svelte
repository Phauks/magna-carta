<script lang="ts">
  /*
   * The two states where the assistant is closed by a firm decision rather than by anything the
   * reader did or can undo.
   *
   * They are different facts with different remedies, so they are two screens and not one: a firm
   * that has not consented to sending its content to an outside model provider has a decision to
   * make, and a firm that has consented but not turned the assistant on has a switch to throw. Each
   * names who can change it. NEITHER OFFERS A CONTROL, because a member standing here cannot press
   * one, and a disabled button would only be a second way of saying no.
   */
  import EmptyState from "@magna-carta/design-system/empty-state";

  let { state }: { state: "firm-ineligible" | "feature-disabled" } = $props();
</script>

{#if state === "firm-ineligible"}
  <EmptyState title="This Firm Hasn't Turned On AI">
    The firm hasn't agreed to send its content to an outside model provider, so Magnus can't answer. An administrator can record that choice in the firm's settings.
  </EmptyState>
{:else}
  <EmptyState title="Magnus Isn't Turned On for This Firm">
    The firm agreed to AI use but hasn't turned on Magnus. An administrator can turn it on in the firm's settings.
  </EmptyState>
{/if}
