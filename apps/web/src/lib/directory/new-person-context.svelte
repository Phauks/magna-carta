<script lang="ts">
  /*
   * The column beside the New Person form: the gate the entry has to pass, and the record read back
   * as it will read.
   *
   * TWO CARDS, IN THE FORM'S OWN REGISTER. The form's sections are cards, so the column beside them
   * is too: one card says whether the firm may already hold this person, the other shows the person
   * the way the record window will open on them, photo and name first and every way to reach them
   * marked by kind, so the entry is checked by looking at it rather than by reading a table.
   */
  import type { Component, Snippet } from "svelte";
  import * as Avatar from "@magna-carta/design-system/avatar";
  import Badge from "@magna-carta/design-system/badge";
  import { personInitials } from "@magna-carta/design-system/formatters";
  import Building2 from "@lucide/svelte/icons/building-2";
  import Cake from "@lucide/svelte/icons/cake";
  import Eye from "@lucide/svelte/icons/eye";
  import Info from "@lucide/svelte/icons/info";
  import KeyRound from "@lucide/svelte/icons/key-round";
  import Mail from "@lucide/svelte/icons/mail";
  import MapPin from "@lucide/svelte/icons/map-pin";
  import Phone from "@lucide/svelte/icons/phone";
  import Printer from "@lucide/svelte/icons/printer";
  import ScanSearch from "@lucide/svelte/icons/scan-search";
  import User from "@lucide/svelte/icons/user";
  import UserRound from "@lucide/svelte/icons/user-round";
  import type { PersonSummaryLine, PersonSummaryMark } from "./person-draft.ts";
  import type { RecordSection } from "./record-sections.ts";

  let {
    summary,
    name,
    photoBase64,
    sections,
    gate,
    look = "card",
  }: {
    summary: readonly PersonSummaryLine[];
    /** The name as it will be filed, or empty before one is typed. */
    name: string;
    photoBase64: string | null;
    sections: readonly RecordSection[];
    /** The duplicate check, drawn inside the first card. */
    gate: Snippet;
    look?: "card" | "cards" | "checklist";
  } = $props();

  const MARKS: Readonly<Record<PersonSummaryMark, Component>> = {
    name: User,
    "other-name": UserRound,
    email: Mail,
    telephone: Phone,
    fax: Printer,
    address: MapPin,
    pronouns: Info,
    born: Cake,
    died: Cake,
    identifier: KeyRound,
    organization: Building2,
  };

  /** Which section each kind of fact is entered in, for the checklist look. */
  const SECTION_OF: Readonly<Record<PersonSummaryMark, string>> = {
    name: "names",
    "other-name": "names",
    email: "contact",
    telephone: "contact",
    fax: "contact",
    address: "address",
    pronouns: "about",
    born: "about",
    died: "about",
    identifier: "identifiers",
    organization: "organizations",
  };

  const SECTION_MARKS: Readonly<Record<string, Component>> = {
    names: User,
    contact: Phone,
    address: MapPin,
    about: Info,
    identifiers: KeyRound,
    organizations: Building2,
  };

  const subline = $derived(
    summary
      .filter((line) => line.mark === "pronouns" || line.mark === "born" || line.mark === "died")
      .map((line) => (line.mark === "pronouns" ? line.value : `${line.label} ${line.value}`))
      .join(" · "),
  );
  const body = $derived(
    summary.filter(
      (line) =>
        line.mark !== "name" && line.mark !== "pronouns" && line.mark !== "born" && line.mark !== "died",
    ),
  );
</script>

