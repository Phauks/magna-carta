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
  import { personInitials } from "@magna-carta/design-system/formatters";
  import Building2 from "@lucide/svelte/icons/building-2";
  import Cake from "@lucide/svelte/icons/cake";
  import Info from "@lucide/svelte/icons/info";
  import KeyRound from "@lucide/svelte/icons/key-round";
  import Mail from "@lucide/svelte/icons/mail";
  import MapPin from "@lucide/svelte/icons/map-pin";
  import Phone from "@lucide/svelte/icons/phone";
  import Printer from "@lucide/svelte/icons/printer";
  import User from "@lucide/svelte/icons/user";
  import UserRound from "@lucide/svelte/icons/user-round";
  import type { PersonSummaryLine, PersonSummaryMark } from "./person-draft.ts";

  let {
    summary,
    name,
    photoBase64,
    gate,
  }: {
    summary: readonly PersonSummaryLine[];
    /** The name as it will be filed, or empty before one is typed. */
    name: string;
    photoBase64: string | null;
    /** The duplicate check, drawn inside the first card. */
    gate: Snippet;
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

<div class="flex flex-col gap-16">
  <section class="flex flex-col rounded-lg border border-border-default bg-surface-raised">
    <div class="px-16 py-12">
      {@render gate()}
    </div>
  </section>

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
</div>
