<script lang="ts">
  /*
   * Where the property is kept, chosen from the firm's container tree — and describable here when
   * the tree has nothing in it yet.
   *
   * WHY CREATION LIVES ON THIS FIELD. A packet must go into a container, and a firm that has
   * described none has nowhere to put its first one. The field was therefore a dead end on exactly
   * the day it mattered most: somebody standing at a safe with an original in their hand, unable to
   * record it because the dropdown was empty and nothing anywhere in the product could fill it.
   * Designing the tree properly is still a considered job for whoever runs the firm's storage; this
   * only refuses to make the first step impossible.
   *
   * A CONTAINER MADE HERE IS A REAL CONTAINER, not a special one. It goes through the same endpoint
   * as any other, carries a kind so a safe is not filed as a bank vault, and nests under whatever
   * was selected when the form was opened — which is what makes "Box 4 inside the Reno safe" the
   * ordinary thing to record rather than a second visit to a settings screen.
   */
  import * as Select from "@magna-carta/design-system/select";
  import Button from "@magna-carta/design-system/button";
  import Input from "@magna-carta/design-system/input";
  import Label from "@magna-carta/design-system/label";
  import Plus from "@lucide/svelte/icons/plus";
  import X from "@lucide/svelte/icons/x";
  import { placeholderOf } from "@magna-carta/design-system/formatters";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import {
    createCustodyLocation,
    type CustodyLocationNode,
  } from "./custody-api.ts";
  import { custodyLocationOptions } from "./location-options.ts";
  import { locationKindLabel, CUSTODY_LOCATION_KINDS } from "./custody-vocabulary.ts";

  let {
    locations,
    value = $bindable(null),
    labelId,
    disabled = false,
    onCreated,
  }: {
    /** The firm's container tree as last read. */
    locations: readonly CustodyLocationNode[];
    /** The chosen container, or null. */
    value?: string | null;
    /** The id of the Label naming this field. */
    labelId: string;
    disabled?: boolean;
    /** A container was described. The surface re-reads the tree; this hands over the new node. */
    onCreated: (locationId: string) => Promise<void> | void;
  } = $props();

  let describing = $state(false);
  let newName = $state("");
  let newKind = $state<(typeof CUSTODY_LOCATION_KINDS)[number]>("safe");
  let saving = $state(false);
  let failure = $state<StatedFailure | null>(null);

  const options = $derived(custodyLocationOptions(locations));
  const items = $derived(options.map((option) => ({ value: option.id, label: option.path })));
  const kindItems = CUSTODY_LOCATION_KINDS.map((kind) => ({
    value: kind,
    label: locationKindLabel(kind),
  }));

  const ready = $derived(newName.trim() !== "");

  async function describe(): Promise<void> {
    if (!ready || saving) return;
    saving = true;
    failure = null;
    const parentLocationId = value;
    const outcome = await createCustodyLocation(
      fetch,
      {
        name: newName.trim(),
        kind: newKind,
        // Nested under whatever was already chosen, so describing a box while a safe is selected
        // puts the box in the safe rather than standing it beside the building.
        ...(parentLocationId === null ? {} : { parentLocationId }),
      },
      crypto.randomUUID(),
    );
    saving = false;
    if (outcome.kind === "ok") {
      await onCreated(outcome.value.id);
      value = outcome.value.id;
      newName = "";
      describing = false;
      return;
    }
    failure = stated(
      outcome.failure,
      "The container could not be described.",
      "Nothing answered. The container was not described.",
    );
  }
</script>

<div class="flex flex-col gap-8">
  <div class="flex items-end gap-8">
    <div class="min-w-0 flex-1">
      <Select.Root
        type="single"
        {items}
        value={value ?? ""}
        onValueChange={(chosen) => (value = chosen === "" ? null : chosen)}
        allowDeselect={false}
        disabled={disabled || items.length === 0}
      >
        <Select.Trigger class="w-full" aria-labelledby={labelId}>
          <Select.Value placeholder={placeholderOf("Container")} />
        </Select.Trigger>
        <Select.Content>
          {#each items as item (item.value)}
            <Select.Item value={item.value} label={item.label} />
          {/each}
        </Select.Content>
      </Select.Root>
    </div>
    <Button
      variant="secondary"
      size="icon"
      {disabled}
      aria-label={describing ? "Stop describing a container" : "Describe a container"}
      title={describing ? "Stop describing a container" : "Describe a container"}
      onclick={() => (describing = !describing)}
    >
      {#if describing}
        <X class="size-16" aria-hidden="true" />
      {:else}
        <Plus class="size-16" aria-hidden="true" />
      {/if}
    </Button>
  </div>

  {#if items.length === 0 && !describing}
    <p class="text-xs text-text-muted">
      No container has been described yet, and a packet has to go into one.
    </p>
  {/if}

  {#if describing}
    <div class="flex flex-col gap-8 rounded-md border border-border-default p-12">
      <div class="grid gap-8 sm:grid-cols-2">
        <div class="flex flex-col gap-4">
          <Label for="new-container-name">Name</Label>
          <Input
            id="new-container-name"
            bind:value={newName}
            placeholder={placeholderOf("Name")}
          />
        </div>
        <div class="flex flex-col gap-4">
          <Label id="new-container-kind-label">Kind</Label>
          <Select.Root
            type="single"
            items={kindItems}
            value={newKind}
            onValueChange={(chosen) =>
              (newKind = chosen as (typeof CUSTODY_LOCATION_KINDS)[number])}
            allowDeselect={false}
          >
            <Select.Trigger aria-labelledby="new-container-kind-label">
              <Select.Value />
            </Select.Trigger>
            <Select.Content>
              {#each kindItems as item (item.value)}
                <Select.Item value={item.value} label={item.label} />
              {/each}
            </Select.Content>
          </Select.Root>
        </div>
      </div>
      {#if value !== null}
        <p class="text-xs text-text-muted">
          Inside {options.find((option) => option.id === value)?.path ?? "the chosen container"}.
        </p>
      {/if}
      {#if failure !== null}
        <FailureNotice
          failure={failure.failure}
          title="The Container Was Not Described"
          fallback={failure.fallback}
          whenSilent={failure.whenSilent}
        />
      {/if}
      <div class="flex justify-end">
        <Button variant="secondary" size="sm" disabled={!ready || saving} onclick={describe}>
          {saving ? "Describing" : "Describe It"}
        </Button>
      </div>
    </div>
  {/if}
</div>
