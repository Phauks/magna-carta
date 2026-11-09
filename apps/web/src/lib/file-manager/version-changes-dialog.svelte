<script lang="ts">
  /*
   * WHO CHANGED WHAT, IN ONE VERSION. The panel opens from a Version History row and lists every
   * change mark that version's document recorded, grouped by the part of the document it sits in
   * and the paragraph within it, each line naming its author and showing the words so the kind
   * reads at a glance: an insertion underlined in the success hue, a deletion struck through in the
   * danger hue, a formatting change as the words with a Reformatted mark. The colour is by KIND,
   * because the words are what the author changed; the author is named on every line.
   *
   * A READING PANEL, the product's one shell for a thing shown and nothing asked. It reads on
   * opening and again on Retry; a version whose marks resolve to nothing says so rather than
   * standing empty, and a failed read is stated as one.
   *
   * The author on a line is the member's name today where the author is still here, and the name
   * the document holds otherwise — a departed member keeps the name they wrote under, never a blank.
   */
  import ActionDialog from "@magna-carta/design-system/action-dialog";
  import type { RecordSubject } from "@magna-carta/design-system/record-reference";
  import Badge from "@magna-carta/design-system/badge";
  import EmptyState from "@magna-carta/design-system/empty-state";
  import FieldLabel from "@magna-carta/design-system/field-label";
  import LoadingRegion from "@magna-carta/design-system/loading-region";
  import { formatInstant } from "@magna-carta/design-system/formatters";
  import { SAMPLE_SENTENCE, samplePerson } from "@magna-carta/design-system/loading-fixtures";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import type { Failure } from "$lib/api/problem.ts";
  import type { MatterFileVersion } from "./matter-file-api.ts";
  import { readVersionChanges, type VersionChange } from "./version-changes-api.ts";
  import {
    changeAuthorText,
    changeTextSegments,
    groupChangesByPart,
    saveKindText,
    type VersionChangePart,
  } from "./version-history.ts";

  let {
    open = $bindable(false),
    fileId,
    version,
  }: {
    open?: boolean;
    fileId: string;
    /** The version whose changes are shown; null while nothing has been chosen. */
    version: MatterFileVersion | null;
  } = $props();

  /** "Version 12 · Saved 24 Sep 2026, 10:14": the record, and the one fact that dates it. */
  const subject = $derived.by((): RecordSubject => {
    if (version === null) return {};
    const kind = saveKindText(version.saveKind);
    const when = version.committedAt === null ? kind : `${kind} ${formatInstant(version.committedAt)}`;
    return { reference: { kind: "Version", number: String(version.versionNumber) }, facts: [when] };
  });

  let changes = $state<readonly VersionChange[] | null>(null);
  let loading = $state(false);
  let readFailure = $state<Failure | null>(null);
  // Bumped by Retry so the read effect asks again for the same version.
  let readToken = $state(0);

  /*
   * The read starts when the panel opens on a version and is thrown away when the panel closes or
   * the version changes under it, so an answer for one version is never shown as another's.
   */
  $effect(() => {
    const versionId = open && version !== null ? version.id : null;
    void readToken;
    changes = null;
    readFailure = null;
    if (versionId === null) {
      loading = false;
      return;
    }
    let cancelled = false;
    loading = true;
    void (async () => {
      const outcome = await readVersionChanges(fetch, fileId, versionId);
      if (cancelled) return;
      changes = outcome.kind === "ok" ? outcome.value : null;
      readFailure = outcome.kind === "ok" ? null : outcome.failure;
      loading = false;
    })();
    return () => {
      cancelled = true;
    };
  });

  const parts = $derived(groupChangesByPart(changes ?? []));

  /*
   * The shape the list takes while the marks are read: two authors over sample words, in the same
   * markup the real list uses, so the bones are the list's own.
   */
  const CHANGES_FIXTURE: readonly VersionChange[] = [
    {
      sequence: 0,
      kind: "insertion",
      authorName: samplePerson(0).name,
      authorUserId: null,
      authorCurrentName: null,
      changedAt: null,
      text: SAMPLE_SENTENCE,
      textTruncated: false,
      part: "word/document.xml",
      paragraphIndex: 0,
    },
    {
      sequence: 1,
      kind: "deletion",
      authorName: samplePerson(1).name,
      authorUserId: null,
      authorCurrentName: null,
      changedAt: null,
      text: SAMPLE_SENTENCE,
      textTruncated: false,
      part: "word/document.xml",
      paragraphIndex: 0,
    },
    {
      sequence: 2,
      kind: "formatting",
      authorName: samplePerson(0).name,
      authorUserId: null,
      authorCurrentName: null,
      changedAt: null,
      text: SAMPLE_SENTENCE,
      textTruncated: false,
      part: "word/document.xml",
      paragraphIndex: 1,
    },
  ];
  const FIXTURE_PARTS: readonly VersionChangePart[] = groupChangesByPart(CHANGES_FIXTURE);
