<script lang="ts">
  /*
   * Earlier calls and texts with the number a record is being made for — the window's History tab
   * while a record is being MADE (owner, 2026-11-09: "instead of earlier from this number, add a
   * history tab to the right side").
   *
   * Read through the log's own search, which already matches the stored number, and then narrowed
   * to rows whose number IS this one: the search also matches what was said, and a message that
   * happens to quote the digits is not a call from them.
   */
  import EmptyState from "@magna-carta/design-system/empty-state";
  import { formatInstant } from "@magna-carta/design-system/formatters";
  import type { CountryCode } from "libphonenumber-js/min";
  import { checkPhoneEntry } from "$lib/directory/phone-entry.ts";
  import { channelEntry, directionEntry, durationText } from "./communication-vocabulary.ts";
  import { listCommunications, type Communication } from "./communications-api.ts";
  import type { LogDraft } from "./log-draft.ts";

  let { draft }: { draft: LogDraft } = $props();

  /** The number as it is stored, or null until it is a whole one. The extension is not searched. */
  const stored = $derived.by((): string | null => {
    const checked = checkPhoneEntry(draft.region as CountryCode, draft.counterpartyNumber);
    return checked.ok ? checked.number : null;
  });

  let rows = $state<readonly Communication[] | null>(null);
  let failed = $state(false);

  $effect(() => {
    const number = stored;
    rows = null;
    failed = false;
    if (number === null) return;
    let cancelled = false;
    void (async () => {
      // The digits alone: the stored form leads with a plus the log's search would read literally.
      const outcome = await listCommunications(fetch, { search: number.replace(/^\+/u, "") });
      if (cancelled) return;
      if (outcome.kind !== "ok") {
        failed = true;
        rows = [];
        return;
      }
      // A stored number may carry its extension after the digits; the line is the same line.
      rows = outcome.value.data.filter((row) => row.counterpartyNumber.startsWith(number));
    })();
    return () => {
      cancelled = true;
    };
  });

  function headline(row: Communication): string {
    const length = durationText(row.durationSeconds);
    return [
      formatInstant(row.occurredAt),
      `${directionEntry(row.direction).label} ${channelEntry(row.channel).label.toLowerCase()}`,
      length,
    ]
      .filter((part) => part !== null && part !== "")
      .join(" · ");
  }
</script>

{#if stored === null}
  <EmptyState title="Type the Number">
    Earlier calls and texts with it show here once it is a whole number.
  </EmptyState>
{:else if rows === null}
  <p class="text-sm text-text-muted">Reading earlier calls and texts.</p>
{:else if failed}
  <p class="text-sm text-text-muted">Earlier calls and texts could not be read.</p>
{:else if rows.length === 0}
  <p class="text-sm text-text-muted">
    Nothing yet. This is the first call or text the firm has from this number.
  </p>
{:else}
  <ul class="flex flex-col rounded-md border border-border-default bg-surface-default">
    {#each rows as row (row.id)}
      {@const said = row.body ?? row.summary ?? ""}
      <li class="flex flex-col gap-4 border-b border-border-default px-12 py-8 last:border-b-0">
        <span class="text-sm font-medium tabular-nums">{headline(row)}</span>
        {#if said !== ""}
          <span class="line-clamp-2 text-sm text-text-muted">{said}</span>
        {/if}
      </li>
    {/each}
  </ul>
{/if}
