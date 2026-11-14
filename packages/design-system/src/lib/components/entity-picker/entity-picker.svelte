<script lang="ts">
  /*
   * EntityPicker — the one field a person or an organization is chosen in.
   *
   * THE PICKER NEVER FETCHES. The directory is the firm's own record, not a bounded set anything
   * could hand this field as an array, so the caller supplies a SEARCH and the field owns everything
   * around it: letting the typed text settle, refusing to ask below the floor, abandoning an answer a
   * newer question has overtaken, and telling a failed search apart from an empty directory. The
   * rules themselves live in picker-search.ts, where they are tested without a browser; this file
   * only calls them and draws what they decide.
   *
   * A FIELD THAT HOLDS A CHOSEN PERSON SHOWS WHAT IT HOLDS AT REST. In single mode the input names
   * the selection whenever nobody is typing in it; arriving in the field selects that text so typing
   * replaces it and starts a fresh search, and leaving without picking returns the field to naming
   * the selection. A filled seat that renders its ghost text reads as an empty field with nobody in
   * it. The chosen entity also stands beside the field as a chip, which is where the glyph and the
   * remove control live.
   *
   * In multiple mode the picks are chips above the field, the field empties after each pick, and
   * the combobox is remounted per pick — its internal single-select value is not consumer-bindable,
   * and a stale one would treat re-picking a removed entity as a deselect.
   *
   * THE LIST IS A RANKED ANSWER, NEVER A LISTING. Hits render in the order the search gave them —
   * the server's relevance order — and a capped answer says so beneath the list, because a list that
   * hides that reads as the firm's whole record.
   *
   * Filtering is consumer-controlled in this house: bits' inputValue is non-bindable, so the typed
   * text is captured from the Input's oninput and handed back as the controlled inputValue.
   *
   * A FIELD THAT CAN MAKE WHAT IT CANNOT FIND SAYS SO BEFORE ANYTHING IS TYPED. Given `onCreate`,
   * a New control stands beside the field — a button when the field offers one kind, a menu of
   * Person and Organization when it offers both — and the list ends with an add row per kind that
   * carries whatever was typed. Both hand the caller the typed text and the kind wanted; the caller
   * makes the record and writes it back as the selection. The control is top-level on purpose
   * (owner's direction, 2026-09-05): a way to add a record that only appears after a failed search
   * is a way you find by accident.
   *
   * `createBeside` false drops that control and keeps the rows, for the one shape where the reason
   * above does not hold: a dense form where the field is one of many and the record is made from
   * inside the list every time anyway (owner ruling, 2026-09-08, on the call log's contact field —
   * "get rid of the New button since new can be made within the dropdown"). It is off by exception
   * and on by default, so the 2026-09-05 direction still governs every field that says nothing.
   */
  import type { HTMLAttributes } from "svelte/elements";
  import * as Combobox from "../combobox/index.ts";
  import * as DropdownMenu from "../dropdown-menu/index.ts";
  import Building2 from "@lucide/svelte/icons/building-2";
  import Plus from "@lucide/svelte/icons/plus";
  import User from "@lucide/svelte/icons/user";
  import X from "@lucide/svelte/icons/x";
  import Button, { buttonClasses } from "../button/index.ts";
  import EntityIdentity from "../entity-identity/entity-identity.svelte";
  import type { EntityKind } from "../entity-identity/types.ts";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import type { WithElementRef } from "../../internal/types.ts";
  import {
    CAPPED_SENTENCE,
    DEFAULT_MINIMUM_QUERY_LENGTH,
    NEW_CONTROL_LABEL,
    SEARCH_SETTLE_MILLISECONDS,
    addRowKind,
    addRowSentence,
    addRowValue,
    newControlName,
    offerableEntities,
    runEntitySearch,
    searchRequestFor,
    tooShortSentence,
  } from "./picker-search.ts";
  import type { EntityPickerStatus, EntitySearch, PickableEntity } from "./types.ts";

  const EVERY_KIND: readonly EntityKind[] = ["person", "organization"];
  /*
   * What the list SAYS rides in the listbox as rows, the way the add row does: a listbox may hold
   * only options, and a button or a paragraph among them is both invalid and unreachable by the
   * arrow keys. A note is a disabled row nobody can pick; trying again is an enabled row, so a
   * keyboard user whose focus stays in the field can reach it.
   */
  const NOTE_ROW_VALUE = "mc-entity-picker:note";
  const RETRY_ROW_VALUE = "mc-entity-picker:retry";
  const refusalId = $props.id();

  let {
    search,
    multiple = false,
    value = $bindable(null),
    values = $bindable([]),
    kinds = EVERY_KIND,
    excluded = [],
    minimumQueryLength = DEFAULT_MINIMUM_QUERY_LENGTH,
    label = "Person or organization",
    inputId,
    disabled = false,
    disabledReason,
    onSelect,
    onClear,
    onCreate,
    createRefusal,
    createBeside = true,
    ref = $bindable(null),
    class: className,
    ...restProps
  }: WithElementRef<HTMLAttributes<HTMLDivElement>, HTMLDivElement> & {
    /** The seam: how the directory is asked. The field never fetches on its own. */
    search: EntitySearch;
    /** Whether the field collects several entities as chips rather than holding one. */
    multiple?: boolean;
    /** The selection in single mode. Bindable; null means nobody is chosen. */
    value?: PickableEntity | null;
    /** The selections in multiple mode. Bindable; the caller owns the set. */
    values?: readonly PickableEntity[];
    /** Which sides of the directory the field offers. A hit of another kind is left out. */
    kinds?: readonly EntityKind[];
    /** Handles never offered, whatever the search finds. Matched by handle, never by name. */
    excluded?: readonly string[];
    /** The shortest query worth asking. Below it the field says what is missing. */
    minimumQueryLength?: number;
    /** The field's own name, as it is written beside the control. It is also the ghost text. */
    label?: string;
    /** The input's id, so the caller's Label can point at it. */
    inputId?: string;
    /** Refuses the field while keeping it visible. */
    disabled?: boolean;
    /** Why the field is refused. Stated on the refused input. */
    disabledReason?: string;
    /** An entity was picked. Fires after `value` or `values` has been written. */
    onSelect?: (entity: PickableEntity) => void;
    /** The single selection was removed. Fires after `value` has been cleared. */
    onClear?: () => void;
    /**
     * Given, the field can make what it cannot find: a New control stands beside it and the list
     * ends with a row per offered kind that adds whatever is typed. Either hands the trimmed query
     * (empty from the control when nothing was typed) and the kind wanted here, and changes no
     * selection; the caller makes the record and hands it back by writing `value` or `values`.
     */
    onCreate?: (typed: string, kind: EntityKind) => void;
    /**
     * Why the field cannot make a record right now — a permission the reader lacks. Present, the New
     * control stays and renders refused carrying this line, and the list offers no add row: a
     * control that vanishes reads as a capability that does not exist.
     */
    createRefusal?: string;
    /**
     * Whether the New control stands beside the field. False leaves the list's own add rows as the
     * one way to make a record here — for a dense form where a control per field is chrome.
     */
    createBeside?: boolean;
  } = $props();

  /** What is in the input, controlled so the field can be returned to naming its selection. */
  let fieldText = $state("");
  /** What a person has typed since they arrived. Only oninput writes it; it is the question asked. */
  let query = $state("");
  let open = $state(false);
  let status = $state<EntityPickerStatus>("idle");
  let hits = $state<readonly PickableEntity[]>([]);
  let capped = $state(false);
  let missing = $state(0);
  /** The query the last search was for, so a failed one can be asked again as it was. */
  let askedQuery = $state("");
  /** The question that is out. Plain, not state: nothing renders from it. */
  let pending: AbortController | null = null;
  // Picking the retry row is a pick, and a pick closes the list; this holds it open for that one.
  let holdOpenForRetry = false;

  /*
   * What the field may offer: the hits less what the caller excluded, less what is already picked
   * in multiple mode, less any kind the field does not offer. The order is the search's own.
   */
  const left = $derived(
    multiple ? [...excluded, ...values.map((picked) => picked.identifier)] : excluded,
  );
  const offered = $derived(
    offerableEntities(hits, left).filter((hit) => kinds.includes(hit.kind)),
  );
  const typedQuery = $derived(query.trim());
  const listboxItems = $derived(offered.map((hit) => ({ value: hit.identifier, label: hit.name })));
  /** The kinds the field can make, in the directory's own order: none unless the caller can create. */
  const creatable = $derived(
    onCreate === undefined ? [] : EVERY_KIND.filter((kind) => kinds.includes(kind)),
  );
  /** Whether the list may end with an add row: the caller can create, and nothing refuses it. */
  const offersAddRow = $derived(createRefusal === undefined);
  const newRefused = $derived(disabled || createRefusal !== undefined);
  const newTitle = $derived(
    createRefusal ?? (disabled ? disabledReason : undefined) ?? newControlName(creatable),
  );
  const KIND_GLYPH = { person: User, organization: Building2 } as const;
  /** Remounts the combobox per pick in multiple mode; single mode keeps one instance. */
  const mountKey = $derived(
    multiple ? values.map((picked) => picked.identifier).join("|") : "single",
  );

  function abortPending(): void {
    pending?.abort();
    pending = null;
  }

  async function ask(text: string): Promise<void> {
    abortPending();
    const controller = new AbortController();
    pending = controller;
    askedQuery = text;
    status = "searching";
    open = true;
    const outcome = await runEntitySearch(search, text, controller.signal);
    // A newer question is out; whatever this one said is not the answer to it.
    if (pending !== controller || outcome.kind === "superseded") return;
    pending = null;
    if (outcome.kind === "failed") {
      hits = [];
      capped = false;
      status = "failed";
      return;
    }
    hits = outcome.answer.hits;
    capped = outcome.answer.capped;
    status = "answered";
  }

  // The typed text settles before it is asked, and is only asked once it clears the floor. Nothing
  // typed closes the list and abandons any question that was out.
  $effect(() => {
    const request = searchRequestFor(query, minimumQueryLength);
    if (request.kind === "nothing") {
      abortPending();
      status = "idle";
      hits = [];
      capped = false;
      open = false;
      return;
    }
    if (request.kind === "too-short") {
      abortPending();
      status = "too-short";
      missing = request.missing;
      hits = [];
      capped = false;
      open = true;
      return;
    }
    const timer = setTimeout(() => void ask(request.query), SEARCH_SETTLE_MILLISECONDS);
    return () => clearTimeout(timer);
  });

  // A question still out when the field goes away is nobody's to answer.
  $effect(() => () => abortPending());

  // At rest the field names its selection, including one the caller wrote — a value handed over at
  // mount, or the entity a caller creates and hands back after the add row. While the list is open
  // the text is the person's, and nothing here touches it.
  $effect(() => {
    const resting = multiple ? "" : (value?.name ?? "");
    if (!open) fieldText = resting;
  });

  function capture(event: Event & { currentTarget: HTMLInputElement }): void {
    fieldText = event.currentTarget.value;
    query = fieldText;
  }

  /** Whether the mouse release that follows a click-arrival must leave the selection alone. */
  let holdSelection = false;

  /** Arriving in the field selects what it names, so typing replaces it. */
  function arrive(event: Event & { currentTarget: HTMLInputElement }): void {
    if (event.currentTarget.value === "") return;
    event.currentTarget.select();
    holdSelection = true;
  }

  /*
   * A click that brings focus fires focus before its release, and the release then collapses the
   * selection to a caret — undoing the arrival. The first release after an arrival is refused; every
   * later click places the caret as usual.
   */
  function release(event: MouseEvent): void {
    if (!holdSelection) return;
    holdSelection = false;
    event.preventDefault();
  }

  /** Leaving without a pick returns the field to naming the selection. */
  function settle(next: boolean): void {
    if (!next && holdOpenForRetry) {
      holdOpenForRetry = false;
      return;
    }
    open = next;
    if (next) return;
    query = "";
    fieldText = multiple ? "" : (value?.name ?? "");
  }

  function pick(chosen: string | string[]): void {
    const identifier = Array.isArray(chosen) ? (chosen[0] ?? "") : chosen;
    if (identifier === "") return;
    if (identifier === RETRY_ROW_VALUE) {
      holdOpenForRetry = true;
      retry();
      return;
    }
    if (identifier === NOTE_ROW_VALUE) return;
    // The one-kind add row (the combobox's own) and the per-kind rows both hand over the typed text;
    // the one-kind row's kind is the only kind the field offers.
    const addKind = Combobox.isAddOption(identifier) ? (creatable[0] ?? null) : addRowKind(identifier);
    if (addKind !== null) {
      const wanted = typedQuery;
      query = "";
      fieldText = multiple ? "" : (value?.name ?? "");
      open = false;
      if (wanted !== "") onCreate?.(wanted, addKind);
      return;
    }
    const entity = offered.find((hit) => hit.identifier === identifier);
    if (entity === undefined) return;
    query = "";
    open = false;
    if (multiple) {
      fieldText = "";
      values = [...values, entity];
    } else {
      fieldText = entity.name;
      value = entity;
    }
    onSelect?.(entity);
  }

  function clearSingle(): void {
    value = null;
    fieldText = "";
    query = "";
    onClear?.();
  }

  function removePicked(entity: PickableEntity): void {
    values = values.filter((kept) => kept.identifier !== entity.identifier);
  }

  function retry(): void {
    if (askedQuery !== "") void ask(askedQuery);
  }

  /** The New control: whatever is typed travels with the kind, so the caller can seed its form. */
  function create(kind: EntityKind): void {
    const wanted = typedQuery;
    abortPending();
    query = "";
    open = false;
    fieldText = multiple ? "" : (value?.name ?? "");
    onCreate?.(wanted, kind);
  }
