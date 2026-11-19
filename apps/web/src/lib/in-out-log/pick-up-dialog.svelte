<script lang="ts">
  /*
   * Pick Up: the entry has left the desk.
   *
   * Who collected it is one of the people it was To, or somebody else by name (a courier sent for
   * it, a spouse). Whether their identity was checked is a yes or no; no document number is written
   * down, because nothing about the log needs one and it could not be taken back. Who handed it
   * over is whoever is signed in, which the server records.
   */
  import ActionDialog, { type ActionOutcome } from "@magna-carta/design-system/action-dialog";
  import Checkbox from "@magna-carta/design-system/checkbox";
  import Input from "@magna-carta/design-system/input";
  import Label from "@magna-carta/design-system/label";
  import * as RadioGroup from "@magna-carta/design-system/radio-group";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import { pickUp, type InOutEntry } from "./in-out-log-api.ts";

  const SOMEONE_ELSE = "someone-else";

  let {
    open = $bindable(false),
    entry,
    onPickedUp,
  }: {
    open?: boolean;
    entry: InOutEntry | null;
    onPickedUp: () => void;
  } = $props();

  let chosen = $state("");
  let otherName = $state("");
  let identityChecked = $state(false);
  let failure = $state<StatedFailure | null>(null);

  function reset(): void {
    chosen = entry?.to.length === 1 ? (entry.to[0]?.id ?? "") : "";
    otherName = "";
    identityChecked = false;
    failure = null;
  }

  const refusal = $derived.by((): string | undefined => {
    if (chosen === "") return "Say who picked it up.";
    if (chosen === SOMEONE_ELSE && otherName.trim() === "") return "Type the name of who picked it up.";
    return undefined;
  });

  async function submit(): Promise<ActionOutcome> {
    if (entry === null) return "refused";
    failure = null;
    const outcome = await pickUp(
      fetch,
      entry.id,
      chosen === SOMEONE_ELSE
        ? { collector: { kind: "external", name: otherName.trim() }, identityChecked }
        : { recipientId: chosen, identityChecked },
      crypto.randomUUID(),
    );
    if (outcome.kind === "ok") {
      onPickedUp();
      return "committed";
    }
    failure = stated(
      outcome.failure,
      "The pick up could not be saved.",
      "Couldn't connect. Nothing was saved.",
    );
    return "refused";
  }
</script>

<ActionDialog
  bind:open
  heading="Pick Up"
  subtitle={entry === null ? undefined : { reference: { kind: "", number: entry.number } }}
  commitLabel="Pick Up"
  commitBusyLabel="Saving"
  commitRefusal={refusal}
  onOpen={reset}
  onCommit={submit}
>
  {#snippet notice()}
    {#if failure !== null}
      <FailureNotice
        failure={failure.failure}
        title="The Pick Up Was Not Saved"
        fallback={failure.fallback}
        whenSilent={failure.whenSilent}
      />
    {/if}
  {/snippet}

  {#snippet fields({ busy })}
    {#if entry !== null}
      <div class="flex flex-col gap-16">
        <p>{entry.description}</p>
        <div class="flex flex-col gap-8">
          <Label id="pick-up-who-label" necessity="required">Picked up by</Label>
          <RadioGroup.Root
            aria-labelledby="pick-up-who-label"
            bind:value={chosen}
            disabled={busy}
            class="flex flex-col gap-8"
          >
            {#each entry.to as person (person.id)}
              <label class="flex items-center gap-8">
                <RadioGroup.Item value={person.id} />
                {person.name}
              </label>
            {/each}
            <label class="flex items-center gap-8">
              <RadioGroup.Item value={SOMEONE_ELSE} />
              Someone else
            </label>
          </RadioGroup.Root>
          {#if chosen === SOMEONE_ELSE}
            <Input aria-label="Name of who picked it up" disabled={busy} bind:value={otherName} />
          {/if}
        </div>
        <label class="flex items-center gap-8">
          <Checkbox disabled={busy} bind:checked={identityChecked} />
          <span>ID checked</span>
        </label>
      </div>
    {/if}
  {/snippet}
</ActionDialog>
