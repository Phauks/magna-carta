<script lang="ts">
  /*
   * The Container field of the packet form: the firm's open containers by their full path, and the
   * way to add one from inside the list that did not have it.
   *
   * IT IS A COMBOBOX, as every choice in the product is: typing narrows the list by any part of the
   * path, which is how a person finds "Box 14" among a dozen boxes. Its last row adds whatever was
   * typed as a new container, and opens a short panel under the field asking what kind it is and
   * where it sits (container-draft.ts says where it can go and why an office becomes its own node).
   *
   * A FIRM WITH NO OPEN CONTAINER MEETS THE PANEL ALREADY OPEN. An empty list is not a choice, and a
   * field whose only honest answer is "make one first" should be that answer rather than a dropdown
   * with nothing in it.
   *
   * What the panel adds is handed to the screen through `onadded` the moment the server answers, so
   * the register's Location column and the next packet's list both know it without a re-read.
   */
  import * as Combobox from "@magna-carta/design-system/combobox";
  import Button from "@magna-carta/design-system/button";
  import Input from "@magna-carta/design-system/input";
  import Label from "@magna-carta/design-system/label";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import ChoicePicker from "$lib/components/choice-picker.svelte";
  import { listOffices } from "$lib/offices/offices-api.ts";
  import {
    createCustodyLocation,
    type CreateCustodyLocationRequest,
    type CustodyLocationNode,
  } from "./custody-api.ts";
  import { LOCATION_KINDS, locationKindLabel } from "./custody-vocabulary.ts";
  import { custodyLocationOptions } from "./location-options.ts";
  import {
    containerDraftRequests,
    containerDraftShortfall,
    containerParentOptions,
    defaultContainerParent,
    kindFromName,
    STANDS_ALONE,
    type ContainerDraft,
    type ContainerOffice,
  } from "./container-draft.ts";

  let {
    locations,
    value = $bindable(null),
    inputId,
    disabled = false,
    onadded,
  }: {
    /** The firm's container tree as the screen last read it. */
    locations: readonly CustodyLocationNode[];
    /** The chosen container's id, or null. Bindable. */
    value?: string | null;
    inputId: string;
    disabled?: boolean;
    /** Containers this field created, in the order they were made, so the screen can hold them too. */
    onadded: (added: readonly CustodyLocationNode[]) => void;
  } = $props();

  const FIELD_NAME = "Container";

  let offices = $state<readonly ContainerOffice[]>([]);
  let officesRead = false;
  $effect(() => {
    if (officesRead) return;
    officesRead = true;
    void (async () => {
      const outcome = await listOffices(fetch);
      // Without the offices a container can still go inside another container or stand on its own,
      // so a failed read narrows the Inside choices rather than stopping the panel.
      if (outcome.kind === "ok") {
        offices = outcome.value.data
          .filter((office) => office.status === "active")
          .map((office) => ({ id: office.id, name: office.name, firmDefault: office.firmDefault }));
      }
    })();
  });

  const options = $derived(custodyLocationOptions(locations));
  const parentOptions = $derived(containerParentOptions(locations, offices));
  const kindOptions = LOCATION_KINDS.map((kind) => ({ value: kind, label: locationKindLabel(kind) }));

  /** What has been typed. Meaningful only while the field is being searched. */
  let query = $state("");
  /** Whether the reader is searching, rather than reading the container the field holds. */
  let searching = $state(false);
  const selectedPath = $derived(options.find((option) => option.id === value)?.path ?? "");
  const matching = $derived.by(() => {
    const needle = searching ? query.trim().toLowerCase() : "";
    return needle === "" ? options : options.filter((option) => option.path.toLowerCase().includes(needle));
  });

  // ---- the add-a-container panel ----------------------------------------------------------------

  let adding = $state(false);
  let saving = $state(false);
  let failure = $state<StatedFailure | null>(null);
  let draft = $state<ContainerDraft>({ name: "", kind: "", parent: "" });
  /** Whether the person has chosen a kind themselves, after which the name stops suggesting one. */
  let kindChosen = $state(false);

  const shortfall = $derived(containerDraftShortfall(draft));
  /** The panel cannot be put away while there is nothing to choose instead. */
  const mustAdd = $derived(options.length === 0);

  function openPanel(name: string): void {
    draft = { name, kind: kindFromName(name), parent: defaultContainerParent(locations, offices) };
    kindChosen = false;
    failure = null;
    adding = true;
  }

  // An empty tree opens the panel by itself, and an office read that lands after it fills in the
  // default office rather than leaving the panel on "on its own".
  $effect(() => {
    if (mustAdd && !adding) openPanel("");
  });
  $effect(() => {
    const known = offices;
    if (adding && draft.parent === STANDS_ALONE && known.length > 0 && locations.length === 0) {
      draft.parent = defaultContainerParent(locations, known);
    }
  });

  function renamed(name: string): void {
    draft.name = name;
    if (!kindChosen) draft.kind = kindFromName(name);
  }

  function nodeFrom(id: string, request: CreateCustodyLocationRequest): CustodyLocationNode {
    return {
      id,
      name: request.name,
      kind: request.kind,
      parentLocationId: request.parentLocationId ?? null,
      firmLocationId: request.firmLocationId ?? null,
      address: null,
      status: "active",
      notes: null,
    };
  }

  async function addContainer(): Promise<void> {
    if (shortfall !== null) return;
    saving = true;
    failure = null;
    const requests = containerDraftRequests(draft, offices);
    let container = requests.container;
    if (requests.officeRoot !== null) {
      const root = await createCustodyLocation(fetch, requests.officeRoot, crypto.randomUUID());
      if (root.kind !== "ok") {
        saving = false;
        failure = stated(
          root.failure,
          "The office could not be added to the containers.",
          "Nothing answered, so no container was added.",
        );
        return;
      }
      const rootNode = nodeFrom(root.value.id, requests.officeRoot);
      onadded([rootNode]);
      // A retry after this point must hang the container from the office that now exists, not
      // create the office a second time.
      draft.parent = `container:${rootNode.id}`;
      container = { ...container, parentLocationId: rootNode.id };
    }
    const created = await createCustodyLocation(fetch, container, crypto.randomUUID());
    saving = false;
    if (created.kind !== "ok") {
      failure = stated(
        created.failure,
        "The container could not be added.",
        "Nothing answered, so the container was not added.",
      );
      return;
    }
    const node = nodeFrom(created.value.id, container);
    onadded([node]);
    value = node.id;
    adding = false;
    searching = false;
    query = "";
  }

  function pick(picked: string | string[]): void {
    const chosen = Array.isArray(picked) ? (picked[0] ?? "") : picked;
    if (Combobox.isAddOption(chosen)) {
      const typed = query.trim();
      searching = false;
      query = "";
      if (typed !== "") openPanel(typed);
      return;
    }
    if (chosen === "") return;
    searching = false;
    query = "";
    value = chosen;
    adding = false;
  }