{#snippet cardHeader(Mark: Component, title: string, count?: number)}
  <div class="flex items-center gap-12 border-b border-border-default px-16 py-12">
    <span
      class="flex size-32 shrink-0 items-center justify-center rounded-md bg-surface-sunken text-text-muted"
      aria-hidden="true"
    >
      <Mark class="size-16" />
    </span>
    <h3 class="m-0 min-w-0 flex-auto text-md font-semibold">{title}</h3>
    {#if count !== undefined && count > 0}
      <Badge variant="neutral">{count}</Badge>
    {/if}
  </div>
{/snippet}

<div class="flex flex-col gap-16">
  <section class="flex flex-col rounded-lg border border-border-default bg-surface-raised">
    {#if look !== "card"}
      {@render cardHeader(ScanSearch, "Already In The Directory?")}
    {/if}
    <div class="px-16 py-12">
      {@render gate()}
    </div>
  </section>

  {#if look === "card"}
    <section
      class="flex flex-col rounded-lg border border-border-default bg-surface-raised"
      aria-label="The person as the record will read"
    >
      <div class="flex items-center gap-12 px-16 py-16">
        <Avatar.Root class="size-48 shrink-0">
          {#if photoBase64 !== null}
            <Avatar.Image src={`data:image/jpeg;base64,${photoBase64}`} alt="" />
          {/if}
          <Avatar.Fallback>{personInitials(name)}</Avatar.Fallback>
        </Avatar.Root>
        <div class="flex min-w-0 flex-col gap-4">
          <p class="m-0 text-lg font-semibold break-words {name === '' ? 'text-text-muted' : ''}">
            {name === "" ? "New Person" : name}
          </p>
          {#if subline !== ""}
            <p class="m-0 text-sm text-text-muted">{subline}</p>
          {/if}
        </div>
      </div>
      <div class="border-t border-border-default px-16 py-12">
        {#if body.length === 0}
          <p class="m-0 text-sm text-text-muted">
            Contact details, addresses and organizations appear here as you add them.
          </p>
        {:else}
          <ul class="m-0 flex list-none flex-col gap-12 p-0">
            {#each body as line, index (index)}
              {@const Mark = MARKS[line.mark]}
              <li class="flex items-start gap-12 text-sm">
                <Mark class="mt-2 size-16 shrink-0 text-text-muted" aria-hidden="true" />
                <div class="flex min-w-0 flex-col">
                  <span class="break-words">{line.value}</span>
                  <span class="text-xs text-text-subtle">{line.label}</span>
                </div>
              </li>
            {/each}
          </ul>
        {/if}
      </div>
    </section>
  {:else if look === "cards"}
    <section class="flex flex-col rounded-lg border border-border-default bg-surface-raised">
      {@render cardHeader(Eye, "As It Will Read", summary.length)}
      <div class="px-16 py-12">
        {#if summary.length === 0}
          <p class="m-0 text-sm text-text-muted">What you enter is read back here.</p>
        {:else}
          <dl class="m-0 grid gap-x-12 gap-y-8 text-sm" style="grid-template-columns: auto minmax(0, 1fr)">
            {#each summary as line, index (index)}
              <dt class="text-text-muted">{line.label}</dt>
              <dd class="m-0 text-right break-words">{line.value}</dd>
            {/each}
          </dl>
        {/if}
      </div>
    </section>
  {:else}
    <section class="flex flex-col rounded-lg border border-border-default bg-surface-raised">
      {@render cardHeader(Eye, "As It Will Read")}
      <ul class="m-0 flex list-none flex-col p-0">
        {#each sections as entry (entry.id)}
          {@const Mark = SECTION_MARKS[entry.id] ?? Info}
          {@const lines = summary.filter((line) => SECTION_OF[line.mark] === entry.id)}
          <li class="flex items-start gap-12 border-b border-border-default px-16 py-8 text-sm last:border-b-0">
            <Mark class="mt-2 size-16 shrink-0 {lines.length > 0 ? 'text-accent-default' : 'text-text-subtle'}" aria-hidden="true" />
            <div class="flex min-w-0 flex-auto flex-col">
              <span class="font-semibold">{entry.label}</span>
              {#if lines.length === 0}
                <span class="text-text-subtle">Not added</span>
              {:else}
                {#each lines as line, index (index)}
                  <span class="break-words">{line.value}</span>
                {/each}
              {/if}
            </div>
          </li>
        {/each}
      </ul>
    </section>
  {/if}
</div>
