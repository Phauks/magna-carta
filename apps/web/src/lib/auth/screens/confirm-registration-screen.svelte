<script lang="ts">
  /*
   * Confirm Your Email Address — the screen the registration token is spent on, and the moment the
   * firm actually starts being built.
   *
   * IT ACCEPTS A TYPED CODE, NOT ONLY A FOLLOWED LINK. Today that is the only way in: the
   * confirmation mail carries the bare token as its whole body, so there is nothing to click
   * (../joining-availability.ts, "confirm-registration"). The page also reads a token out of the
   * address bar, so the day the mail carries a URL this screen already answers it — and even then a
   * link that will not open in the reader's mail client is never a dead end.
   *
   * THE TOKEN IS PASSED THROUGH UNTOUCHED except for trimming. Unlike the invitation code, the
   * server does NOT normalize it — apps/worker/src/joining-secrets.ts hashes the trimmed string
   * exactly as given — so uppercasing it, grouping it, or stripping punctuation from it here would
   * quietly produce a digest that matches nothing, and the person would be told their link was bad
   * by the field that broke it.
   *
   * ONE REFUSAL, as everywhere on this surface: an unknown token, a spent one and an expired one
   * answer identically, because telling them apart would confirm that a particular registration
   * exists for a particular address.
   */
  import Button from "@magna-carta/design-system/button";
  import Input from "@magna-carta/design-system/input";
  import Label from "@magna-carta/design-system/label";
  import AuthPanel from "../auth-panel.svelte";
  import CredentialNotice from "../credential-notice.svelte";

  let {
    token = $bindable(""),
    pending = false,
    rejection = null,
    tokenFieldReference = $bindable(null),
    onSubmit,
  }: {
    token?: string;
    pending?: boolean;
    rejection?: string | null;
    tokenFieldReference?: HTMLInputElement | null;
    onSubmit: (event: SubmitEvent) => void;
  } = $props();

  const canSubmit = $derived(!pending && token.trim() !== "");
</script>

<AuthPanel title="Confirm Your Email Address">
  {#snippet meta()}Type the confirmation code from the email we sent you.{/snippet}

  {#snippet children()}
    <form onsubmit={onSubmit} class="flex flex-col gap-16">
      <div class="flex flex-col gap-8">
        <Label for="registration-confirmation-code">Confirmation Code</Label>
        <Input
          bind:ref={tokenFieldReference}
          id="registration-confirmation-code"
          name="confirmation-code"
          size="lg"
          class="font-mono"
          bind:value={token}
          autocomplete="off"
          spellcheck={false}
          placeholder="Confirmation Code"
          aria-invalid={rejection ? "true" : undefined}
          disabled={pending}
          required
        />
      </div>

      <Button type="submit" variant="primary" size="lg" class="w-full" disabled={!canSubmit}>
        {pending ? "Confirming…" : "Confirm Email Address"}
      </Button>

      <CredentialNotice message={rejection} subject="this registration" />
    </form>
  {/snippet}
</AuthPanel>