</script>

<!-- One change on one line: who, then the words in the kind's own treatment. The words are
     underlined or struck in the status hue rather than tinted, so the ink stays the page's own and
     the mark is the kind. Each run of words carries its own mark, because a decoration set on a
     parent reaches every word inside it and the named paragraph break must stay plain. -->
{#snippet changeLine(change: VersionChange)}
  <li class="flex flex-col gap-4 text-sm sm:flex-row sm:items-baseline sm:gap-12">
    <span
      class="shrink-0 text-text-muted sm:w-3xs sm:truncate"
      title={change.changedAt === null ? undefined : formatInstant(change.changedAt)}
    >
      {changeAuthorText(change)}
    </span>
    <span class="min-w-0 flex-1">
      {#if change.kind === "insertion"}
        {@render changeWords(change, "underline decoration-status-success-subtle-foreground")}
      {:else if change.kind === "deletion"}
        {@render changeWords(change, "line-through decoration-status-danger-subtle-foreground")}
      {:else}
        {@render changeWords(change, "")}
        <Badge variant="neutral" class="ms-8 align-middle">Reformatted</Badge>
      {/if}
    </span>
  </li>
{/snippet}

<!-- The words themselves, each run in the kind's mark: a paragraph break is named in muted text,
     and words the server cut end in an ellipsis with a note that says so. -->
{#snippet changeWords(change: VersionChange, wordClass: string)}
  {#each changeTextSegments(change.text) as segment, index (index)}
    {#if segment.kind === "words"}
      <span class={wordClass}>{segment.text}</span>
    {:else}
      <span class="text-text-muted">paragraph break</span>
    {/if}
  {/each}
  {#if change.textTruncated}
    <span class={wordClass}>…</span>
    <span class="text-text-muted">(cut)</span>
  {/if}
{/snippet}

<!-- The grouped list: a heading per part only where the document has changes in more than one,
     and the paragraph's own number over each run of changes within it. -->
{#snippet changeGroups(groups: readonly VersionChangePart[])}
  <div class="flex flex-col gap-16">
    {#each groups as part (part.part)}
      <section class="flex flex-col gap-8">
        {#if groups.length > 1}
          <FieldLabel as="h3">{part.label}</FieldLabel>
        {/if}
        {#each part.paragraphs as paragraph (paragraph.paragraphIndex)}
          <div class="flex flex-col gap-4">
            <span class="text-xs text-text-subtle tabular-nums">
              Paragraph {paragraph.paragraphIndex + 1}
            </span>
            <ol class="flex flex-col gap-4">
              {#each paragraph.changes as change (change.sequence)}
                {@render changeLine(change)}
              {/each}
            </ol>
          </div>
        {/each}
      </section>
    {/each}
  </div>
{/snippet}

<ActionDialog kind="reading" bind:open heading="Changes" subtitle={subject} width="wide">
  {#snippet fields()}
    <LoadingRegion
      {loading}
      failed={readFailure !== null}
      empty={changes !== null && changes.length === 0}
      label="Reading who changed what in this version"
      onRetry={() => (readToken += 1)}
    >
      {#snippet failure()}
        {#if readFailure !== null}
          <FailureNotice
            failure={readFailure}
            subject="This version's changes"
            onRetry={() => (readToken += 1)}
          />
        {/if}
      {/snippet}
      {#snippet fixture()}
        {@render changeGroups(FIXTURE_PARTS)}
      {/snippet}
      {#snippet emptyState()}
        <EmptyState title="No changes recorded for this version.">
          The document carries no change marks for it, or none have been read yet.
        </EmptyState>
      {/snippet}
      {@render changeGroups(parts)}
    </LoadingRegion>
  {/snippet}
</ActionDialog>
