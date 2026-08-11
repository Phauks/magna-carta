<script lang="ts">
  /*
   * Use a Recovery Code — the way in when the authenticator is not to hand.
   *
   * THE FIELD ACCEPTS LETTERS. It used to be worth saying only as a warning; it is worth saying
   * here as a rule, because a numeric-only recovery field silently eats every valid code and
   * presents that as the code being wrong. Numeric-only applies to the six-digit authenticator
   * entry alone. The value is uppercased as it is typed and trimmed on submit, so a code copied out
   * of a password manager with a stray space still verifies.
   *
   * The artifact this screen was transposed from renders the code with a generated, non-deletable
   * `MCREC-` prefix inside the field, so a code found loose in a drawer says what it opens. That is
   * a good decision and it is NOT implemented here, because the two-factor plugin mints backup
   * codes in its own format: a field that inserted a prefix the server has never seen would reject
   * every real code. The prefix belongs to the same change that sets the generator's format.
   *
   * Each code works once, and the copy says so up front rather than after a second attempt with the
   * same one fails.
   */
  import Button from "@magna-carta/design-system/button";
  import Input from "@magna-carta/design-system/input";
  import Label from "@magna-carta/design-system/label";
  import AuthPanel from "../auth-panel.svelte";
  import CredentialNotice from "../credential-notice.svelte";

  let {
    recoveryCode = $bindable(""),
    pending = false,
    rejection = null,
    attemptsRemaining = null,
    lockoutSeconds = null,
    codeFieldReference = $bindable(null),
    onSubmit,
    back,
  }: {
    recoveryCode?: string;
    pending?: boolean;
    rejection?: string | null;
    attemptsRemaining?: number | null;
    lockoutSeconds?: number | null;
    codeFieldReference?: HTMLInputElement | null;
    onSubmit: (event: SubmitEvent) => void;
    back?: () => void;
  } = $props();

  const lockedOut = $derived(lockoutSeconds !== null);
  const canSubmit = $derived(!pending && !lockedOut && recoveryCode.trim() !== "");
</script>

<AuthPanel title="Use a Recovery Code" {back} backLabel="Back to your code">
  {#snippet meta()}Enter one of the codes you saved. Each code works once.{/snippet}

  {#snippet children()}
    <form onsubmit={onSubmit} class="flex flex-col gap-16">
      <div class="flex flex-col gap-8">
        <Label for="recovery-code">Recovery Code</Label>
        <Input
          bind:ref={codeFieldReference}
          id="recovery-code"
          name="recovery-code"
          size="lg"
          class="font-mono"
          bind:value={recoveryCode}
          autocomplete="one-time-code"
          autocapitalize="characters"
          spellcheck={false}
          placeholder="Recovery Code"
          aria-invalid={rejection ? "true" : undefined}
          disabled={pending || lockedOut}
          required
        />
      </div>

      <Button type="submit" variant="primary" size="lg" class="w-full" disabled={!canSubmit}>
        {pending ? "Verifying…" : "Verify Recovery Code"}
      </Button>

      <CredentialNotice
        message={rejection}
        {attemptsRemaining}
        {lockoutSeconds}
        subject="this sign-in"
      />
    </form>
  {/snippet}

  {#snippet footer()}
    <p>Out of codes? Your firm's administrator can reset Two-Factor after verifying who you are.</p>
  {/snippet}
</AuthPanel>
