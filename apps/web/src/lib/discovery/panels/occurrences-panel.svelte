<script lang="ts">
  /*
   * Every other copy of this document the review set holds, and which Custodian of Record held each.
   *
   * THIS IS THE READ BEHIND A QUESTION ASKED UNDER OATH. Deduplication decides which copy a reviewer
   * opens; it never decides who held one. A suppressed copy keeps its own row, stays in the corpus,
   * and stays reachable from here — because "which custodians had this document" is a question a
   * firm answers to a court, and a platform that collapsed the answer into one copy would have
   * destroyed it.
   */
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import {
    listOccurrences,
    listRecordCustodians,
    type RecordCustodian,
    type ReviewDocumentOccurrence,
  } from "../discovery-api.ts";

  let { reviewSetId, documentId }: { reviewSetId: string; documentId: string } = $props();

  let occurrences = $state<readonly ReviewDocumentOccurrence[] | null>(null);
  let custodians = $state<readonly RecordCustodian[]>([]);
  let failure = $state<StatedFailure | null>(null);
  let showing = $state<string | null>(null);

  const names = $derived(new Map(custodians.map((one) => [one.id, one.displayName])));

  $effect(() => {
    const asked = documentId;
    if (showing === asked) return;
    showing = asked;
    occurrences = null;
    failure = null;
    void (async () => {
      const [copies, roster] = await Promise.all([
        listOccurrences(fetch, reviewSetId, asked),
        listRecordCustodians(fetch, reviewSetId),
      ]);
      // The roster failing leaves the copies readable, and only their names go quiet — the count is
      // the part that matters here, and it is still true.
      custodians = roster.kind === "ok" ? roster.value.data : [];
      if (copies.kind === "ok") occurrences = copies.value.data;
      else failure = stated(copies.failure, "The other copies could not be read.");
    })();
  });
</script>

{#if failure !== null}
  <FailureNotice
    failure={failure.failure}
    title="The Other Copies Could Not Be Read"
    fallback={failure.fallback}
  />
{:else if occurrences !== null}
  {#if occurrences.length === 0}
    <p class="text-text-muted text-sm">
      No other copy of this document is in this review set.
    </p>
  {:else}
    <ul class="flex flex-col gap-8">
      {#each occurrences as copy (copy.id)}
        <li class="flex flex-col gap-4">
          <span class="text-sm">{names.get(copy.recordCustodianId) ?? "Not named here"}</span>
          <span class="text-text-muted text-sm">
            Arrived {new Date(copy.createdAt).toLocaleDateString()}
          </span>
        </li>
      {/each}
    </ul>
  {/if}
{/if}
