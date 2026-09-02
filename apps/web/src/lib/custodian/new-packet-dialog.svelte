<script lang="ts">
  /*
   * Logging a packet into the register.
   *
   * WHAT A PACKET IS, WHICH IS WHY THE FORM HAS TWO SIDES. A packet is the physical thing the firm
   * holds and moves: an envelope, a deed box, a sealed wallet. It draws the custody number and it
   * has a location. What is INSIDE it is described item by item, and the two are different
   * questions asked of the same person at the same moment — so they are two columns rather than one
   * long scroll. Nothing on the right is required: property is regularly taken in sealed, and a
   * form that demanded its contents would either stop the firm recording what it just took custody
   * of, or teach somebody to invent an item.
   *
   * THE MATTER LEADS, AND IT IS REQUIRED. Property is held for a client, a client is somebody the
   * firm has a matter with, and the firm does not hold originals for anyone else. Everything else
   * on the form depends on it: the owners on offer are the matter's own parties, and the files that
   * can be attached are the ones filed on it. The API still permits a packet with no matter; this
   * screen is deliberately the stricter of the two.
   *
   * THE NUMBER IS SHOWN AND SAID TO BE TENTATIVE. It is what somebody writes on a physical label,
   * so a person filling this in wants to know what they are about to write. Nothing is allocated by
   * asking, so two people logging at once are shown the same number and only one of them gets it.
   * Saying "tentative" is the whole reason it can be shown at all.
   *
   * NOTHING IS WRITTEN UNTIL THE SUBMIT. Items and attachments are collected here and posted after
   * the packet exists, because they need its identifier. That makes the submit a short sequence
   * rather than one call, and a failure partway through is reported as what it is: the packet was
   * logged, and this part of it was not.
   */
  import * as Dialog from "@magna-carta/design-system/dialog";
  import * as Select from "@magna-carta/design-system/select";
  import Badge from "@magna-carta/design-system/badge";
  import Button, { buttonClasses } from "@magna-carta/design-system/button";
  import Checkbox from "@magna-carta/design-system/checkbox";
  import Input from "@magna-carta/design-system/input";
  import Label from "@magna-carta/design-system/label";
  import Separator from "@magna-carta/design-system/separator";
  import Textarea from "@magna-carta/design-system/textarea";
  import { DatePicker } from "@magna-carta/design-system/date-picker";
  import { placeholderOf } from "@magna-carta/design-system/formatters";
  import { parseDate, type DateValue } from "@internationalized/date";
  import Plus from "@lucide/svelte/icons/plus";
  import X from "@lucide/svelte/icons/x";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import MatterFilePicker from "$lib/components/matter-file-picker.svelte";
  import MatterPicker from "$lib/matters/matter-picker.svelte";
  import { FirmMatters } from "$lib/matters/firm-matters.svelte.ts";
  import type { MatterParty } from "$lib/directory/directory-api.ts";
  import type { DocumentSummary } from "$lib/documents/document-api.ts";
  import {
    addCustodyItem,
    createCustodyPacket,
    linkCustodyScan,
    listCustodyItemTypes,
    readNextCustodyNumber,
    type CreatedCustodyPacket,
    type CustodyItemType,
    type CustodyLocationNode,
  } from "./custody-api.ts";
  import ContainerPicker from "./container-picker.svelte";
  import OwnerPicker from "./owner-picker.svelte";
  import { scanKindLabel } from "./custody-vocabulary.ts";
  import {
    itemDraftReady,
    itemDraftRequest,
    packetDraftReady,
    packetDraftRequest,
    packetDraftShortfalls,
    EMPTY_ITEM_DRAFT,
    EMPTY_PACKET_DRAFT,
    type ItemDraft,
    type PacketDraft,
    type PacketOwnerDraft,
  } from "./packet-draft.ts";

  let {
    open = $bindable(false),
    locations,
    matterId = null,
    onCreated,
    onLocationsChanged,
  }: {
    open?: boolean;
    /** The firm's container tree, read by the surface. */
    locations: readonly CustodyLocationNode[];
    /** The matter this is being logged against, where the form was opened from one. */
    matterId?: string | null;
    onCreated: (created: CreatedCustodyPacket) => void;
    /** A container was described here, so the surface re-reads the tree. */
    onLocationsChanged: () => Promise<void> | void;
  } = $props();

  let draft = $state<PacketDraft>({ ...EMPTY_PACKET_DRAFT });
  /* Names held beside the handles, because the register stores handles and resolves none: without
     them the fields could only show `directoryPerson_01J…` back at whoever just chose. */
  let trustorName = $state<string | null>(null);
  let attachments = $state<readonly { fileId: string; name: string }[]>([]);
  let itemTypes = $state<readonly CustodyItemType[]>([]);
  let tentativeNumber = $state<string | null>(null);
  let submitting = $state(false);
  let failure = $state<StatedFailure | null>(null);
  /** What went in before something went wrong, so a partial write is reported and not swallowed. */
  let partial = $state<string | null>(null);
  let bootstrapped = false;

  const firmMatters = new FirmMatters();

  // The item being typed, which is not yet part of the draft. It joins the list on Add, so a
  // half-typed line can never be posted as a described item.
  let pending = $state<ItemDraft>({ ...EMPTY_ITEM_DRAFT });

  $effect(() => {
    if (!open || bootstrapped) return;
    bootstrapped = true;
    void firmMatters.load(fetch);
    void (async () => {
      const [types, next] = await Promise.all([
        listCustodyItemTypes(fetch),
        readNextCustodyNumber(fetch),
      ]);
      // A catalog that cannot be read leaves the form usable: the type is optional and a
      // description is what an item actually is. A number that cannot be read simply is not shown.
      if (types.kind === "ok") itemTypes = types.value.data.filter((type) => type.active);
      if (next.kind === "ok") tentativeNumber = next.value.custodyNumber;
    })();
  });

  // The matter the form was opened from is the matter it records, and a form reopened from a
  // different matter must not carry the last one's.
  $effect(() => {
    if (!open) return;
    if (matterId !== null) draft.matterId = matterId;
  });

  const typeItems = $derived(itemTypes.map((type) => ({ value: type.id, label: type.name })));
  const shortfalls = $derived(packetDraftShortfalls(draft));
  const ready = $derived(packetDraftReady(draft));

  /** A date as a calendar date, or undefined while it is empty or half-entered. */
  function asCalendarDate(value: string | null): DateValue | undefined {
    if (value === null) return undefined;
    try {
      return parseDate(value);
    } catch {
      return undefined;
    }
  }

  function addOwner(party: MatterParty): void {
    const owner: PacketOwnerDraft = {
      entityId: party.entityId,
      displayName: party.displayName ?? "Not named in the directory",
      // What they are on the matter is where the ownership role starts. Still editable: what
      // somebody is to a matter and what they are to an envelope inside it are related questions,
      // not the same one.
      ownershipRole: party.capacity ?? party.role,
    };
    draft.owners = [...draft.owners, owner];
  }

  function setOwnershipRole(entityId: string, role: string): void {
    draft.owners = draft.owners.map((owner) =>
      owner.entityId === entityId ? { ...owner, ownershipRole: role } : owner,
    );
  }

  function chooseItemType(value: string): void {
    pending.itemTypeId = value === "" ? null : value;
    const chosen = itemTypes.find((type) => type.id === value);
    // The catalog's answer about irreplaceability comes across with the type, because that is what
    // a catalog entry is for. A person can still overrule it in front of the object.
    if (chosen !== undefined) pending.intrinsicValue = chosen.intrinsicValueDefault;
  }

  function addItem(): void {
    if (!itemDraftReady(pending)) return;
    draft.items = [...draft.items, { ...pending }];
    pending = { ...EMPTY_ITEM_DRAFT };
  }

  function reset(): void {
    draft = { ...EMPTY_PACKET_DRAFT, matterId };
    pending = { ...EMPTY_ITEM_DRAFT };
    trustorName = null;
    attachments = [];
    failure = null;
    partial = null;
  }

  async function submit(): Promise<void> {
    if (!ready || submitting) return;
    submitting = true;
    failure = null;
    partial = null;
    // A retried submit must not draw a second custody number for one envelope, so every attempt
    // carries its own key and the server answers the repeat with the first result.
    const created = await createCustodyPacket(fetch, packetDraftRequest(draft), crypto.randomUUID());
    if (created.kind !== "ok") {
      submitting = false;
      failure = stated(
        created.failure,
        "The packet could not be logged.",
        "Nothing answered. Nothing was logged, so no number was drawn.",
      );
      return;
    }

    // The packet exists from here on. Anything that fails after this point is reported as a
    // shortfall of a REAL packet rather than as a failed submit, because telling somebody their
    // packet was not logged when it was is how a second one gets logged for the same envelope.
    const packet = created.value;
    const unrecorded: string[] = [];
    for (const item of draft.items) {
      const outcome = await addCustodyItem(fetch, packet.id, itemDraftRequest(item), crypto.randomUUID());
      if (outcome.kind !== "ok") unrecorded.push(item.description.trim());
    }
    for (const attachment of attachments) {
      const outcome = await linkCustodyScan(
        fetch,
        packet.id,
        { fileId: attachment.fileId, kind: "scan" },
        crypto.randomUUID(),
      );
      if (outcome.kind !== "ok") unrecorded.push(attachment.name);
    }
    submitting = false;

    if (unrecorded.length > 0) {
      partial = `${packet.custodyNumber} was logged. These were not recorded against it and can be added from the packet: ${unrecorded.join(", ")}.`;
      onCreated(packet);
      return;
    }
    onCreated(packet);
    reset();
    open = false;
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Content class="max-w-4xl">
    <div class="flex flex-col gap-16">
      <div class="flex flex-wrap items-baseline justify-between gap-8">
        <Dialog.Title>New Packet</Dialog.Title>
        {#if tentativeNumber !== null}
          <!-- What the number WOULD be. Said to be tentative because nothing is allocated by
               asking, and a number written on a label before the record exists is the one kind of
               wrong this register cannot tolerate. -->
          <span class="flex items-center gap-8">
            <span class="text-sm tabular-nums">{tentativeNumber}</span>
            <Badge
              variant="neutral"
              title="Nothing is reserved by showing it. If somebody else logs a packet first, this one takes the next number."
            >
              Tentative
            </Badge>
          </span>
        {/if}
      </div>

      <div class="grid gap-24 lg:grid-cols-2">
        <!-- The packet: what the firm is taking in, and where it goes. -->
        <div class="flex flex-col gap-16">
          <div class="flex flex-col gap-8">
            <Label for="new-packet-matter">Matter</Label>
            <MatterPicker
              inputId="new-packet-matter"
              matters={firmMatters.matters ?? []}
              value={draft.matterId}
              capped={firmMatters.capped}
              allowNone={false}
              disabled={matterId !== null}
              title={matterId !== null
                ? "Logged against the matter this was opened from."
                : undefined}
              onpick={(chosen) => {
                draft.matterId = chosen;
                // The owners on offer are the matter's parties, so a change of matter cannot leave
                // the last matter's people attached to this packet.
                draft.owners = [];
              }}
            />
            {#if firmMatters.failure !== null}
              <p class="text-xs text-text-muted">{firmMatters.failure}</p>
            {/if}
          </div>

          <div class="flex flex-col gap-8">
            <Label for="new-packet-name">Name</Label>
            <Input
              id="new-packet-name"
              bind:value={draft.name}
              placeholder={placeholderOf("Name")}
            />
          </div>

          <div class="flex flex-col gap-8">
            <Label id="new-packet-container-label">Container</Label>
            <ContainerPicker
              {locations}
              bind:value={draft.locationId}
              labelId="new-packet-container-label"
              onCreated={onLocationsChanged}
            />
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
                      placeholder={placeholderOf("Role")}
                      value={owner.ownershipRole}
                      oninput={(event) => setOwnershipRole(owner.entityId, event.currentTarget.value)}
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Stop holding this for {owner.displayName}"
                      onclick={() =>
                        (draft.owners = draft.owners.filter(
                          (candidate) => candidate.entityId !== owner.entityId,
                        ))}
                    >
                      <X class="size-16" aria-hidden="true" />
                    </Button>
                  </li>
                {/each}
              </ul>
            {/if}
            <OwnerPicker
              matterId={draft.matterId}
              inputId="new-packet-owner"
              fieldName="Held for"
              excluded={draft.owners.map((owner) => owner.entityId)}
              onPick={addOwner}
            />
          </div>

          <div class="grid gap-16 sm:grid-cols-2">
            <div class="flex flex-col gap-8">
              <Label for="new-packet-trustor">Trustor</Label>
              {#if trustorName === null}
                <OwnerPicker
                  matterId={draft.matterId}
                  inputId="new-packet-trustor"
                  fieldName="Trustor"
                  onPick={(party) => {
                    draft.trustorEntityId = party.entityId;
                    trustorName = party.displayName ?? "Not named in the directory";
                  }}
                />
              {:else}
                <!-- A filled seat names who is in it. A picker that went back to its ghost text
                     would read as an empty field with nobody chosen. -->
                <div class="flex items-center gap-8">
                  <span class="min-w-0 flex-1 truncate">{trustorName}</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Clear the trustor"
                    onclick={() => {
                      draft.trustorEntityId = null;
                      trustorName = null;
                    }}
                  >
                    <X class="size-16" aria-hidden="true" />
                  </Button>
                </div>
              {/if}
            </div>
            <div class="flex flex-col gap-8">
              <!-- When the firm actually took it, which is rarely the day this row is typed. -->
              <DatePicker
                label="Acquisition date"
                value={asCalendarDate(draft.acquiredOn)}
                onValueChange={(next) => (draft.acquiredOn = next ? next.toString() : null)}
              />
            </div>
          </div>

          <div class="flex flex-col gap-8">
            <Label for="new-packet-notes">Notes</Label>
            <Textarea id="new-packet-notes" rows={2} bind:value={draft.notes} />
          </div>

          <div class="flex flex-col gap-8">
            <Label for="new-packet-existing-number">Existing number</Label>
            <Input
              id="new-packet-existing-number"
              bind:value={draft.existingNumber}
              placeholder={placeholderOf("Existing number")}
            />
            <!-- A consequence, not an explanation: setting this changes which number the property
                 ends up under, which is the one thing a reader must know before typing in it. -->
            <p class="text-xs text-text-muted">
              For property that already carries a number from an earlier register. Set it and the
              register keeps that number instead of drawing {tentativeNumber ?? "the next one"}.
            </p>
          </div>
        </div>

        <!-- The contents: what is inside, and the copies filed with it. -->
        <div class="flex flex-col gap-16">
          <div class="flex flex-col gap-8">
            <h3 class="text-xs text-text-muted uppercase" style="letter-spacing: var(--mc-tracking-caps)">
              What is inside
            </h3>

            {#if draft.items.length > 0}
              <ul class="flex flex-col gap-8">
                {#each draft.items as item, index (index)}
                  <li class="flex items-start gap-8">
                    <span class="min-w-0 flex-1">
                      <span class="block truncate">{item.description}</span>
                      <span class="text-xs text-text-muted">
                        {itemTypes.find((type) => type.id === item.itemTypeId)?.name ?? "Not typed"}
                        {item.instrumentDate === null ? "" : ` · dated ${item.instrumentDate}`}
                        {item.intrinsicValue ? " · irreplaceable" : ""}
                      </span>
                    </span>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Remove {item.description}"
                      onclick={() =>
                        (draft.items = draft.items.filter((_, at) => at !== index))}
                    >
                      <X class="size-16" aria-hidden="true" />
                    </Button>
                  </li>
                {/each}
              </ul>
              <Separator />
            {/if}

            <div class="flex flex-col gap-8">
              <Label for="new-item-description">Description</Label>
              <Input
                id="new-item-description"
                bind:value={pending.description}
                placeholder={placeholderOf("Description")}
                onkeydown={(event) => {
                  // Enter adds the line, because this is a field somebody types a list into and
                  // reaching for the button between every one is what makes a list feel long.
                  if (event.key !== "Enter") return;
                  event.preventDefault();
                  addItem();
                }}
              />
              <div class="grid gap-8 sm:grid-cols-2">
                <div class="flex flex-col gap-4">
                  <Label id="new-item-type-label">Type</Label>
                  <Select.Root
                    type="single"
                    items={typeItems}
                    value={pending.itemTypeId ?? ""}
                    onValueChange={chooseItemType}
                    allowDeselect={false}
                    disabled={typeItems.length === 0}
                  >
                    <Select.Trigger aria-labelledby="new-item-type-label">
                      <Select.Value placeholder={placeholderOf("Type")} />
                    </Select.Trigger>
                    <Select.Content>
                      {#each typeItems as item (item.value)}
                        <Select.Item value={item.value} label={item.label} />
                      {/each}
                    </Select.Content>
                  </Select.Root>
                </div>
                <div class="flex flex-col gap-4">
                  <DatePicker
                    label="Dated"
                    value={asCalendarDate(pending.instrumentDate)}
                    onValueChange={(next) =>
                      (pending.instrumentDate = next ? next.toString() : null)}
                  />
                </div>
              </div>
              <label class="flex items-start gap-8">
                <Checkbox bind:checked={pending.intrinsicValue} />
                <span class="flex flex-col gap-4">
                  <span>An irreplaceable original</span>
                  <span class="text-xs text-text-muted">
                    It can never be destroyed, and that refusal has no override.
                  </span>
                </span>
              </label>
              <div class="flex justify-end">
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={!itemDraftReady(pending)}
                  onclick={addItem}
                >
                  <Plus class="size-16" aria-hidden="true" />
                  Add Item
                </Button>
              </div>
            </div>
          </div>

          <Separator />

          <div class="flex flex-col gap-8">
            <h3 class="text-xs text-text-muted uppercase" style="letter-spacing: var(--mc-tracking-caps)">
              Copies filed with it
            </h3>
            {#if attachments.length > 0}
              <ul class="flex flex-col gap-8">
                {#each attachments as attachment (attachment.fileId)}
                  <li class="flex items-center gap-8">
                    <span class="min-w-0 flex-1 truncate">{attachment.name}</span>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Remove {attachment.name}"
                      onclick={() =>
                        (attachments = attachments.filter(
                          (candidate) => candidate.fileId !== attachment.fileId,
                        ))}
                    >
                      <X class="size-16" aria-hidden="true" />
                    </Button>
                  </li>
                {/each}
              </ul>
            {/if}
            <Label for="new-packet-attachment">Document on this matter</Label>
            <MatterFilePicker
              matterId={draft.matterId}
              inputId="new-packet-attachment"
              excluded={attachments.map((attachment) => attachment.fileId)}
              onPick={(document: DocumentSummary) =>
                (attachments = [...attachments, { fileId: document.id, name: document.name }])}
            />
            <p class="text-xs text-text-muted">
              A copy is never a substitute for the original. Filed as {scanKindLabel("scan")}; a
              photograph or an appraisal is filed from the packet itself.
            </p>
          </div>
        </div>
      </div>

      {#if partial !== null}
        <!-- The packet EXISTS. Saying the submit failed would invite a second packet for one
             envelope, which is the worst outcome available here. -->
        <p class="text-sm">{partial}</p>
      {/if}

      {#if failure !== null}
        <FailureNotice
          failure={failure.failure}
          title="The Packet Was Not Logged"
          fallback={failure.fallback}
          whenSilent={failure.whenSilent}
        />
      {/if}

      <div class="flex items-center justify-end gap-8">
        {#if shortfalls[0] !== undefined}
          <span class="me-auto text-xs text-text-muted">{shortfalls[0]}</span>
        {/if}
        <Dialog.Close
          class={buttonClasses({ variant: "secondary", size: "default" })}
          disabled={submitting}
        >
          {partial === null ? "Cancel" : "Close"}
        </Dialog.Close>
        <Button variant="primary" disabled={!ready || submitting} onclick={submit}>
          {submitting ? "Logging" : "Log Packet"}
        </Button>
      </div>
    </div>
  </Dialog.Content>
</Dialog.Root>