</script>

<div class="flex flex-col gap-8">
  {#if !mustAdd}
    <Combobox.Root
      type="single"
      disabled={disabled || saving}
      allowDeselect={false}
      items={matching.map((option) => ({ value: option.id, label: option.path }))}
      value={value ?? ""}
      inputValue={searching ? query : selectedPath}
      onValueChange={pick}
      onOpenChange={(open) => {
        // Opening offers every container again; closing puts the chosen path back, so text that was
        // typed and never chosen is not mistaken for a value.
        searching = open;
        query = "";
      }}
    >
      <Combobox.Input
        id={inputId}
        fieldName={FIELD_NAME}
        autocomplete="off"
        spellcheck={false}
        oninput={(event) => {
          searching = true;
          query = event.currentTarget.value;
        }}
      />
      <Combobox.Content>
        {#each matching as option (option.id)}
          <Combobox.Item value={option.id} label={option.path}>
            <span class="flex items-baseline justify-between gap-8">
              <span>{option.path}</span>
              <span class="text-xs text-text-muted">
                {locationKindLabel(locations.find((node) => node.id === option.id)?.kind ?? "box")}
              </span>
            </span>
          </Combobox.Item>
        {/each}
        <Combobox.AddOption fieldName={FIELD_NAME} {query} />
      </Combobox.Content>
    </Combobox.Root>
  {/if}

  {#if adding}
    <div class="flex flex-col gap-16 rounded-md border border-border-default bg-surface-subtle p-16">
      <div class="grid gap-16 sm:grid-cols-2">
        <div class="flex flex-col gap-8">
          <Label for="{inputId}-new-name">Name</Label>
          <Input
            id="{inputId}-new-name"
            disabled={disabled || saving}
            value={draft.name}
            oninput={(event) => renamed(event.currentTarget.value)}
          />
        </div>
        <div class="flex flex-col gap-8">
          <Label for="{inputId}-new-kind">Kind</Label>
          <ChoicePicker
            inputId="{inputId}-new-kind"
            label="Kind"
            options={kindOptions}
            disabled={disabled || saving}
            value={draft.kind}
            onchange={(kind) => {
              kindChosen = true;
              draft.kind = kind as ContainerDraft["kind"];
            }}
          />
        </div>
      </div>
      <div class="flex flex-col gap-8">
        <Label for="{inputId}-new-parent">Inside</Label>
        <ChoicePicker
          inputId="{inputId}-new-parent"
          label="Inside"
          options={parentOptions}
          disabled={disabled || saving}
          bind:value={draft.parent}
        />
      </div>
      {#if failure !== null}
        <FailureNotice
          failure={failure.failure}
          title="The Container Was Not Added"
          fallback={failure.fallback}
          whenSilent={failure.whenSilent}
        />
      {/if}
      <div class="flex flex-wrap items-center justify-end gap-8">
        {#if shortfall !== null}
          <span class="mr-auto text-sm text-text-muted">{shortfall}</span>
        {/if}
        {#if !mustAdd}
          <Button variant="ghost" disabled={saving} onclick={() => (adding = false)}>Cancel</Button>
        {/if}
        <Button
          variant="secondary"
          disabled={disabled || saving || shortfall !== null}
          onclick={() => void addContainer()}
        >
          {saving ? "Adding" : "Add Container"}
        </Button>
      </div>
    </div>
  {/if}
</div>
