<script lang="ts">
  /*
   * What this document is, and the record of how it got that way.
   *
   * THE DIGESTS ARE HERE BECAUSE THIS IS WHERE THEY ARE ASKED FOR. "How do we know this is the
   * document you were given" is answered by a hash recorded at ingest, and a reviewer challenged on
   * it should not have to leave the document to find one.
   *
   * THE EXTRACTION ROUTE IS SHOWN FOR THE SAME REASON. Which engine read a document, and how many of
   * its pages had to be recognized rather than read, is the difference between text a court can rely
   * on and text somebody should look at again.
   */
  import Badge from "@magna-carta/design-system/badge";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import { readReviewDocument, type ReviewDocumentDetail } from "../discovery-api.ts";
  import { formatInstantDate } from "@magna-carta/design-system/formatters";
  import {
    exceptionCodeEntry,
    indexStateEntry,
    processingStateEntry,
  } from "../discovery-vocabulary.ts";

  let { reviewSetId, documentId }: { reviewSetId: string; documentId: string } = $props();

  let document = $state<ReviewDocumentDetail | null>(null);
  let failure = $state<StatedFailure | null>(null);
  let showing = $state<string | null>(null);

  $effect(() => {
    const asked = documentId;
    if (showing === asked) return;
    showing = asked;
    document = null;
    failure = null;
    void (async () => {
      const outcome = await readReviewDocument(fetch, reviewSetId, asked);
      if (outcome.kind === "ok") document = outcome.value;
      else failure = stated(outcome.failure, "This document could not be read.");
    })();
  });

  function bytes(size: number | null): string {
    if (size === null) return "—";
    if (size < 1024) return `${size} B`;
    if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  }

  const rows = $derived.by(() => {
    const one = document;
    if (one === null) return [];
    return [
      { label: "Name", value: one.sourceName ?? "Unnamed" },
      { label: "Path", value: one.sourcePath ?? "—" },
      { label: "Format", value: one.formatIdentified ?? "—" },
      { label: "Size", value: bytes(one.sizeBytes) },
      { label: "Pages", value: one.pageCount === null ? "—" : String(one.pageCount) },
      {
        // The date is the document's OWN where one could be derived, and where it came from matters
        // as much as the value: a production routinely gives no date at all, and a document dated by
        // the day it was copied is not dated by anything about the document.
        label: "Date",
        value:
          one.sortDate === null
            ? "No date"
            : `${formatInstantDate(one.sortDate)}${
                one.sortDateSource === null ? "" : ` (${one.sortDateSource})`
              }`,
      },
      { label: "Read by", value: one.extractionRoute ?? "—" },
      {
        label: "Pages recognized",
        value: one.pagesRecognized === null ? "—" : String(one.pagesRecognized),
      },
      { label: "SHA-256", value: one.contentSha256 ?? "—" },
      { label: "SHA-1", value: one.contentSha1 ?? "—" },
      { label: "MD5", value: one.contentMd5 ?? "—" },
    ];
  });
</script>

{#if failure !== null}
  <FailureNotice
    failure={failure.failure}
    title="This Document Could Not Be Read"
    fallback={failure.fallback}
  />
{:else if document !== null}
  {@const processing = processingStateEntry(document.processingState)}
  {@const index = indexStateEntry(document.indexState)}
  <div class="flex flex-col gap-16">
    <div class="flex flex-wrap items-center gap-8">
      <Badge variant={processing.tone} title={processing.meaning}>{processing.label}</Badge>
      <Badge variant={index.tone} title={index.meaning}>{index.label}</Badge>
      {#if !document.isDedupPrimary}
        <!-- A suppressed copy is still in the corpus and still reachable: deduplication decides
             which copy a reviewer opens and never who held one. -->
        <Badge variant="neutral" title="Another copy of this document is the one review opens.">
          Duplicate
        </Badge>
      {/if}
    </div>

    {#if document.exceptions.length > 0}
      <div class="flex flex-col gap-8">
        <h3 class="text-sm font-semibold">Why it could not be read</h3>
        <ul class="flex flex-col gap-8">
          {#each document.exceptions as exception (exception.id)}
            {@const entry = exceptionCodeEntry(exception.code)}
            <li class="flex flex-col gap-4">
              <div class="flex items-center gap-8">
                <Badge variant={entry.tone}>{entry.label}</Badge>
                <span class="text-text-muted text-sm">at {exception.stage}</span>
              </div>
              <p class="text-text-muted text-sm">{exception.detail ?? entry.meaning}</p>
            </li>
          {/each}
        </ul>
      </div>
    {/if}

    <dl class="flex flex-col gap-8">
      {#each rows as row (row.label)}
        <div class="flex gap-8">
          <dt class="text-text-muted w-96 shrink-0 text-sm">{row.label}</dt>
          <dd class="min-w-0 flex-1 break-all text-sm">{row.value}</dd>
        </div>
      {/each}
    </dl>
  </div>
{/if}
