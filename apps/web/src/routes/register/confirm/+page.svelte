<script lang="ts">
  /*
   * Confirm a registration — the screen the emailed token is spent on.
   *
   * IT READS A TOKEN OUT OF THE ADDRESS BAR AND DOES NOT SPEND IT. The field is filled from
   * `?token=`, and confirming stays a deliberate press. A token is single-use, and anything that
   * fetches a URL before a person reads it — a mail client's link preview, a security scanner, a
   * browser prefetch — would burn it and leave the owner staring at a link that says it has already
   * been used. One press costs a second and cannot be spent by a machine that never asked.
   *
   * The confirmation mail carries a link that lands here with the field filled, plus the bare code
   * for a mail client that will not open links. Both paths end at the same deliberate press; the
   * step's reach is declared in $lib/auth/joining-availability.ts under "confirm-registration".
   *
   * WHAT SPENDING THE TOKEN NOW CREATES is the account, the credential the person chose when they
   * registered, AND a session — the confirmation response carries the cookie, because the token only
   * ever travelled by email and spending it proves the mailbox. So the ordinary ending of this screen
   * is not a screen at all: it walks straight into /welcome. Which ending shows is the server's own
   * `next`, never a guess made here: `signedIn`, `signIn` where the account exists but no session
   * came with it, or `checkEmail` for a registration started before passwords were chosen at
   * registration, which still needs its mailed link.
   *
   * The firm is NOT built by the time this answers. Provisioning creates a bucket and mints a key,
   * which is not work an anonymous request does inline, so the route queues it and answers
   * "under way" — and the success screen says that rather than pretending a workspace is waiting.
   */
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import AuthFrame from "$lib/auth/auth-frame.svelte";
  import { confirmRegistration } from "$lib/auth/joining-api.ts";
  import AccountReadyScreen from "$lib/auth/screens/account-ready-screen.svelte";
  import CheckEmailScreen from "$lib/auth/screens/check-email-screen.svelte";
  import ConfirmRegistrationScreen from "$lib/auth/screens/confirm-registration-screen.svelte";
  import type { ConfirmedRegistration } from "$lib/auth/joining-api.ts";
  import {
    CONFIRMATION_REFUSED,
    joiningErrorMessage,
    joiningSupportErrorId,
  } from "../joining-messages.ts";

  let token = $state(page.url.searchParams.get("token") ?? "");
  let pending = $state(false);
  let rejection = $state<string | null>(null);
  let supportErrorId = $state<string | null>(null);
  let confirmedAddress = $state<string | null>(null);
  let confirmedAt = $state(new Date());
  // What the server said the spent token bought, which decides which of three endings this screen
  // shows. Held rather than derived, because the answer arrives once and the screen then stays on it.
  let confirmed = $state<ConfirmedRegistration | null>(null);

  let tokenFieldReference = $state<HTMLInputElement | null>(null);

  $effect(() => {
    if (confirmedAddress === null) tokenFieldReference?.focus();
  });

  async function confirm(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (pending || token.trim() === "") return;
    pending = true;
    rejection = null;
    supportErrorId = null;
    const outcome = await confirmRegistration(fetch, token);
    pending = false;
    if (outcome.kind !== "ok") {
      rejection = joiningErrorMessage(outcome, CONFIRMATION_REFUSED);
      supportErrorId = joiningSupportErrorId(outcome);
      return;
    }
    confirmedAt = new Date();
    confirmed = outcome.value;
    confirmedAddress = outcome.value.email;
    // The session rode in on that response, so there is nothing to show and nowhere to stop: the
    // joining screen is where somebody with an account and no firm belongs. It reads the bootstrap
    // for itself, which is what makes the cookie the only thing that had to arrive here.
    if (outcome.value.next === "signedIn") await goto("/welcome");
  }
</script>

<svelte:head><title>Confirm your registration · Magna Carta</title></svelte:head>

<AuthFrame>
  {#if confirmedAddress === null}
    <ConfirmRegistrationScreen
      bind:token
      bind:tokenFieldReference
      {pending}
      {rejection}
      {supportErrorId}
      onSubmit={confirm}
      back={() => goto("/login")}
    />
  {:else if confirmed?.next === "checkEmail"}
    <!--
      A registration started before passwords were chosen at registration: its account has no
      credential, so the mailed link really is the next step and this screen is still the truthful
      ending for it.
    -->
    <CheckEmailScreen
      address={confirmedAddress}
      instruction={confirmed.status === "provisioning"
        ? "Your workspace is being set up. We've sent a second email with a link to set your password. Open it once your workspace is ready."
        : "We have sent a second email with the link that sets your password. Open it to finish setting up your account."}
      sentAt={confirmedAt}
      remedy="If it has not arrived after a few minutes, use Reset Password from the sign-in screen."
      back={() => goto("/login")}
    />
  {:else}
    <!--
      The account exists and holds the password chosen at registration, but no session came back with
      it — the fallback, not the ordinary ending, which navigated away before rendering anything.
    -->
    <AccountReadyScreen
      address={confirmedAddress}
      pendingFirm={confirmed?.status === "provisioning"}
    />
  {/if}
</AuthFrame>
