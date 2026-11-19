<script lang="ts">
  /*
   * The middle region — the document itself, shown by whichever rendition applies.
   *
   * THE TEXT COMES THROUGH THE DISCOVERY ROUTES, gated by the review set's own access list rather
   * than by the file permissions the native bytes are behind. That is the point of serving it here
   * at all: a reviewer brought in for one production is on the access list and may hold no file
   * permission, and the extracted text is exactly what they need to code a document. The native file
   * stays behind its own gate — reachable for the readers who have it, never the only way in.
   *
   * IT IS RENDERED AS TEXT AND NEVER AS MARKUP. These are bytes an opposing party produced, read out
   * of an untrusted document; the response carries a sandbox policy and nosniff, and this pane puts
   * them in a text node. Nothing here interpolates them into HTML, and nothing should.
   */
  import Badge from "@magna-carta/design-system/badge";
  import { MaturityBadge, soonDependencySentence } from "@magna-carta/design-system/maturity";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { requestLine, type Failure } from "$lib/api/request.ts";
  import {
    readReviewDocument,
    reviewDocumentTextUrl,
    type ReviewDocumentDetail,
  } from "./discovery-api.ts";
  import { renditionFor, SOON_RENDITIONS } from "./renditions.ts";

  let { reviewSetId, documentId }: { reviewSetId: string; documentId: string } = $props();

  let document = $state<ReviewDocumentDetail | null>(null);
  let text = $state<string | null>(null);
  let failure = $state<Failure | null>(null);
  let showing = $state<string | null>(null);

  const rendition = $derived(document === null ? null : renditionFor(document));

  $effect(() => {
    const asked = documentId;
    if (showing === asked) return;
    showing = asked;
    document = null;
    text = null;
    failure = null;
    void (async () => {
      const outcome = await readReviewDocument(fetch, reviewSetId, asked);
      if (outcome.kind !== "ok") {
        failure = outcome.failure;
        return;
      }
      document = outcome.value;
      if (!outcome.value.hasExtractedText) return;
      const path = reviewDocumentTextUrl(reviewSetId, asked);
      try {
        const response = await fetch(path, { headers: { accept: "text/plain" } });
        // A document that is gone is not an error worth a banner: a closed review set releases its
        // derived text and keeps every record, so the pane says what it has rather than what broke.
        text = response.ok ? await response.text() : null;
      } catch {
        failure = { problem: null, request: requestLine("GET", path), failedAt: new Date() };
      }
    })();
  });
</script>

<div class="flex min-h-0 flex-1 flex-col gap-8">
  {#if failure !== null}
    <FailureNotice
      failure={failure}
      title="This Document Could Not Be Shown"
      fallback="Couldn't load the document."
    />
  {:else if document !== null && rendition !== null}
    <div class="flex flex-wrap items-baseline gap-8 border-b border-border-strong pb-8">
      <h2 class="min-w-0 flex-1 truncate font-semibold">
        {document.sourceName ?? "Unnamed"}
      </h2>
      <Badge variant="neutral">{rendition.label}</Badge>
    </div>
    <p class="text-text-muted text-sm">{rendition.explains}</p>

    {#if rendition.kind === "extracted-text"}
      {#if text === null}
        <p class="text-text-muted text-sm">Reading the text.</p>
      {:else}
        <!-- Pre-wrapped, monospaced and scrolled inside its own region: extracted text keeps the
             line breaks the engine found, and a document that is one long line must not push the
             page sideways. -->
        <pre
          class="mc-scrollbar min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words rounded border border-border p-16 font-mono text-sm">{text}</pre>
      {/if}
    {:else if rendition.kind === "unreadable" && document.exceptions.length === 0}
      <p class="text-text-muted text-sm">
        No reason is recorded against it beyond the one above.
      </p>
    {/if}

    <!-- The ways of showing a document that are designed and not built. Named rather than absent, so
         a reviewer can see that the original and its pages are coming rather than wondering whether
         the platform can show them at all. -->
    <ul class="flex flex-col gap-4 border-t border-border pt-8">
      {#each SOON_RENDITIONS as soon (soon.id)}
        <li class="flex flex-wrap items-center gap-8">
          <span class="text-sm font-medium">{soon.label}</span>
          <MaturityBadge stage="soon" />
          <span class="text-text-muted text-sm">
            {soon.shows}
            {soonDependencySentence(soon.waitsOn)}
          </span>
        </li>
      {/each}
    </ul>
  {/if}
</div>
