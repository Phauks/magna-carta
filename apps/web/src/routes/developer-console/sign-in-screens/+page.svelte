<script lang="ts">
  /*
   * Sign-in screen states — every signed-out screen, in every state, on one scrollable surface.
   *
   * This page is the REVIEW SURFACE for the sign-in design. It exists so the design can be looked
   * at without a standalone mockup file: a mockup drifts from the product the moment either one
   * changes, and it is styled by hand rather than by the components that actually ship. Everything
   * below renders the real screen components through the real design system, so what a reviewer
   * sees is what a visitor gets — including the states that are awkward to reach on purpose (a
   * lockout, a cancelled passkey prompt, a fifth failed attempt).
   *
   * Every specimen says whether the product can reach it today. Several screens are designed
   * against a capability the Worker has no route for, and those are marked rather than quietly
   * shown as working; the register is $lib/auth/unbuilt-capabilities.ts and it opens the page.
   *
   * Dev builds only, like the developer console itself — the panel and everything it pulls in
   * tree-shake out of a production build behind the import.meta.env.DEV gate.
   */
  import * as Alert from "@magna-carta/design-system/alert";
  import Badge from "@magna-carta/design-system/badge";
  import { UNBUILT_CAPABILITIES, unbuiltCapability } from "$lib/auth/unbuilt-capabilities.ts";
  import { maskedPhoneNumber } from "$lib/auth/code-channels.ts";
  import { ATTEMPT_LIMIT } from "$lib/auth/attempt-ladder.ts";
  import RecoveryCodeScreen from "$lib/auth/screens/recovery-code-screen.svelte";
  import SignInScreen from "$lib/auth/screens/sign-in-screen.svelte";
  import TwoFactorMethodScreen from "$lib/auth/screens/two-factor-method-screen.svelte";
  import type { SecondFactorOption } from "$lib/auth/screens/two-factor-method-screen.svelte";
  import VerificationCodeScreen from "$lib/auth/screens/verification-code-screen.svelte";
  import WorkspaceScreen from "$lib/auth/screens/workspace-screen.svelte";
  import type { WorkspaceOption } from "$lib/auth/screens/workspace-screen.svelte";
  import ScreenSpecimen from "./screen-specimen.svelte";

  /*
   * One draft bag for every editable field on the page. A specimen has to be typeable — a reviewer
   * checks a code field by typing into it — but twenty screens would otherwise need twenty
   * declarations, so each field binds through a key with the function form of bind:.
   */
  const draft = $state<Record<string, string>>({});
  function field(key: string): string {
    return draft[key] ?? "";
  }

  const REJECTION = "That email and password combination doesn't match our records.";
  const PHONE = maskedPhoneNumber("+1", "1284");

  const swallow = (event: SubmitEvent): void => event.preventDefault();
  const noop = (): void => {};

  const SECOND_FACTORS: readonly SecondFactorOption[] = [
    { id: "authenticator", channel: "authenticator", label: "Authenticator app code" },
    { id: "text-1284", channel: "text", label: `Text a code to ${PHONE}` },
    { id: "call-1284", channel: "call", label: `Call ${PHONE} with a code` },
    { id: "email", channel: "email", label: "Email a code" },
  ];

  const WORKSPACES: readonly WorkspaceOption[] = [
    {
      id: "goldsmith",
      name: "Goldsmith and Associates",
      detail: "Las Vegas, Nevada · Last opened August 10, 2026",
      relationship: "Firm",
    },
    {
      id: "carta",
      name: "Carta Family Law",
      detail: "Reno, Nevada · Last opened August 4, 2026",
      relationship: "Client",
    },
    {
      id: "nye",
      name: "Nye Estate Group",
      detail: "Pahrump, Nevada · Last opened May 19, 2026",
      relationship: "Client",
    },
  ];

  const PASSKEY_GAP = unbuiltCapability("passkey").missing;
  const CHOICE_GAP = unbuiltCapability("second-factor-choice").missing;
  const WORKSPACE_GAP = unbuiltCapability("workspace-selection").missing;
  const VERIFICATION_GAP = unbuiltCapability("human-verification").missing;
  const PROVIDER_GAP = unbuiltCapability("identity-provider").missing;

  let workspaceChoice = $state<string | null>("goldsmith");
</script>

<svelte:head><title>Sign-in screen states · Magna Carta</title></svelte:head>

