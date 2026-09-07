<script lang="ts">
  /*
   * Choosing the matter an upload lands on — the one control that lets a file go somewhere other
   * than the matter on screen.
   *
   * It is the design system's single Combobox in the documented shape: the consumer owns the input
   * text, typing narrows the list, a pick writes the chosen matter back, and closing the listbox
   * resets the text to whatever is actually chosen, so typed-but-unchosen text is never mistaken
   * for a destination. The field always HOLDS a matter — there is no "nowhere" to upload to — and
   * opens holding the matter the reader is standing in.
   *
   * THE LIST IS THE SERVER'S ANSWER, NOT A LOCAL NARROW. A firm's docket is not a bounded set this
   * field could be handed as an array, so the typed text goes to the listing's own search once it
   * has settled, and the field shows what came back in the order it came. The matter already
   * chosen is always offered, whatever the search says, so the reader can see it and return to it.
   */
  import * as Combobox from "@magna-carta/design-system/combobox";
  import { listEveryMatter, type MatterSummary } from "$lib/matters/matters-api.ts";
  import { matterNumberText } from "$lib/matters/matter-columns.ts";

  let {
    value = $bindable(),
    inputId,
    disabled = false,
  }: {
    /** The chosen matter. Bindable; never null, because an upload always lands somewhere. */
    value: { id: string; title: string; label: string };
    inputId: string;
    disabled?: boolean;
  } = $props();

  // How long typed text sits before it is asked of the server: long enough to type a word, short
  // enough that the answer keeps up with the typing.
  const SETTLE_MILLISECONDS = 250;

  let query = $state("");
  let searching = $state(false);
  let offered = $state<readonly MatterSummary[]>([]);
  let asking = $state(false);
  let lastAsked = 0;

  function labelOf(matter: MatterSummary): string {
    const number = matterNumberText(matter);
    return number === "" ? matter.title : `${number} · ${matter.title}`;
  }

  async function ask(text: string): Promise<void> {
    const ticket = (lastAsked += 1);
    asking = true;
    const outcome = await listEveryMatter(fetch, text === "" ? {} : { search: text });
    // A newer question has been asked since; this answer is stale and must not land.
    if (ticket !== lastAsked) return;
    asking = false;
    offered = outcome.kind === "ok" ? outcome.value.data : [];
  }

  let settleTimer: ReturnType<typeof setTimeout> | null = null;
  function typed(text: string): void {
    searching = true;
    query = text;
    if (settleTimer !== null) clearTimeout(settleTimer);
    settleTimer = setTimeout(() => void ask(text.trim()), SETTLE_MILLISECONDS);
  }

  function settle(): void {
    searching = false;
    query = "";
  }

  const items = $derived.by(() => {
    const seen = new Set<string>();
    const list: { value: string; label: string }[] = [];
    // The matter already chosen leads: it is the answer until another is picked.
    list.push({ value: value.id, label: value.label });
    seen.add(value.id);
    for (const matter of offered) {
      if (seen.has(matter.id)) continue;
      seen.add(matter.id);
      list.push({ value: matter.id, label: labelOf(matter) });
    }
    return list;
  });

  function pick(picked: string | string[]): void {
    const id = Array.isArray(picked) ? (picked[0] ?? "") : picked;
    const item = items.find((candidate) => candidate.value === id);
    const matter = offered.find((candidate) => candidate.id === id);
    if (item !== undefined && id !== value.id) {
      value = { id, title: matter?.title ?? item.label, label: item.label };
    }
    settle();
  }
</script>

<Combobox.Root
  type="single"
  {disabled}
  {items}
  value={value.id}
  inputValue={searching ? query : value.label}
  onValueChange={pick}
  onOpenChange={(open) => {
    if (open) void ask(query.trim());
    else settle();
  }}
>
  <!-- Focus alone does not clear the field: the panel hands focus to its first field on open, and
       a seat that emptied itself on arrival read as no matter chosen. Typing is what searches; the
       first keystroke replaces the seated name with what was typed. -->
  <Combobox.Input
    id={inputId}
    placeholder="Matter"
    onfocus={(event) => event.currentTarget.select()}
    onblur={settle}
    oninput={(event) => typed(event.currentTarget.value)}
  />
  <Combobox.Content>
    {#each items as item (item.value)}
      <Combobox.Item value={item.value} label={item.label} />
    {/each}
    {#if asking && items.length <= 1}
      <Combobox.Item value="mc-upload-matter:asking" label="Searching the docket" disabled />
    {/if}
  </Combobox.Content>
</Combobox.Root>
