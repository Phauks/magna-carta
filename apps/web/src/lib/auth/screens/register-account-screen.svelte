<script lang="ts">
  /*
   * Create Your Account — the whole of registration, and the only thing this surface asks.
   *
   * IT ASKS NOTHING ABOUT A FIRM, and that is the reflow. The screen it replaces opened by asking a
   * visitor to classify themselves — a client of a firm, somebody who works at one, somebody
   * founding one — before anything about them existed. That is a question about a RELATIONSHIP, and
   * a person cannot have one before they are a person. So this screen makes the person, and which
   * firm they belong to is settled afterwards, signed in, on the joining screen at /welcome.
   *
   * THE BUTTON NAMES WHAT PRESSING IT DOES. It sends a confirmation email; it does not create the
   * account, which is created when the link in that mail is followed. A button reading "Create
   * Account" would describe the end of a journey while performing its first step.
   *
   * THE PASSWORD IS CHOSEN HERE, and nothing is minted by choosing it. It is hashed by the server in
   * this request and held with the pending registration; the credential comes into being only when
   * the emailed token is spent, which is the act that proves the mailbox belongs to the person who
   * typed it. So the ordering the earlier design protected is intact — nothing exists before the
   * mailbox is proven — while the person is spared a second mail and a password-reset round trip
   * standing between them and their first sign-in. (Passkeys are still a gap:
   * ../joining-availability.ts.)
   *
   * ONE PASSWORD FIELD WITH A REVEAL, not a confirm pair, matching the reset screen beside it
   * (reset-password-set-screen.svelte): being able to READ what you typed is what the second field
   * existed to compensate for, and a mistyped password here is recoverable through Reset Password
   * rather than fatal.
   *
   * BOTH ACKNOWLEDGEMENTS GATE THE SUBMIT, and they are two acts of consent because they are two
   * documents. The gate is honest — nothing is sent until both are ticked — but it stops at this
   * browser: the registration route records no consent, and neither document is published yet.
   *
   * EVERY FIELD IS REQUIRED and the submit stays shut until they are all filled, rather than opening
   * and then rejecting: a form that lets you press the button and then tells you off has spent a
   * round trip to say what it already knew.
   */
  import Button from "@magna-carta/design-system/button";
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

<AuthPanel title="Create Your Account" {back} backLabel="Back to sign in">
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
        <Label for="register-password">Password</Label>
        <PasswordInput
          id="register-password"
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

        Each sentence is ONE span inside its Label: the label recipe is a flex row, so bare text
        nodes and an inline anchor would become separate flex items and the link would drift to the
        far edge with the closing period orphaned against the card border.
      -->
      <div class="flex flex-col gap-8">
        <div class="flex items-center gap-8">
          <Checkbox id="register-terms" bind:checked={agreedToTerms} disabled={pending} />
          <Label for="register-terms">
            <span>
              I have read and agreed to the
              <a class={QUIET_LINK} href="#terms" target="_blank" rel="noopener noreferrer">
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
              <a class={QUIET_LINK} href="#privacy" target="_blank" rel="noopener noreferrer">
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
        Your account is created when you open the link in that email, which is how we know the
        address is yours — then sign in with the password you just chose. Once you are signed in,
        you can start a law firm or join one you have been invited to.
      </p>
    </form>
  {/snippet}
</AuthPanel>
