<script lang="ts">
  /*
   * Choosing the client, or naming a new one.
   *
   * WHY THIS IS A PICKER AND NOT A TEXT BOX. A client is not a property of a matter, it is a party
   * the firm already has a relationship with — most matters opened in a working firm are for
   * somebody the firm has acted for before. A text box makes every one of those a fresh act of
   * typing, and typing the same client twice is how one client ends up on the docket as
   * "Bexley Holdings LLC" and "Bexley Holdings, L.L.C." with two sets of matters under them.
   *
   * WHAT IT CAN HONESTLY OFFER TODAY. Nothing on the server publishes a client directory, so the
   * clients that demonstrably exist are the ones the firm's own docket already names. Those are the
   * options. Naming a client the docket has never seen is the add row at the bottom of the list —
   * the same one every firm-owned vocabulary in the product uses — so the list is never a dead end.
   *
   * WHAT COMES WITH A CLIENT LATER, AND WHY NO CODE IS TYPED HERE. Anything a firm keeps about a
   * client — an accounting code, an address, a billing contact — belongs to the client's own record
   * and arrives when the client is chosen. Typing one of those on a matter form asks a person to
   * re-key a fact that is already recorded somewhere else, and produces a second copy of it that
   * nothing keeps in step.
   */
  import * as Combobox from "@magna-carta/design-system/combobox";

  let {
    knownClients,
    value = $bindable(""),
    inputId,
    disabled = false,
  }: {
    /** The distinct client names the firm's docket already carries. */
    knownClients: readonly string[];
    /** The client's name as it should print. Bindable; empty means none recorded. */
    value?: string;
    inputId: string;
    disabled?: boolean;
  } = $props();

  let query = $state("");

  // The typed text narrows the list; an empty query offers every client the firm has.
  const matching = $derived.by(() => {
    const needle = query.trim().toLowerCase();
    if (needle === "") return knownClients;
    return knownClients.filter((name) => name.toLowerCase().includes(needle));
  });

  function pick(picked: string | string[]): void {
    const chosen = Array.isArray(picked) ? (picked[0] ?? "") : picked;
    // The add row reports its own reserved value: what it means is "keep what was typed", and only
    // this component knows that the typed text IS the value here.
    value = Combobox.isAddOption(chosen) ? query.trim() : chosen;
    query = value;
  }
</script>

<Combobox.Root
  type="single"
  {disabled}
  items={[...matching.map((name) => ({ value: name, label: name }))]}
  inputValue={query}
  onValueChange={pick}
  onOpenChange={(open) => {
    // Closing settles the text on the truth: whatever the field actually holds.
    if (!open) query = value;
  }}
>
  <Combobox.Input
    id={inputId}
    placeholder="Client"
    oninput={(event) => (query = event.currentTarget.value)}
  />
  <Combobox.Content>
    {#each matching as name (name)}
      <Combobox.Item value={name} label={name} />
    {/each}
    <Combobox.AddOption fieldName="Client" {query} />
  </Combobox.Content>
</Combobox.Root>
