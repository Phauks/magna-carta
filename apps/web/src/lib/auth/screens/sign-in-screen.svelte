<script lang="ts">
  /*
   * Sign In — the one front door, and the whole credential in one screen.
   *
   * EMAIL AND PASSWORD SIT TOGETHER. The two-step split (an address, then a password) existed so the
   * server could decide what to show next, but it could never keep what it bought: revealing
   * anything after the address — a firm name, "this account signs in elsewhere", "no such account" —
   * is exactly the enumeration oracle that would let anyone confirm which addresses belong to a
   * firm. The second step could therefore only ever show the same neutral form. One screen is one
   * round trip, one password-manager fill, and one fewer place to leak.
   *
   * Which follows: HOME-REALM RESOLUTION HAPPENS ON SUBMIT, never on blur, because resolving as the
   * address loses focus answers questions about an address nobody has authenticated. The password
   * field is therefore always visible. The cost is real and accepted: someone whose firm signs in
   * through an identity provider may fill a password that will never be checked. The screen says so
   * the moment it resolves, and leaves the field visible but inert rather than removing it — taking
   * a field away would slide the button up under the cursor.
   *
   * ALTERNATIVE CREDENTIALS ARE OPT-IN, not decoration. Each is listed in `alternatives` by the
   * caller, and a caller only lists one it can actually complete: a sign-in button with no route
   * behind it is worse than an absent one. ../unbuilt-capabilities.ts is the register of which are
   * not built, and the developer screen-state page is where they are shown and labelled as such.
   *
   * NOTHING IS INSERTED ABOVE THE PRIMARY BUTTON except the human-verification slot, so the button
   * cannot move. That slot is the one exception because a human check is the last step before the
   * act it guards, and it appears for a small minority of attempts.
   */
  import KeyRound from "@lucide/svelte/icons/key-round";
  import Mail from "@lucide/svelte/icons/mail";
  import ShieldCheck from "@lucide/svelte/icons/shield-check";
  import Building from "@lucide/svelte/icons/building-2";
  import * as Alert from "@magna-carta/design-system/alert";
  import Button from "@magna-carta/design-system/button";
  import Checkbox from "@magna-carta/design-system/checkbox";
  import Input from "@magna-carta/design-system/input";
  import Label from "@magna-carta/design-system/label";
  import PasswordInput from "@magna-carta/design-system/password-input";
  import ProgressSteps from "@magna-carta/design-system/progress-steps";
  import AuthPanel from "../auth-panel.svelte";
  import CredentialNotice from "../credential-notice.svelte";
  import { QUIET_LINK } from "../quiet-link.ts";
  import {
    type PasskeyCeremonyPhase,
    passkeyCeremonyScript,
    passkeyCeremonySteps,
  } from "../passkey-ceremony.ts";

  /** An alternative way in, beyond the email-and-password credential. */
  export type SignInAlternative = "passkey" | "one-time-link" | "identity-provider";

  let {
    email = $bindable(""),
    password = $bindable(""),
    keepSignedIn = $bindable(true),
    pending = false,
    rejection = null,
    attemptsRemaining = null,
    lockoutSeconds = null,
    humanVerificationChallenged = false,
    identityProvider = null,
    passkeyPhase = "idle",
    alternatives = [],
    emailFieldReference = $bindable(null),
    onSubmit,
    onPasskey,
    onOneTimeLink,
    onIdentityProvider,
    onForgotPassword,
    onRegister,
  }: {
    email?: string;
    password?: string;
    keepSignedIn?: boolean;
    pending?: boolean;
    /** The rejection sentence. One sentence for every failure mode — it never says which half was wrong. */
    rejection?: string | null;
    attemptsRemaining?: number | null;
    lockoutSeconds?: number | null;
    humanVerificationChallenged?: boolean;
    /**
     * The identity provider this address turned out to belong to, discovered ON SUBMIT. Set only
     * after a resolution; null on every screen that has not resolved one.
     */
    identityProvider?: string | null;
    passkeyPhase?: PasskeyCeremonyPhase;
    alternatives?: readonly SignInAlternative[];
    emailFieldReference?: HTMLInputElement | null;
    onSubmit: (event: SubmitEvent) => void;
    onPasskey?: () => void;
    onOneTimeLink?: () => void;
    onIdentityProvider?: () => void;
    onForgotPassword?: () => void;
    onRegister?: () => void;
  } = $props();

  const lockedOut = $derived(lockoutSeconds !== null);
  const resolvedElsewhere = $derived(identityProvider !== null);
  const canSubmit = $derived(!pending && !lockedOut && email.trim() !== "");
  const passkeyScript = passkeyCeremonyScript("authenticate");
  const passkeyRunning = $derived(passkeyPhase !== "idle" && passkeyPhase !== "cancelled");
</script>

