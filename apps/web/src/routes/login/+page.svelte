<script lang="ts">
  /*
   * Sign in — the firm's front door, and the only surface a visitor can reach without a session
   * (it lives OUTSIDE the (app) route group, which redirects unauthenticated visitors here).
   *
   * THREE STEPS, ONE URL. Identify (email) → password → the authenticator code, all held in
   * component state. The URL never changes, deliberately: a /two-factor path would announce to
   * anyone watching the address bar — or reading a history list — which accounts carry a second
   * factor and which step of the challenge failed. It also means a step is never bookmarkable or
   * reloadable into a half-authenticated state; a refresh returns to the identify step, which is
   * correct.
   *
   * The identify step is a seam, not decoration: Firm and Client users come through the same door,
   * and the address is what will choose which credential the next step asks for. Today it does the
   * simple thing — carries the email forward.
   *
   * The password step offers exactly one way in, because the server supports exactly one: no
   * alternative-method row appears until there is a method behind it, since a control that cannot
   * work is worse than an absent one.
   *
   * Every call goes through the Better Auth client ($lib/auth/client.ts). Sign-in either returns a
   * session or reports that a second factor is owed (`twoFactorRedirect`), and the code call
   * completes the challenge. Failure wording is a security decision and lives in
   * ./sign-in-messages.ts; every number the copy states comes from $lib/auth/two-factor-policy.ts.
   */
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import Badge from "@magna-carta/design-system/badge";
  import Button from "@magna-carta/design-system/button";
  import Checkbox from "@magna-carta/design-system/checkbox";
  import Input from "@magna-carta/design-system/input";
  import Label from "@magna-carta/design-system/label";
  import PasswordInput from "@magna-carta/design-system/password-input";
  import VerificationCodeInput from "@magna-carta/design-system/verification-code-input";
  import * as Alert from "@magna-carta/design-system/alert";
  import * as Card from "@magna-carta/design-system/card";
  import * as Masthead from "@magna-carta/design-system/masthead";
  import AuthFrame from "$lib/auth/auth-frame.svelte";
  import { authClient } from "$lib/auth/client.ts";
  import {
    TRUSTED_DEVICE_DAYS,
    VERIFICATION_CODE_LENGTH,
  } from "$lib/auth/two-factor-policy.ts";
  import { safeReturnPath } from "./return-path.ts";
  import {
    CREDENTIALS_REJECTED,
    VERIFICATION_CODE_REJECTED,
    signInErrorMessage,
  } from "./sign-in-messages.ts";

  /*
   * The quiet inline-link register: a text link that carries no control chrome, for the side doors
   * beside a control (reset, recovery, stepping back). Written as one literal so the anchors and
   * the buttons-that-read-as-links cannot drift apart — and so Tailwind's scanner still sees every
   * class, which it would not if the string were assembled.
   */
  const QUIET_LINK =
    "rounded-sm text-sm text-text-link hover:underline focus-visible:outline-2 focus-visible:outline-focus-ring focus-visible:outline-offset-2";

  let step = $state<"identify" | "password" | "verification">("identify");
  let email = $state("");
  let password = $state("");
  let keepSignedIn = $state(true);
  let verificationCode = $state("");
  let trustDevice = $state(false);
  let pending = $state(false);
  let errorMessage = $state<string | null>(null);
  /*
   * Which field the live error is about, so aria-invalid lands on the control the visitor has to
   * fix. A credential rejection marks BOTH halves of the credential — the message says to check
   * both, and refusing to say which one was wrong is the whole point — so the flag survives a step
   * back to the email field and marks it too.
   */
  let credentialsRejected = $state(false);
  let verificationCodeRejected = $state(false);

  let emailFieldReference = $state<HTMLInputElement | null>(null);
  let passwordFieldReference = $state<HTMLInputElement | null>(null);
  let verificationCodeFieldReference = $state<HTMLInputElement | null>(null);

  const trimmedEmail = $derived(email.trim());
  const canContinue = $derived(!pending && trimmedEmail !== "");
  const canSignIn = $derived(!pending && password !== "");
  const canVerify = $derived(!pending && verificationCode.length === VERIFICATION_CODE_LENGTH);

  // Each step opens with focus in its own field, so the keyboard never has to catch up with the form.
  $effect(() => {
    if (step === "identify") emailFieldReference?.focus();
    else if (step === "password") passwordFieldReference?.focus();
    else verificationCodeFieldReference?.focus();
  });

  /**
   * Whether a successful sign-in response is a second-factor challenge rather than a session:
   * Better Auth answers the same endpoint with either shape, so the caller has to look.
   */
  function requiresSecondFactor(data: unknown): boolean {
    return (
      typeof data === "object" &&
      data !== null &&
      "twoFactorRedirect" in data &&
      data.twoFactorRedirect === true
    );
  }

  async function enterApplication(): Promise<void> {
    await goto(safeReturnPath(page.url.searchParams.get("next")));
  }

  function identify(event: SubmitEvent): void {
    event.preventDefault();
    if (!canContinue) return;
    errorMessage = null;
    credentialsRejected = false;
    step = "password";
  }

  function returnToIdentify(): void {
    step = "identify";
    password = "";
  }

  function abandonChallenge(): void {
    step = "identify";
    password = "";
    verificationCode = "";
    trustDevice = false;
    errorMessage = null;
    credentialsRejected = false;
    verificationCodeRejected = false;
  }

  async function signIn(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (!canSignIn) return;
    pending = true;
    errorMessage = null;
    credentialsRejected = false;
    let outcome: "session" | "challenge" | "failed" = "failed";
    // undefined means no response at all — offline, or a frontend-only dev server with no Worker.
    let status: number | undefined;
    try {
      const { data, error } = await authClient.signIn.email({
        email: trimmedEmail,
        password,
        rememberMe: keepSignedIn,
      });
      if (error) status = error.status;
      else outcome = requiresSecondFactor(data) ? "challenge" : "session";
    } catch {
      status = undefined;
    }
    pending = false;
    if (outcome === "challenge") {
      // The password has done its work; hold nothing but the challenge while the code is entered.
      password = "";
      verificationCode = "";
      step = "verification";
      return;
    }
    if (outcome === "failed") {
      errorMessage = signInErrorMessage(status, CREDENTIALS_REJECTED);
      credentialsRejected = errorMessage === CREDENTIALS_REJECTED;
      return;
    }
    await enterApplication();
  }

  async function verify(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (!canVerify) return;
    pending = true;
    errorMessage = null;
    verificationCodeRejected = false;
    let verified = false;
    let status: number | undefined;
    try {
      const { error } = await authClient.twoFactor.verifyTotp({
        code: verificationCode,
        trustDevice,
      });
      if (error) status = error.status;
      else verified = true;
    } catch {
      status = undefined;
    }
    pending = false;
    if (!verified) {
      errorMessage = signInErrorMessage(status, VERIFICATION_CODE_REJECTED);
      verificationCodeRejected = errorMessage === VERIFICATION_CODE_REJECTED;
      verificationCode = "";
      return;
    }
    await enterApplication();
  }
