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
  <EmptyState title="This Firm Has Not Enabled AI Processing">
    The firm has not consented to sending its content to an outside model provider, so Magnus cannot
    answer anything. That is the firm's decision to make: an administrator records it in the firm's
    settings.
  </EmptyState>
{:else}
  <EmptyState title="Magnus Is Not Turned On For This Firm">
    The firm has consented to AI processing but has not turned the assistant on. An administrator
    turns it on in the firm's settings.
  </EmptyState>
{/if}
