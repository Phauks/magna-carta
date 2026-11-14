<script lang="ts">
  /*
   * Logging a packet into the register.
   *
   * WHAT A PACKET IS, WHICH IS WHY THIS FORM ASKS WHAT IT ASKS. A packet is the physical thing the
   * firm holds and moves: an envelope, a deed box, a sealed wallet. It draws the custody number, it
   * has a location, and it is the unit everything else hangs from. What is INSIDE it is described
   * separately, item by item, and deliberately not here: property is regularly taken in sealed, and
   * a form that demanded its contents before it would accept it would either stop the firm
   * recording what it just took custody of, or teach somebody to invent an item.
   *
   * THREE ANSWERS ARE REQUIRED AND THE REST ARE NOT. A name, at least one owner, and a location.
   * Each is the register failing at its own job without it: property with no name cannot be asked
   * for, property held for nobody can never be given back, and property at no location is property
   * the firm has lost. The owner is a Directory handle rather than typed text for the same reason
   * the whole register stores handles, which owner-picker.svelte states. They come first, in the
   * order a person thinks of them (what it is, whose it is, where it goes), and the optional fields
   * follow.
   *
   * THE CONTAINER CAN BE MADE HERE. A firm meets the need for a shelf at the moment this form asks
   * for one, so the Container field adds a container as well as choosing one (container-picker.svelte).
   *
   * THE NUMBER IS DRAWN, EXCEPT WHEN IT IS CARRIED IN. A firm converting a paper register keeps the
   * numbers already written on the physical labels, because renumbering property the firm is
   * holding means relabelling objects in a safe. That is the one case the form takes a number, and
   * it says which case it is rather than offering a number field to everybody.
   */
  import ActionDialog from "@magna-carta/design-system/action-dialog";
  import { untrack } from "svelte";
  import {
    DraftNumber,
    type RecordSubject,
  } from "@magna-carta/design-system/record-reference";
  import { draftNumberKeeper } from "$lib/records/draft-number-keeper.ts";
  import type { ActionOutcome } from "@magna-carta/design-system/action-dialog";
  import Button from "@magna-carta/design-system/button";
  import Checkbox from "@magna-carta/design-system/checkbox";
  import Input from "@magna-carta/design-system/input";
  import Label from "@magna-carta/design-system/label";
  import Textarea from "@magna-carta/design-system/textarea";
  import { DatePicker } from "@magna-carta/design-system/date-picker";
  import { placeholderOf } from "@magna-carta/design-system/formatters";
  import type { DateValue } from "@internationalized/date";
  import { civilDateText, civilDateValue } from "$lib/dates";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import X from "@lucide/svelte/icons/x";
  import type { DirectorySearchHit } from "$lib/directory/directory-api.ts";
  import {
    createCustodyPacket,
    type CreatedCustodyPacket,
    type CustodyLocationNode,
  } from "./custody-api.ts";
  import ContainerPicker from "./container-picker.svelte";
  import OwnerPicker from "./owner-picker.svelte";
  import {
    packetDraftReady,
    packetDraftRequest,
    packetDraftShortfalls,
    EMPTY_PACKET_DRAFT,
    type PacketDraft,
    type PacketOwnerDraft,
  } from "./packet-draft.ts";

  let {
    open = $bindable(false),
    locations,
    matterId = null,
    onCreated,
    onLocationsAdded,
  }: {
    open?: boolean;
    /** The firm's container tree, read once by the surface. */
    locations: readonly CustodyLocationNode[];
    /** The matter this packet is being logged against, where the form was opened from one. */
    matterId?: string | null;
    onCreated: (created: CreatedCustodyPacket) => void;
    /** Containers the form added on the way, so the screen's tree holds them without a re-read. */
    onLocationsAdded: (added: readonly CustodyLocationNode[]) => void;
  } = $props();

  let draft = $state<PacketDraft>({ ...EMPTY_PACKET_DRAFT });
  /* The depositor's name is held beside the handle because the register stores handles and resolves
     no names: without it the field could only show `directoryPerson_01J…` back at the person who
     just chose them. */
  let depositorName = $state<string | null>(null);
  let carriedIn = $state(false);

  /*
   * The custody number this packet will be filed under, stated before it exists.
   *
   * TWO CASES, and the form already knows which it is in. A packet the firm is taking in now is
   * filed under a draft number, held for this form while it is open and given back if it closes
   * without saving; a packet CARRIED IN from a paper deeds register keeps the number already written
   * on its physical label, because renumbering property the firm is holding means relabelling
   * objects in a safe. So a typed carried-in number is `drawn` — it is the packet's real number, and
   * the save is only recording it — and the draft is given back while the form is in that case.
   */
  const number = new DraftNumber("Packet");
  const keeper = draftNumberKeeper("custody_packet");
  let logged = false;
  $effect(() => {
    const holding = open && !carriedIn;
    untrack(() => {
      if (holding) {
        void number.hold(keeper);
        return;
      }
      if (logged) number.taken();
      else number.release();
      logged = false;
    });
  });
  const subtitle = $derived<RecordSubject>({
    reference:
      carriedIn && draft.manualCustodyNumber !== ""
        ? { kind: "Packet", number: draft.manualCustodyNumber }
        : number.reference,
  });
  let failure = $state<StatedFailure | null>(null);

  const shortfalls = $derived(packetDraftShortfalls(draft));

  /*
   * Why the commit is unavailable, or undefined when it is available. The window shows this beside
   * the control it refuses rather than hiding the control, so a reader is told which of the three
   * required answers is still missing instead of hunting for it.
   */
  const refusal = $derived(packetDraftReady(draft) ? undefined : shortfalls[0]);

  /** Whether anything has been entered. A blank form has nothing to lose, so leaving never asks. */
  const started = $derived(
    draft.name.trim() !== "" ||
      draft.owners.length > 0 ||
      draft.locationId !== null ||
      draft.notes.trim() !== "" ||
      draft.depositorEntityId !== null,
  );

  /** The deposit date as a calendar date, or undefined while it is empty or half-entered. */
  const depositedAtValue = $derived(civilDateValue(draft.depositedAt));

  function recordDepositedAt(next: DateValue | undefined): void {
    draft.depositedAt = civilDateText(next);
  }

  function addOwner(hit: DirectorySearchHit): void {
    const owner: PacketOwnerDraft = {
      entityId: hit.entityId,
      displayName: hit.displayName,
      ownershipRole: "",
    };
    draft.owners = [...draft.owners, owner];
  }

  function removeOwner(entityId: string): void {
    draft.owners = draft.owners.filter((owner) => owner.entityId !== entityId);
  }

  function setOwnershipRole(entityId: string, role: string): void {
    draft.owners = draft.owners.map((owner) =>
      owner.entityId === entityId ? { ...owner, ownershipRole: role } : owner,
    );
  }

  function recordDepositor(hit: DirectorySearchHit): void {
    draft.depositorEntityId = hit.entityId;
    depositorName = hit.displayName;
  }

  function clearDepositor(): void {
    draft.depositorEntityId = null;
    depositorName = null;
  }

  function reset(): void {
    draft = { ...EMPTY_PACKET_DRAFT, matterId };
    depositorName = null;
    carriedIn = false;
    failure = null;
  }

  // The matter the form was opened from is the matter it records, and a form reopened from a
  // different matter must not carry the last one's link.
  $effect(() => {
    const opened = open;
    if (!opened) return;
    draft.matterId = matterId;
  });

  // Unticking "carried in" drops the number rather than hiding a value that would still be sent.
  $effect(() => {
    if (!carriedIn) draft.manualCustodyNumber = "";
  });

  async function submit(): Promise<ActionOutcome> {
    failure = null;
    // A retried submit must not draw a second custody number for one envelope, so every attempt
    // carries its own key and the server answers the repeat with the first result.
    const outcome = await createCustodyPacket(
      fetch,
      { ...packetDraftRequest(draft), numberReservation: carriedIn ? undefined : number.token },
      crypto.randomUUID(),
    );
    if (outcome.kind === "ok") {
      logged = true;
      onCreated(outcome.value);
      return "committed";
    }
    failure = stated(
      outcome.failure,
      "The packet could not be logged.",
      // Nothing answered is a stronger statement than a refusal, and it is the one a person about
      // to press the button again needs: no number was drawn, so pressing again logs one packet.
      "Couldn't connect. Nothing was logged and no number was used.",
    );
    return "refused";
  }
