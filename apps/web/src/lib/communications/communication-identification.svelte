<script lang="ts">
  /*
   * Who a call being recorded is with, worked out from its number — the right-hand side of the
   * window while a record is being MADE.
   *
   * WHY IT IS BESIDE THE FORM AND NOT IN IT (owner, 2026-11-09: "i like how we can gain some
   * information. would be especially useful if we could have it look up information once number is
   * set"). The number is usually the only thing somebody taking a call has; everything this side
   * shows follows from it, and it waits for a whole number before it asks anything, so a half-typed
   * number never names the wrong person.
   *
   * ITS OPEN MATTERS ARE SEARCHED, NOT LISTED (owner, same day: some contacts — a public defender's
   * office — have a hundred cases with the firm). The few with the most recent activity show, and a
   * search over the title and number finds the rest. Pressing File Here sets where the record
   * belongs; the form's own Belongs To field shows the answer and can still change it.
   */
  import Button from "@magna-carta/design-system/button";
  import EmptyState from "@magna-carta/design-system/empty-state";
  import FieldLabel from "@magna-carta/design-system/field-label";
  import Input from "@magna-carta/design-system/input";
  import type { CountryCode } from "libphonenumber-js/min";
  import DirectoryEntityPicker from "$lib/directory/directory-entity-picker.svelte";
  import {
    readDirectoryEntityMatterParties,
    type DirectoryEntityMatterParty,
  } from "$lib/directory/directory-api.ts";
  import { checkPhoneEntry } from "$lib/directory/phone-entry.ts";
  import type { SheetMatter } from "$lib/time/time-sheet-model.ts";
  import * as Alert from "@magna-carta/design-system/alert";
  import { chooseContact, clearContact, contactSelectionOf } from "./communication-contact.ts";
  import { readNumberHistory, spamMarks } from "./number-history.ts";
  import CallerLookup from "./caller-lookup.svelte";
  import type { LogDraft } from "./log-draft.ts";

  let {
    draft = $bindable(),
    busy = false,
    onFile,
  }: {
    draft: LogDraft;
    busy?: boolean;
    /** Put the record on this matter. The window owns the anchor; this side only proposes it. */
    onFile: (matter: SheetMatter) => void;
  } = $props();

  const identity = $props.id();

  /** How many matters show before a search is asked for. */
  const SHOWN = 5;
  /** How many pages of a contact's matters are read before the panel stops and says so. */
  const MOST_PAGES = 10;
  /** The statuses a call can still be filed onto; a closed matter is finished business. */
  const OPEN_STATUSES = new Set(["intake", "consultation", "open", "hold"]);

  const numberComplete = $derived(
    checkPhoneEntry(
      draft.region as CountryCode,
      draft.counterpartyNumber,
      draft.counterpartyExtension,
    ).ok,
  );
  const contact = $derived(contactSelectionOf(draft));

  /** The number as it is stored, or null until it is a whole one. */
  const stored = $derived.by((): string | null => {
    const checked = checkPhoneEntry(draft.region as CountryCode, draft.counterpartyNumber);
    return checked.ok ? checked.number : null;
  });

  /*
   * LIKELY SPAM (owner, 2026-11-09). How many times the firm has already called this number spam,
   * read from the same earlier calls the History tab lists, so a receptionist sees the warning
   * before they have said anything to the caller.
   */
  let spamCount = $state(0);
  $effect(() => {
    const number = stored;
    spamCount = 0;
    if (number === null) return;
    let cancelled = false;
    void (async () => {
      const outcome = await readNumberHistory(fetch, number);
      if (cancelled || outcome.kind !== "ok") return;
      spamCount = spamMarks(outcome.value);
    })();
    return () => {
      cancelled = true;
    };
  });

  let parties = $state<readonly DirectoryEntityMatterParty[] | null>(null);
  let partiesCapped = $state(false);
  let partiesFailed = $state(false);
  let query = $state("");

  $effect(() => {
    const entityId = draft.counterpartyEntityId;
    parties = null;
    partiesCapped = false;
    partiesFailed = false;
    query = "";
    if (entityId === null) return;
    let cancelled = false;
    void (async () => {
      const gathered: DirectoryEntityMatterParty[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < MOST_PAGES; page += 1) {
        const outcome = await readDirectoryEntityMatterParties(fetch, entityId, cursor);
        if (cancelled) return;
        if (outcome.kind !== "ok") {
          partiesFailed = true;
          parties = gathered;
          return;
        }
        gathered.push(...outcome.value.data);
        if (outcome.value.nextCursor === null) {
          parties = gathered;
          return;
        }
        cursor = outcome.value.nextCursor;
      }
      partiesCapped = true;
      parties = gathered;
    })();
    return () => {
      cancelled = true;
    };
  });

  /*
   * One row per MATTER, open ones only, most recently linked first. A contact can sit on one matter
   * in two roles, and a row for each would list the same case twice.
   */
  const openMatters = $derived.by((): readonly DirectoryEntityMatterParty[] => {
    if (parties === null) return [];
    const seen = new Set<string>();
    return parties
      .filter((party) => party.matterStatus !== null && OPEN_STATUSES.has(party.matterStatus))
      .toSorted((left, right) => right.linkedAt.localeCompare(left.linkedAt))
      .filter((party) => {
        if (seen.has(party.matterId)) return false;
        seen.add(party.matterId);
        return true;
      });
  });

  const hits = $derived.by((): readonly DirectoryEntityMatterParty[] => {
    const term = query.trim().toLowerCase();
    if (term === "") return openMatters;
    return openMatters.filter((party) =>
      `${party.matterTitle ?? ""} ${party.matterNumber ?? ""}`.toLowerCase().includes(term),
    );
  });

  const footnote = $derived.by((): string => {
    const total = openMatters.length;
    const term = query.trim();
    if (term === "" && total > SHOWN) {
      return `Showing the ${SHOWN} most recently linked. Search to find the rest.`;
    }
    if (term !== "" && hits.length === 0) return `None of their ${total} open matters match.`;
    if (term !== "") {
      return hits.length > SHOWN
        ? `${hits.length} of ${total} match. Showing the first ${SHOWN}.`
        : `${hits.length} of ${total} match.`;
    }
    return "";
  });

  function matterOf(party: DirectoryEntityMatterParty): SheetMatter {
    return {
      id: party.matterId,
      matterNumber: party.matterNumber,
      title: party.matterTitle ?? "Untitled matter",
    };
  }
