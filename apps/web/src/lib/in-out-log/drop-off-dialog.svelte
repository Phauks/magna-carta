<script lang="ts">
  /*
   * Drop Off: something has been left at the front desk for somebody to collect.
   *
   * Three answers are required: who it is from, what it is, and who it is To. Anybody listed in To
   * may pick it up, so a family or a lawyer and their assistant are all named at once. The matter,
   * where it is kept and notes are optional; a courier's envelope is often on no matter at all.
   *
   * The number the entry will carry is shown as the window opens, held for this window and given
   * back if it closes without saving, the way a New Packet window holds a custody number.
   */
  import ActionDialog, { type ActionOutcome } from "@magna-carta/design-system/action-dialog";
  import { untrack } from "svelte";
  import { DraftNumber, type RecordSubject } from "@magna-carta/design-system/record-reference";
  import Button from "@magna-carta/design-system/button";
  import Input from "@magna-carta/design-system/input";
  import Label from "@magna-carta/design-system/label";
  import Textarea from "@magna-carta/design-system/textarea";
  import X from "@lucide/svelte/icons/x";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import { draftNumberKeeper } from "$lib/records/draft-number-keeper.ts";
  import MatterPicker from "$lib/time/matter-picker.svelte";
  import type { SheetMatter } from "$lib/time/time-sheet-model.ts";
  import type { FirmMemberSummary } from "$lib/members/members-api.ts";
  import { dropOff, partyKey, type InOutParty } from "./in-out-log-api.ts";
  import PartyPicker from "./party-picker.svelte";

  let {
    open = $bindable(false),
    members,
    matters,
    mattersCapped = false,
    onDroppedOff,
  }: {
    open?: boolean;
    members: readonly FirmMemberSummary[];
    matters: readonly SheetMatter[];
    mattersCapped?: boolean;
    onDroppedOff: (created: { id: string; number: string }) => void;
  } = $props();

  let from = $state<InOutParty | null>(null);
  let description = $state("");
  let matterId = $state<string | null>(null);
  let to = $state<InOutParty[]>([]);
  let keptAt = $state("");
  let notes = $state("");
  let failure = $state<StatedFailure | null>(null);

  const number = new DraftNumber("");
  const keeper = draftNumberKeeper("in_out_entry");
  let saved = false;
  $effect(() => {
    const holding = open;
    untrack(() => {
      if (holding) {
        void number.hold(keeper);
        return;
      }
      if (saved) number.taken();
      else number.release();
      saved = false;
    });
  });
  const subtitle = $derived<RecordSubject>({ reference: number.reference });

  const refusal = $derived.by((): string | undefined => {
    if (from === null) return "Say who it is from.";
    if (description.trim() === "") return "Say what it is.";
    if (to.length === 0) return "Add at least one person it is to.";
    return undefined;
  });

  const started = $derived(
    from !== null || description.trim() !== "" || to.length > 0 || keptAt.trim() !== "" || notes.trim() !== "",
  );

  function reset(): void {
    from = null;
    description = "";
    matterId = null;
    to = [];
    keptAt = "";
    notes = "";
    failure = null;
  }

  function addRecipient(party: InOutParty): void {
    if (to.some((person) => partyKey(person) === partyKey(party))) return;
    to = [...to, party];
  }

  function removeRecipient(key: string): void {
    to = to.filter((person) => partyKey(person) !== key);
  }

  async function submit(): Promise<ActionOutcome> {
    if (from === null) return "refused";
    failure = null;
    const outcome = await dropOff(
      fetch,
      {
        description: description.trim(),
        from,
        to,
        matterId,
        keptAt: keptAt.trim() === "" ? null : keptAt.trim(),
        notes: notes.trim() === "" ? null : notes.trim(),
        numberReservation: number.token,
      },
      crypto.randomUUID(),
    );
    if (outcome.kind === "ok") {
      saved = true;
      onDroppedOff(outcome.value);
      return "committed";
    }
    failure = stated(
      outcome.failure,
      "The drop off could not be saved.",
      "Couldn't connect. Nothing was saved and no number was used.",
    );
    return "refused";
  }
</script>

<ActionDialog
  bind:open
  heading="Drop Off"
  {subtitle}
  commitLabel="Save"
  commitBusyLabel="Saving"
  commitRefusal={refusal}
  unsavedChanges={started}
  onOpen={reset}
  onCommit={submit}
>
  {#snippet notice()}
    {#if failure !== null}
      <FailureNotice
        failure={failure.failure}
        title="The Drop Off Was Not Saved"
        fallback={failure.fallback}
        whenSilent={failure.whenSilent}
      />
    {/if}
  {/snippet}

  {#snippet fields({ busy })}
    <div class="flex flex-col gap-16">
      <div class="flex flex-col gap-8">
        <Label necessity="required" for="drop-off-from">From</Label>
        {#if from === null}
          <PartyPicker
            inputId="drop-off-from"
            fieldName="From"
            {members}
            disabled={busy}
            onPick={(party) => (from = party)}
          />
          <p class="text-xs text-text-muted">
            Search the Directory, or type a name for someone who is not in it.
          </p>
        {:else}
          <div class="flex items-center gap-8">
            <span class="min-w-0 flex-1 truncate">{from.name}</span>
            <Button variant="ghost" size="icon" aria-label="Clear who it is from" onclick={() => (from = null)}>
              <X class="size-16" aria-hidden="true" />
            </Button>
          </div>
        {/if}
      </div>

      <div class="flex flex-col gap-8">
        <Label necessity="required" for="drop-off-what">What</Label>
        <Textarea id="drop-off-what" rows={2} disabled={busy} bind:value={description} />
      </div>

      <div class="flex flex-col gap-8">
        <Label necessity="optional" for="drop-off-matter">Matter</Label>
        <MatterPicker
          {matters}
          capped={mattersCapped}
          disabled={busy}
          inputId="drop-off-matter"
          value={matterId}
          onpick={(picked: string | null) => (matterId = picked)}
        />
      </div>

      <div class="flex flex-col gap-8">
        <Label necessity="required" for="drop-off-to">To</Label>
        {#if to.length > 0}
          <ul class="flex flex-wrap gap-8">
            {#each to as person (partyKey(person))}
              <li class="flex items-center gap-4 rounded-md border border-border-default py-4 ps-8 pe-4">
                <span class="truncate">{person.name}</span>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Remove {person.name}"
                  onclick={() => removeRecipient(partyKey(person))}
                >
                  <X class="size-16" aria-hidden="true" />
                </Button>
              </li>
            {/each}
          </ul>
        {/if}
        <PartyPicker
          inputId="drop-off-to"
          fieldName="Add a person"
          {members}
          disabled={busy}
          excluded={to.map(partyKey)}
          onPick={addRecipient}
        />
        <p class="text-xs text-text-muted">Anyone listed can pick it up.</p>
      </div>

      <div class="flex flex-col gap-8">
        <Label necessity="optional" for="drop-off-kept-at">Kept at</Label>
        <Input id="drop-off-kept-at" disabled={busy} placeholder="Front desk tray" bind:value={keptAt} />
      </div>

      <div class="flex flex-col gap-8">
        <Label necessity="optional" for="drop-off-notes">Notes</Label>
        <Textarea id="drop-off-notes" rows={2} disabled={busy} bind:value={notes} />
      </div>
    </div>
  {/snippet}
</ActionDialog>
