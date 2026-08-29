<script lang="ts">
  /*
   * Reset Password — asking for the link. The one field is the address, and the answer on screen is
   * the same whether or not that address has an account: the server responds identically either way,
   * and the difference is only ever in the MAIL, which goes to the address in question. Anything
   * else would make this form an account-enumeration oracle for the firm's member list.
   *
   * This is also the activation path: a firm owner fresh from registration, or an invited member,
   * sets their FIRST password through exactly this flow — completing it is what marks the address
   * verified — so the copy says "set" rather than assuming a password already exists.
   */
  import Button from "@magna-carta/design-system/button";
  import Input from "@magna-carta/design-system/input";
  import Label from "@magna-carta/design-system/label";
  import AuthPanel from "../auth-panel.svelte";
  import CredentialNotice from "../credential-notice.svelte";

  let {
    email = $bindable(""),
    pending = false,
    rejection = null,
    emailFieldReference = $bindable(null),
    onSubmit,
    back,
  }: {
    email?: string;
    pending?: boolean;
    /** The failure sentence — only ever an outage or a rate limit, never a verdict on the address. */
    rejection?: string | null;
    emailFieldReference?: HTMLInputElement | null;
    onSubmit: (event: SubmitEvent) => void;
    back?: () => void;
  } = $props();

  const canSubmit = $derived(!pending && email.trim() !== "");
</script>

<AuthPanel title="Reset Password" {back} backLabel="Back to Sign In">
  {#snippet meta()}
    We will email you a link that sets a new password for your account.
  {/snippet}

  {#snippet children()}
    <form onsubmit={onSubmit} class="flex flex-col gap-16">
      <div class="flex flex-col gap-8">
        <Label for="reset-password-email">Email Address</Label>
        <Input
          bind:ref={emailFieldReference}
          id="reset-password-email"
          name="email"
          type="email"
          size="lg"
          bind:value={email}
          autocomplete="username"
          placeholder="Email Address"
          spellcheck={false}
          disabled={pending}
          required
        />
      </div>

      <Button type="submit" variant="primary" size="lg" class="w-full" disabled={!canSubmit}>
        {pending ? "Sending…" : "Email Me a Reset Link"}
      </Button>

      <!-- Everything informational renders BELOW the button, so the button holds still. -->
      <CredentialNotice message={rejection} subject="this account" />
    </form>
  {/snippet}
</AuthPanel>
