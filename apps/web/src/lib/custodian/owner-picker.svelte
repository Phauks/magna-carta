<script lang="ts">
  /*
   * Whom the firm holds property for, chosen from the MATTER'S OWN PARTIES.
   *
   * IT WAS A DIRECTORY SEARCH AND THAT WAS WRONG. The directory is the firm's whole address book —
   * opposing counsel, courts, vendors, every party to every matter the firm has ever had. Offering
   * all of it as candidate owners invites recording a will as held for the other side's attorney,
   * and no amount of care at the keyboard makes that a good list to choose from. The people a
   * packet can be held for are the people on its matter, so that is the list.
   *
   * WHICH IS WHY THE MATTER COMES FIRST ON THE FORM. Property is held for a client, a client is
   * somebody the firm has a matter with, and the firm does not hold originals for anyone else. With
   * no matter chosen there is nothing to offer, and the field says so rather than sitting empty
   * looking broken.
   *
   * THE ROLE COMES ACROSS WITH THE PERSON. A party already carries what they are on the matter, so
   * the ownership role starts from the capacity the matter recorded rather than from a blank box.
   * It stays editable: what somebody is to a matter and what they are to an envelope inside it are
   * related questions, not the same one.
   */
  import * as Combobox from "@magna-carta/design-system/combobox";
  import { listMatterParties, type MatterParty } from "$lib/directory/directory-api.ts";

  let {
    matterId,
    inputId,
    fieldName,
    disabled = false,
    excluded = [],
    onPick,
  }: {
    /** The matter whose parties are on offer. Null before one has been chosen. */
    matterId: string | null;
    /** The combobox input's id, so the consumer's Label can point at it. */
    inputId: string;
    /** What this field is choosing, for the input's own accessible name. */
    fieldName: string;
    disabled?: boolean;
    /** Handles already chosen. Offering one twice would invite a duplicate the server refuses. */
    excluded?: readonly string[];
    /** A party was chosen. */
    onPick: (party: MatterParty) => void;
  } = $props();

  let parties = $state<readonly MatterParty[]>([]);
  let reading = $state(false);
  let readFailed = $state(false);
  let query = $state("");
  let readMatterId: string | null = null;

  // One read per matter. A read that could not run is stated rather than rendered as a matter with
  // no parties: the two are the same picture and they are not the same fact.
  $effect(() => {
    const matter = matterId;
    if (matter === null) {
      parties = [];
      readMatterId = null;
      return;
    }
    if (readMatterId === matter) return;
    readMatterId = matter;
    reading = true;
    void (async () => {
      const outcome = await listMatterParties(fetch, matter);
      if (readMatterId !== matter) return;
      reading = false;
      if (outcome.kind === "ok") {
        parties = outcome.value.parties;
        readFailed = false;
        return;
      }
      parties = [];
      readFailed = true;
    })();
  });

  /** What to call a party. A handle is never printed at a person; the gap is stated instead. */
  function partyName(party: MatterParty): string {
    return party.displayName ?? "Not named in the directory";
  }

  /** What they are on the matter, which is where the ownership role starts from. */
  function partyRole(party: MatterParty): string {
    return party.capacity ?? party.role;
  }

  const offered = $derived.by(() => {
    const wanted = query.trim().toLowerCase();
    return parties
      .filter((party) => !excluded.includes(party.entityId))
      .filter(
        (party) =>
          wanted === "" ||
          partyName(party).toLowerCase().includes(wanted) ||
          partyRole(party).toLowerCase().includes(wanted),
      );
  });

  function pick(value: string | string[]): void {
    const entityId = Array.isArray(value) ? (value[0] ?? "") : value;
    const party = offered.find((candidate) => candidate.entityId === entityId);
    if (party === undefined) return;
    onPick(party);
    // The field forgets its pick: the form above holds a LIST of owners, and a field that kept the
    // last one would read as though that choice were still pending.
    query = "";
  }
</script>

<Combobox.Root
  type="single"
  disabled={disabled || matterId === null}
  items={offered.map((party) => ({ value: party.entityId, label: partyName(party) }))}
  inputValue={query}
  onValueChange={pick}
>
  <Combobox.Input
    id={inputId}
    {fieldName}
    autocomplete="off"
    oninput={(event) => (query = event.currentTarget.value)}
  />
  <Combobox.Content>
    {#each offered as party (party.entityId)}
      <Combobox.Item value={party.entityId} label={partyName(party)}>
        {partyName(party)}
        <span class="text-text-muted">&mdash; {partyRole(party)}</span>
      </Combobox.Item>
    {/each}
  </Combobox.Content>
</Combobox.Root>

{#if matterId === null}
  <p class="text-xs text-text-muted">Choose the matter first. Owners come from its parties.</p>
{:else if readFailed}
  <p class="text-xs text-text-muted">This matter's parties could not be read.</p>
{:else if reading}
  <p class="text-xs text-text-muted">Reading the matter's parties.</p>
{:else if parties.length === 0}
  <p class="text-xs text-text-muted">
    This matter records no parties yet. Add them on the matter, and they can hold property here.
  </p>
{/if}
