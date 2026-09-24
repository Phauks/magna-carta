<script lang="ts">
  /*
   * Change Password — the act, asked for in the product's one action panel.
   *
   * A FORM RATHER THAN A QUESTION, because it collects something: the ActionDialog's `form` kind,
   * whose commit is the panel's submit, so Enter in any field commits and the caller wires nothing.
   *
   * ONE NEW-PASSWORD FIELD WITH A REVEAL, not a confirm pair — the reset screen's precedent
   * ($lib/auth/screens/reset-password-set-screen.svelte): PasswordInput lets a person read what they
   * typed, which is the whole job the second field was doing.
   *
   * THE SIGN-OUT-ELSEWHERE CHOICE IS ON BY DEFAULT, and that default is the point of the control.
   * Somebody changing a password because they fear their account is held by somebody else needs the
   * old sessions ended in the same act, and asking the two questions separately leaves a gap an
   * intruder can change it back through ($lib/account/change-password.ts holds that reasoning). The
   * choice stays offered rather than forced because a member who is simply rotating a password on a
   * calendar should not be made to sign in again on their phone.
   *
   * The rules it states are the client's copy of the server's ($lib/auth/password-rule.ts) — a
   * courtesy that keeps the commit shut rather than the enforcement, which is the server's.
   */
  import ActionDialog from "@magna-carta/design-system/action-dialog";
  import type { ActionOutcome } from "@magna-carta/design-system/action-dialog";
  import * as Alert from "@magna-carta/design-system/alert";
  import Checkbox from "@magna-carta/design-system/checkbox";
  import Label from "@magna-carta/design-system/label";
  import LabelledField from "@magna-carta/design-system/labelled-field";
  import PasswordInput from "@magna-carta/design-system/password-input";
  import { toast } from "@magna-carta/design-system/toast";
  import {
    changePassword,
    passwordChangedMessage,
    type PasswordChangeOutcome,
  } from "$lib/account/change-password.ts";
  import { MAXIMUM_PASSWORD_LENGTH, MINIMUM_PASSWORD_LENGTH } from "$lib/auth/password-rule.ts";

  let { open = $bindable(false) }: { open?: boolean } = $props();

  let currentPassword = $state("");
  let newPassword = $state("");
  let signOutOtherDevices = $state(true);
  let refusal = $state<string | null>(null);

  function clear(): void {
    currentPassword = "";
    newPassword = "";
    signOutOtherDevices = true;
    refusal = null;
  }

  // Why the commit is unavailable, or undefined when it is available. The shell states this beside
  // the control it refuses, so nobody presses a dead button and wonders.
  const commitRefusal = $derived.by((): string | undefined => {
    if (currentPassword === "") return "Enter your current password.";
    if (newPassword.length < MINIMUM_PASSWORD_LENGTH) {
      return `A password is at least ${MINIMUM_PASSWORD_LENGTH} characters.`;
    }
    if (newPassword.length > MAXIMUM_PASSWORD_LENGTH) {
      return `A password is at most ${MAXIMUM_PASSWORD_LENGTH} characters.`;
    }
    // Said here rather than by the server, which would spend a round trip to answer a question the
    // field already knows: a password that has not changed is not a change.
    if (newPassword === currentPassword) return "Your new password is the one you already have.";
    return undefined;
  });

  async function commit(): Promise<ActionOutcome> {
    if (commitRefusal !== undefined) return "refused";
    refusal = null;
    const signingOutElsewhere = signOutOtherDevices;
    const outcome: PasswordChangeOutcome = await changePassword({
      currentPassword,
      newPassword,
      signOutOtherDevices: signingOutElsewhere,
    });
    if (outcome.kind !== "changed") {
      refusal = outcome.message;
      return "refused";
    }
    // Said on the surface the member returns to, not inside a panel that is closing. The fields are
    // cleared on the way out rather than left holding a password in a closed panel's state.
    toast.success(passwordChangedMessage(signingOutElsewhere));
    clear();
    return "committed";
  }
</script>

<ActionDialog
  bind:open
  kind="form"
  heading="Change Password"
  commitLabel="Change Password"
  commitBusyLabel="Changing"
  {commitRefusal}
  unsavedChanges={currentPassword !== "" || newPassword !== ""}
  onOpen={clear}
  onDismiss={clear}
  onCommit={commit}
>
  {#snippet notice()}
    {#if refusal !== null}
      <Alert.Root variant="danger">
        <Alert.Description>{refusal}</Alert.Description>
      </Alert.Root>
    {/if}
  {/snippet}
  {#snippet fields({ busy })}
    <div class="flex flex-col gap-16">
      <LabelledField label="Current Password">
        {#snippet children({ props })}
          <PasswordInput
            {...props}
            bind:value={currentPassword}
            autocomplete="current-password"
            disabled={busy}
          />
        {/snippet}
      </LabelledField>

      <LabelledField
        label="New Password"
        hint="At least {MINIMUM_PASSWORD_LENGTH} characters."
      >
        {#snippet children({ props })}
          <PasswordInput
            {...props}
            bind:value={newPassword}
            autocomplete="new-password"
            disabled={busy}
          />
        {/snippet}
      </LabelledField>

      <div class="flex items-center gap-8">
        <Checkbox
          id="change-password-sign-out-others"
          bind:checked={signOutOtherDevices}
          disabled={busy}
        />
        <Label for="change-password-sign-out-others">Sign out my other devices</Label>
      </div>
    </div>
  {/snippet}
</ActionDialog>
