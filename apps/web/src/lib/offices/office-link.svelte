<script lang="ts">
  /*
   * An office, NAMED — the one piece that renders wherever a record points at one of the firm's
   * offices: a matter's owning office, the status window's Location, a resource's office, a member's
   * assignment. It takes the office's handle, resolves the name and the citation from the firm's
   * own list, and links to the office's record on the Offices screen, so a reader who wants to know
   * where an office is, or who staffs it, is one press from the answer rather than reading a name
   * that leads nowhere.
   *
   * WHAT ACTS LIKE A LINK LOOKS LIKE A LINK: the app's link register, always. A caller that already
   * holds the office's name passes it, so the link reads correctly before the list lands and for
   * an office the list no longer carries; the handle alone is never printed at a person.
   */
  import { firmOffices } from "./firm-offices.svelte.ts";
  import { officeCitation, officeRecordHref } from "./office-vocabulary.ts";

  let {
    officeId,
    name,
    citation = true,
    whenNone = "No office",
  }: {
    /** The office's handle, or null where the record names none. */
    officeId: string | null;
    /** The office's name where the caller already holds it; otherwise resolved from the firm's list. */
    name?: string | null;
    /** Whether the place and the numbering code follow the name. */
    citation?: boolean;
    /** What to say where the record names no office. */
    whenNone?: string;
  } = $props();

  $effect(() => {
    if (officeId !== null) void firmOffices.load(fetch);
  });

  const office = $derived(firmOffices.byId(officeId));
  const shownName = $derived(office?.name ?? name ?? null);
  const shownCitation = $derived(office === undefined ? "" : officeCitation(office));
</script>

{#if officeId === null}
  <span class="text-text-muted">{whenNone}</span>
{:else}
  <span class="inline-flex flex-wrap items-baseline gap-x-8">
    <a class="underline underline-offset-2" href={officeRecordHref(officeId)}>
      {#if shownName === null}
        <!-- The list has not answered yet. The link still works; the name arrives with the read. -->
        <span class="text-text-muted">Office</span>
      {:else}
        {shownName}
      {/if}
    </a>
    {#if citation && shownCitation !== ""}
      <span class="text-xs text-text-muted">{shownCitation}</span>
    {/if}
  </span>
{/if}
