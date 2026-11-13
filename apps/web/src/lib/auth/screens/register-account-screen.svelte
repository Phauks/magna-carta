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
   * IT ASKS NOTHING ABOUT A NAME EITHER (owner correction, 2026-09-09). An address and a password
   * are the whole credential; a first and last name are a PROFILE, which is a thing an account has
   * rather than a thing it needs to exist, and asking for them here made two of the four fields
   * standing between a visitor and their account facts the platform can be told any time afterwards.
   * The account holds the address as its display name until somebody says otherwise — an honest
   * placeholder, and never a guess split out of the address, which cannot be undone.
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
   * AND IT IS TYPED TWICE (owner correction, 2026-09-09). The reveal control is still there, and the
   * screen kept a single field for a while on the reasoning that being able to READ what you typed
   * is what a confirm field compensates for. What that reasoning missed is that a reveal is a thing
   * you have to think to press, and the cost of a password mistyped identically twice is a mail
   * round trip through Reset Password before a first sign-in. The two must match before the submit
   * opens; the mismatch is stated under the second field rather than after a press.
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
  import { opensBeside } from "$lib/navigation/open-beside.ts";
  import Checkbox from "@magna-carta/design-system/checkbox";
  import Input from "@magna-carta/design-system/input";
  import Label from "@magna-carta/design-system/label";
  import PasswordInput from "@magna-carta/design-system/password-input";
  import AuthPanel from "../auth-panel.svelte";
  import CredentialNotice from "../credential-notice.svelte";
  import { QUIET_LINK } from "../quiet-link.ts";

  let {
    email = $bindable(""),
    password = $bindable(""),
    passwordAgain = $bindable(""),
    minimumPasswordLength,
    agreedToTerms = $bindable(false),
    agreedToPrivacy = $bindable(false),
    pending = false,
    rejection = null,
    supportErrorId = null,
    emailFieldReference = $bindable(null),
    onSubmit,
    back,
  }: {
    email?: string;
    password?: string;
    /** The second typing of the same password. Never sent anywhere — it is compared here and dropped. */
    passwordAgain?: string;
    /** The shortest password the server accepts, stated up front rather than discovered by refusal. */
    minimumPasswordLength: number;
    agreedToTerms?: boolean;
    agreedToPrivacy?: boolean;
    pending?: boolean;
    /** The refusal sentence, already chosen by the caller. */
    rejection?: string | null;
    /** The correlated Error ID for a server fault, to quote to support. Null for a refusal. */
    supportErrorId?: string | null;
    emailFieldReference?: HTMLInputElement | null;
    onSubmit: (event: SubmitEvent) => void;
    back?: () => void;
  } = $props();

  const longEnough = $derived(password.length >= minimumPasswordLength);
  /*
   * Said only once the second field has something in it. A mismatch announced against an empty box
   * is a complaint about not having finished typing yet, which every person filling this form is
   * guilty of for as long as it takes them to fill it.
   */
  const mismatched = $derived(passwordAgain !== "" && passwordAgain !== password);
  const complete = $derived(
    email.trim() !== "" &&
      longEnough &&
      passwordAgain === password &&
      agreedToTerms &&
      agreedToPrivacy,
  );
  const canSubmit = $derived(!pending && complete);
</script>

<AuthPanel title="Create Your Account" {back} backLabel="Sign In">
  {#snippet children()}
    <form onsubmit={onSubmit} class="flex flex-col gap-16">
      <div class="flex flex-col gap-8">
        <Label for="register-email">Email Address</Label>
        <Input
          bind:ref={emailFieldReference}
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

      <div class="flex flex-col gap-8">
        <Label for="register-password-again">Verify Password</Label>
        <PasswordInput
          id="register-password-again"
          name="new-password-again"
          size="lg"
          bind:value={passwordAgain}
          autocomplete="new-password"
          placeholder="Verify Password"
          aria-invalid={mismatched ? "true" : undefined}
          aria-describedby={mismatched ? "register-password-mismatch" : undefined}
          disabled={pending}
        />
        {#if mismatched}
          <p id="register-password-mismatch" class="text-sm text-text-danger">
            The two passwords do not match.
          </p>
        {/if}
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
        Open the link in that email to create your account and sign in. Then you can start a law firm or join one you've been invited to.
      </p>
    </form>
  {/snippet}
</AuthPanel>
