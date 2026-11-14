<script lang="ts">
  /*
   * The street box, when the address form is handed a lookup: a text box that offers real addresses
   * as it is typed into, and fills the rest of the form when one is chosen.
   *
   * WHAT IS TYPED IS THE STREET LINE, AND NOTHING HERE EVER TAKES IT BACK. A picker's text is a
   * question and its value is the pick; this box's text IS the value. Every keystroke is written to
   * the record's street line as it is typed, closing the list leaves it exactly as typed, and the
   * offers are a shortcut to filling the other boxes — never a gate on typing this one. That is why
   * this is not the data-safe combobox the country field is: that one settles its text back onto a
   * chosen value on close, which here would erase an address somebody typed because no service
   * offered it.
   *
   * THE BOX NEVER FETCHES. The caller hands in an `AddressLookup`; the rules around it — how long
   * typed text settles, the floor, which answer is current — are street-lookup.ts, tested on their
   * own. What is here is drawing them.
   *
   * FOUR KINDS OF "NO OFFERS", KEPT APART. Nothing matched; this country cannot be looked up; no
   * address service is provisioned; the service did not answer. The first two are said in the list.
   * The third is said by nothing at all: the box stops asking and behaves exactly as it did before
   * lookup existed. The fourth is said once, with a way to try again — and the box stops asking on
   * its own until somebody does, because every question to a failing service is both another failure
   * counted against the platform and, where the service is up but refusing, another bill.
   *
   * A GROUP IS OPENED, NEVER CHOSEN. A building with many units is one row with a count; choosing it
   * keeps the list open on the addresses inside it. Filling the form with the building's line would
   * write an address that does not reach the client who lives in one of its units.
   *
   * THE PICK IS HELD AND THEN LET GO. The combobox keeps what was last chosen, and choosing the same
   * offer again would read to it as no change at all. So what it holds is set to the offer as it is
   * chosen and cleared again as the next answer arrives, which is what lets an identical offer be
   * chosen twice.
   */
  import MapPin from "@lucide/svelte/icons/map-pin";
  import { tick } from "svelte";
  import * as Combobox from "../combobox/index.ts";
  import type { LabelledFieldControlProperties } from "../labelled-field/index.ts";
  import {
    ADDRESS_LOOKUP_SENTENCES,
    ADDRESS_SETTLE_MILLISECONDS,
    addressLookupRequestFor,
    groupAside,
    groupHeading,
    matchedSegments,
    offerLines,
    ADDRESS_OFFER_ATTRIBUTION_TEXT,
    type AddressOfferAttribution,
    type AddressLookup,
    type AddressLookupAnswer,
    type AddressLookupResolution,
    type AddressOffer,
  } from "./street-lookup.ts";
  import type { AddressParts } from "./types.ts";

  /*
   * What the list says rides in it as rows: a listbox may hold only options, and a paragraph among
   * them is both invalid and unreachable by the arrow keys. A note is a disabled row nobody can
   * pick; trying again is an enabled one, so a keyboard user whose focus stays in the box reaches it.
   */
  const NOTE_ROW_VALUE = "mc-address-fields:note";
  const RETRY_ROW_VALUE = "mc-address-fields:retry";
  const ATTRIBUTION_ROW_VALUE = "mc-address-fields:attribution";

  let {
    text,
    country,
    near,
    lookup,
    fieldName,
    controlProperties,
    disabled = false,
    onType,
    onChoose,
  }: {
    /** The street line the record holds. */
    text: string;
    /** The country the address is in. Nothing is asked without one. */
    country: string | undefined;
    /** The region the form already holds, if any — a bias for the service, read when it is asked. */
    near?: string | undefined;
    /** How addresses are looked up. The box never fetches on its own. */
    lookup: AddressLookup;
    /** The box's name as the country's form writes it. Also its ghost text. */
    fieldName: string;
    /** What LabelledField hands its control: the id, the description, the refusal. */
    controlProperties: LabelledFieldControlProperties;
    disabled?: boolean;
    /** Every keystroke, as typed. */
    onType: (typed: string) => void;
    /** A chosen address, as the parts the lookup gave. The form decides how they merge. */
    onChoose: (parts: AddressParts) => void;
  } = $props();

  type Status = "idle" | "searching" | "offers" | "no-coverage" | "failed" | "expired";

  let status = $state<Status>("idle");
  let offers = $state<readonly AddressOffer[]>([]);
  /** Whose data the offers on show are, when the provider's terms require the list to say so. */
  let attribution = $state<AddressOfferAttribution | undefined>(undefined);
  /** The group whose addresses the list is showing, or null for the answer to what was typed. */
  let openedGroup = $state<AddressOffer | null>(null);
  let open = $state(false);
  /** What has been typed, as a question. Only a keystroke writes it. */
  let query = $state("");
  /** What the combobox holds — set as an offer is chosen, cleared as the next answer arrives. */
  let chosen = $state("");
  /** The service said it is not provisioned. Nothing more is asked for the life of the box. */
  let switchedOff = $state(false);
  /** The service did not answer. Nothing more is asked until somebody tries again. */
  let paused = $state(false);
  /** Countries the service said it cannot look up. Plain: nothing renders from it. */
  const uncovered = new Set<string>();
  /** The search that is out, and the choice that is out. A newer one overtakes the older. */
  let searchTurn = 0;
  let choiceTurn = 0;
  /** A pick closes the list, and opening a group or trying again must keep it open. */
  let holdOpen = false;
  let input = $state<HTMLInputElement | null>(null);

  const items = $derived(offers.map((offer) => ({ value: offer.identifier, label: offer.label })));

  /**
   * The street line, put back into the box directly. Choosing a row writes the row's label into the
   * input, and the framework's record of what it last wrote there is still the street line, so it
   * would not write the line back on its own. The same remedy the country field uses on its settle.
   */
  function showStreetLine(): void {
    if (input !== null) input.value = text;
  }

  function answered(answer: AddressLookupAnswer, askedCountry: string): void {
    openedGroup = null;
    chosen = "";
    if (answer.kind === "offers") {
      offers = answer.offers;
      attribution = answer.attribution;
      status = "offers";
      open = true;
      return;
    }
    offers = [];
    if (answer.kind === "no-coverage") {
      uncovered.add(askedCountry);
      status = "no-coverage";
      open = true;
      return;
    }
    // Not provisioned: say nothing, ask nothing more. The box is a plain text box from here on.
    switchedOff = true;
    status = "idle";
    open = false;
  }

  function couldNotAnswer(): void {
    offers = [];
    openedGroup = null;
    status = "failed";
    paused = true;
    open = true;
  }

  async function ask(askedCountry: string, question: string): Promise<void> {
    const turn = ++searchTurn;
    // Offers already on screen stay while the next answer is fetched; only an empty list says it is
    // looking, so the list does not flicker to a sentence and back on every keystroke.
    if (offers.length === 0) {
      status = "searching";
      open = true;
    }
    let answer: AddressLookupAnswer;
    try {
      answer = await lookup.suggest(askedCountry, question, near);
    } catch {
      if (turn === searchTurn) couldNotAnswer();
      return;
    }
    if (turn === searchTurn) answered(answer, askedCountry);
  }

  // Typed text settles before it is asked, and only a question above the floor, in a country the
  // service covers, is asked at all. Anything short of that closes the list without a word.
  $effect(() => {
    const request = addressLookupRequestFor(query, country);
    if (switchedOff || paused) return;
    if (request.kind !== "ask" || uncovered.has(request.country)) {
      searchTurn += 1;
      offers = [];
      openedGroup = null;
      status = "idle";
      open = false;
      return;
    }
    const timer = setTimeout(
      () => void ask(request.country, request.query),
      ADDRESS_SETTLE_MILLISECONDS,
    );
    return () => clearTimeout(timer);
  });

  function capture(event: Event & { currentTarget: HTMLInputElement }): void {
    const typed = event.currentTarget.value;
    // A keystroke overtakes a choice still out: its answer would overwrite what was just typed.
    choiceTurn += 1;
    onType(typed);
    query = typed;
  }

  function settle(next: boolean): void {
    if (!next && holdOpen) {
      // A choice closes the list inside the primitive, and `open` reaches it one way only: setting it
      // to true while it already reads true changes nothing and the list stays shut. So the close is
      // acknowledged and the list reopened a tick later — which is what opening a group and trying
      // again both need.
      holdOpen = false;
      open = false;
      void tick().then(() => (open = true));
      return;
    }
    // The list opens only onto something: there is no list to browse before anything is typed.
    open = next && status !== "idle";
    if (open) return;
    // Closed: whatever search was out is nobody's to answer. The street line stays exactly as typed.
    searchTurn += 1;
    query = "";
    showStreetLine();
  }

  /**
   * Ask again about the street line as it stands. The settle effect does the asking — un-pausing is
   * what lets it — so a retry is one question, not this one and then the effect's own a moment later.
   */
  function tryAgain(): void {
    holdOpen = true;
    showStreetLine();
    status = "searching";
    query = text;
    paused = false;
  }

  function resolvedInto(resolution: AddressLookupResolution, offer: AddressOffer): void {
    chosen = "";
    switch (resolution.kind) {
      case "address":
        onChoose(resolution.parts);
        offers = [];
        openedGroup = null;
        status = "idle";
        open = false;
        query = "";
        // The form writes the new street line on its next render; put it in the box once it has.
        void tick().then(showStreetLine);
        return;
      case "group":
        openedGroup = offer;
        offers = resolution.offers;
        status = "offers";
        open = true;
        return;
      case "expired":
        offers = [];
        status = "expired";
        open = true;
        return;
      case "no-coverage":
        if (country !== undefined) uncovered.add(country);
        offers = [];
        status = "no-coverage";
        open = true;
        return;
      case "unavailable":
        switchedOff = true;
        offers = [];
        status = "idle";
        open = false;
        return;
    }
  }

  async function pick(picked: string | string[]): Promise<void> {
    const identifier = Array.isArray(picked) ? (picked[0] ?? "") : picked;
    if (identifier === "" || identifier === NOTE_ROW_VALUE || identifier === ATTRIBUTION_ROW_VALUE) {
      return;
    }
    if (identifier === RETRY_ROW_VALUE) {
      tryAgain();
      return;
    }
    const offer = offers.find((candidate) => candidate.identifier === identifier);
    if (offer === undefined) return;
    chosen = identifier;
    showStreetLine();
    // A group keeps the list open on its addresses; an address closes it as it fills the form.
    if (offer.kind === "group") {
      holdOpen = true;
      offers = [];
      status = "searching";
      open = true;
    }
    searchTurn += 1;
    const turn = ++choiceTurn;
    let resolution: AddressLookupResolution;
    try {
      resolution = await lookup.resolve(offer.identifier);
    } catch {
      if (turn === choiceTurn) {
        chosen = "";
        couldNotAnswer();
      }
      return;
    }
    if (turn === choiceTurn) resolvedInto(resolution, offer);
  }
