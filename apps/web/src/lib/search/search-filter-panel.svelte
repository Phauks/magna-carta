<script lang="ts">
  /*
   * The Search page's filters, in one panel: Places, Matters, Date and By.
   *
   * IT OWNS NO CHOICE THAT HAS BEEN MADE. The filters are the address's, handed in and handed back
   * whole. What it holds is the one thing the address cannot: that the reader picked "one client",
   * "matters I pick" or "between" and has not yet said which.
   *
   * EVERY PLACE IS COUNTED, TICKED OR NOT, so unticking a place does not hide how much is there. A
   * place the search did not reach carries a mark, with the reason on its hover and, where the
   * reader can act on it, written out under the list.
   *
   * A CLIENT IS PICKED FROM THE DIRECTORY, AND NEVER MADE HERE. The field is the firm's one entity
   * picker with recording turned off: a search is narrowed to somebody the firm already holds.
   */
  import { parseDate } from "@internationalized/date";
  import Badge from "@magna-carta/design-system/badge";
  import Button from "@magna-carta/design-system/button";
  import Checkbox from "@magna-carta/design-system/checkbox";
  import { DateRangePicker } from "@magna-carta/design-system/date-range-picker";
  import type { PickableEntity } from "@magna-carta/design-system/entity-picker";
  import * as RadioGroup from "@magna-carta/design-system/radio-group";
  import { todayCivil } from "$lib/calendar/calendar-window.ts";
  import { readDirectoryEntityNames } from "$lib/directory/directory-api.ts";
  import DirectoryEntityPicker from "$lib/directory/directory-entity-picker.svelte";
  import MemberPicker from "$lib/matters/member-picker.svelte";
  import { firmRoster } from "$lib/members/firm-roster.svelte.ts";
  import { FirmMatters } from "$lib/time/firm-matters.svelte.ts";
  import MatterPicker from "$lib/time/matter-picker.svelte";
  import { matterDisplay } from "$lib/time/time-sheet-model.ts";
  import type { PanelPlace } from "./search-across-matters.svelte.ts";
  import {
    CHOSEN_MATTERS_LIMIT,
    EVERYTHING,
    MY_MATTERS,
    placeTicked,
    type SearchFilters,
  } from "./search-address.ts";
  import {
    DATE_CHOICES,
    MATTERS_CHOICES,
    clientNamed,
    dateChoiceOf,
    daysOfChoice,
    withMatter,
    withPlace,
    withoutMatter,
    type DateChoice,
    type MattersChoice,
  } from "./search-filters.ts";

  let {
    filters,
    places,
    onChange,
  }: {
    /** The filters in force, read from the address. */
    filters: SearchFilters;
    /** The Places list, counted from the last answer. Empty before the first one lands. */
    places: readonly PanelPlace[];
    onChange: (next: SearchFilters) => void;
  } = $props();

  const fieldId = $props.id();

  function change(part: Partial<SearchFilters>): void {
    onChange({ ...filters, ...part });
  }

  // ---- Places ----

  const everyPlace = $derived(places.map((place) => place.key));

  function tick(place: string, ticked: boolean): void {
    change({ places: withPlace(filters, everyPlace, place, ticked) });
  }

  const writtenOut = $derived(
    places.filter((place) => place.writtenOut && placeTicked(filters, place.key)),
  );

  // ---- Matters ----

  /** A Matters choice that needs a second answer, said and not yet completed. */
  let pendingMatters = $state<"client" | "matters" | null>(null);
  const mattersChoice = $derived<MattersChoice>(pendingMatters ?? filters.reach.kind);

  function chooseMatters(next: MattersChoice): void {
    if (next === "everything" || next === "mine") {
      pendingMatters = null;
      change({ reach: next === "mine" ? MY_MATTERS : EVERYTHING });
      return;
    }
    pendingMatters = next === filters.reach.kind ? null : next;
  }

  /** The client the address names, once the directory has said what to call them. */
  let named = $state<PickableEntity | null>(null);
  const client = $derived(
    filters.reach.kind === "client" && named?.identifier === filters.reach.entityId ? named : null,
  );

  // An address can arrive with a client in it (a reload, a link from a colleague), and the field
  // has to name who that is. Asked once per client, and a late answer for an earlier one is dropped.
  $effect(() => {
    if (filters.reach.kind !== "client") return;
    const entityId = filters.reach.entityId;
    if (named?.identifier === entityId) return;
    let current = true;
    void readDirectoryEntityNames(fetch, [entityId]).then((outcome) => {
      if (current) named = clientNamed(entityId, outcome);
    });
    return () => {
      current = false;
    };
  });

  function pickClient(entity: PickableEntity): void {
    named = entity;
    pendingMatters = null;
    change({ reach: { kind: "client", entityId: entity.identifier } });
  }

  function clearClient(): void {
    // The field stays, empty, for another client; the search goes back to every matter meanwhile.
    pendingMatters = "client";
    if (filters.reach.kind === "client") change({ reach: EVERYTHING });
  }

  const firmMatters = new FirmMatters();
  $effect(() => {
    if (mattersChoice === "matters") void firmMatters.load(fetch);
  });

  const chosenMatterIds = $derived(filters.reach.kind === "matters" ? filters.reach.matterIds : []);

  function matterName(matterId: string): string {
    const matter = firmMatters.matters?.find((entry) => entry.id === matterId);
    return matter === undefined ? "A matter" : matterDisplay(matter);
  }

  function pickMatter(matterId: string | null): void {
    if (matterId === null) return;
    pendingMatters = null;
    change({ reach: withMatter(filters.reach, matterId) });
  }

  function dropMatter(matterId: string): void {
    const next = withoutMatter(filters.reach, matterId);
    // The last one taken off leaves "Matters I pick" open for another.
    if (next.kind === "everything") pendingMatters = "matters";
    change({ reach: next });
  }

  // ---- Date ----

  const today = todayCivil();
  let pendingBetween = $state(false);
  const dateChoice = $derived<DateChoice>(
    pendingBetween ? "between" : dateChoiceOf(filters.days, today),
  );

  function chooseDate(next: DateChoice): void {
    if (next === "between") {
      pendingBetween = true;
      return;
    }
    pendingBetween = false;
    change({ days: daysOfChoice(next, today) });
  }

  const range = $derived(
    filters.days?.from !== undefined && filters.days.to !== undefined
      ? { start: parseDate(filters.days.from), end: parseDate(filters.days.to) }
      : undefined,
  );

  function pickRange(start: string, end: string): void {
    if (start === "" || end === "") return;
    pendingBetween = false;
    change({ days: { from: start, to: end } });
  }

  // ---- By ----

  $effect(() => {
    void firmRoster.load(fetch);
  });

  function pickAuthor(userId: string): void {
    change({ by: userId });
  }