<AuthPanel title="Sign In">
  {#snippet children()}
    <form onsubmit={onSubmit} class="flex flex-col gap-16">
      <div class="flex flex-col gap-8">
        <div class="flex items-baseline justify-between gap-8">
          <Label for="sign-in-email">Email Address</Label>
          {#if onRegister}
            <button type="button" class={QUIET_LINK} onclick={onRegister}>Register</button>
          {/if}
        </div>
        <Input
          bind:ref={emailFieldReference}
          id="sign-in-email"
          name="email"
          type="email"
          size="lg"
          bind:value={email}
          autocomplete="username"
          placeholder="Email Address"
          spellcheck={false}
          aria-invalid={rejection ? "true" : undefined}
          disabled={lockedOut}
          required
        />
      </div>

      <div class="flex flex-col gap-8">
        <div class="flex items-baseline justify-between gap-8">
          <Label for="sign-in-password">Password</Label>
          {#if onForgotPassword}
            <button type="button" class={QUIET_LINK} onclick={onForgotPassword}>
              Forgot Password
            </button>
          {/if}
        </div>
        <PasswordInput
          id="sign-in-password"
          name="password"
          size="lg"
          bind:value={password}
          autocomplete="current-password"
          placeholder="Password"
          aria-invalid={rejection ? "true" : undefined}
          aria-describedby={resolvedElsewhere ? "sign-in-identity-provider" : undefined}
          disabled={pending || lockedOut}
          readonly={resolvedElsewhere}
        />
      </div>

      <div class="flex items-center gap-8">
        <Checkbox id="sign-in-keep" bind:checked={keepSignedIn} disabled={pending || lockedOut} />
        <Label for="sign-in-keep">Keep me signed in on this device.</Label>
      </div>

      <!--
        The one thing allowed above the primary action: a human check is the last step before the
        act it guards. It shows for a small minority of attempts, so the row it adds is honest.
      -->
      {#if humanVerificationChallenged}
        <div
          class="flex items-center gap-8 rounded-md border border-border-default bg-surface-raised px-12 py-8 text-sm text-text-muted"
        >
          <ShieldCheck size={18} aria-hidden="true" />
          <span>Verifying you are human</span>
          <span class="ms-auto text-xs text-text-subtle">Cloudflare Turnstile</span>
        </div>
      {/if}

      <Button
        type="submit"
        variant="primary"
        size="lg"
        class="w-full"
        disabled={!canSubmit || (resolvedElsewhere && !onIdentityProvider)}
        onclick={resolvedElsewhere ? onIdentityProvider : undefined}
      >
        {#if pending}
          Signing In…
        {:else if resolvedElsewhere}
          Continue to {identityProvider}
        {:else}
          Sign In
        {/if}
      </Button>

      <!-- Everything informational renders BELOW the button, so the card grows and the button holds still. -->
      {#if resolvedElsewhere}
        <Alert.Root variant="info">
          <Alert.Description>
            <span class="flex flex-col gap-4" id="sign-in-identity-provider">
              <span>Your firm signs in with {identityProvider}. Use the button above.</span>
              <span class="text-xs">
                Passwords are managed there, so the one you typed was not checked.
              </span>
            </span>
          </Alert.Description>
        </Alert.Root>
      {/if}

      {#if passkeyRunning || passkeyPhase === "cancelled"}
        <ProgressSteps steps={passkeyCeremonySteps("authenticate", passkeyPhase)} />
      {/if}

      <CredentialNotice
        message={rejection}
        {attemptsRemaining}
        {lockoutSeconds}
        subject="this account"
      />
    </form>

    {#if alternatives.length > 0}
      <div class="flex flex-col gap-12">
        <div class="flex items-center gap-12">
          <span class="h-px flex-auto bg-border-default" aria-hidden="true"></span>
          <span
            class="text-xs text-text-subtle uppercase"
            style="letter-spacing: var(--mc-tracking-caps)"
          >
            or
          </span>
          <span class="h-px flex-auto bg-border-default" aria-hidden="true"></span>
        </div>

        <div class="flex flex-wrap gap-8">
          {#if alternatives.includes("passkey")}
            <Button
              variant="secondary"
              size="lg"
              class="min-w-0 flex-auto"
              disabled={passkeyRunning || lockedOut}
              onclick={onPasskey}
            >
              <KeyRound size={16} aria-hidden="true" />
              <span class="truncate">
                {passkeyPhase === "cancelled"
                  ? passkeyScript.retry
                  : passkeyPhase === "settled"
                    ? passkeyScript.settled
                    : "Use Passkey or Security Key"}
              </span>
            </Button>
          {/if}
          {#if alternatives.includes("one-time-link")}
            <Button
              variant="secondary"
              size="lg"
              class="min-w-0 flex-auto"
              disabled={lockedOut}
              onclick={onOneTimeLink}
            >
              <Mail size={16} aria-hidden="true" />
              <span class="truncate">Email One-Time Link</span>
            </Button>
          {/if}
          {#if alternatives.includes("identity-provider")}
            <Button
              variant="secondary"
              size="lg"
              class="min-w-0 flex-auto"
              disabled={lockedOut}
              onclick={onIdentityProvider}
            >
              <Building size={16} aria-hidden="true" />
              <span class="truncate">Use Your Firm's Identity Provider</span>
            </Button>
          {/if}
        </div>
      </div>
    {/if}
  {/snippet}

</AuthPanel>
