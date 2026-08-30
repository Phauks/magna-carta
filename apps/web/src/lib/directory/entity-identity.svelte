<script lang="ts">
  /*
   * How an entity is presented wherever one is named — the directory's search results, a duplicate
   * candidate, the two sides of a merge, and whatever else comes to show the same record.
   *
   * It exists so those surfaces cannot drift. The entity a conflicts result matches and the entity
   * this directory shows are one record, so the mark that says which side of the directory it is,
   * the name, the stated pronouns and the folded-away mark all have to read the same in every one
   * of them. The component takes a name and facts, never a fetch: what to show is the caller's, how
   * it looks is settled here.
   */
  import Badge from "@magna-carta/design-system/badge";
  import Building2 from "@lucide/svelte/icons/building-2";
  import User from "@lucide/svelte/icons/user";
  import type { DirectoryEntityKind, PronounSet } from "./directory-api.ts";
  import { entityKindLabel, pronounShortForm } from "./entity-presentation.ts";

  let {
    kind,
    name,
    pronouns = null,
    merged = false,
    href,
    aside,
  }: {
    kind: DirectoryEntityKind;
    name: string;
    /** The set the person stated. Never derived from the name, here or anywhere else. */
    pronouns?: PronounSet | null;
    /** Whether this record has been folded into another one. */
    merged?: boolean;
    /** Where the record lives. Given, the name is the link to it. */
    href?: string;
    /** A second line the caller owns — an organization's legal name, a role on a matter. */
    aside?: string | null;
  } = $props();
</script>

<span class="flex items-start gap-8">
  {#if kind === "person"}
    <User class="mt-4 size-16 shrink-0 text-text-muted" aria-hidden="true" />
  {:else}
    <Building2 class="mt-4 size-16 shrink-0 text-text-muted" aria-hidden="true" />
  {/if}
  <span class="flex flex-col gap-4">
    <span class="flex flex-wrap items-center gap-8">
      {#if href === undefined}
        <span>{name}</span>
      {:else}
        <a class="underline underline-offset-2" {href}>{name}</a>
      {/if}
      <span class="sr-only">{entityKindLabel(kind)}</span>
      {#if pronouns !== null}
        <!-- Beside the name, because that is where it governs: a pronoun is only useful at the
             moment somebody is about to write about this person. -->
        <span class="text-xs text-text-muted">{pronounShortForm(pronouns)}</span>
      {/if}
      {#if merged}
        <Badge variant="neutral">Folded in</Badge>
      {/if}
    </span>
    {#if aside !== undefined && aside !== null && aside !== ""}
      <span class="text-xs text-text-muted">{aside}</span>
    {/if}
  </span>
</span>
