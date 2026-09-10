<script lang="ts">
  /*
   * Sign in — the firm's front door, and the only surface a visitor can reach without a session
   * (it lives OUTSIDE the (app) route group, which redirects unauthenticated visitors here).
   *
   * ONE URL, EVERY STEP. The credential, the second factor and the recovery code are held in
   * component state and the address bar never changes. A /two-factor path would announce to anyone
   * watching the address bar — or reading a history list — which accounts carry a second factor and
   * which step of the challenge failed. It also means no step is bookmarkable or reloadable into a
   * half-authenticated state; a refresh returns to the credential, which is correct.
   *
   * The credential is ONE step: email and password together. A separate identify step existed so
   * the server could decide what to show next, but anything it could reveal — a firm name, "this
   * account signs in elsewhere", "no such account" — is the enumeration oracle the confidentiality
   * rule forbids, so its second screen could only ever show the same neutral form.
   *
   * Every screen here is a component in $lib/auth/screens/, rendered in every state it can take on
   * the developer console's sign-in screen-state page. That is deliberate: a state that is awkward
   * to reach in the product (a lockout, a rejected recovery code) is otherwise only ever seen by
   * the person it happened to.
   *
   * The Register link beside the address field DOES go somewhere: the three-way role fork at
 * /register, and from there the founding-a-firm form or invitation redemption. Those screens are in
 * $lib/auth/screens/ beside these ones, and $lib/auth/joining-availability.ts records how far each
 * of their steps actually carries.
 *
 * NO ALTERNATIVE CREDENTIAL IS OFFERED, because the server supports exactly one. Passkeys,
   * one-time links and firm identity providers are designed and rendered, but their plugins are not
   * mounted — $lib/auth/unbuilt-capabilities.ts is the register, and a control with no route behind
   * it is worse than an absent one.
   *
   * The remaining-attempts line and the lockout countdown ARE wired, because the server now
   * publishes both on every credential answer. They stay absent when it does not (an older Worker,
   * or a frontend-only dev server): a count the server has not agreed to is worse than no count,
   * which is the whole reason the ladder was left unwired until now.
   *
   * Every call goes through the Better Auth client ($lib/auth/client.ts). Failure wording is a
   * security decision and lives in ./sign-in-messages.ts; every number the copy states comes from
   * $lib/auth/two-factor-policy.ts.
   */
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import AuthFrame from "$lib/auth/auth-frame.svelte";
  import { attemptBudget, authClient } from "$lib/auth/client.ts";
  import RecoveryCodeScreen from "$lib/auth/screens/recovery-code-screen.svelte";
  import SignInScreen from "$lib/auth/screens/sign-in-screen.svelte";
  import VerificationCodeScreen from "$lib/auth/screens/verification-code-screen.svelte";
  import { safeReturnPath } from "./return-path.ts";
  import {
    CREDENTIALS_REJECTED,
    RECOVERY_CODE_REJECTED,
    VERIFICATION_CODE_REJECTED,
    signInErrorMessage,
  } from "./sign-in-messages.ts";

  let step = $state<"credential" | "verification" | "recovery">("credential");
  let email = $state("");
  let password = $state("");
  let rememberMe = $state(true);
  let verificationCode = $state("");
  let recoveryCode = $state("");
  let trustDevice = $state(false);
  let pending = $state(false);

  /*
   * The shared ladder, as the server last reported it. One value for all three steps because it is
   * one budget — the password, the code and the recovery code spend the same allowance, so a count
   * held per screen would let a visitor be one failure from a lockout with no screen saying so.
   */
  let budget = $state<ReturnType<typeof attemptBudget>>(null);

  /*
   * One rejection at a time, and it belongs to the step that produced it. Carrying a credential
   * rejection into the code step would leave a sentence about a password on a screen that has
   * already accepted one.
   */
  let credentialRejection = $state<string | null>(null);
  let verificationRejected = $state(false);
  let recoveryRejection = $state<string | null>(null);

  let emailFieldReference = $state<HTMLInputElement | null>(null);
  let verificationCodeFieldReference = $state<HTMLInputElement | null>(null);
  let recoveryCodeFieldReference = $state<HTMLInputElement | null>(null);

  // Each step opens with focus in its own field, so the keyboard never has to catch up with the form.
  $effect(() => {
    if (step === "credential") emailFieldReference?.focus();
    else if (step === "verification") verificationCodeFieldReference?.focus();
    else recoveryCodeFieldReference?.focus();
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

  function abandonChallenge(): void {
    step = "credential";
    password = "";
    verificationCode = "";
    recoveryCode = "";
    trustDevice = false;
    credentialRejection = null;
    verificationRejected = false;
    recoveryRejection = null;
    budget = null;
  }

  async function signIn(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (pending || email.trim() === "" || password === "") return;
    pending = true;
    credentialRejection = null;
    let outcome: "session" | "challenge" | "failed" = "failed";
    // undefined means no response at all — offline, or a frontend-only dev server with no Worker.
    let status: number | undefined;
    try {
      const { data, error } = await authClient.signIn.email({
        email: email.trim(),
        password,
        rememberMe,
      });
      if (error) status = error.status;
      else outcome = requiresSecondFactor(data) ? "challenge" : "session";
    } catch {
      status = undefined;
    }
    pending = false;
    budget = attemptBudget();
    if (outcome === "challenge") {
      // The password has done its work; hold nothing but the challenge while the code is entered.
      password = "";
      verificationCode = "";
      step = "verification";
      return;
    }
    if (outcome === "failed") {
      credentialRejection = signInErrorMessage(status, CREDENTIALS_REJECTED);
      return;
    }
    await enterApplication();
  }

  async function verify(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (pending) return;
    pending = true;
    verificationRejected = false;
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
    budget = attemptBudget();
    if (!verified) {
      // The channel-specific sentence is the screen's own; only a non-rejection needs saying here.
      const message = signInErrorMessage(status, VERIFICATION_CODE_REJECTED);
      verificationRejected = true;
      if (message !== VERIFICATION_CODE_REJECTED) credentialRejection = message;
      verificationCode = "";
      return;
    }
    await enterApplication();
  }

  async function verifyRecoveryCode(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (pending || recoveryCode.trim() === "") return;
    pending = true;
    recoveryRejection = null;
    let verified = false;
    let status: number | undefined;
    try {
      const { error } = await authClient.twoFactor.verifyBackupCode({
        code: recoveryCode.trim(),
        trustDevice,
      });
      if (error) status = error.status;
      else verified = true;
    } catch {
      status = undefined;
    }
    pending = false;
    budget = attemptBudget();
    if (!verified) {
      recoveryRejection = signInErrorMessage(status, RECOVERY_CODE_REJECTED);
      recoveryCode = "";
      return;
    }
    await enterApplication();
  }
</script>

<svelte:head><title>Sign in · Magna Carta</title></svelte:head>

<AuthFrame>
  {#if step === "credential"}
    <SignInScreen
      bind:email
      bind:password
      bind:rememberMe
      bind:emailFieldReference
      {pending}
      rejection={credentialRejection}
      attemptsRemaining={budget?.remaining}
      lockoutSeconds={budget?.lockoutSecondsRemaining ?? undefined}
      onSubmit={signIn}
      onForgotPassword={() => goto("/login/reset-password")}
      onRegister={() => goto("/register")}
    />
  {:else if step === "verification"}
    <VerificationCodeScreen
      channel="authenticator"
      bind:code={verificationCode}
      bind:trustDevice
      bind:codeFieldReference={verificationCodeFieldReference}
      {pending}
      rejected={verificationRejected}
      attemptsRemaining={budget?.remaining}
      lockoutSeconds={budget?.lockoutSecondsRemaining ?? undefined}
      onSubmit={verify}
      onRecoveryCode={() => {
        step = "recovery";
        verificationRejected = false;
      }}
      back={abandonChallenge}
    />
  {:else}
    <RecoveryCodeScreen
      bind:recoveryCode
      bind:codeFieldReference={recoveryCodeFieldReference}
      {pending}
      rejection={recoveryRejection}
      lockoutSeconds={budget?.lockoutSecondsRemaining ?? undefined}
      onSubmit={verifyRecoveryCode}
      back={() => {
        step = "verification";
        recoveryRejection = null;
      }}
    />
  {/if}
</AuthFrame>
