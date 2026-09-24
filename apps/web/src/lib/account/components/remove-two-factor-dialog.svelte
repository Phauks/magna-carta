<script lang="ts">
  /*
   * Remove Two-Factor — the password, and nothing else.
   *
   * A FORM, NOT A DESTRUCTIVE CONFIRM, because it collects the password: removing a protection is
   * exactly the act somebody holding an unlocked laptop should not be able to do with one press.
   * The server asks for it too; the field is here because the server does.
   *
   * The server deletes the authenticator's secret and every recovery code with it, and forgets this
   * browser's "don't ask for 30 days" — so setting it up again later starts from a new secret, not
   * the old one, and the old codes on paper are dead.
   */
  import ActionDialog from "@magna-carta/design-system/action-dialog";
  import type { ActionOutcome } from "@magna-carta/design-system/action-dialog";
  import * as Alert from "@magna-carta/design-system/alert";
  import LabelledField from "@magna-carta/design-system/labelled-field";
  import PasswordInput from "@magna-carta/design-system/password-input";
  import { toast } from "@magna-carta/design-system/toast";
  import { turnOffTwoFactor } from "$lib/account/two-factor.ts";

  let {
    open = $bindable(false),
    onRemoved,
  }: {
    open?: boolean;
    onRemoved: () => void;
  } = $props();

  let password = $state("");
  let refusal = $state<string | null>(null);

  function clear(): void {
    password = "";
    refusal = null;
  }

  async function commit(): Promise<ActionOutcome> {
    if (password === "") return "refused";
    refusal = null;
    const outcome = await turnOffTwoFactor(password);
    if (outcome.kind === "refused") {
      refusal = outcome.message;
      return "refused";
    }
    toast.success("Two-Factor is off. Signing in asks for your password only.");
    clear();
    onRemoved();
    return "committed";
  }
</script>

<ActionDialog
  bind:open
  kind="form"
  heading="Remove Two-Factor"
  commitLabel="Remove Two-Factor"
  commitBusyLabel="Removing"
  commitRefusal={password === "" ? "Enter your password." : undefined}
  unsavedChanges={password !== ""}
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
    <LabelledField label="Password">
      {#snippet children({ props })}
        <PasswordInput
          {...props}
          bind:value={password}
          autocomplete="current-password"
          disabled={busy}
        />
      {/snippet}
    </LabelledField>
  {/snippet}
</ActionDialog>
