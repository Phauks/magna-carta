<script lang="ts">
  /*
   * The matter field of a conflicts check: where the check is filed.
   *
   * ONCE A PARTY IS CHOSEN, THE FIELD OFFERS THE MATTERS THAT PARTY IS ON (owner's ruling,
   * 2026-09-11). A check is about the parties; the matter is where it is filed; and the matter a
   * member is looking for is almost always one the parties in front of them are already on. So the
   * list opens with those — read from the Directory, which knows every matter an entity is a party
   * to — and the rest of the docket is a search beneath them, for the case where the file is new
   * enough that no party has been linked to it yet.
   *
   * It is one combobox, not two fields: the reader types once and both lists narrow. The party
   * matters are read once per set of parties, not per keystroke; the docket search settles before it
   * is sent, because a docket read per keystroke is a request per keystroke.
   *
   * The same field files a check on a matter from the check's own screen, where the parties are the
   * check's recorded subjects rather than a draft's — the shape of the question is identical.
   */
  import * as Combobox from "@magna-carta/design-system/combobox";
  import { readDirectoryEntityMatterParties } from "$lib/directory/directory-api.ts";
  import { listMatters } from "$lib/matters/matters-api.ts";
  import { chosenMatterLine, type ChosenMatter } from "./check-request.ts";

  let {
    subjectEntityIds,
    value = null,
    inputId,
    disabled = false,
    title,
    placeholder = "No matter",
    onpick,
  }: {
    /** The parties the check is about. Their matters lead the list. */
    subjectEntityIds: readonly string[];
    /** The matter the field holds, or null for a check filed on none. */
    value?: ChosenMatter | null;
    /** The input's id, so the caller's Label points at it. */
    inputId?: string;
    disabled?: boolean;
    /** What the field says on its hover, which is where a refusal is worded. */
    title?: string;
    placeholder?: string;
    /** Called with the chosen matter, or null when the choice is taken back off. */
    onpick: (matter: ChosenMatter | null) => void;
  } = $props();

  /** What has been typed. Meaningful only while the field is being searched. */
  let query = $state("");
  let searching = $state(false);
  let settledQuery = $state("");

  /** The matters the chosen parties are on, in the order the Directory answers them. */
  let partyMatters = $state<readonly ChosenMatter[]>([]);
  /** What the docket search answered for the settled query. */
  let docketMatters = $state<readonly ChosenMatter[]>([]);

  const partyKey = $derived(subjectEntityIds.join("\n"));

  // One read per party, once per set of parties: the union of what each is on, first page each. A
  // party on more matters than one page holds is rare, and the docket search beneath reaches the
  // rest by name.
  $effect(() => {
    const asked = partyKey;
    const ids = asked === "" ? [] : asked.split("\n");
    let live = true;
    void (async () => {
      const seen = new Map<string, ChosenMatter>();
      const pages = await Promise.all(
        ids.map((entityId) => readDirectoryEntityMatterParties(fetch, entityId)),
      );
      for (const page of pages) {
        if (page.kind !== "ok") continue;
        for (const row of page.value.data) {
          if (seen.has(row.matterId)) continue;
          seen.set(row.matterId, {
            id: row.matterId,
            matterNumber: row.matterNumber,
            title: row.matterTitle ?? row.matterId,
          });
        }
      }
      if (live) partyMatters = [...seen.values()];
    })();
    return () => {
      live = false;
    };
  });

  $effect(() => {
    const typed = query;
    const timer = setTimeout(() => (settledQuery = typed), 250);
    return () => clearTimeout(timer);
  });

  $effect(() => {
    const asked = settledQuery.trim();
    let live = true;
    void (async () => {
      const outcome = await listMatters(fetch, { scope: "caseload", search: asked });
      if (!live) return;
      // A docket that cannot be read leaves the search empty; the check itself does not need one.
      docketMatters =
        outcome.kind === "ok"
          ? outcome.value.data.map((matter) => ({
              id: matter.id,
              matterNumber: matter.matterNumber ?? matter.consultationNumber,
              title: matter.title,
            }))
          : [];
    })();
    return () => {
      live = false;
    };
  });

  function matches(matter: ChosenMatter, needle: string): boolean {
    return needle === "" || chosenMatterLine(matter).toLowerCase().includes(needle);
  }

  const needle = $derived(searching ? query.trim().toLowerCase() : "");
  const onParties = $derived(partyMatters.filter((matter) => matches(matter, needle)));
  const elsewhere = $derived(
    docketMatters.filter(
      (matter) => !partyMatters.some((own) => own.id === matter.id) && matches(matter, needle),
    ),
  );
  const offered = $derived([...onParties, ...elsewhere]);

  function settle(): void {
    searching = false;
    query = "";
  }

  function pick(picked: string | string[]): void {
    const chosen = Array.isArray(picked) ? (picked[0] ?? "") : picked;
    settle();
    if (chosen === "") {
      onpick(null);
      return;
    }
    const matter = offered.find((candidate) => candidate.id === chosen) ?? null;
    onpick(matter);
  }
</script>

<Combobox.Root
  type="single"
  {disabled}
  items={offered.map((matter) => ({ value: matter.id, label: chosenMatterLine(matter) }))}
  value={value?.id ?? ""}
  inputValue={searching ? query : value === null ? "" : chosenMatterLine(value)}
  onValueChange={pick}
  onOpenChange={(open) => {
    if (!open) settle();
  }}
>
  <Combobox.Input
    id={inputId}
    {placeholder}
    {title}
    autocomplete="off"
    spellcheck={false}
    onfocus={() => {
      searching = true;
      query = "";
    }}
    onblur={settle}
    oninput={(event) => {
      searching = true;
      query = event.currentTarget.value;
    }}
  />
  <Combobox.Content>
    {#if onParties.length > 0}
      <Combobox.Group>
        <Combobox.GroupHeading>Matters these parties are on</Combobox.GroupHeading>
        {#each onParties as matter (matter.id)}
          <Combobox.Item value={matter.id} label={chosenMatterLine(matter)}>
            {chosenMatterLine(matter)}
          </Combobox.Item>
        {/each}
      </Combobox.Group>
    {/if}
    {#if elsewhere.length > 0}
      <Combobox.Group>
        <Combobox.GroupHeading>
          {onParties.length > 0 ? "Elsewhere on the docket" : "The docket"}
        </Combobox.GroupHeading>
        {#each elsewhere as matter (matter.id)}
          <Combobox.Item value={matter.id} label={chosenMatterLine(matter)}>
            {chosenMatterLine(matter)}
          </Combobox.Item>
        {/each}
      </Combobox.Group>
    {/if}
    {#if offered.length === 0}
      <Combobox.Group>
        <Combobox.GroupHeading>
          {needle === "" ? "No matter to offer yet." : `Nothing matches "${query.trim()}".`}
        </Combobox.GroupHeading>
      </Combobox.Group>
    {/if}
  </Combobox.Content>
</Combobox.Root>
