<script lang="ts">
  /*
   * What arrived with this document.
   *
   * A family is a message and its attachments, or an archive and its entries — material that came in
   * together and is usually read together, because an attachment away from the message it arrived on
   * is a document without the thing that explains it. Every document belongs to a family even when
   * it is alone in one, so this panel always has an answer.
   *
   * It is the SAME LIST READ the corpus is paged by, narrowed to one family. Written as its own read
   * it would drift from the list it is a view of, and the drift would be silent.
   */
  import Badge from "@magna-carta/design-system/badge";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import {
    listReviewDocuments,
    readReviewDocument,
    type ReviewDocument,
  } from "../discovery-api.ts";
  import { processingStateEntry } from "../discovery-vocabulary.ts";

  let { reviewSetId, documentId }: { reviewSetId: string; documentId: string } = $props();

  let members = $state<readonly ReviewDocument[] | null>(null);
  let failure = $state<StatedFailure | null>(null);
  let showing = $state<string | null>(null);

  const ROLE_WORDS: Readonly<Record<string, string>> = {
    standalone: "Standalone",
    parent: "The message",
    attachment: "Attachment",
    "container-child": "Inside the archive",
  };

  $effect(() => {
    const asked = documentId;
    if (showing === asked) return;
    showing = asked;
    members = null;
    failure = null;
    void (async () => {
      // Two reads rather than one: the family is named on the document, and the family's members are
      // the list read narrowed to it. Asking the list for a family id this document does not have
      // would answer confidently about the wrong family.
      const one = await readReviewDocument(fetch, reviewSetId, asked);
      if (one.kind !== "ok") {
        failure = stated(one.failure, "This document's family could not be read.");
        return;
      }
      const page = await listReviewDocuments(fetch, reviewSetId, { familyId: one.value.familyId });
      if (page.kind === "ok") members = page.value.data;
      else failure = stated(page.failure, "This document's family could not be read.");
    })();
  });
</script>

{#if failure !== null}
  <FailureNotice
    failure={failure.failure}
    title="The Family Could Not Be Read"
    fallback={failure.fallback}
  />
{:else if members !== null}
  {#if members.length <= 1}
    <p class="text-text-muted text-sm">
      This document arrived on its own, with no related documents.
    </p>
  {:else}
    <ul class="flex flex-col gap-8">
      {#each members as member (member.id)}
        {@const state = processingStateEntry(member.processingState)}
        <li class="flex flex-col gap-4">
          <div class="flex items-center gap-8">
            <a
              class="min-w-0 flex-1 truncate underline underline-offset-2"
              href={`/discovery/review-sets/${reviewSetId}/documents/${member.id}`}
              aria-current={member.id === documentId ? "page" : undefined}
            >
              {member.sourceName ?? "Unnamed"}
            </a>
            <Badge variant={state.tone} title={state.meaning}>{state.label}</Badge>
          </div>
          <span class="text-text-muted text-sm">
            {ROLE_WORDS[member.familyRole] ?? member.familyRole}
          </span>
        </li>
      {/each}
    </ul>
  {/if}
{/if}
