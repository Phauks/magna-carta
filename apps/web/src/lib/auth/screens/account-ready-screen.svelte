<script lang="ts">
  /*
   * Your Account Is Ready — the full stop the confirmation screen reaches when the account already
   * holds a password.
   *
   * IT IS A SEPARATE SCREEN FROM "CHECK YOUR EMAIL" BECAUSE IT IS THE OPPOSITE ENDING. That screen
   * points at a mailbox and asks somebody to wait; this one says there is nothing left to wait for
   * and puts the sign-in button under their hand. Registration now collects the password and
   * confirming the emailed token commits it with the account, so this is the ordinary ending of the
   * ordinary path — and telling someone to check their email for a second mail that is never coming
   * is precisely the failure this whole reflow removed.
   *
   * `pendingFirm` covers the founding door, where the workspace is still being built off the
   * request: the credential exists either way, so the sign-in button is the same, but the sentence
   * must not promise a workspace that is not up yet.
   *
   * `notice` carries the one unhappy variant — the account is real but a mail that was owed did not
   * go out — because it belongs on the SUCCESS, not on a refusal. A person whose account exists has
   * not failed at anything, and the only thing they need is the door that still opens.
   */
  import * as Alert from "@magna-carta/design-system/alert";
  import Button from "@magna-carta/design-system/button";
  import AuthPanel from "../auth-panel.svelte";

  let {
    address,
    pendingFirm = false,
    notice = null,
  }: {
    /** The address the account was created for, so the person knows which one it is. */
    address: string;
    /** True while the founding door's workspace is still being provisioned in the background. */
    pendingFirm?: boolean;
    /** An honest complication to show under the success — today, a mail that did not send. */
    notice?: string | null;
  } = $props();
</script>

<AuthPanel title="Your Account Is Ready">
  {#snippet meta()}{address}{/snippet}

  {#snippet children()}
    <Alert.Root variant="success">
      <Alert.Description>
        {#if pendingFirm}
          Your account is confirmed. Sign in with the password you chose. We'll let you know when your workspace is ready.
        {:else}
          Your account is confirmed. Sign in with the password you chose when you registered.
        {/if}
      </Alert.Description>
    </Alert.Root>

    {#if notice}
      <Alert.Root variant="warning">
        <Alert.Description>{notice}</Alert.Description>
      </Alert.Root>
    {/if}

    <Button variant="primary" size="lg" class="w-full" href="/login">Sign In</Button>
  {/snippet}
</AuthPanel>
