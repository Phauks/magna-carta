<script lang="ts">
  /*
   * New Recovery Codes — the password, then the fresh set.
   *
   * Every earlier code stops working in the same act ($lib/account/two-factor.ts), so this is the
   * remedy for a sheet that has gone missing as well as one that has run out. The panel ends in the
   * shell's "done" shape: the new codes on screen, Close the only way out, because there is nothing
   * left to ask and the one thing that matters is that they are kept before it closes.
   */
  import ActionDialog from "@magna-carta/design-system/action-dialog";
  import type { ActionOutcome } from "@magna-carta/design-system/action-dialog";
  import * as Alert from "@magna-carta/design-system/alert";
  import LabelledField from "@magna-carta/design-system/labelled-field";
  import PasswordInput from "@magna-carta/design-system/password-input";
  import RecoveryCodes from "$lib/account/components/recovery-codes.svelte";
  import { replaceRecoveryCodes } from "$lib/account/two-factor.ts";

  let {
    open = $bindable(false),
    accountAddress,
  }: {
    open?: boolean;
    accountAddress: string | null;
  } = $props();

  let password = $state("");
  let codes = $state<readonly string[] | null>(null);
  let refusal = $state<string | null>(null);

  function clear(): void {
    password = "";
    codes = null;
    refusal = null;
  }

  async function commit(): Promise<ActionOutcome> {
    if (password === "") return "refused";
    refusal = null;
    const outcome = await replaceRecoveryCodes(password);
    if (outcome.kind === "refused") {
      refusal = outcome.message;
      return "refused";
    }
    password = "";
    codes = outcome.recoveryCodes;
    return "done";
  }
</script>

<ActionDialog
  bind:open
  kind="form"
  heading="New Recovery Codes"
  commitLabel="Replace Recovery Codes"
  commitBusyLabel="Replacing"
  commitRefusal={codes === null && password === "" ? "Enter your password." : undefined}
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
    {#if codes === null}
      <div class="flex flex-col gap-16">
        <p class="text-sm">Your current recovery codes stop working when the new ones are made.</p>
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
      </div>
    {:else}
      <RecoveryCodes {codes} {accountAddress} />
    {/if}
  {/snippet}
</ActionDialog>
