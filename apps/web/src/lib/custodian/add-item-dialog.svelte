<script lang="ts">
  /*
   * Describing one thing inside a packet.
   *
   * AN ITEM IS THE UNIT OF DESCRIPTION, AND A PACKET IS THE UNIT OF CUSTODY. The envelope is what
   * the firm holds, moves and numbers; the will inside it is what somebody rings up to ask about.
   * They are separate because one envelope routinely holds several instruments, each with its own
   * date, its own status and its own review, and because property arrives sealed: the packet is
   * logged the day it is taken in and its contents are described whenever it is next opened.
   *
   * THE IRREPLACEABLE TICK IS THE ONE ANSWER ON THIS FORM THAT CANNOT BE WALKED BACK. An item
   * recorded as an irreplaceable original is never destructible, and that refusal has no override
   * anywhere in the subsystem, not in the destruction workflow and not in the database. So it is
   * drawn with what it means beside it rather than as a bare checkbox, and the firm's own item-type
   * catalog pre-answers it wherever the catalog has an answer.
   *
   * NO DECLARED VALUE IS ASKED FOR HERE, DELIBERATELY. The contract takes an amount with a currency
   * and the firm declares no currency anywhere, so the only way this form could send one is by
   * inventing it. A figure of record invented by a screen is worse than an absent one; the field
   * belongs to whatever surface records an appraisal, which knows what the appraisal was in.
   */
  import * as Dialog from "@magna-carta/design-system/dialog";
  import * as Select from "@magna-carta/design-system/select";
  import Button, { buttonClasses } from "@magna-carta/design-system/button";
  import Checkbox from "@magna-carta/design-system/checkbox";
  import Label from "@magna-carta/design-system/label";
  import Textarea from "@magna-carta/design-system/textarea";
  import { DatePicker } from "@magna-carta/design-system/date-picker";
  import { placeholderOf } from "@magna-carta/design-system/formatters";
  import { parseDate, type DateValue } from "@internationalized/date";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import { addCustodyItem, listCustodyItemTypes, type CustodyItemType } from "./custody-api.ts";
  import {
    itemDraftReady,
    itemDraftRequest,
    itemDraftShortfalls,
    EMPTY_ITEM_DRAFT,
    type ItemDraft,
  } from "./packet-draft.ts";

  let {
    open = $bindable(false),
    packetId,
    onAdded,
  }: {
    open?: boolean;
    /** The packet being described. Null while no packet is open. */
    packetId: string | null;
    onAdded: () => void;
  } = $props();

  let draft = $state<ItemDraft>({ ...EMPTY_ITEM_DRAFT });
  let itemTypes = $state<readonly CustodyItemType[]>([]);
  let submitting = $state(false);
  let failure = $state<StatedFailure | null>(null);
  let catalogRead = false;

  // The firm's own catalog of what a packet may contain, read once. A catalog that cannot be read
  // leaves the form usable: the type is optional, and a description is what an item actually is.
  $effect(() => {
    if (!open || catalogRead) return;
    catalogRead = true;
    void (async () => {
      const outcome = await listCustodyItemTypes(fetch);
      if (outcome.kind === "ok") itemTypes = outcome.value.data.filter((type) => type.active);
    })();
  });

  const typeItems = $derived(itemTypes.map((type) => ({ value: type.id, label: type.name })));
  const shortfalls = $derived(itemDraftShortfalls(draft));
  const ready = $derived(itemDraftReady(draft) && packetId !== null);

  /** The instrument date as a calendar date, or undefined while it is empty or half-entered. */
  const instrumentDateValue = $derived.by(() => {
    if (draft.instrumentDate === null) return undefined;
    try {
      return parseDate(draft.instrumentDate);
    } catch {
      return undefined;
    }
  });

  function recordInstrumentDate(next: DateValue | undefined): void {
    draft.instrumentDate = next ? next.toString() : null;
  }

  /*
   * Choosing a type carries the catalog's own answer about irreplaceability across with it, because
   * that is what a catalog entry is for: a firm that has declared "original will" irreplaceable has
   * said so once and should not have to remember it at every will. A person can still overrule it
   * in front of the object, and the tick they leave is the one that is sent.
   */
  function chooseType(value: string): void {
    draft.itemTypeId = value === "" ? null : value;
    const chosen = itemTypes.find((type) => type.id === value);
    if (chosen !== undefined) draft.intrinsicValue = chosen.intrinsicValueDefault;
  }

  function reset(): void {
    draft = { ...EMPTY_ITEM_DRAFT };
    failure = null;
  }

  async function submit(): Promise<void> {
    if (!ready || submitting || packetId === null) return;
    submitting = true;
    failure = null;
    // A retried submit must not describe the same instrument twice, so every attempt carries its
    // own key and the server answers the repeat with the first result.
    const outcome = await addCustodyItem(
      fetch,
      packetId,
      itemDraftRequest(draft),
      crypto.randomUUID(),
    );
    submitting = false;
    if (outcome.kind === "ok") {
      onAdded();
      reset();
      open = false;
      return;
    }
    failure = stated(
      outcome.failure,
      "The item could not be described.",
      "Nothing answered. Nothing was recorded against this packet.",
    );
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Content class="max-w-xl">
    <div class="flex flex-col gap-16">
      <div class="flex flex-col gap-8">
        <Dialog.Title>Describe An Item</Dialog.Title>
        <Dialog.Description>
          One thing inside this packet. A packet holding a will and two codicils is three items.
        </Dialog.Description>
      </div>

      <div class="flex flex-col gap-8">
        <Label for="new-item-description">Description</Label>
        <Textarea id="new-item-description" rows={2} bind:value={draft.description} />
      </div>

      <div class="grid gap-16 sm:grid-cols-2">
        <div class="flex flex-col gap-8">
          <Label id="new-item-type-label">Type</Label>
          <Select.Root
            type="single"
            items={typeItems}
            value={draft.itemTypeId ?? ""}
            onValueChange={chooseType}
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
        <div class="flex flex-col gap-8">
          <!-- The date on the instrument itself, which is not the date the firm took it in. -->
          <DatePicker
            label="Dated"
            value={instrumentDateValue}
            onValueChange={recordInstrumentDate}
          />
        </div>
      </div>

      <label class="flex items-start gap-8">
        <Checkbox bind:checked={draft.intrinsicValue} />
        <span class="flex flex-col gap-4">
          <span>An irreplaceable original</span>
          <span class="text-xs text-text-muted">
            It can never be destroyed, and that refusal has no override.
          </span>
        </span>
      </label>

      {#if failure !== null}
        <FailureNotice
          failure={failure.failure}
          title="The Item Was Not Recorded"
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
          Cancel
        </Dialog.Close>
        <Button variant="primary" disabled={!ready || submitting} onclick={submit}>
          {submitting ? "Recording" : "Record Item"}
        </Button>
      </div>
    </div>
  </Dialog.Content>
</Dialog.Root>
