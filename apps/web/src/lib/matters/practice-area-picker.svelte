<script lang="ts">
  /*
   * Practice area — the firm's matter types, offered as one list a person can type into.
   *
   * WHAT THE FIELD HOLDS is a matter-type identifier, exactly as the contract stores it. What it
   * OFFERS is two things at once: the matter types the firm already has, and the common areas of
   * practice it has not adopted yet (practice-areas.ts says why that second list exists). Choosing
   * one of the second kind creates the firm's own matter type from it and then holds that, so the
   * area is the firm's from the first matter that used it and is renamed or retired in the firm's
   * settings like any other.
   *
   * IT IS THE PRODUCT'S ONE DROPDOWN, in the documented data-safe shape: the consumer owns the
   * input text, typing narrows the list, a pick writes the chosen name back, and closing the
   * listbox resets the text to whatever is actually selected — so text somebody typed and never
   * chose can never be mistaken for a value.
   *
   * A MEMBER WHO CANNOT ADD A TYPE STILL SEES THE WHOLE LIST. The server refuses a matter-type
   * write without matters:manageTypes, so the areas the firm has not adopted render disabled with
   * the permission named, rather than vanishing for some colleagues and not others. A person who
   * cannot add "Immigration" should still learn that it is a thing to ask for.
   */
  import * as Alert from "@magna-carta/design-system/alert";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import * as Combobox from "@magna-carta/design-system/combobox";
  import { createMatterType, type MatterTypeSummary } from "./matters-api.ts";
  import {
    matchingPracticeArea,
    unadoptedPracticeAreas,
    type PracticeArea,
  } from "./practice-areas.ts";

  let {
    matterTypes,
    value = $bindable(null),
    inputId,
    mayAddType,
    disabled = false,
    onadopted,
  }: {
    /** The firm's matter types as last read. Deactivated ones are filtered out here. */
    matterTypes: readonly MatterTypeSummary[];
    /** The chosen matter type's identifier, or null for "not recorded". Bindable. */
    value?: string | null;
    /** The input's id, so the caller's Label points at it. */
    inputId: string;
    /** Whether this member may add to the firm's matter types (matters:manageTypes). */
    mayAddType: boolean;
    disabled?: boolean;
    /** A matter type this field created, so the screen that owns the list can hold it too. */
    onadopted?: (created: MatterTypeSummary) => void;
  } = $props();

  /** The field's own name, which is also its ghost text and the add row's subject. */
  const FIELD_NAME = "Practice Area";

  /** What an unadopted area's row reports, kept apart from any identifier the firm could hold. */
  const STARTING_AREA_PREFIX = "starting-practice-area:";

  let query = $state("");
  let adopting = $state(false);
  let failure = $state<StatedFailure | null>(null);

  const firmTypes = $derived(matterTypes.filter((type) => type.active));
  const unadopted = $derived(unadoptedPracticeAreas(firmTypes.map((type) => type.name)));

  const selectedName = $derived(
    value === null ? "" : (matterTypes.find((type) => type.id === value)?.name ?? ""),
  );

  /** Narrowed by what has been typed. An empty query offers the whole vocabulary. */
  function narrow<T extends { name: string }>(options: readonly T[]): readonly T[] {
    const needle = query.trim().toLowerCase();
    if (needle === "") return options;
    return options.filter((option) => option.name.toLowerCase().includes(needle));
  }

  const matchingFirmTypes = $derived(narrow(firmTypes));
  const matchingStartingAreas = $derived(narrow(unadopted));

  /**
   * Every row the listbox holds, which is also what the primitive needs told: bits reads this list
   * to name the selection once the rows themselves are unmounted.
   */
  const items = $derived([
    ...matchingFirmTypes.map((type) => ({ value: type.id, label: type.name })),
    ...matchingStartingAreas.map((area) => ({
      value: `${STARTING_AREA_PREFIX}${area.name}`,
      label: area.name,
    })),
  ]);

  /** Create the firm's matter type, hold it, and hand it to the screen that owns the list. */
  async function adopt(area: { name: string; code: string | null }): Promise<void> {
    adopting = true;
    failure = null;
    const outcome = await createMatterType(
      fetch,
      { name: area.name, code: area.code },
      crypto.randomUUID(),
    );
    adopting = false;
    if (outcome.kind !== "ok") {
      failure = stated(
        outcome.failure,
        "The practice area could not be added.",
        "Couldn't connect. The practice area wasn't added.",
      );
      query = selectedName;
      return;
    }
    const created: MatterTypeSummary = {
      id: outcome.value.id,
      name: area.name,
      code: area.code,
      active: true,
    };
    onadopted?.(created);
    value = created.id;
    query = created.name;
  }

  function pick(picked: string | string[]): void {
    const chosen = Array.isArray(picked) ? (picked[0] ?? "") : picked;
    if (chosen === "") {
      // Clearing the field is a real answer: a matter with no practice area is valid.
      value = null;
      query = "";
      return;
    }
    if (Combobox.isAddOption(chosen)) {
      const typed = query.trim();
      if (typed === "") return;
      // A typed name that IS one of the starting areas adopts that area, code and all, rather than
      // minting a second code-less row that reads identically beside it.
      const known: PracticeArea | null = matchingPracticeArea(typed);
      void adopt(known ?? { name: typed, code: null });
      return;
    }
    if (chosen.startsWith(STARTING_AREA_PREFIX)) {
      const name = chosen.slice(STARTING_AREA_PREFIX.length);
      const area = matchingPracticeArea(name);
      if (area !== null) void adopt(area);
      return;
    }
    value = chosen;
    query = matterTypes.find((type) => type.id === chosen)?.name ?? "";
  }
</script>

<Combobox.Root
  type="single"
  disabled={disabled || adopting}
  {items}
  inputValue={query}
  onValueChange={pick}
  onOpenChange={(open) => {
    // Closing settles the text on the truth: the selected area, or empty when none is chosen.
    if (!open) query = selectedName;
  }}
>
  <Combobox.Input
    id={inputId}
    placeholder={FIELD_NAME}
    oninput={(event) => (query = event.currentTarget.value)}
  />
  <Combobox.Content>
    {#if matchingFirmTypes.length > 0}
      <Combobox.Group>
        <Combobox.GroupHeading>The Firm's Practice Areas</Combobox.GroupHeading>
        {#each matchingFirmTypes as type (type.id)}
          <Combobox.Item value={type.id} label={type.name} />
        {/each}
      </Combobox.Group>
    {/if}

    {#if matchingStartingAreas.length > 0}
      <Combobox.Group>
        <Combobox.GroupHeading>
          {mayAddType
            ? "Add to the Firm's Practice Areas"
            : "Adding a practice area needs the matters:manageTypes permission"}
        </Combobox.GroupHeading>
        {#each matchingStartingAreas as area (area.name)}
          <Combobox.Item
            value={`${STARTING_AREA_PREFIX}${area.name}`}
            label={area.name}
            disabled={!mayAddType}
          />
        {/each}
      </Combobox.Group>
    {/if}

    {#if mayAddType}
      <Combobox.AddOption fieldName={FIELD_NAME} {query} />
    {/if}
  </Combobox.Content>
</Combobox.Root>

{#if failure !== null}
  <FailureNotice
    failure={failure.failure}
    title="The Practice Area Was Not Added"
    fallback={failure.fallback}
    whenSilent={failure.whenSilent}
  />
{/if}
