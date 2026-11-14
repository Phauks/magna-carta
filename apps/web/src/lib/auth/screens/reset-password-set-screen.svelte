<script lang="ts">
  /*
   * Set a New Password — spending the emailed token. The token arrived in `?token=` (the mail links
   * straight at this screen; the server-side reasoning is in
   * apps/api-worker/src/password-reset-link.ts) and is spent only when the form is submitted, so a
   * link opened by a mail client's preview costs nothing.
   *
   * ONE PASSWORD FIELD WITH A REVEAL, not a confirm pair: PasswordInput lets the person read what
   * they typed, which is what the second field existed to compensate for.
   *
   * Completing this is more than a reset: it marks the address verified, which is how a firm
   * owner's or an invited member's account becomes usable at all — the server flips the flag in
   * its onPasswordReset hook (apps/api-worker/src/auth.ts).
   */
  import * as Alert from "@magna-carta/design-system/alert";
  import Button from "@magna-carta/design-system/button";
  import Label from "@magna-carta/design-system/label";
  import PasswordInput from "@magna-carta/design-system/password-input";
  import AuthPanel from "../auth-panel.svelte";
  import CredentialNotice from "../credential-notice.svelte";

  let {
    newPassword = $bindable(""),
    minimumLength,
    pending = false,
    completed = false,
    rejection = null,
    passwordFieldReference = $bindable(null),
    onSubmit,
    onSignIn,
    onRequestNewLink,
  }: {
    newPassword?: string;
    /** The shortest password the server accepts, stated up front rather than discovered by refusal. */
    minimumLength: number;
    pending?: boolean;
    /** True once the password is set; the form gives way to the way onward. */
    completed?: boolean;
    /** The failure sentence, already chosen by the caller. */
    rejection?: string | null;
    passwordFieldReference?: HTMLInputElement | null;
    onSubmit: (event: SubmitEvent) => void;
    /** Where to go once the password is set. */
    onSignIn: () => void;
    /** Offered under a refusal, because an expired link's remedy is a fresh one. */
    onRequestNewLink?: () => void;
  } = $props();

  const canSubmit = $derived(!pending && newPassword.length >= minimumLength);
</script>

<AuthPanel title="Set a New Password">
  {#snippet meta()}
    Choose the password you will sign in with. At least {minimumLength} characters.
  {/snippet}

  {#snippet children()}
    {#if completed}
      <div class="flex flex-col gap-16">
        <Alert.Root variant="success">
          <Alert.Description>
            Your password is set. Sign in now. This link can't be used again.
          </Alert.Description>
        </Alert.Root>
        <Button variant="primary" size="lg" class="w-full" onclick={onSignIn}>Sign In</Button>
      </div>
    {:else}
      <form onsubmit={onSubmit} class="flex flex-col gap-16">
        <div class="flex flex-col gap-8">
          <Label for="reset-password-new">New Password</Label>
          <PasswordInput
            bind:ref={passwordFieldReference}
            id="reset-password-new"
            name="new-password"
            size="lg"
            bind:value={newPassword}
            autocomplete="new-password"
            placeholder="New Password"
            aria-invalid={rejection ? "true" : undefined}
            disabled={pending}
          />
        </div>

        <Button type="submit" variant="primary" size="lg" class="w-full" disabled={!canSubmit}>
          {pending ? "Setting…" : "Set Password"}
        </Button>

        <!-- Everything informational renders BELOW the button, so the button holds still. -->
        <CredentialNotice message={rejection} subject="this reset link" />

        {#if rejection && onRequestNewLink}
          <Button variant="secondary" size="lg" class="w-full" onclick={onRequestNewLink}>
            Request a New Link
          </Button>
        {/if}
      </form>
    {/if}
  {/snippet}
</AuthPanel>
