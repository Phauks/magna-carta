<script lang="ts">
  /*
   * Start a New Law Firm — the first half of the only door that creates anything.
   *
   * ONE FIELD, ON ITS OWN SCREEN. Naming the firm is a different decision from naming yourself, and
   * it is the decision that makes this door different from the other two, so it is asked first and
   * alone. The person's own details follow on the next screen and both are submitted together: the
   * registration route takes one call, so the split here is a reading order, not a round trip.
   *
   * THE FIRM'S NAME IS NOT A LOOKUP KEY and is not unique. Plenty of firms share a name, and the
   * control-plane row holds this as a display name precisely so that nothing can probe it — see
   * `firm.display_name` in packages/database/src/control-plane-schema.ts. So there is no
   * availability check here, no "that name is taken", and nothing to wait for while typing.
   */
  import Button from "@magna-carta/design-system/button";
  import Input from "@magna-carta/design-system/input";
  import Label from "@magna-carta/design-system/label";
  import AuthPanel from "../auth-panel.svelte";

  let {
    firmName = $bindable(""),
    firmNameFieldReference = $bindable(null),
    onContinue,
    back,
  }: {
    firmName?: string;
    firmNameFieldReference?: HTMLInputElement | null;
    onContinue: (event: SubmitEvent) => void;
    back?: () => void;
  } = $props();

  const canContinue = $derived(firmName.trim() !== "");
</script>

<AuthPanel title="Start a New Law Firm" {back} backLabel="Back to the three choices">
  {#snippet children()}
    <form onsubmit={onContinue} class="flex flex-col gap-16">
      <div class="flex flex-col gap-8">
        <Label for="found-firm-name">Firm Name</Label>
        <Input
          bind:ref={firmNameFieldReference}
          id="found-firm-name"
          name="firm-name"
          size="lg"
          bind:value={firmName}
          autocomplete="organization"
          placeholder="Firm Name"
          required
        />
      </div>

      <Button type="submit" variant="primary" size="lg" class="w-full" disabled={!canContinue}>
        Continue
      </Button>

      <!-- Below the button, so the card grows downward and the primary action never moves. -->
      <p class="text-sm text-text-muted">
        Your firm starts on the free tier. You can move to a paid tier later from inside the
        workspace.
      </p>
    </form>
  {/snippet}
</AuthPanel>
