<script lang="ts">
  /*
   * Who a typed number belongs to, said under the number as soon as it is a whole one.
   *
   * THREE ANSWERS, CHEAPEST FIRST. The firm's own Directory — a contact who has this number, offered
   * with one press to put on the record. Then where the area code was issued, which is free and always
   * there for a North American number. Then the caller ID the telephone network holds, which costs a
   * fraction of a cent a query: it is a button, never automatic, and once anybody at the firm has
   * pressed it for a number the answer is kept and shown here for nothing.
   *
   * THE LOGIC IS NOT HERE. Everything this asks and every line it prints comes from caller-lookup.ts,
   * so the same answer can be drawn in a side panel of the record window without a second copy.
   *
   * A FAILED FREE READ SHOWS NOTHING. The lookup is help with a form, not part of it; a person whose
   * read failed types the call in exactly as they did before the lookup existed. A failed PAID lookup
   * does say so, because the person pressed something and is waiting for it.
   */
  import Button from "@magna-carta/design-system/button";
  import EntityIdentity from "@magna-carta/design-system/entity-identity";
  import {
    areaCodeLine,
    callerIdentityLine,
    lookUpCallerIdentity,
    lookupNumberFor,
    readCallerLookup,
    type CallerDirectoryMatch,
    type CallerLookup,
  } from "./caller-lookup.ts";
  import { newWriteKey } from "./communications-api.ts";

  let {
    region,
    number,
    hasContact,
    disabled = false,
    onUseContact,
  }: {
    /** The country the number field holds, as its two-letter region code. */
    region: string;
    /** The number as typed. */
    number: string;
    /** Whether the record already names a contact. A match is then shown but not offered. */
    hasContact: boolean;
    disabled?: boolean;
    /** Put a matched contact on the record. */
    onUseContact: (match: CallerDirectoryMatch) => void;
  } = $props();

  const asked = $derived(lookupNumberFor(region, number));

  let answer = $state<CallerLookup | null>(null);
  let pressing = $state(false);
  let pressFailed = $state(false);

  // Settled before it is sent, as the Directory's duplicate check is: a whole number arrives one
  // keystroke at a time, and the last digit is the one worth asking about.
  $effect(() => {
    const target = asked;
    answer = null;
    pressFailed = false;
    if (target === null) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      void (async () => {
        const outcome = await readCallerLookup(target);
        if (cancelled || outcome.kind !== "ok") return;
        answer = outcome.value;
      })();
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  });

  async function lookUp(): Promise<void> {
    const target = asked;
    if (target === null || answer === null) return;
    pressing = true;
    pressFailed = false;
    const outcome = await lookUpCallerIdentity(target, newWriteKey());
    pressing = false;
    // The number changed while the press was in flight: the answer belongs to a number no longer
    // on the form, and the free read for the new one is already on its way.
    if (asked !== target || answer === null) return;
    if (outcome.kind !== "ok") {
      pressFailed = true;
      return;
    }
    const result = outcome.value;
    if (result.outcome === "found") answer = { ...answer, callerIdentity: result.callerIdentity };
    else answer = { ...answer, paidLookup: result.outcome };
  }

  function matchName(match: CallerDirectoryMatch): string {
    return match.displayName ?? "Unnamed record";
  }
</script>

{#if answer !== null}
  {@const known = answer}
  <div class="flex flex-col gap-8" aria-live="polite">
    {#each known.directoryMatches as match (match.entityId)}
      <div class="flex flex-wrap items-center gap-8">
        <EntityIdentity kind={match.entityKind} name={matchName(match)} size="sm" />
        <span class="text-xs text-text-muted">has this number</span>
        {#if !hasContact}
          <Button
            variant="secondary"
            size="sm"
            {disabled}
            onclick={() => onUseContact(match)}
          >
            Use This Contact
          </Button>
        {/if}
      </div>
    {/each}

    {#if known.areaCode !== null || known.callerIdentity !== null || known.paidLookup === "available"}
      <div class="flex flex-wrap items-center gap-x-12 gap-y-4 text-xs text-text-muted">
        {#if known.areaCode !== null}
          <span>{areaCodeLine(known.areaCode)}</span>
        {/if}
        {#if known.callerIdentity !== null}
          <span>Caller ID: <span class="text-text-default">{callerIdentityLine(known.callerIdentity)}</span></span>
        {:else if known.paidLookup === "available"}
          <Button
            variant="ghost"
            size="sm"
            disabled={disabled || pressing}
            onclick={() => void lookUp()}
          >
            {pressing ? "Looking Up Caller ID" : "Look Up Caller ID"}
          </Button>
        {/if}
      </div>
    {/if}

    {#if pressFailed}
      <p class="text-xs text-text-muted">The caller ID service did not answer. Nothing was kept; try again.</p>
    {/if}
  </div>
{/if}