</script>

<div class="flex min-w-0 flex-col gap-24">
  <fieldset class="flex min-w-0 flex-col gap-4">
    <legend class="mb-8 text-sm font-semibold text-text-default">Places</legend>
    {#each places as place (place.key)}
      {@const unreachable = place.mark === "In A Matter" || place.mark === "No Access"}
      {@const ticked = !unreachable && placeTicked(filters, place.key)}
      <label
        class={[
          "flex min-w-0 items-center gap-8 rounded-sm py-4 text-sm",
          unreachable ? "text-text-muted" : "text-text-default",
        ]}
        title={place.reason ?? undefined}
      >
        <Checkbox
          checked={ticked}
          disabled={unreachable}
          onCheckedChange={(next) => tick(place.key, next)}
        />
        <span class="min-w-0 flex-1">{place.label}</span>
        {#if place.mark !== null}
          <Badge variant="neutral">{place.mark}</Badge>
        {:else if place.shown !== null}
          <span class="text-xs text-text-muted">{place.shown}{place.more ? "+" : ""}</span>
        {/if}
      </label>
    {/each}
    {#each writtenOut as place (place.key)}
      <p class="mt-4 text-xs text-text-muted">{place.reason}</p>
    {/each}
    {#if places.length > 0}
      <p class="mt-4 text-xs text-text-muted">
        Places marked In A Matter are searched from that matter. Review sets are searched only from inside the set, by people with access.
      </p>
    {/if}
  </fieldset>

  <fieldset class="flex min-w-0 flex-col gap-8">
    <legend class="mb-8 text-sm font-semibold text-text-default">Matters</legend>
    <RadioGroup.Root
      aria-label="Matters"
      value={mattersChoice}
      onValueChange={(next) => chooseMatters(next as MattersChoice)}
      class="flex flex-col gap-8"
    >
      {#each MATTERS_CHOICES as choice (choice.value)}
        <label class="flex items-center gap-8 text-sm text-text-default">
          <RadioGroup.Item value={choice.value} />
          {choice.label}
        </label>
      {/each}
    </RadioGroup.Root>
    {#if mattersChoice === "client"}
      <DirectoryEntityPicker
        value={client}
        label="Client"
        inputId="{fieldId}-client"
        allowCreate={false}
        onSelect={pickClient}
        onClear={clearClient}
      />
    {:else if mattersChoice === "matters"}
      {#each chosenMatterIds as matterId (matterId)}
        <label class="flex min-w-0 items-center gap-8 text-sm text-text-default">
          <Checkbox checked={true} onCheckedChange={(next) => !next && dropMatter(matterId)} />
          <span class="min-w-0 truncate">{matterName(matterId)}</span>
        </label>
      {/each}
      {#if chosenMatterIds.length < CHOSEN_MATTERS_LIMIT}
        <div class="w-full min-w-0">
          <MatterPicker
            matters={(firmMatters.matters ?? []).filter((matter) => !chosenMatterIds.includes(matter.id))}
            reading={firmMatters.matters === null}
            capped={firmMatters.capped}
            inputId="{fieldId}-matter"
            offerNoMatter={false}
            title="Find a matter by name or number"
            onpick={pickMatter}
          />
        </div>
      {:else}
        <p class="text-xs text-text-muted">
          A search can name up to {CHOSEN_MATTERS_LIMIT} matters.
        </p>
      {/if}
      {#if firmMatters.failure !== null}
        <p class="text-xs text-text-muted">The firm's matters could not be read just now.</p>
      {/if}
    {/if}
  </fieldset>

  <fieldset class="flex min-w-0 flex-col gap-8">
    <legend class="mb-8 text-sm font-semibold text-text-default">Date</legend>
    <RadioGroup.Root
      aria-label="Date"
      value={dateChoice}
      onValueChange={(next) => chooseDate(next as DateChoice)}
      class="flex flex-col gap-8"
    >
      {#each DATE_CHOICES as choice (choice.value)}
        <label class="flex items-center gap-8 text-sm text-text-default">
          <RadioGroup.Item value={choice.value} />
          {choice.label}
        </label>
      {/each}
    </RadioGroup.Root>
    {#if dateChoice === "between"}
      <DateRangePicker
        label="Between"
        value={range}
        onValueChange={(next) =>
          pickRange(next?.start?.toString() ?? "", next?.end?.toString() ?? "")}
      />
    {/if}
  </fieldset>

  <fieldset class="flex min-w-0 flex-col gap-8">
    <legend class="mb-8 text-sm font-semibold text-text-default">By</legend>
    <MemberPicker
      members={firmRoster.members ?? []}
      value={filters.by}
      inputId="{fieldId}-by"
      label="Anyone"
      onpick={pickAuthor}
    />
    {#if filters.by !== null}
      <Button variant="ghost" size="sm" class="self-start" onclick={() => change({ by: null })}>
        Anyone
      </Button>
    {/if}
    {#if firmRoster.failure !== null}
      <p class="text-xs text-text-muted">{firmRoster.failure}</p>
    {/if}
  </fieldset>
</div>
