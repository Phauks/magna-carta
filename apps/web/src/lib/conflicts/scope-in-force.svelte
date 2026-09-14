<script lang="ts">
  /*
   * The scope a check actually ran under, read back off its own row.
   *
   * A reader must never have to know what the code did with the word "balanced" on the day a check
   * ran. A preset is a word whose meaning moves as channels are added, so the row names the channels
   * too — which name keys were compared, which encoders ran, which name roles were in scope — and
   * this states them.
   *
   * IT READS BY PLACE FIRST, AS THE PANEL ASKS. Where the check searched is the Directory, Files,
   * Messaging and Magnus — the places a member chooses between — and each says whether it was
   * searched. The recorded sources beneath are the specifics, keyed as the row stores them, so an
   * old row still reads.
   *
   * THREE FACTS HERE ARE LOAD-BEARING AND ARE NEVER SOFTENED.
   *
   *   - A SOURCE THAT COULD NOT RUN IS NOT A SOURCE THAT FOUND NOTHING. Every registered source is
   *     listed, including the ones with no corpus behind them, and each says which it was.
   *   - A TRUNCATED TRAVERSAL IS NEVER SHOWN AS A COMPLETED ONE. A check follows every recorded
   *     relationship to closure; where the platform's ceiling stopped it, it says so, with how much
   *     was reachable and not searched. A row from before the ceiling — one that ran under the hop
   *     budgets a firm once set — reads under those, because that is what it did.
   *   - "THE ROW DOES NOT SAY" IS ITS OWN ANSWER. A check written before one of these records
   *     existed carries nothing for it, which is a different fact from a walk that completed or a
   *     comparison that ran, and it is never flattened into either.
   */
  import Badge from "@magna-carta/design-system/badge";
  import FieldLabel from "@magna-carta/design-system/field-label";
  import type { ScopeInForceRecord } from "./conflicts-api.ts";
  import {
    NAME_MATCHING_LABEL,
    SEARCH_LOCATIONS,
    locationReading,
    sourceVocabulary,
    strictnessVocabulary,
  } from "./conflicts-vocabulary.ts";

  let { scope }: { scope: ScopeInForceRecord } = $props();

  const sources = $derived(
    Object.entries(scope.sources).toSorted(([left], [right]) => left.localeCompare(right)),
  );
  const budgets = $derived(
    Object.entries(scope.traversal?.edgeClassBudgets ?? {}).toSorted(([left], [right]) =>
      left.localeCompare(right),
    ),
  );
  const toClosure = $derived(scope.traversal?.followedToClosure === true);

  function count(value: number | null): string {
    return value === null ? "Not recorded" : String(value);
  }
</script>

