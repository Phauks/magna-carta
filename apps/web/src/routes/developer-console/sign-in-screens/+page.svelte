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
  import { JOINING_STEPS, joiningStep } from "$lib/auth/joining-availability.ts";
  import { maskedPhoneNumber } from "$lib/auth/code-channels.ts";
  import { ATTEMPT_LIMIT } from "$lib/auth/attempt-ladder.ts";
  import { MINIMUM_PASSWORD_LENGTH } from "$lib/auth/password-rule.ts";
  import AccountReadyScreen from "$lib/auth/screens/account-ready-screen.svelte";
  import CheckEmailScreen from "$lib/auth/screens/check-email-screen.svelte";
  import ConfirmRegistrationScreen from "$lib/auth/screens/confirm-registration-screen.svelte";
  import FoundFirmScreen from "$lib/auth/screens/found-firm-screen.svelte";
  import RedeemInvitationScreen from "$lib/auth/screens/redeem-invitation-screen.svelte";
  import { firmBuildSteps, firmBuiltReading } from "$lib/auth/firm-build-progress.ts";
  import FirmBuildingScreen from "$lib/auth/screens/firm-building-screen.svelte";
  import JoiningChoiceScreen from "$lib/auth/screens/joining-choice-screen.svelte";
  import RegisterAccountScreen from "$lib/auth/screens/register-account-screen.svelte";
  import RegisterDetailsScreen from "$lib/auth/screens/register-details-screen.svelte";
  import { REDEMPTION_REFUSED } from "../../register/joining-messages.ts";
  import RecoveryCodeScreen from "$lib/auth/screens/recovery-code-screen.svelte";
  import SignInScreen from "$lib/auth/screens/sign-in-screen.svelte";
  import TwoFactorMethodScreen from "$lib/auth/screens/two-factor-method-screen.svelte";
  import type { SecondFactorOption } from "$lib/auth/screens/two-factor-method-screen.svelte";
  import VerificationCodeScreen from "$lib/auth/screens/verification-code-screen.svelte";
  import WorkspaceScreen from "$lib/auth/screens/workspace-screen.svelte";
  import type { WorkspaceOption } from "$lib/auth/screens/workspace-screen.svelte";
  import ScreenSpecimen from "./screen-specimen.svelte";
  import ScreenHeader from "$lib/screen/screen-header.svelte";
  import { DEVELOPER_CONSOLE_BACK } from "$lib/screen/screen-header.ts";

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

  /*
   * A fixed instant for the "sent at" line, so the specimen reads the same on every render and a
   * visual-regression pass is not chasing the clock. The live screens pass the real send time.
   */
  const SENT_AT = new Date("2026-09-04T21:03:00Z");

  const CONFIRMATION_GAP = joiningStep("confirm-registration").behaviour;
  const AGREEMENTS_GAP = joiningStep("agreements").behaviour;
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
      <ScreenHeader title="Sign-in screen states" favoritable={false} back={DEVELOPER_CONSOLE_BACK} />
      <p class="text-sm text-text-muted">
        Every signed-out screen and every state it can be in, rendered from the real components. Use
        this instead of a standalone mockup: a mockup is styled by hand and drifts the moment either
        side changes, while everything here is the shipping design system.
      </p>
      <p class="text-sm text-text-muted">
        Each specimen says whether the product can reach it. A state marked
        <Badge variant="warning">No server route</Badge>
        is designed and rendered but has nothing behind it, and the live route does not offer it. A
        state marked
        <Badge variant="warning">Stops short</Badge>
        does call a route that answers, but something outside that route is missing, so it lands
        somewhere short of where a visitor would expect.
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

    <section class="flex max-w-prose flex-col gap-12">
      <h2 class="text-lg font-semibold">How far each joining step carries</h2>
      <p class="text-sm text-text-muted">
        Read against the Worker's registration and invitation routes. Every one of them answers —
        what varies is whether the step ends where the person expects, which is what the screens
        below have to say out loud rather than leave somebody to find out.
      </p>
      <ul class="flex flex-col gap-8">
        {#each JOINING_STEPS as step (step.id)}
          <li class="rounded-md border border-border-default bg-surface-raised p-12">
            <p class="flex flex-wrap items-center gap-8 text-sm font-semibold">
              {step.label}
              {#if step.reach === "live"}
                <Badge variant="success">Live today</Badge>
              {:else}
                <Badge variant="warning">Stops short</Badge>
              {/if}
            </p>
            <p class="text-xs text-text-muted">{step.behaviour}</p>
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

    <section class="flex flex-col gap-24">
      <div class="flex max-w-prose flex-col gap-8">
        <h2 class="text-lg font-semibold">Register</h2>
        <p class="text-sm text-text-muted">
          One form, and it asks nothing about a firm. Registration makes a PERSON; which firm they
          belong to is settled afterwards, signed in, on the joining screen below. The role fork
          that used to stand here asked a visitor to classify themselves before anything about them
          existed.
        </p>
      </div>

      <ScreenSpecimen
        name="Create Your Account"
        note="Two facts and a password typed twice — no name, because a name is a profile rather than a credential. The button names what pressing it does: it sends a confirmation email; the account is created when the link is followed. The password is chosen HERE and nothing is minted by choosing it — the server holds it hashed with the pending registration and commits the credential when the emailed token is spent, so one mail does what two used to."
        caveat={AGREEMENTS_GAP}
      >
        <RegisterAccountScreen
          minimumPasswordLength={MINIMUM_PASSWORD_LENGTH}
          onSubmit={swallow}
          back={noop}
        />
      </ScreenSpecimen>

      <ScreenSpecimen
        name="The two passwords disagree"
        note="Said under the second field as soon as there is something in it to disagree with, and never against an empty box — a mismatch announced there is a complaint about not having finished typing. The submit stays shut until they match."
      >
        <RegisterAccountScreen
          minimumPasswordLength={MINIMUM_PASSWORD_LENGTH}
          email="trevor@goldsmith.example"
          password="a-sufficiently-long-password"
          passwordAgain="a-sufficiently-long-passwrod"
          onSubmit={swallow}
          back={noop}
        />
      </ScreenSpecimen>

      <ScreenSpecimen
        name="Registration refused"
        note="Only a malformed form reaches this. A taken address and a free one both answer 202 — the difference is in the mail, never on the screen."
      >
        <RegisterAccountScreen
          minimumPasswordLength={MINIMUM_PASSWORD_LENGTH}
          rejection="Those details could not be accepted. Check the email address and try again."
          onSubmit={swallow}
          back={noop}
        />
      </ScreenSpecimen>
    </section>

    <section class="flex flex-col gap-24">
      <div class="flex max-w-prose flex-col gap-8">
        <h2 class="text-lg font-semibold">Welcome — settling what an account is</h2>
        <p class="text-sm text-text-muted">
          The dedicated signed-in screen, reached with a real session and no firm. Two choices,
          because two are what the server can actually do; what is not built is a sentence rather
          than a control. Founding is asynchronous, so it has a waiting state that polls the
          bootstrap rather than remembering anything in the browser.
        </p>
      </div>

      <ScreenSpecimen
        name="The two choices"
        note="Neither is the recommended answer. Founding carries the primary weight because it is the act that creates something, not because it is expected. Nothing sits under the heading: the account's own name read back at somebody who arrived a second ago was a greeting above two buttons that already say what the choice is."
      >
        <JoiningChoiceScreen onFoundFirm={noop} onRedeemInvitation={noop} />
      </ScreenSpecimen>

      <ScreenSpecimen
        name="Building your workspace"
        note="The named steps, not a spinner: each one leaves its own mark on the firm's record, so the sequence is read from the server rather than counted here. No progress bar — the steps are of wildly unequal length, and a bar at a made-up percentage is a claim about how far along the work is."
      >
        <FirmBuildingScreen
          firmName="Goldsmith and Associates"
          steps={firmBuildSteps({
            firmRecord: true,
            fileStorage: true,
            encryptionKey: false,
            activated: false,
            stalled: false,
            memberRecord: false,
            memberRecordStalled: false,
          })}
          onCheckAgain={noop}
        />
      </ScreenSpecimen>

      <ScreenSpecimen
        name="The last step"
        note="The firm exists and the account cannot use it yet — the gap that used to drop somebody into a workspace where every screen refused. The wait now runs one step past the firm being made, and admits when it is running long."
      >
        <FirmBuildingScreen
          firmName="Goldsmith and Associates"
          steps={firmBuildSteps(firmBuiltReading({ memberRecord: false }))}
          slow
          onCheckAgain={noop}
        />
      </ScreenSpecimen>

      <ScreenSpecimen
        name="Joining a firm that already exists"
        note="Redeeming an invitation queues the same member record and leaves the same gap, so the same screen holds that person — on the one step that is theirs, and under a heading that does not tell somebody joining a working firm that their workspace is being built."
      >
        <FirmBuildingScreen
          firmName="Goldsmith and Associates"
          kind="joining"
          steps={firmBuildSteps(firmBuiltReading({ memberRecord: false }), "joining")}
          onCheckAgain={noop}
        />
      </ScreenSpecimen>

      <ScreenSpecimen
        name="A build that stopped"
        note="Dead-lettered work is the one state waiting will not clear, so the step it stopped on says so instead of pretending to still be in flight."
      >
        <FirmBuildingScreen
          firmName="Goldsmith and Associates"
          steps={firmBuildSteps({
            firmRecord: true,
            fileStorage: true,
            encryptionKey: true,
            activated: false,
            stalled: true,
            memberRecord: false,
            memberRecordStalled: false,
          })}
          stalled
          onCheckAgain={noop}
        />
      </ScreenSpecimen>

      <ScreenSpecimen
        name="Still checking"
        note="The manual check disables itself while it is in flight, so a second press cannot stack a second request behind the poll."
      >
        <FirmBuildingScreen
          firmName="Goldsmith and Associates"
          steps={firmBuildSteps({
            firmRecord: true,
            fileStorage: true,
            encryptionKey: false,
            activated: false,
            stalled: false,
            memberRecord: false,
            memberRecordStalled: false,
          })}
          checking
          onCheckAgain={noop}
        />
      </ScreenSpecimen>
    </section>

    <section class="flex flex-col gap-24">
      <div class="flex max-w-prose flex-col gap-8">
        <h2 class="text-lg font-semibold">Start a New Law Firm</h2>
        <p class="text-sm text-text-muted">
          The firm's name, then the person's own details, then the mail. Both forms submit together
          — the route takes one call, so the split is a reading order rather than a round trip.
        </p>
      </div>

      <ScreenSpecimen
        name="The firm's name"
        note="No availability check and nothing to wait for: the name is a display name, not a lookup key, and plenty of firms share one."
      >
        <FoundFirmScreen
          bind:firmName={() => field("firm-name"), (value) => (draft["firm-name"] = value)}
          onContinue={swallow}
          back={noop}
        />
      </ScreenSpecimen>

      <ScreenSpecimen
        name="Register New User"
        note="The button names what pressing it does. The password is chosen here and committed onto the account only when the emailed token is spent, which is still the act that proves the mailbox."
        caveat={AGREEMENTS_GAP}
      >
        <RegisterDetailsScreen
          firmName="Goldsmith and Associates"
          minimumPasswordLength={MINIMUM_PASSWORD_LENGTH}
          onSubmit={swallow}
          back={noop}
        />
      </ScreenSpecimen>

      <ScreenSpecimen
        name="The two passwords disagree"
        note="Said under the second field as soon as there is something in it to disagree with, and never against an empty box — a mismatch announced there is a complaint about not having finished typing. The submit stays shut until they match."
      >
        <RegisterAccountScreen
          minimumPasswordLength={MINIMUM_PASSWORD_LENGTH}
          email="trevor@goldsmith.example"
          password="a-sufficiently-long-password"
          passwordAgain="a-sufficiently-long-passwrod"
          onSubmit={swallow}
          back={noop}
        />
      </ScreenSpecimen>

      <ScreenSpecimen
        name="Registration refused"
        note="Only a malformed form reaches this. A taken address and a free one both answer 202 — the difference is in the mail, never on the screen."
      >
        <RegisterDetailsScreen
          firmName="Goldsmith and Associates"
          minimumPasswordLength={MINIMUM_PASSWORD_LENGTH}
          rejection="Those details could not be accepted. Check the email address and try again."
          onSubmit={swallow}
          back={noop}
        />
      </ScreenSpecimen>

      <ScreenSpecimen
        name="Check your email"
        note="No resend control, because nothing resends: registering again supersedes the first link. The sent time is written out in full, in the reader's own zone. The way out is the panel's own back control at the top, where every other screen on this surface keeps it; the typed-code button at the foot is a way onward, not a second way out."
      >
        <CheckEmailScreen
          address="trevor@goldsmith.example"
          instruction="Open the link we sent, or type the confirmation code from that email. Your account is created once that is done, with the password you chose, and you are signed in on the spot."
          sentAt={SENT_AT}
          remedy="If it does not arrive, check the spam folder, then register again — a second registration replaces the first, and the newest code is the one that works."
          onEnterCode={noop}
          enterCodeLabel="Enter the Confirmation Code"
          back={noop}
        />
      </ScreenSpecimen>

      <ScreenSpecimen
        name="Your account is ready"
        note="The FALLBACK ending, not the ordinary one: confirming now signs the person in on the response and walks straight into the joining screen, so this shows only where a session could not be minted. The account already holds the password chosen at registration, so the sign-in button always opens. The second variant is the founding door, whose workspace is still being built off the request — the credential exists either way, so the sentence must not promise a workspace that is not up yet."
      >
        <AccountReadyScreen address="trevor@goldsmith.example" />
      </ScreenSpecimen>

      <ScreenSpecimen
        name="Your account is ready, workspace still building"
        note="The founding door's ending. Same credential, same button; only the sentence differs."
      >
        <AccountReadyScreen address="trevor@goldsmith.example" pendingFirm />
      </ScreenSpecimen>

      <ScreenSpecimen
        name="Confirm the emailed token"
        note="The token is passed through untouched but for trimming: the server does not normalize it, so grouping or uppercasing it here would produce a digest that matches nothing. Its back control points at sign-in rather than at the screen before, because this one is reached cold from a mailbox as often as it is stepped into."
        caveat={CONFIRMATION_GAP}
      >
        <ConfirmRegistrationScreen
          bind:token={() => field("confirm-token"), (value) => (draft["confirm-token"] = value)}
          onSubmit={swallow}
          back={noop}
        />
      </ScreenSpecimen>
    </section>

    <section class="flex flex-col gap-24">
      <div class="flex max-w-prose flex-col gap-8">
        <h2 class="text-lg font-semibold">Your Invitation</h2>
        <p class="text-sm text-text-muted">
          Three facts and one answer. The row holds a single digest over the code, the surname and
          the date of birth together, so the server cannot say which was wrong — and neither can
          this screen, which is the property the whole design turns on.
        </p>
      </div>

      <ScreenSpecimen
        name="Default"
        note="Titles above the fields and ghost text within, so the field's name survives the first keystroke. The code carries no generated prefix: the generator emits none, and one typed in would normalize into the digest and fail every code."
      >
        <RedeemInvitationScreen
          bind:code={() => field("invitation-code"), (value) => (draft["invitation-code"] = value)}
          bind:lastName={() => field("invitation-name"), (value) => (draft["invitation-name"] = value)}
          onSubmit={swallow}
          back={noop}
        />
      </ScreenSpecimen>

      <ScreenSpecimen
        name="Details do not match"
        note="ONE sentence for a wrong code, a wrong surname, a wrong date of birth, an invitation already used, revoked or expired. All three fields carry the invalid mark together, because the refusal belongs to the combination."
      >
        <RedeemInvitationScreen rejection={REDEMPTION_REFUSED} onSubmit={swallow} back={noop} />
      </ScreenSpecimen>

      <ScreenSpecimen
        name="Attempts remaining"
        note={`The invitation spends its own budget of ${ATTEMPT_LIMIT} beside the caller-keyed one, because an address-keyed limit alone does not stop a date of birth being walked from a rented range.`}
      >
        <RedeemInvitationScreen
          rejection={REDEMPTION_REFUSED}
          attemptsRemaining={2}
          onSubmit={swallow}
          back={noop}
        />
      </ScreenSpecimen>

      <ScreenSpecimen
        name="Invitation locked"
        note="The lockout replaces the refusal rather than stacking under it, and the way out sits in the same element as the countdown."
      >
        <RedeemInvitationScreen
          rejection={REDEMPTION_REFUSED}
          lockoutSeconds={898}
          onSubmit={swallow}
          back={noop}
        />
      </ScreenSpecimen>

      <ScreenSpecimen
        name="Redeemed"
        note="Redemption ends at a mailbox rather than a session, so somebody who guessed all three facts but does not hold the address still gets nothing."
      >
        <CheckEmailScreen
          address="joan@example.test"
          instruction="Open the link we sent and choose a password. That is the last step — you can sign in straight afterwards."
          sentAt={SENT_AT}
          remedy="If it does not arrive, check the spam folder, then ask the firm that invited you to send a new invitation."
          back={noop}
        />
      </ScreenSpecimen>
    </section>

    <section class="flex max-w-prose flex-col gap-12">
      <h2 class="text-lg font-semibold">Not transposed yet</h2>
      <Alert.Root variant="info">
        <Alert.Description>
          Two-factor enrolment by authenticator app, and issuing and saving the recovery codes, are
          built on Account · Security rather than here, because a signed-in member sets them up.
          The phone-channel enrolment screens and the reset-password screen as one
          progressively-disclosed surface are designed but not built. The passkey-or-password
          choice the registration design calls for is a third case: it is not a missing screen but a
          missing route, and it stays absent until there is one.
        </Alert.Description>
      </Alert.Root>
    </section>
  </div>
{:else}
  <p class="p-16 text-sm text-text-muted">
    The screen-state page is only available in development builds.
  </p>
{/if}