</script>

<ActionDialog
  bind:open
  heading="New Packet"
  {subtitle}
  commitLabel="Save"
  commitBusyLabel="Saving"
  commitRefusal={refusal}
  width="wide"
  unsavedChanges={started}
  onOpen={reset}
  onCommit={submit}
>

  {#snippet notice()}
    {#if failure !== null}
      <FailureNotice
        failure={failure.failure}
        title="The Packet Was Not Logged"
        fallback={failure.fallback}
        whenSilent={failure.whenSilent}
      />
    {/if}
  {/snippet}

  {#snippet fields({ busy })}
    <div class="flex flex-col gap-16">
      <div class="flex flex-col gap-8">
        <Label for="new-packet-name">Name</Label>
        <Input id="new-packet-name" disabled={busy} bind:value={draft.name} />
      </div>

      <div class="flex flex-col gap-8">
        <Label for="new-packet-owner">Held for</Label>
        {#if draft.owners.length > 0}
          <ul class="flex flex-col gap-8">
            {#each draft.owners as owner (owner.entityId)}
              <li class="flex flex-wrap items-center gap-8">
                <span class="min-w-0 flex-1 truncate">{owner.displayName}</span>
                <Input
                  class="w-3xs"
                  aria-label="What {owner.displayName} is to this property"
                  placeholder={placeholderOf("Owner")}
                  value={owner.ownershipRole}
                  oninput={(event) =>
                    setOwnershipRole(owner.entityId, event.currentTarget.value)}
                />
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Stop holding this for {owner.displayName}"
                  onclick={() => removeOwner(owner.entityId)}
                >
                  <X class="size-16" aria-hidden="true" />
                </Button>
              </li>
            {/each}
          </ul>
        {/if}
        <OwnerPicker
          inputId="new-packet-owner"
          fieldName="Held for"
          excluded={draft.owners.map((owner) => owner.entityId)}
          onPick={addOwner}
        />
      </div>

      <div class="flex flex-col gap-8">
        <Label for="new-packet-container">Container</Label>
        <ContainerPicker
          inputId="new-packet-container"
          {locations}
          disabled={busy}
          bind:value={draft.locationId}
          onadded={onLocationsAdded}
        />
      </div>

      <div class="grid gap-16 sm:grid-cols-2">
        <div class="flex flex-col gap-8">
          <Label for="new-packet-depositor">Handed over by</Label>
          {#if depositorName === null}
            <OwnerPicker
              inputId="new-packet-depositor"
              fieldName="Handed over by"
              onPick={recordDepositor}
            />
          {:else}
            <!-- A filled seat names who is in it. A picker that went back to its ghost text once a
                 choice was made would read as an empty field with nobody chosen. -->
            <div class="flex items-center gap-8">
              <span class="min-w-0 flex-1 truncate">{depositorName}</span>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Clear who handed this over"
                onclick={clearDepositor}
              >
                <X class="size-16" aria-hidden="true" />
              </Button>
            </div>
          {/if}
        </div>
        <div class="flex flex-col gap-8">
          <!-- When the firm actually took it, which is not when this row is being typed. Property
               is regularly logged years after it was handed over. -->
          <DatePicker
            label="Handed over on"
            value={depositedAtValue}
            onValueChange={recordDepositedAt}
          />
        </div>
      </div>

      <div class="flex flex-col gap-8">
        <Label for="new-packet-notes">Notes</Label>
        <Textarea id="new-packet-notes" rows={2} disabled={busy} bind:value={draft.notes} />
      </div>

      <div class="flex flex-col gap-8">
        <label class="flex items-center gap-8">
          <Checkbox disabled={busy} bind:checked={carriedIn} />
          <span>Carried in from an earlier register</span>
        </label>
        {#if carriedIn}
          <Input
            aria-label="The number already written on this packet"
            disabled={busy}
            bind:value={draft.manualCustodyNumber}
          />
        {/if}
      </div>
    </div>
  {/snippet}
</ActionDialog>