</script>

{#snippet offerRow(offer: AddressOffer)}
  <!-- The label is the STREET LINE, not the offer: choosing a row writes its label into the box,
       and what the box must hold after a choice is the line the person typed — replaced only when a
       chosen address brings a street line of its own. -->
  <!-- Two lines, the way a person scans for the right one: the street, with the part they typed
       in bold, and beneath it the town, region and country that tell two streets of one name
       apart. -->
  {@const lines = offerLines(offer.label)}
  <Combobox.Item value={offer.identifier} label={text}>
    <span class="mc-address-fields-offer w-full">
      <MapPin class="mc-address-fields-offer-icon" aria-hidden="true" />
      <span class="mc-address-fields-offer-lines">
        <span class="mc-address-fields-offer-main">
          {#each matchedSegments(lines.main, query) as segment, index (index)}
            {#if segment.matched}
              <strong class="mc-address-fields-offer-match">{segment.text}</strong>
            {:else}
              {segment.text}
            {/if}
          {/each}{#if lines.secondary !== ""}<span class="sr-only">,</span>{/if}
        </span>
        {#if lines.secondary !== ""}
          <span class="mc-address-fields-offer-secondary">{lines.secondary}</span>
        {/if}
      </span>
      {#if offer.kind === "group"}
        <span class="mc-address-fields-offer-aside">{groupAside(offer)}</span>
      {/if}
    </span>
  </Combobox.Item>
{/snippet}

<Combobox.Root
  type="single"
  {disabled}
  allowDeselect={false}
  {items}
  value={chosen}
  inputValue={text}
  {open}
  onOpenChange={settle}
  onValueChange={(picked) => void pick(picked)}
>
  <Combobox.Input
    {...controlProperties}
    bind:ref={input}
    {fieldName}
    browsable={false}
    autocomplete="off"
    spellcheck={false}
    oninput={capture}
  />
  <Combobox.Content>
    {#if status === "searching"}
      <Combobox.Item value={NOTE_ROW_VALUE} label="" disabled class="mc-address-fields-note">
        {ADDRESS_LOOKUP_SENTENCES.searching}
      </Combobox.Item>
    {:else if status === "no-coverage"}
      <Combobox.Item value={NOTE_ROW_VALUE} label="" disabled class="mc-address-fields-note">
        {ADDRESS_LOOKUP_SENTENCES.noCoverage}
      </Combobox.Item>
    {:else if status === "failed"}
      <!-- A service that did not answer is stated rather than shown as an address nobody has: the
           two are the same empty picture and not the same fact. -->
      <Combobox.Item value={NOTE_ROW_VALUE} label="" disabled class="mc-address-fields-note">
        {ADDRESS_LOOKUP_SENTENCES.failed}
      </Combobox.Item>
      <Combobox.Item value={RETRY_ROW_VALUE} label={text} class="mc-address-fields-retry">
        {ADDRESS_LOOKUP_SENTENCES.retry}
      </Combobox.Item>
    {:else if status === "expired"}
      <Combobox.Item value={NOTE_ROW_VALUE} label="" disabled class="mc-address-fields-note">
        {ADDRESS_LOOKUP_SENTENCES.expired}
      </Combobox.Item>
    {:else if offers.length === 0}
      <Combobox.Item value={NOTE_ROW_VALUE} label="" disabled class="mc-address-fields-note">
        {ADDRESS_LOOKUP_SENTENCES.nothingMatched}
      </Combobox.Item>
    {:else if openedGroup !== null}
      <!-- The heading needs a group: a bare one has no identity to label and throws when the list
           opens. -->
      <Combobox.Group>
        <Combobox.GroupHeading>{groupHeading(openedGroup)}</Combobox.GroupHeading>
        {#each offers as offer (offer.identifier)}
          {@render offerRow(offer)}
        {/each}
      </Combobox.Group>
    {:else}
      {#each offers as offer (offer.identifier)}
        {@render offerRow(offer)}
      {/each}
      {#if attribution !== undefined}
        <!-- The provider's name, inside the list that shows its offers, as its terms require: a row
             nobody can pick, never translated. -->
        <Combobox.Item
          value={ATTRIBUTION_ROW_VALUE}
          label=""
          disabled
          class="mc-address-fields-attribution"
        >
          <span translate="no">{ADDRESS_OFFER_ATTRIBUTION_TEXT[attribution]}</span>
        </Combobox.Item>
      {/if}
    {/if}
  </Combobox.Content>
</Combobox.Root>
