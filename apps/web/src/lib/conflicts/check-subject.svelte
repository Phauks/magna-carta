<script lang="ts">
  /*
   * The New Check panel's LEFT pane: who the check is about, and what pressing Run will do.
   *
   * The owner's direction, 2026-09-08: "left would be general information, right would be advanced
   * and technical settings. left side is the input. right side is the engine settings." So this
   * pane holds the two things a member always fills in — the parties, and where the check is filed
   * — and nothing else. Everything that tunes the search is one pane over.
   *
   * A CHECK DOES NOT NEED A MATTER. The owner again: "a conflict check does not need to check
   * against a matter, the whole point is to find the matters that are potential conflicts." The
   * matter is not what a check runs AGAINST; it is where the check is filed, and naming one adds
   * that matter's own parties and lets the search reach the firm's own people. The field says so
   * and never refuses a check for being without one — the pre-engagement screen, where all anybody
   * has is a name given over the telephone, is the case the whole preliminary trigger exists for.
   *
   * THE PLAN IS THE ANSWER TO "WHAT DOES THIS DO". Every control in the right pane is a fact about
   * a search nobody can watch, and no label is enough on its own. So the sentences under the fields
   * say what will actually run, composed from the very values the request is composed from — a
   * read-back that could describe a different search from the one that runs would be worse than
   * none. They are facts about the SEARCH, never about the matter.
   */
  import * as Combobox from "@magna-carta/design-system/combobox";
  import FieldLabel from "@magna-carta/design-system/field-label";
  import Label from "@magna-carta/design-system/label";
  import DirectoryEntityPicker from "$lib/directory/directory-entity-picker.svelte";
  import { directoryPickerSearch } from "$lib/directory/directory-picker-source.ts";
  import { listMatters, type MatterSummary } from "$lib/matters/matters-api.ts";
  import type { CheckDraft } from "./check-draft.svelte.ts";

  let {
    draft,
    chooseMatter = false,
    matterLabel = null,
    plan,
    busy = false,
  }: {
    draft: CheckDraft;
    /** Whether this pane asks which matter. The firm-wide log does; a matter's own section cannot. */
    chooseMatter?: boolean;
    /** How the surface's own matter reads, where it has one. */
    matterLabel?: string | null;
    /** What the check will do, in sentences, composed from the draft the panel will send. */
    plan: readonly string[];
    /** True while the panel's commit is in flight, so every field holds still. */
    busy?: boolean;
  } = $props();

  const fieldPrefix = $props.id();
  const partySearch = directoryPickerSearch(fetch);

  let matters = $state<readonly MatterSummary[]>([]);
  let matterQuery = $state("");
  let settledMatterQuery = $state("");

  // The typed query settles before it is sent: a docket read per keystroke is a request per
  // keystroke, and the firm's own search over title, number and client is the authoritative one.
  $effect(() => {
    const typed = matterQuery;
    const timer = setTimeout(() => (settledMatterQuery = typed), 250);
    return () => clearTimeout(timer);
  });

  $effect(() => {
    if (!chooseMatter) return;
    const asked = settledMatterQuery.trim();
    let live = true;
    void (async () => {
      const outcome = await listMatters(fetch, { scope: "caseload", search: asked });
      if (!live) return;
      // A docket that cannot be read leaves the picker empty; the check itself does not need one.
      matters = outcome.kind === "ok" ? outcome.value.data : [];
    })();
    return () => {
      live = false;
    };
  });

  /**
   * How a matter reads in the picker: its number where it has one. A consultation's tentative
   * number counts — running a check against one is the whole point of taking the consultation, and
   * the number is what the result will be filed under.
   */
  function matterLine(matter: MatterSummary): string {
    const number = matter.matterNumber ?? matter.consultationNumber;
    return number === null ? matter.title : `${number} · ${matter.title}`;
  }

  function recordMatter(value: string | string[]): void {
    const id = Array.isArray(value) ? (value[0] ?? "") : value;
    draft.chosenMatter = matters.find((matter) => matter.id === id) ?? null;
  }
</script>

<div class="flex flex-col gap-24">
  <section class="flex flex-col gap-16">
    <FieldLabel as="h4">Who The Check Is About</FieldLabel>

    <div class="flex flex-col gap-8">
      <Label for="{fieldPrefix}-parties">Parties</Label>
      <!-- A check takes directory entities, never typed names: the one picker, in multiple mode. -->
      <DirectoryEntityPicker
        search={partySearch}
        multiple
        bind:values={draft.parties}
        label="Party"
        inputId="{fieldPrefix}-parties"
        disabled={busy}
        disabledReason={busy ? "The check is running." : undefined}
      />
      <p class="text-xs text-text-muted">
        The people and organizations this check is about. The search starts from each of them.
      </p>
    </div>

    {#if chooseMatter}
      <div class="flex flex-col gap-8">
        <Label for="{fieldPrefix}-matter">Matter</Label>
        <Combobox.Root
          type="single"
          items={matters.map((matter) => ({ value: matter.id, label: matterLine(matter) }))}
          inputValue={matterQuery}
          onValueChange={recordMatter}
          disabled={busy}
        >
          <Combobox.Input
            id="{fieldPrefix}-matter"
            placeholder="No matter"
            autocomplete="off"
            oninput={(event) => (matterQuery = event.currentTarget.value)}
          />
          <Combobox.Content>
            {#each matters as matter (matter.id)}
              <Combobox.Item value={matter.id} label={matterLine(matter)}>
                {matterLine(matter)}
              </Combobox.Item>
            {/each}
          </Combobox.Content>
        </Combobox.Root>
        <p class="text-xs text-text-muted">
          Optional. A matter is where the check is filed, not what it is checked against — naming
          one adds that matter's own parties to the search and lets it reach the firm's own people.
        </p>
      </div>
    {:else if matterLabel !== null}
      <div class="flex flex-col gap-8">
        <Label>Matter</Label>
        <p class="text-sm">{matterLabel}</p>
      </div>
    {/if}
  </section>

  <section class="flex flex-col gap-8 border-t border-border-default pt-16">
    <FieldLabel as="h4">What This Check Will Do</FieldLabel>
    <ul class="flex flex-col gap-4 text-xs text-text-muted">
      {#each plan as sentence (sentence)}
        <li>{sentence}</li>
      {/each}
    </ul>
  </section>
</div>