</script>

<svelte:head><title>Sign in · Magna Carta</title></svelte:head>

<AuthFrame>
  <Card.Root class="relative w-full max-w-sm bg-surface-default shadow-elevation-2">
    <Card.Content class="flex flex-col gap-24">
      <Masthead.Heading>
        {#if step === "verification"}
          <div><Badge variant="accent">Second step</Badge></div>
        {/if}
        <Masthead.Title class="text-2xl">
          {step === "verification" ? "Enter your code" : "Sign in"}
        </Masthead.Title>
        {#if step === "password"}
          <Masthead.Meta>Signing in as {trimmedEmail}</Masthead.Meta>
        {:else if step === "verification"}
          <Masthead.Meta>
            Open your authenticator app and enter the {VERIFICATION_CODE_LENGTH}-digit code it shows.
          </Masthead.Meta>
        {/if}
      </Masthead.Heading>

      {#if errorMessage}
        <Alert.Root variant="danger">
          <Alert.Description>{errorMessage}</Alert.Description>
        </Alert.Root>
      {/if}

      {#if step === "identify"}
        <form onsubmit={identify} class="flex flex-col gap-16">
          <div class="flex flex-col gap-8">
            <Label for="login-email">Email</Label>
            <Input
              bind:ref={emailFieldReference}
              id="login-email"
              name="email"
              type="email"
              size="lg"
              bind:value={email}
              autocomplete="username"
              placeholder="you@firm.example"
              spellcheck={false}
              aria-invalid={credentialsRejected ? "true" : undefined}
              required
            />
          </div>
          <Button type="submit" variant="primary" size="lg" class="w-full" disabled={!canContinue}>
            Continue
          </Button>
        </form>
      {:else if step === "password"}
        <form onsubmit={signIn} class="flex flex-col gap-16">
          <div class="flex flex-col gap-8">
            <div class="flex items-baseline justify-between gap-8">
              <Label for="login-password">Password</Label>
              <a href="/login/reset-password" class={QUIET_LINK}>Forgot password?</a>
            </div>
            <PasswordInput
              bind:ref={passwordFieldReference}
              id="login-password"
              name="password"
              size="lg"
              bind:value={password}
              autocomplete="current-password"
              aria-invalid={credentialsRejected ? "true" : undefined}
              disabled={pending}
              required
            />
          </div>
          <div class="flex items-center gap-8">
            <Checkbox id="login-keep-signed-in" bind:checked={keepSignedIn} disabled={pending} />
            <Label for="login-keep-signed-in">Keep me signed in on this device</Label>
          </div>
          <Button type="submit" variant="primary" size="lg" class="w-full" disabled={!canSignIn}>
            {pending ? "Signing in…" : "Sign in"}
          </Button>
          <button type="button" class={`self-start ${QUIET_LINK}`} onclick={returnToIdentify}>
            Use a different email
          </button>
        </form>
      {:else}
        <form onsubmit={verify} class="flex flex-col gap-16">
          <div class="flex flex-col gap-8">
            <Label for="login-verification-code">Authentication code</Label>
            <VerificationCodeInput
              bind:inputRef={verificationCodeFieldReference}
              inputId="login-verification-code"
              bind:value={verificationCode}
              length={VERIFICATION_CODE_LENGTH}
              aria-invalid={verificationCodeRejected ? "true" : undefined}
              disabled={pending}
            />
          </div>
          <div class="flex items-center gap-8">
            <Checkbox id="login-trust-device" bind:checked={trustDevice} disabled={pending} />
            <Label for="login-trust-device">Trust this device for {TRUSTED_DEVICE_DAYS} days</Label>
          </div>
          <Button type="submit" variant="primary" size="lg" class="w-full" disabled={!canVerify}>
            {pending ? "Verifying…" : "Verify"}
          </Button>
          <div class="flex flex-wrap items-center justify-between gap-8">
            <a href="/login/recovery-code" class={QUIET_LINK}>Use a recovery code</a>
            <button type="button" class={QUIET_LINK} onclick={abandonChallenge}>
              Back to sign in
            </button>
          </div>
        </form>
      {/if}
    </Card.Content>

    <Card.Footer class="flex-col items-start gap-4 text-xs text-text-muted">
      <p>Access is provisioned by your firm's administrator.</p>
      <p>No self-service registration.</p>
    </Card.Footer>
  </Card.Root>
</AuthFrame>
