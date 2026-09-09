<script lang="ts">
  /*
   * Register — one form, and the entry point the sign-in card's "Register" link opens.
   *
   * IT MAKES A PERSON AND NOTHING ELSE. The three-way role fork that used to live here is gone: it
   * asked a visitor to classify themselves — a client of a firm, somebody who works at one,
   * somebody founding one — before anything about them existed, which is a question about a
   * relationship put to somebody who is not yet a party to one. What firm this person belongs to is
   * settled afterwards, signed in, on the joining screen at /welcome.
   *
   * It lives OUTSIDE the (app) route group, beside /login, because everything here happens before
   * anybody has a session; the auth frame is the only chrome a visitor gets.
   *
   * AN INVITATION CODE IN THE QUERY STRING IS CARRIED FORWARD, not consumed here. Somebody who
   * follows a link holding a code and makes an account first would otherwise have to keep the code
   * in their head across three screens and a mailbox, so it is stashed per-tab and the joining
   * screen opens on redemption with the field filled. Only the CODE travels: the surname and date of
   * birth are the two facts that make a code worth anything, and they are typed once, at the moment
   * of redemption. Somebody who would rather redeem it without making an account first still can —
   * /register/invitation is unchanged and still works.
   *
   * A TAKEN ADDRESS AND A FREE ONE ANSWER IDENTICALLY, and this page must keep it that way. The
   * server sends different MAIL in the two cases — to the address in question, which is a channel
   * the person filling this form does not necessarily control — and returns the same body either
   * way. There is nothing here to branch on, and adding a branch would be inventing the
   * account-existence oracle the route was built to deny.
   */
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import AuthFrame from "$lib/auth/auth-frame.svelte";
  import { startRegistration } from "$lib/auth/joining-api.ts";
  import { MINIMUM_PASSWORD_LENGTH } from "$lib/auth/password-rule.ts";
  import { rememberInvitationCode } from "$lib/auth/pending-invitation.ts";
  import CheckEmailScreen from "$lib/auth/screens/check-email-screen.svelte";
  import RegisterAccountScreen from "$lib/auth/screens/register-account-screen.svelte";
  import {
    REGISTRATION_REFUSED,
    joiningErrorMessage,
    joiningSupportErrorId,
  } from "./joining-messages.ts";

  let step = $state<"details" | "sent">("details");
  let firstName = $state("");
  let lastName = $state("");
  let email = $state("");
  let password = $state("");
  let agreedToTerms = $state(false);
  let agreedToPrivacy = $state(false);
  let pending = $state(false);
  let rejection = $state<string | null>(null);
  let supportErrorId = $state<string | null>(null);
  let sentAt = $state(new Date());

  let firstNameFieldReference = $state<HTMLInputElement | null>(null);

  // The form opens with focus in its first field, so the keyboard never has to catch up.
  $effect(() => {
    if (step === "details") firstNameFieldReference?.focus();
  });

  // Stash a code the visitor arrived with, once, before anything else can navigate.
  $effect(() => {
    rememberInvitationCode(page.url.searchParams.get("invitation"));
  });

  async function register(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (pending) return;
    pending = true;
    rejection = null;
    supportErrorId = null;
    const outcome = await startRegistration(fetch, {
      // Both the line and its parts. The line is what a screen prints; the parts are what the
      // account keeps, so nobody has to have their name split back apart later — a split that
      // cannot be done without guessing at somebody's own name.
      name: `${firstName.trim()} ${lastName.trim()}`,
      givenName: firstName.trim(),
      familyName: lastName.trim(),
      email: email.trim(),
      // NOT trimmed. Leading and trailing spaces are part of a password — trimming one here would
      // hash something the person never typed and lock them out of their own account at sign-in.
      password,
    });
    pending = false;
    if (outcome.kind !== "ok") {
      rejection = joiningErrorMessage(outcome, REGISTRATION_REFUSED);
      supportErrorId = joiningSupportErrorId(outcome);
      return;
    }
    sentAt = new Date();
    step = "sent";
  }
</script>

<svelte:head><title>Register · Magna Carta</title></svelte:head>

<AuthFrame>
  {#if step === "details"}
    <RegisterAccountScreen
      bind:firstName
      bind:lastName
      bind:email
      bind:password
      minimumPasswordLength={MINIMUM_PASSWORD_LENGTH}
      bind:agreedToTerms
      bind:agreedToPrivacy
      bind:firstNameFieldReference
      {pending}
      {rejection}
      {supportErrorId}
      onSubmit={register}
      back={() => goto("/login")}
    />
  {:else}
    <CheckEmailScreen
      address={email.trim()}
      instruction="Open the link we sent, or type the confirmation code from that email. Your account is created once that is done, with the password you chose."
      {sentAt}
      remedy="If it does not arrive, check the spam folder, then register again — a second registration replaces the first, and the newest code is the one that works."
      onEnterCode={() => goto("/register/confirm")}
      enterCodeLabel="Enter the Confirmation Code"
    />
  {/if}
</AuthFrame>