</script>

<div bind:this={ref} class={mergeClasses("mc-entity-picker", className)} {...restProps}>
  {#if multiple && values.length > 0}
    <div class="mc-entity-picker-chips">
      {#each values as entity (entity.identifier)}
        <EntityIdentity
          size="sm"
          kind={entity.kind}
          name={entity.name}
          {disabled}
          {disabledReason}
          onRemove={() => removePicked(entity)}
        />
      {/each}
    </div>
  {/if}

  <div class="mc-entity-picker-field">
    {#key mountKey}
      <Combobox.Root
        type="single"
        {disabled}
        allowDeselect={false}
        items={listboxItems}
        value={multiple ? "" : (value?.identifier ?? "")}
        inputValue={fieldText}
        {open}
        onOpenChange={settle}
        onValueChange={pick}
      >
        <Combobox.Input
          id={inputId}
          fieldName={label}
          aria-label={label}
          autocomplete="off"
          title={disabled ? disabledReason : undefined}
          aria-describedby={disabled && disabledReason !== undefined ? refusalId : undefined}
          class="mc-entity-picker-input"
          oninput={capture}
          onfocus={arrive}
          onmouseup={release}
          onblur={() => (holdSelection = false)}
        />
        <Combobox.Content>
          {#if status === "idle"}
            <Combobox.Item value={NOTE_ROW_VALUE} label="" disabled class="mc-entity-picker-note">
              {tooShortSentence(minimumQueryLength)}
            </Combobox.Item>
          {:else if status === "too-short"}
            <Combobox.Item value={NOTE_ROW_VALUE} label="" disabled class="mc-entity-picker-note">
              {tooShortSentence(missing)}
            </Combobox.Item>
          {:else if status === "searching"}
            <Combobox.Item value={NOTE_ROW_VALUE} label="" disabled class="mc-entity-picker-note">
              Searching the directory
            </Combobox.Item>
          {:else if status === "failed"}
            <!--
              A search that could not run is stated rather than rendered as an empty directory: the
              two are the same picture and they are not the same fact.
            -->
            <Combobox.Item value={NOTE_ROW_VALUE} label="" disabled class="mc-entity-picker-note">
              Couldn't search the directory.
            </Combobox.Item>
            <Combobox.Item value={RETRY_ROW_VALUE} label="Try Again" class="mc-entity-picker-retry">
              Try Again
            </Combobox.Item>
          {:else if offered.length === 0}
            <Combobox.Item value={NOTE_ROW_VALUE} label="" disabled class="mc-entity-picker-note">
              No record matches that search.
            </Combobox.Item>
          {:else}
            {#each offered as hit (hit.identifier)}
              <Combobox.Item
                value={hit.identifier}
                label={hit.name}
                class="mc-entity-picker-item"
              >
                <EntityIdentity kind={hit.kind} name={hit.name} aside={hit.aside ?? null} />
              </Combobox.Item>
            {/each}
            {#if capped}
              <Combobox.Item value={NOTE_ROW_VALUE} label="" disabled class="mc-entity-picker-note">
                {CAPPED_SENTENCE}
              </Combobox.Item>
            {/if}
          {/if}
          {#if creatable.length === 1 && offersAddRow && status !== "idle"}
            <Combobox.AddOption fieldName={label} query={typedQuery} />
          {:else if creatable.length > 1 && offersAddRow && status !== "idle"}
            <!-- One row per kind, because the caller has to be told which record to make. The
                 label is the typed value, as the combobox's own add row does it, so a pick never
                 leaves the sentence in the field. -->
            {#each creatable as kind (kind)}
              <Combobox.Item
                value={addRowValue(kind)}
                label={typedQuery}
                class="mc-combobox-add-option"
              >
                {addRowSentence(kind, typedQuery)}
              </Combobox.Item>
            {/each}
          {/if}
        </Combobox.Content>
      </Combobox.Root>
    {/key}

    {#if !multiple && value !== null}
      <!--
        The field already names what it holds, so nothing beside it says the name again. What stands
        beside it is the one act a filled field owns: letting it go. Refused, it stays and says why.
      -->
      <button
        type="button"
        class="mc-entity-picker-clear"
        {disabled}
        title={disabled ? disabledReason : "Remove"}
        aria-label={`Remove ${value.name}`}
        onclick={clearSingle}
      >
        <X class="mc-entity-picker-clear-icon" aria-hidden="true" />
      </button>
    {/if}

    {#if !createBeside}
      <!-- Nothing beside the field: the list's add row is the way a record is made here. -->
    {:else if creatable.length === 1}
      <!-- One kind: the control makes it. Refused with the field, and saying why. It stands after
           the selection's own remove control, which belongs to the field's content; this belongs
           to the row. -->
      <Button
        variant="secondary"
        size="sm"
        class="mc-entity-picker-new"
        disabled={newRefused}
        title={newTitle}
        aria-label={newControlName(creatable)}
        onclick={() => create(creatable[0] ?? "person")}
      >
        <Plus class="mc-entity-picker-new-glyph" aria-hidden="true" />
        {NEW_CONTROL_LABEL}
      </Button>
    {:else if creatable.length > 1}
      <!-- Both kinds: the control is a menu, so the caller is told which record to make. -->
      <DropdownMenu.Root>
        <DropdownMenu.Trigger
          class={mergeClasses(buttonClasses({ variant: "secondary", size: "sm" }), "mc-entity-picker-new")}
          disabled={newRefused}
          title={newTitle}
          aria-label={newControlName(creatable)}
        >
          <Plus class="mc-entity-picker-new-glyph" aria-hidden="true" />
          {NEW_CONTROL_LABEL}
        </DropdownMenu.Trigger>
        <DropdownMenu.Content align="end" style="min-inline-size: var(--mc-size-popover)">
          {#each creatable as kind (kind)}
            {@const Glyph = KIND_GLYPH[kind]}
            <DropdownMenu.Item onSelect={() => create(kind)}>
              <Glyph class="mc-entity-picker-new-glyph" aria-hidden="true" />
              {kind === "person" ? "Person" : "Organization"}
            </DropdownMenu.Item>
          {/each}
        </DropdownMenu.Content>
      </DropdownMenu.Root>
    {/if}

  </div>

  {#if disabled && disabledReason !== undefined}
    <span id={refusalId} class="sr-only">{disabledReason}</span>
  {/if}
</div>
