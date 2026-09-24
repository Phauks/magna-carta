<script lang="ts">
  /*
   * What a guest's page says when the page itself broke: one sentence, the Error ID, and Reload.
   *
   * IT IS NOT THE APPLICATION'S CRASH SCREEN, ON PURPOSE. That screen is written for a member: its
   * trace names the route, its remedies send the reader home or to sign in, and its report dialog
   * files the address the crash happened at. On a guest's page the address IS the link — the token
   * is the path — so every one of those would print the invitation's secret into text built to be
   * copied and pasted, or hand somebody outside the firm a way into the application's own screens.
   * This says only what a guest can act on: reload, or ask the firm for a new link. The Error ID is
   * the one fact kept, because it is what a firm quotes when it asks what went wrong, and it names
   * nothing.
   */
  import Button from "@magna-carta/design-system/button";
  import FailureState from "@magna-carta/design-system/failure-state";

  let {
    errorId,
  }: {
    /** The handle minted for this crash, or null where none was. */
    errorId: string | null;
  } = $props();

  /** The whole of what a guest is told about a page that broke. */
  const GUEST_CRASH_SENTENCE = "Something went wrong on this page. Reload, or ask the firm for a new link.";

  const rows = $derived([{ label: "Error ID", value: errorId ?? "None issued", mono: true }]);
  // What Copy puts on the clipboard: the handle and nothing else, never the address it happened at.
  const trace = $derived(errorId === null ? "" : `Error ID: ${errorId}`);
</script>

<div class="flex min-h-screen flex-col items-center justify-center bg-surface-default">
  <FailureState title="Something Went Wrong" message={GUEST_CRASH_SENTENCE} {rows} {trace}>
    {#snippet actions()}
      <Button variant="primary" onclick={() => location.reload()}>Reload</Button>
    {/snippet}
  </FailureState>
</div>
