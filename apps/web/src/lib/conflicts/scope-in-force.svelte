<script lang="ts">
  /*
   * The scope a check actually ran under, read back off its own row.
   *
   * A reader must never have to know what the code did with the word "balanced" on the day a check
   * ran. A preset is a word whose meaning moves as channels are added, so the row names the channels
   * too — which name keys were compared, which encoders ran, which name roles were in scope — and
   * this states them.
   *
   * THREE FACTS HERE ARE LOAD-BEARING AND ARE NEVER SOFTENED.
   *
   *   - A SOURCE THAT COULD NOT RUN IS NOT A SOURCE THAT FOUND NOTHING. Every registered source is
   *     listed, including the ones with no corpus behind them, and each says which it was.
   *   - A TRUNCATED TRAVERSAL IS NEVER SHOWN AS A COMPLETED ONE. Where the walk stopped at its cap,
   *     it says so, with how much was reachable and not searched.
   *   - "THE ROW DOES NOT SAY" IS ITS OWN ANSWER. A check written before one of these records
   *     existed carries nothing for it, which is a different fact from a walk that completed or a
   *     comparison that ran, and it is never flattened into either.
   */
  import Badge from "@magna-carta/design-system/badge";
  import type { ScopeInForceRecord } from "./conflicts-api.ts";
  import { sourceVocabulary, strictnessVocabulary } from "./conflicts-vocabulary.ts";

  let { scope }: { scope: ScopeInForceRecord } = $props();

  const sources = $derived(
    Object.entries(scope.sources).toSorted(([left], [right]) => left.localeCompare(right)),
  );
  const budgets = $derived(
    Object.entries(scope.traversal?.edgeClassBudgets ?? {}).toSorted(([left], [right]) =>
      left.localeCompare(right),
    ),
  );
</script>

{#snippet fact(label: string, value: string, title?: string)}
  <div class="flex items-baseline justify-between gap-16">
    <dt class="text-text-muted">{label}</dt>
    <dd class="text-right" {title}>{value}</dd>
  </div>
{/snippet}

<div class="flex flex-col gap-16">
  <section class="flex flex-col gap-8">
    <h3 class="text-xs text-text-subtle uppercase">Sources</h3>
    <dl class="flex flex-col gap-4 text-sm">
      {#each sources as [source, availability] (source)}
        {@const word = sourceVocabulary(source)}
        <div class="flex items-baseline justify-between gap-16">
          <dt class="text-text-muted" title={word.meaning}>{word.label}</dt>
          <dd>
            {#if availability === "searched"}
              <span>Searched</span>
            {:else}
              <Badge
                variant="neutral"
                title="This source could not run. It is reported rather than omitted, so it can never read as searched and empty."
              >
                Not searched
              </Badge>
            {/if}
          </dd>
        </div>
      {/each}
    </dl>
  </section>

  <section class="flex flex-col gap-8 border-t border-border-default pt-12">
    <h3 class="text-xs text-text-subtle uppercase">How It Compared</h3>
    <dl class="flex flex-col gap-4 text-sm">
      {@render fact(
        "Strictness",
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
        {@render fact(
          "Name Keys",
          scope.matching.nameKeys.join(", ") || "None recorded",
        )}
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
    <h3 class="text-xs text-text-subtle uppercase">How Far It Walked</h3>
    <dl class="flex flex-col gap-4 text-sm">
      {@render fact("Traversal Budget", `${String(scope.depth)} hops (widest class)`)}
      {#each budgets as [edgeClass, budget] (edgeClass)}
        {@render fact(edgeClass, `${String(budget)} ${budget === 1 ? "hop" : "hops"}`)}
      {/each}
      {#if scope.traversal === null}
        {@render fact(
          "Traversal",
          "The row does not say",
          "This check predates the record of the walk. That is a different fact from a walk that completed.",
        )}
      {:else}
        {@render fact("Closure Cap", scope.traversal.closureCap === null ? "Not recorded" : String(scope.traversal.closureCap))}
        {#if scope.traversal.truncated}
          <div class="flex items-baseline justify-between gap-16">
            <dt class="text-text-muted">Traversal</dt>
            <dd>
              <Badge
                variant="warning"
                title="The walk stopped at its cap. This search of the graph is incomplete, and the counts below say by how much."
              >
                Truncated
              </Badge>
            </dd>
          </div>
          {@render fact(
            "Entities Reached",
            scope.traversal.entitiesReached === null
              ? "Not recorded"
              : String(scope.traversal.entitiesReached),
          )}
          {@render fact(
            "Reachable And Not Searched",
            scope.traversal.unexploredFrontierSize === null
              ? "Not recorded"
              : String(scope.traversal.unexploredFrontierSize),
          )}
          {@render fact(
            "Matched But Not Expanded",
            scope.traversal.unexpandedReachedCount === null
              ? "Not recorded"
              : String(scope.traversal.unexpandedReachedCount),
          )}
        {:else}
          {@render fact("Traversal", "Completed within its cap")}
        {/if}
      {/if}
    </dl>
  </section>

  <section class="flex flex-col gap-8 border-t border-border-default pt-12">
    <h3 class="text-xs text-text-subtle uppercase">How Much It Recorded</h3>
    <dl class="flex flex-col gap-4 text-sm">
      {#if scope.candidates === null}
        {@render fact(
          "Candidate Bound",
          "The row does not say",
          "This check predates the record of the candidate bound.",
        )}
      {:else}
        {@render fact(
          "Candidate Cap",
          scope.candidates.candidateCap === null ? "Not recorded" : String(scope.candidates.candidateCap),
        )}
        {#if scope.candidates.truncated}
          <div class="flex items-baseline justify-between gap-16">
            <dt class="text-text-muted">Candidate Set</dt>
            <dd>
              <Badge
                variant="warning"
                title="The cap refused candidates the channels had already surfaced. The strongest evidence was kept, and a co-party surfacing is never refused."
              >
                Truncated
              </Badge>
            </dd>
          </div>
          {@render fact(
            "Surfaced",
            scope.candidates.candidatesSurfaced === null
              ? "Not recorded"
              : String(scope.candidates.candidatesSurfaced),
          )}
          {@render fact(
            "Recorded",
            scope.candidates.candidatesWritten === null
              ? "Not recorded"
              : String(scope.candidates.candidatesWritten),
          )}
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
