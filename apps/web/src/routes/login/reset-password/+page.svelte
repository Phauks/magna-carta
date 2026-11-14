<script lang="ts">
  /*
   * Reset Password — the destination of the sign-in screen's "Forgot Password" link AND of the
   * emailed reset link, which carries `?token=` (built in apps/api-worker/src/password-reset-link.ts).
   * This is also how an account becomes usable at all: a firm owner fresh from registration and an
   * invited member both set their first password here, and completing the reset marks the address
   * verified.
   *
   * The token is NOT spent on load. It waits in the form and is spent when the person submits a new
   * password — a reset token is single-use, and a link opened by a mail client's preview or a
   * security scanner must cost nothing.
   *
   * Asking for a link never branches on whether the address has an account: the server answers
   * identically either way, and the sent screen's "if that address has an account" conditional is
   * the design rather than hedging — see ./reset-password-messages.ts.
   */
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import AuthFrame from "$lib/auth/auth-frame.svelte";
  import { authClient } from "$lib/auth/client.ts";
  import CheckEmailScreen from "$lib/auth/screens/check-email-screen.svelte";
  import ResetPasswordRequestScreen from "$lib/auth/screens/reset-password-request-screen.svelte";
  import ResetPasswordSetScreen from "$lib/auth/screens/reset-password-set-screen.svelte";
  import {
    MINIMUM_PASSWORD_LENGTH,
    requestResetErrorMessage,
    resetPasswordErrorMessage,
  } from "./reset-password-messages.ts";

  let token = $state(page.url.searchParams.get("token") ?? "");
  let step = $state<"request" | "sent" | "set">(
    (page.url.searchParams.get("token") ?? "") === "" ? "request" : "set",
  );
  let email = $state("");
  let newPassword = $state("");
  let pending = $state(false);
  let completed = $state(false);
  let requestRejection = $state<string | null>(null);
  let setRejection = $state<string | null>(null);
  let sentAt = $state(new Date());

  let emailFieldReference = $state<HTMLInputElement | null>(null);
  let passwordFieldReference = $state<HTMLInputElement | null>(null);

  // Each step opens with focus in its own first field, so the keyboard never has to catch up.
  $effect(() => {
    if (step === "request") emailFieldReference?.focus();
    else if (step === "set" && !completed) passwordFieldReference?.focus();
  });

  async function requestLink(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (pending || email.trim() === "") return;
    pending = true;
    requestRejection = null;
    let sent = false;
    let status: number | undefined;
    try {
      const { error } = await authClient.requestPasswordReset({ email: email.trim() });
      if (error) status = error.status;
      else sent = true;
    } catch {
      status = undefined;
    }
    pending = false;
    if (!sent) {
      requestRejection = requestResetErrorMessage(status);
      return;
    }
    sentAt = new Date();
    step = "sent";
  }

  async function setPassword(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (pending || newPassword.length < MINIMUM_PASSWORD_LENGTH) return;
    pending = true;
    setRejection = null;
    let succeeded = false;
    let status: number | undefined;
    let code: string | undefined;
    try {
      const { error } = await authClient.resetPassword({
        newPassword,
        token: token.trim(),
      });
      if (error) {
        status = error.status;
        code = error.code;
      } else {
        succeeded = true;
      }
    } catch {
      status = undefined;
    }
    pending = false;
    if (!succeeded) {
      setRejection = resetPasswordErrorMessage(status, code);
      return;
    }
    newPassword = "";
    completed = true;
  }

  function backToRequest(): void {
    // An expired link's remedy is a fresh one; the token stays in the address bar but a new request
    // supersedes it, so clearing local state is all that is needed.
    step = "request";
    setRejection = null;
  }
</script>

<svelte:head><title>Reset password · Magna Carta</title></svelte:head>

<AuthFrame>
  {#if step === "request"}
    <ResetPasswordRequestScreen
      bind:email
      bind:emailFieldReference
      {pending}
      rejection={requestRejection}
      onSubmit={requestLink}
      back={() => goto("/login")}
    />
  {:else if step === "sent"}
    <CheckEmailScreen
      address={email.trim()}
      instruction="If that address has an account, a reset link is on its way. Open it and choose a new password."
      {sentAt}
      remedy="If it doesn't arrive, check your spam folder and make sure this is the address you sign in with."
      back={() => goto("/login")}
    />
  {:else}
    <ResetPasswordSetScreen
      bind:newPassword
      bind:passwordFieldReference
      minimumLength={MINIMUM_PASSWORD_LENGTH}
      {pending}
      {completed}
      rejection={setRejection}
      onSubmit={setPassword}
      onSignIn={() => goto("/login")}
      onRequestNewLink={backToRequest}
    />
  {/if}
</AuthFrame>