</script>

{#if !numberComplete && contact === null}
  <EmptyState title="Type the Number">
    As soon as it is a whole number, this side shows who it belongs to and their open matters.
  </EmptyState>
{:else}
  <div class="flex flex-col gap-24">
    {#if spamCount > 0}
      <Alert.Root variant="warning">
        <Alert.Title>Likely Spam</Alert.Title>
        <Alert.Description>
          The firm has marked this number as spam {spamCount === 1
            ? "once"
            : `${String(spamCount)} times`} before.
        </Alert.Description>
      </Alert.Root>
    {/if}
    <section class="flex flex-col gap-8" aria-labelledby="{identity}-who">
      <FieldLabel as="h3" id="{identity}-who">This Number Belongs To</FieldLabel>
      <!-- What the number itself says: a Directory contact holding it, the area code's region, and
           the network's caller ID once somebody has paid to ask. Silent until the number is whole,
           and silent again if the read fails. -->
      <CallerLookup
        region={draft.region}
        number={draft.counterpartyNumber}
        hasContact={contact !== null}
        disabled={busy}
        onUseContact={(match) =>
          chooseContact(draft, {
            identifier: match.entityId,
            name: match.displayName ?? "This contact",
            kind: match.entityKind,
          })}
      />
      {#if contact !== null}
        <div
          class="flex items-center gap-12 rounded-md border border-border-default bg-surface-default p-12"
        >
          <span class="min-w-0 flex-1 font-medium">{contact.name}</span>
          <Button size="sm" variant="secondary" disabled={busy} onclick={() => clearContact(draft)}>
            Not Them
          </Button>
        </div>
      {:else}
        <p class="text-sm text-text-muted">
          No contact chosen yet. It can still be saved, and it waits in the queue until someone decides where it belongs.
        </p>
        <DirectoryEntityPicker
          inputId="{identity}-contact"
          label="Find in the Directory"
          disabled={busy}
          createBeside={false}
          value={null}
          onSelect={(entity) => chooseContact(draft, entity)}
          onClear={() => clearContact(draft)}
        />
      {/if}
    </section>

    {#if contact !== null}
      <section class="flex flex-col gap-8" aria-labelledby="{identity}-matters">
        <FieldLabel as="h3" id="{identity}-matters">
          Open Matters{parties === null ? "" : ` · ${openMatters.length}`}
        </FieldLabel>
        {#if parties === null}
          <p class="text-sm text-text-muted">Reading their matters.</p>
        {:else if openMatters.length === 0}
          <p class="text-sm text-text-muted">
            {partiesFailed ? "Their matters could not be read." : "No open matters."}
          </p>
        {:else}
          {#if openMatters.length > SHOWN}
            <Input
              type="search"
              aria-label="Search their open matters"
              placeholder="Search"
              disabled={busy}
              bind:value={query}
            />
          {/if}
          <ul class="flex flex-col rounded-md border border-border-default bg-surface-default">
            {#each hits.slice(0, SHOWN) as party (party.matterId)}
              {@const chosen = draft.anchor === "matter" && draft.matterId === party.matterId}
              <li
                class="flex items-center gap-12 border-b border-border-default px-12 py-8 last:border-b-0"
              >
                <div class="flex min-w-0 flex-1 flex-col">
                  <span class="font-medium">{party.matterTitle ?? "Untitled matter"}</span>
                  <span class="text-xs text-text-muted">
                    {[party.matterNumber, party.role].filter((part) => part !== null).join(" · ")}
                  </span>
                </div>
                <Button
                  size="sm"
                  variant={chosen ? "secondary" : "ghost"}
                  aria-pressed={chosen}
                  disabled={busy || chosen}
                  onclick={() => onFile(matterOf(party))}
                >
                  {chosen ? "Chosen" : "File Here"}
                </Button>
              </li>
            {/each}
          </ul>
          {#if footnote !== ""}
            <p class="text-xs text-text-muted">{footnote}</p>
          {/if}
          {#if partiesCapped}
            <p class="text-xs text-text-muted">
              They are on more matters than this side reads. Use Belongs To to search every matter.
            </p>
          {/if}
        {/if}
      </section>
    {/if}
  </div>
{/if}
