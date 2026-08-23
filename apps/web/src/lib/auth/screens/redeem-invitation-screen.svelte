<script lang="ts">
  /*
   * Your Invitation — the door for everyone who did not found the firm they are joining.
   *
   * THREE FACTS, ONE ANSWER, AND NO PER-FIELD ERROR. The code alone would be enough
   * cryptographically; the surname and the date of birth are there because a code travels by email
   * and email is forwarded, printed and left open, while two facts the firm already holds are free
   * to the right person and unavailable to the wrong one. What makes that safe is the storage shape
   * rather than this screen's manners: the invitation row holds ONE digest over all three facts
   * (apps/api-worker/src/joining-secrets.ts), so there is no stored surname to compare and no stored
   * birthday, and the handler is structurally incapable of reporting which one was wrong.
   *
   * SO THIS SCREEN MUST NEVER GROW A PER-FIELD ERROR, and the temptation is real — "the code looks
   * right, mark the date of birth" is the obvious kindness, and it is exactly the thing that turns
   * the form into a machine for confirming that a named person was invited to a named firm, which
   * for a law firm's client list is the confidential fact itself. There is one alert, it carries one
   * constant sentence (../../routes/register/joining-messages.ts), and the only field-level state
   * any of the three inputs takes is `aria-invalid`, which they take TOGETHER because the refusal
   * belongs to the combination. If a future change wants to say more, the answer is that the server
   * does not know more.
   *
   * The remaining-attempts line and the lockout countdown are the shared ladder's, unchanged from
   * the sign-in screens, and they are a fact about the caller's own attempts rather than about the
   * invitation — see ../attempt-ladder.ts for why the wording narrows as the count drops.
   *
   * THE CODE FIELD CARRIES NO GENERATED PREFIX. ../invitation-code.ts says why, and does the
   * grouping the field shows.
   */
  import Button from "@magna-carta/design-system/button";
  import Input from "@magna-carta/design-system/input";
  import Label from "@magna-carta/design-system/label";
  import AuthPanel from "../auth-panel.svelte";
  import CredentialNotice from "../credential-notice.svelte";
  import { formatInvitationCode, isCompleteInvitationCode } from "../invitation-code.ts";

  let {
    code = $bindable(""),
    lastName = $bindable(""),
    dateOfBirth = $bindable(""),
    pending = false,
    rejection = null,
    attemptsRemaining = null,
    lockoutSeconds = null,
    codeFieldReference = $bindable(null),
    onSubmit,
    back,
  }: {
    code?: string;
    lastName?: string;
    /** A calendar date in YYYY-MM-DD form — what the date field submits and the route takes. */
    dateOfBirth?: string;
    pending?: boolean;
    /** The ONE refusal sentence. It never says which of the three facts was wrong. */
    rejection?: string | null;
    attemptsRemaining?: number | null;
    lockoutSeconds?: number | null;
    codeFieldReference?: HTMLInputElement | null;
    onSubmit: (event: SubmitEvent) => void;
    back?: () => void;
  } = $props();

  const lockedOut = $derived(lockoutSeconds !== null);
  const complete = $derived(
    isCompleteInvitationCode(code) && lastName.trim() !== "" && dateOfBirth !== "",
  );
  const canSubmit = $derived(!pending && !lockedOut && complete);

  /*
   * One invalid flag for all three fields, never one per field. The refusal is about the
   * combination, so marking a single input would be this screen inventing a verdict the server
   * refused to give.
   */
  const invalid = $derived(rejection !== null ? "true" : undefined);

  function reformatCode(): void {
    code = formatInvitationCode(code);
  }
</script>

<AuthPanel title="Your Invitation" {back} backLabel="Back to the three choices">
  {#snippet meta()}Your firm sent you a link. You can type the code from it instead.{/snippet}

  {#snippet children()}
    <form onsubmit={onSubmit} class="flex flex-col gap-16">
      <div class="flex flex-col gap-8">
        <Label for="invitation-code">Invitation Code</Label>
        <Input
          bind:ref={codeFieldReference}
          id="invitation-code"
          name="invitation-code"
          size="lg"
          class="font-mono"
          bind:value={code}
          oninput={reformatCode}
          autocomplete="off"
          autocapitalize="characters"
          spellcheck={false}
          placeholder="Invitation Code"
          aria-invalid={invalid}
          disabled={pending || lockedOut}
          required
        />
      </div>

      <div class="flex flex-col gap-8">
        <Label for="invitation-last-name">Last Name</Label>
        <Input
          id="invitation-last-name"
          name="family-name"
          size="lg"
          bind:value={lastName}
          autocomplete="family-name"
          placeholder="Last Name"
          aria-invalid={invalid}
          disabled={pending || lockedOut}
          required
        />
      </div>

      <div class="flex flex-col gap-8">
        <!-- The field is named for the fact it holds, never "Date": a form that asks for "a date"
             on the screen where three facts are being matched is asking a question nobody can
             answer with confidence. -->
        <Label for="invitation-date-of-birth">Date of Birth</Label>
        <Input
          id="invitation-date-of-birth"
          name="bday"
          type="date"
          size="lg"
          bind:value={dateOfBirth}
          autocomplete="bday"
          aria-invalid={invalid}
          disabled={pending || lockedOut}
          required
        />
      </div>

      <Button type="submit" variant="primary" size="lg" class="w-full" disabled={!canSubmit}>
        {pending ? "Redeeming…" : "Redeem Invitation"}
      </Button>

      <!-- One alert, below the button, so the card grows and the button never moves. -->
      <CredentialNotice
        message={rejection}
        {attemptsRemaining}
        {lockoutSeconds}
        subject="this invitation"
      />
    </form>
  {/snippet}
</AuthPanel>
