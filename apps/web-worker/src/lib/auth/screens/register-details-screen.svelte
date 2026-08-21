<script lang="ts">
  /*
   * Register New User — who the person founding the firm is, and the last screen before the mail.
   *
   * THE BUTTON NAMES WHAT PRESSING IT DOES. It sends a confirmation email; it does not create an
   * account, and the firm is not built until the link in that mail is followed. A button reading
   * "Create Account" would be describing the end of a journey while performing its first step, and
   * the person would then sit on a screen wondering why nothing had been created.
   *
   * NO CREDENTIAL IS CHOSEN HERE — no password field, no passkey button. The password is set
   * afterwards, through the link this sends, which is the same act that proves the mailbox belongs
   * to the person who typed it; a password collected on this form would be a credential minted
   * before anybody had proven anything. The passkey-or-password choice the design calls for is a
   * real design decision waiting on a real route — ../joining-availability.ts holds both facts, and
   * ../unbuilt-capabilities.ts holds the passkey gap itself.
   *
   * BOTH ACKNOWLEDGEMENTS GATE THE SUBMIT, and they are two acts of consent because they are two
   * documents. The gate is honest — nothing is sent until both are ticked — but it stops at this
   * browser: the registration route records no consent, and neither document is published yet, so
   * the two links have nowhere to go. Both facts are declared in ../joining-availability.ts rather
   * than left for somebody to discover by clicking.
   *
   * EVERY FIELD IS REQUIRED and the submit stays shut until they are all filled, rather than
   * opening and then rejecting: a form that lets you press the button and then tells you off has
   * spent a round trip to say what it already knew.
   */
  import Button from "@magna-carta/design-system/button";
  import Checkbox from "@magna-carta/design-system/checkbox";
  import Input from "@magna-carta/design-system/input";
  import Label from "@magna-carta/design-system/label";
  import AuthPanel from "../auth-panel.svelte";
  import CredentialNotice from "../credential-notice.svelte";
  import { QUIET_LINK } from "../quiet-link.ts";

  let {
    firstName = $bindable(""),
    lastName = $bindable(""),
    email = $bindable(""),
    agreedToTerms = $bindable(false),
    agreedToPrivacy = $bindable(false),
    firmName,
    pending = false,
    rejection = null,
    firstNameFieldReference = $bindable(null),
    onSubmit,
    back,
  }: {
    firstName?: string;
    lastName?: string;
    email?: string;
    agreedToTerms?: boolean;
    agreedToPrivacy?: boolean;
    /** The firm being founded, echoed so the person can see what they are about to create. */
    firmName?: string;
    pending?: boolean;
    /** The refusal sentence, already chosen by the caller. */
    rejection?: string | null;
    firstNameFieldReference?: HTMLInputElement | null;
    onSubmit: (event: SubmitEvent) => void;
    back?: () => void;
  } = $props();

  const complete = $derived(
    firstName.trim() !== "" &&
      lastName.trim() !== "" &&
      email.trim() !== "" &&
      agreedToTerms &&
      agreedToPrivacy,
  );
  const canSubmit = $derived(!pending && complete);
</script>

<AuthPanel title="Register New User" {back} backLabel="Back to your firm's name">
  {#snippet meta()}
    {#if firmName}Founding {firmName}.{/if}
  {/snippet}

  {#snippet children()}
    <form onsubmit={onSubmit} class="flex flex-col gap-16">
      <div class="flex gap-8">
        <div class="flex min-w-0 flex-1 flex-col gap-8">
          <Label for="register-first-name">First Name</Label>
          <Input
            bind:ref={firstNameFieldReference}
            id="register-first-name"
            name="given-name"
            size="lg"
            bind:value={firstName}
            autocomplete="given-name"
            placeholder="First Name"
            disabled={pending}
            required
          />
        </div>
        <div class="flex min-w-0 flex-1 flex-col gap-8">
          <Label for="register-last-name">Last Name</Label>
          <Input
            id="register-last-name"
            name="family-name"
            size="lg"
            bind:value={lastName}
            autocomplete="family-name"
            placeholder="Last Name"
            disabled={pending}
            required
          />
        </div>
      </div>

      <div class="flex flex-col gap-8">
        <Label for="register-email">Email Address</Label>
        <Input
          id="register-email"
          name="email"
          type="email"
          size="lg"
          bind:value={email}
          autocomplete="email"
          placeholder="Email Address"
          spellcheck={false}
          disabled={pending}
          required
        />
      </div>

      <!--
        The two documents do not exist yet, so both hrefs are placeholders and open nothing. They
        are links rather than plain text because that is what they become the day the pages are
        published, and the shape of the consent should not change then. The gap is declared in
        ../joining-availability.ts under "agreements".
      -->
      <div class="flex items-center gap-8">
        <Checkbox id="register-terms" bind:checked={agreedToTerms} disabled={pending} />
        <Label for="register-terms">
          I have read and agreed to the
          <a class={QUIET_LINK} href="#terms" target="_blank" rel="noopener noreferrer">
            Terms of Service
          </a>.
        </Label>
      </div>

      <div class="flex items-center gap-8">
        <Checkbox id="register-privacy" bind:checked={agreedToPrivacy} disabled={pending} />
        <Label for="register-privacy">
          I have read and agreed to the
          <a class={QUIET_LINK} href="#privacy" target="_blank" rel="noopener noreferrer">
            Privacy Policy
          </a>.
        </Label>
      </div>

      <Button type="submit" variant="primary" size="lg" class="w-full" disabled={!canSubmit}>
        {pending ? "Sending…" : "Send Confirmation Email"}
      </Button>

      <!-- Everything informational renders BELOW the button, so the button holds still. -->
      <CredentialNotice message={rejection} subject="registration" />

      <p class="text-sm text-text-muted">
        You will set your password from the link in that email, which is also how we know the
        address is yours.
      </p>
    </form>
  {/snippet}
</AuthPanel>
