<script lang="ts">
  /*
   * Register New User — who the person founding the firm is, and the last screen before the mail.
   *
   * THE BUTTON NAMES WHAT PRESSING IT DOES. It sends a confirmation email; it does not create an
   * account, and the firm is not built until the link in that mail is followed. A button reading
   * "Create Account" would be describing the end of a journey while performing its first step, and
   * the person would then sit on a screen wondering why nothing had been created.
   *
   * THE PASSWORD IS CHOSEN HERE, and nothing is minted by choosing it: the server hashes it in this
   * request and holds it with the pending registration, and the credential comes into being only
   * when the emailed token is spent — the act that proves the mailbox belongs to the person who
   * typed it. The ordering the earlier design protected is intact; what is gone is the second mail
   * and the password-reset round trip that used to stand between somebody and their first sign-in.
   * The passkey-or-password choice the design calls for is still a real design decision waiting on a
   * real route — ../joining-availability.ts holds that fact, and ../unbuilt-capabilities.ts holds
   * the passkey gap itself.
   *
   * ONE PASSWORD FIELD WITH A REVEAL, not a confirm pair — the same reading as the account door
   * beside it (register-account-screen.svelte) and the reset screen.
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
  import { opensBeside } from "$lib/navigation/open-beside.ts";
  import Checkbox from "@magna-carta/design-system/checkbox";
  import Input from "@magna-carta/design-system/input";
  import Label from "@magna-carta/design-system/label";
  import PasswordInput from "@magna-carta/design-system/password-input";
  import AuthPanel from "../auth-panel.svelte";
  import CredentialNotice from "../credential-notice.svelte";
  import { QUIET_LINK } from "../quiet-link.ts";

  let {
    firstName = $bindable(""),
    lastName = $bindable(""),
    email = $bindable(""),
    password = $bindable(""),
    minimumPasswordLength,
    agreedToTerms = $bindable(false),
    agreedToPrivacy = $bindable(false),
    firmName,
    pending = false,
    rejection = null,
    supportErrorId = null,
    firstNameFieldReference = $bindable(null),
    onSubmit,
    back,
  }: {
    firstName?: string;
    lastName?: string;
    email?: string;
    password?: string;
    /** The shortest password the server accepts, stated up front rather than discovered by refusal. */
    minimumPasswordLength: number;
    agreedToTerms?: boolean;
    agreedToPrivacy?: boolean;
    /** The firm being founded, echoed so the person can see what they are about to create. */
    firmName?: string;
    pending?: boolean;
    /** The refusal sentence, already chosen by the caller. */
    rejection?: string | null;
    /** The correlated Error ID for a server fault, to quote to support. Null for a refusal. */
    supportErrorId?: string | null;
    firstNameFieldReference?: HTMLInputElement | null;
    onSubmit: (event: SubmitEvent) => void;
    back?: () => void;
  } = $props();

  const complete = $derived(
    firstName.trim() !== "" &&
      lastName.trim() !== "" &&
      email.trim() !== "" &&
      password.length >= minimumPasswordLength &&
      agreedToTerms &&
      agreedToPrivacy,
  );
  const canSubmit = $derived(!pending && complete);
</script>

<AuthPanel title="Register New User" {back} backLabel="Your Firm's Name">
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

      <div class="flex flex-col gap-8">
        <Label for="register-details-password">Password</Label>
        <PasswordInput
          id="register-details-password"
          name="new-password"
          size="lg"
          bind:value={password}
          autocomplete="new-password"
          placeholder="Password"
          disabled={pending}
        />
        <p class="text-sm text-text-muted">At least {minimumPasswordLength} characters.</p>
      </div>

      <!--
        The two documents do not exist yet, so both hrefs are placeholders and open nothing. They
        are links rather than plain text because that is what they become the day the pages are
        published, and the shape of the consent should not change then. The gap is declared in
        ../joining-availability.ts under "agreements".

        Each sentence is ONE span inside its Label: the label recipe is a flex row (its gap spaces
        a wrapped control from its caption), so bare text nodes and an inline anchor become
        separate flex items — the link drifts to the far edge and the closing period ends up
        orphaned against the card border. One span keeps the sentence flowing as inline text. The
        two acknowledgements sit in one gap-8 group because they are one act of consent in two
        parts, not two unrelated form sections.
      -->
      <div class="flex flex-col gap-8">
        <div class="flex items-center gap-8">
          <Checkbox id="register-terms" bind:checked={agreedToTerms} disabled={pending} />
          <Label for="register-terms">
            <span>
              I have read and agreed to the
              <a class={QUIET_LINK} href="#terms" {...opensBeside("external")}>
                Terms of Service</a
              >.
            </span>
          </Label>
        </div>

        <div class="flex items-center gap-8">
          <Checkbox id="register-privacy" bind:checked={agreedToPrivacy} disabled={pending} />
          <Label for="register-privacy">
            <span>
              I have read and agreed to the
              <a class={QUIET_LINK} href="#privacy" {...opensBeside("external")}>
                Privacy Policy</a
              >.
            </span>
          </Label>
        </div>
      </div>

      <Button type="submit" variant="primary" size="lg" class="w-full" disabled={!canSubmit}>
        {pending ? "Sending…" : "Send Confirmation Email"}
      </Button>

      <!-- Everything informational renders BELOW the button, so the button holds still. -->
      <CredentialNotice message={rejection} errorId={supportErrorId} subject="registration" />

      <p class="text-sm text-text-muted">
        You will set your password from the link in that email, which is also how we know the
        address is yours.
      </p>
    </form>
  {/snippet}
</AuthPanel>