{#if import.meta.env.DEV}
  <div class="flex min-h-screen flex-col gap-32 bg-surface-default p-24 text-text-default">
    <header class="flex max-w-prose flex-col gap-8">
      <p
        class="text-xs font-semibold text-text-muted uppercase"
        style="letter-spacing: var(--mc-tracking-caps)"
      >
        Developer console
      </p>
      <h1 class="text-2xl font-semibold">Sign-in screen states</h1>
      <p class="text-sm text-text-muted">
        Every signed-out screen and every state it can be in, rendered from the real components. Use
        this instead of a standalone mockup: a mockup is styled by hand and drifts the moment either
        side changes, while everything here is the shipping design system.
      </p>
      <p class="text-sm text-text-muted">
        Each specimen says whether the product can reach it. A state marked
        <Badge variant="warning">No server route</Badge>
        is designed and rendered but has nothing behind it, and the live route does not offer it.
      </p>
    </header>

    <section class="flex max-w-prose flex-col gap-12">
      <h2 class="text-lg font-semibold">What the server cannot do yet</h2>
      <p class="text-sm text-text-muted">
        Read against the Worker's auth surface and the browser client. Each entry is the reason a
        control below is absent from the live sign-in route rather than present and inert.
      </p>
      <ul class="flex flex-col gap-8">
        {#each UNBUILT_CAPABILITIES as capability (capability.id)}
          <li class="rounded-md border border-border-default bg-surface-raised p-12">
            <p class="text-sm font-semibold">{capability.label}</p>
            <p class="text-xs text-text-muted">{capability.missing}</p>
          </li>
        {/each}
      </ul>
    </section>

    <section class="flex flex-col gap-24">
      <div class="flex max-w-prose flex-col gap-8">
        <h2 class="text-lg font-semibold">Sign In</h2>
        <p class="text-sm text-text-muted">
          Email and password on one screen. The two-step split could never show anything different
          on its second step without confirming whether an address belongs to the firm, so it bought
          nothing and cost a round trip.
        </p>
      </div>

      <ScreenSpecimen
        name="Default"
        note="What ships today: the credential, and no alternative row, because no alternative has a route behind it."
      >
        <SignInScreen
          bind:email={() => field("a-email"), (value) => (draft["a-email"] = value)}
          bind:password={() => field("a-password"), (value) => (draft["a-password"] = value)}
          onSubmit={swallow}
          onForgotPassword={noop}
        />
      </ScreenSpecimen>

      <ScreenSpecimen
        name="Every alternative credential offered"
        note="The designed screen. Each alternative renders only where the caller can complete it, so today the live route lists none of these."
        unbuilt={PASSKEY_GAP}
      >
        <SignInScreen
          alternatives={["passkey", "one-time-link", "identity-provider"]}
          onSubmit={swallow}
          onForgotPassword={noop}
          onRegister={noop}
          onPasskey={noop}
          onOneTimeLink={noop}
          onIdentityProvider={noop}
        />
      </ScreenSpecimen>

      <ScreenSpecimen
        name="Human verification challenged"
        note="The one thing allowed above the primary button, because a human check is the last step before the act it guards."
        unbuilt={VERIFICATION_GAP}
      >
        <SignInScreen humanVerificationChallenged onSubmit={swallow} onForgotPassword={noop} />
      </ScreenSpecimen>

      <ScreenSpecimen
        name="Signing in"
        note="The submit is pending. Both fields hold their values; only the controls go inert."
      >
        <SignInScreen pending onSubmit={swallow} onForgotPassword={noop} />
      </ScreenSpecimen>

      <ScreenSpecimen
        name="Credentials rejected"
        note="One sentence for every failure mode. It never says which half was wrong, because telling them apart turns the form into an account-enumeration oracle."
      >
        <SignInScreen rejection={REJECTION} onSubmit={swallow} onForgotPassword={noop} />
      </ScreenSpecimen>

      <ScreenSpecimen
        name="Rejected, with attempts remaining"
        note={`The shared ladder allows ${ATTEMPT_LIMIT} failures across the password, the code and the recovery code.`}
      >
        <SignInScreen
          rejection={REJECTION}
          attemptsRemaining={3}
          onSubmit={swallow}
          onForgotPassword={noop}
        />
      </ScreenSpecimen>

      <ScreenSpecimen
        name="Last attempt"
        note="The wording narrows as the count drops; a constant message trains people to ignore it."
      >
        <SignInScreen
          rejection={REJECTION}
          attemptsRemaining={1}
          onSubmit={swallow}
          onForgotPassword={noop}
        />
      </ScreenSpecimen>

      <ScreenSpecimen
        name="Locked out"
        note="The lockout REPLACES the rejection: once the budget is spent, whether the last attempt was wrong stopped mattering. The countdown and the way out sit in one element."
      >
        <SignInScreen
          rejection={REJECTION}
          lockoutSeconds={298}
          onSubmit={swallow}
          onForgotPassword={noop}
        />
      </ScreenSpecimen>

      <ScreenSpecimen
        name="Passkey prompt open"
        note="The dialog is the browser's own native sheet, never ours. The page needs only to report the ceremony it handed off."
        unbuilt={PASSKEY_GAP}
      >
        <SignInScreen
          alternatives={["passkey"]}
          passkeyPhase="asked"
          onSubmit={swallow}
          onPasskey={noop}
          onForgotPassword={noop}
        />
      </ScreenSpecimen>

      <ScreenSpecimen
        name="Passkey prompt cancelled"
        note="The failure states what did not happen. The third step is dropped rather than struck through, because the ceremony never reached it."
        unbuilt={PASSKEY_GAP}
      >
        <SignInScreen
          alternatives={["passkey"]}
          passkeyPhase="cancelled"
          onSubmit={swallow}
          onPasskey={noop}
          onForgotPassword={noop}
        />
      </ScreenSpecimen>

      <ScreenSpecimen
        name="Address belongs to an identity provider"
        note="Resolved ON SUBMIT, never on blur. The password field stays visible but inert: removing it would slide the button up under the cursor."
        unbuilt={PROVIDER_GAP}
      >
        <SignInScreen
          identityProvider="Microsoft"
          password="not-checked"
          onSubmit={swallow}
          onIdentityProvider={noop}
          onForgotPassword={noop}
        />
      </ScreenSpecimen>
    </section>

    <section class="flex flex-col gap-24">
      <div class="flex max-w-prose flex-col gap-8">
        <h2 class="text-lg font-semibold">Verify It's You</h2>
        <p class="text-sm text-text-muted">
          Rendered only from channels that are enrolled, capable and firm-permitted. Someone with a
          single authenticator never sees this screen — they go straight to the code.
        </p>
      </div>

      <ScreenSpecimen
        name="Several channels enrolled"
        note="One row per capable channel per verified number, each named by its masked digits."
        unbuilt={CHOICE_GAP}
      >
        <TwoFactorMethodScreen
          options={SECOND_FACTORS}
          onChoose={noop}
          onRecoveryCode={noop}
          back={noop}
        />
      </ScreenSpecimen>

      <ScreenSpecimen
        name="Nothing enrolled"
        note="No rows to show, so the screen says what the remaining route is instead of showing an empty list."
        unbuilt={CHOICE_GAP}
      >
        <TwoFactorMethodScreen options={[]} onChoose={noop} back={noop} />
      </ScreenSpecimen>
    </section>

    <section class="flex flex-col gap-24">
      <div class="flex max-w-prose flex-col gap-8">
        <h2 class="text-lg font-semibold">Enter Your Two-Factor Code</h2>
        <p class="text-sm text-text-muted">
          The channel decides the field, not just the wording: six digits from an authenticator or a
          call, eight characters from a code this platform generated and sent.
        </p>
      </div>

      <ScreenSpecimen
        name="Authenticator"
        note="Six numeric cells. No resend control: an authenticator issues its own codes and we cannot send one."
      >
        <VerificationCodeScreen
          channel="authenticator"
          bind:code={() => field("code-app"), (value) => (draft["code-app"] = value)}
          onSubmit={swallow}
          onRecoveryCode={noop}
          back={noop}
        />
      </ScreenSpecimen>

      <ScreenSpecimen
        name="Texted code, resend on a countdown"
        note="Eight alphanumeric cells, uppercased as typed. Every resend waits out a visible window."
        unbuilt={CHOICE_GAP}
      >
        <VerificationCodeScreen
          channel="text"
          sentTo={PHONE}
          resendSecondsRemaining={47}
          bind:code={() => field("code-text"), (value) => (draft["code-text"] = value)}
          onSubmit={swallow}
          onResend={noop}
          onRecoveryCode={noop}
          back={noop}
        />
      </ScreenSpecimen>

      <ScreenSpecimen
        name="Spoken code"
        note="Six digits, like the authenticator, because that is what a call reads aloud — but it is resendable, because we placed the call."
        unbuilt={CHOICE_GAP}
      >
        <VerificationCodeScreen
          channel="call"
          sentTo={PHONE}
          bind:code={() => field("code-call"), (value) => (draft["code-call"] = value)}
          onSubmit={swallow}
          onResend={noop}
          back={noop}
        />
      </ScreenSpecimen>

      <ScreenSpecimen
        name="Emailed code"
        note="Eight characters again. The same email carries a link, so a link that will not open is never a dead end."
        unbuilt={CHOICE_GAP}
      >
        <VerificationCodeScreen
          channel="email"
          bind:code={() => field("code-email"), (value) => (draft["code-email"] = value)}
          onSubmit={swallow}
          onResend={noop}
          back={noop}
        />
      </ScreenSpecimen>

      <ScreenSpecimen
        name="Code rejected"
        note="The sentence names what to do for THIS channel — pointing someone at a rotation that does not happen is a wrong instruction."
      >
        <VerificationCodeScreen
          channel="authenticator"
          rejected
          onSubmit={swallow}
          onRecoveryCode={noop}
          back={noop}
        />
      </ScreenSpecimen>

      <ScreenSpecimen name="Last attempt">
        <VerificationCodeScreen
          channel="authenticator"
          rejected
          attemptsRemaining={1}
          onSubmit={swallow}
          onRecoveryCode={noop}
          back={noop}
        />
      </ScreenSpecimen>

      <ScreenSpecimen name="Locked out">
        <VerificationCodeScreen
          channel="authenticator"
          rejected
          lockoutSeconds={298}
          onSubmit={swallow}
          onRecoveryCode={noop}
          back={noop}
        />
      </ScreenSpecimen>
    </section>

    <section class="flex flex-col gap-24">
      <div class="flex max-w-prose flex-col gap-8">
        <h2 class="text-lg font-semibold">Use a Recovery Code</h2>
        <p class="text-sm text-text-muted">
          The field accepts letters. A numeric-only recovery field eats every valid code and
          presents that as the code being wrong.
        </p>
      </div>

      <ScreenSpecimen name="Default">
        <RecoveryCodeScreen
          bind:recoveryCode={() => field("recovery"), (value) => (draft["recovery"] = value)}
          onSubmit={swallow}
          back={noop}
        />
      </ScreenSpecimen>

      <ScreenSpecimen name="Code rejected">
        <RecoveryCodeScreen
          rejection="That code didn't match. Each code works once."
          onSubmit={swallow}
          back={noop}
        />
      </ScreenSpecimen>

      <ScreenSpecimen name="Locked out">
        <RecoveryCodeScreen
          rejection="That code didn't match. Each code works once."
          lockoutSeconds={298}
          onSubmit={swallow}
          back={noop}
        />
      </ScreenSpecimen>
    </section>

    <section class="flex flex-col gap-24">
      <div class="flex max-w-prose flex-col gap-8">
        <h2 class="text-lg font-semibold">Select Workspace</h2>
        <p class="text-sm text-text-muted">
          The first screen allowed to know anything about the person in front of it — which firms
          someone deals with is privileged, so it is revealed only after they have proved who they
          are. One sign-in serves firm members and portal clients alike; this chooser is the fork.
        </p>
      </div>

      <ScreenSpecimen
        name="Several associations, no default set"
        note="Where the workspace is and when this person last opened it is what tells two similarly named firms apart."
        unbuilt={WORKSPACE_GAP}
      >
        <WorkspaceScreen
          workspaces={WORKSPACES}
          bind:selectedId={workspaceChoice}
          onContinue={noop}
        />
      </ScreenSpecimen>
    </section>

    <section class="flex max-w-prose flex-col gap-12">
      <h2 class="text-lg font-semibold">Not transposed yet</h2>
      <Alert.Root variant="info">
        <Alert.Description>
          The two-factor enrolment hub and its authenticator, phone and recovery-code screens, the
          recovery-codes issuance and export, and the reset-password screen as one
          progressively-disclosed surface are designed but not built here. Registration and its
          three-way role fork and invitation redemption are a different case: those routes now
          exist and answer, so what is missing is only the screens that would call them.
        </Alert.Description>
      </Alert.Root>
    </section>
  </div>
{:else}
  <p class="p-16 text-sm text-text-muted">
    The screen-state page is only available in development builds.
  </p>
{/if}