{#snippet fact(label: string, value: string, title?: string)}
  <div class="flex items-baseline justify-between gap-16">
    <dt class="text-text-muted">{label}</dt>
    <dd class="text-right" {title}>{value}</dd>
  </div>
{/snippet}

{#snippet notSearched(title: string)}
  <Badge variant="neutral" {title}>Not searched</Badge>
{/snippet}

<div class="flex flex-col gap-16">
  <section class="flex flex-col gap-8">
    <FieldLabel as="h3">Where It Searched</FieldLabel>
    <dl class="flex flex-col gap-4 text-sm">
      {#each SEARCH_LOCATIONS as entry (entry.location)}
        {@const reading = locationReading(entry, scope.sources)}
        <div class="flex items-baseline justify-between gap-16">
          <dt class="text-text-muted">{entry.label}</dt>
          <dd>
            {#if reading === "searched"}
              <span>Searched</span>
            {:else if reading === "not-searched"}
              {@render notSearched(
                "This place could not be searched. It is reported rather than omitted, so it can never read as searched and empty.",
              )}
            {:else}
              <span
                class="text-text-muted"
                title="This check predates the record of this place. That is not the same as saying it was searched."
              >
                The row does not say
              </span>
            {/if}
          </dd>
        </div>
      {/each}
    </dl>
    <dl class="flex flex-col gap-4 border-t border-border-default pt-8 text-sm">
      {#each sources as [source, availability] (source)}
        {@const word = sourceVocabulary(source)}
        <div class="flex items-baseline justify-between gap-16">
          <dt class="text-text-muted" title={word.meaning}>{word.label}</dt>
          <dd>
            {#if availability === "searched"}
              <span>Searched</span>
            {:else}
              {@render notSearched(
                "This source could not run. It is reported rather than omitted, so it can never read as searched and empty.",
              )}
            {/if}
          </dd>
        </div>
      {/each}
    </dl>
  </section>

  <section class="flex flex-col gap-8 border-t border-border-default pt-12">
    <FieldLabel as="h3">How It Compared</FieldLabel>
    <dl class="flex flex-col gap-4 text-sm">
      {@render fact(
        NAME_MATCHING_LABEL,
        strictnessVocabulary(scope.strictness).label,
        strictnessVocabulary(scope.strictness).meaning,
      )}
      {@render fact(
        "Raised To The Firm's Floor",
        scope.floorRaised ? "Yes" : "No",
        scope.floorRaised
          ? "The requested scope fell below the firm's floor and was raised to it before the search ran."
          : undefined,
      )}
      {#if scope.matching === null}
        {@render fact(
          "Channels Compared",
          "The row does not say",
          "This check predates the record of which channels ran. That is not the same as saying it compared what today's code compares.",
        )}
      {:else}
        {@render fact("Name Keys", scope.matching.nameKeys.join(", ") || "None recorded")}
        {@render fact(
          "Phonetic Encoders",
          scope.matching.phoneticSchemes.join(", ") || "None recorded",
        )}
        {@render fact(
          "Name Roles",
          scope.matching.nameRoles === null
            ? "Every role the corpus holds"
            : scope.matching.nameRoles.join(", "),
          scope.matching.nameRoles === null
            ? "A distinct statement from a list that happens to name them all: a role the firm adds later is covered by this and not by that."
            : undefined,
        )}
      {/if}
    </dl>
  </section>

  <section class="flex flex-col gap-8 border-t border-border-default pt-12">
    <FieldLabel as="h3">How Far It Walked</FieldLabel>
    <dl class="flex flex-col gap-4 text-sm">
      {#if scope.traversal === null}
        {@render fact("Traversal Budget", `${String(scope.depth)} hops (widest class)`)}
        {@render fact(
          "Traversal",
          "The row does not say",
          "This check predates the record of the walk. That is a different fact from a walk that completed.",
        )}
      {:else}
        {#if toClosure}
          {@render fact(
            "Relationships",
            "Every recorded relationship, followed to closure",
            "The walk followed every relationship out from the subject parties as far as each chain goes. There was no hop budget to set.",
          )}
          {@render fact(
            "Longest Chain Followed",
            scope.traversal.longestPathLength === null
              ? "Not recorded"
              : `${String(scope.traversal.longestPathLength)} ${scope.traversal.longestPathLength === 1 ? "relationship" : "relationships"}`,
          )}
        {:else}
          <!-- A row from before the walk went to closure ran under the firm's hop budgets of the
               day, and reads under them: that is what it did. -->
          {@render fact("Traversal Budget", `${String(scope.depth)} hops (widest class)`)}
          {#each budgets as [edgeClass, budget] (edgeClass)}
            {@render fact(edgeClass, `${String(budget)} ${budget === 1 ? "hop" : "hops"}`)}
          {/each}
        {/if}
        {@render fact(
          toClosure ? "The Platform's Ceiling" : "Closure Cap",
          count(scope.traversal.closureCap),
          toClosure
            ? "The most entities one walk may reach. It is the platform's own bound, not a setting, and a walk that reaches it says so here."
            : undefined,
        )}
        {#if scope.traversal.truncated}
          <div class="flex items-baseline justify-between gap-16">
            <dt class="text-text-muted">Traversal</dt>
            <dd>
              <Badge
                variant="warning"
                title="The walk stopped at its bound. This search of the graph is incomplete, and the counts below say by how much."
              >
                Truncated
              </Badge>
            </dd>
          </div>
          {@render fact("Entities Reached", count(scope.traversal.entitiesReached))}
          {@render fact("Reachable And Not Searched", count(scope.traversal.unexploredFrontierSize))}
          {@render fact("Matched But Not Expanded", count(scope.traversal.unexpandedReachedCount))}
        {:else}
          {@render fact("Traversal", toClosure ? "Completed" : "Completed within its cap")}
        {/if}
      {/if}
    </dl>
  </section>

  <section class="flex flex-col gap-8 border-t border-border-default pt-12">
    <FieldLabel as="h3">How Much It Recorded</FieldLabel>
    <dl class="flex flex-col gap-4 text-sm">
      {#if scope.candidates === null}
        {@render fact(
          "Record Bound",
          "The row does not say",
          "This check predates the record of the bound on what one run may write.",
        )}
      {:else}
        {@render fact(
          "Record Bound",
          count(scope.candidates.candidateCap),
          "The most candidates one record can carry. It is the platform's own bound, not a setting.",
        )}
        {#if scope.candidates.truncated}
          <div class="flex items-baseline justify-between gap-16">
            <dt class="text-text-muted">Candidate Set</dt>
            <dd>
              <Badge
                variant="warning"
                title="The bound refused candidates the channels had already surfaced. The strongest evidence was kept, and a co-party surfacing is never refused."
              >
                Truncated
              </Badge>
            </dd>
          </div>
          {@render fact("Surfaced", count(scope.candidates.candidatesSurfaced))}
          {@render fact("Recorded", count(scope.candidates.candidatesWritten))}
          {@render fact(
            "Refused",
            scope.candidates.candidatesRefused === null
              ? "Not recorded"
              : `${String(scope.candidates.candidatesRefused)} (${scope.candidates.refusedByTier
                  .map((entry) => `tier ${String(entry.tier)}: ${String(entry.count)}`)
                  .join(", ")})`,
          )}
        {:else}
          {@render fact("Candidate Set", "Everything the channels surfaced was recorded")}
        {/if}
      {/if}
    </dl>
  </section>
</div>
