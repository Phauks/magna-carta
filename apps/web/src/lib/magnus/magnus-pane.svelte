<script lang="ts">
  /*
   * The pane beside an open conversation: Context, Permissions and Artifacts (the owner's board,
   * rulings R2.15 to R2.17 in docs/conventions/magnus-rulings.md).
   *
   * CONTEXT is what this conversation carries: the files attached to it, the documents Magnus wrote
   * in it, and, when that permission is on, a line saying the reader's other conversations on the
   * matter are read too.
   *
   * PERMISSIONS says what Magnus may read, per conversation. Only what is built is offered: the
   * attached files of This Matter, which is what attaching already means, and the author's own other
   * conversations on the same matter, off until turned on. Firm records, the client's other matters,
   * research services and the firm library are not shown as switches, because a switch that changes
   * nothing would tell a member Magnus can read something it cannot (the decision record
   * docs/decisions/pending/what-magnus-reads-widens-one-disclosure-at-a-time.md).
   *
   * ARTIFACTS lists the documents Magnus wrote; opening one shows it with its versions
   * (artifact-view.svelte).
   */
  import { failureToast } from "$lib/diagnostics/failure-toast.ts";
  import * as SegmentedControl from "@magna-carta/design-system/segmented-control";
  import Download from "@lucide/svelte/icons/download";
  import Eye from "@lucide/svelte/icons/eye";
  import FileText from "@lucide/svelte/icons/file-text";
  import Paperclip from "@lucide/svelte/icons/paperclip";
  import X from "@lucide/svelte/icons/x";
  import Button from "@magna-carta/design-system/button";
  import FieldLabel from "@magna-carta/design-system/field-label";
  import { formatInstant } from "@magna-carta/design-system/formatters";
  import Switch from "@magna-carta/design-system/switch";
  import { toast } from "@magna-carta/design-system/toast";
  import * as Tooltip from "@magna-carta/design-system/tooltip";
  import ArtifactView from "./artifact-view.svelte";
  import { artifactFileName, latestVersion, versionOrigin } from "./artifact-text.ts";
  import { readArtifactVersion } from "./magnus-api.ts";
  import { saveToTarget } from "$lib/export/save-target.ts";
  import type { ConversationSession } from "./conversation-session.svelte.ts";
  import { attachmentName, attachmentStatusSentence } from "./magnus-vocabulary.ts";

  export type PaneTab = "context" | "permissions" | "artifacts";

  let {
    session,
    fetchImpl,
    tab = $bindable("context"),
    openDocument = $bindable(null),
    memberName,
    readerIsAuthor,
    matterLine,
    attachRefusal,
    detachingFileId,
    onAttach,
    onDetach,
    onClose,
  }: {
    session: ConversationSession;
    fetchImpl: typeof fetch;
    tab?: PaneTab;
    /** The document open in the pane, and the version on screen; null shows the tabs. */
    openDocument?: { artifactId: string; versionNumber: number } | null;
    /** Who asks in the conversation. */
    memberName: string;
    /** True when the reader started the conversation, so may change it. */
    readerIsAuthor: boolean;
    /** The matter the conversation is kept on, as its number and name; null when on none. */
    matterLine: string | null;
    /** Why a file cannot be attached now, if it cannot. */
    attachRefusal?: string;
    detachingFileId: string | null;
    onAttach: () => void;
    onDetach: (fileId: string) => void;
    onClose: () => void;
  } = $props();

  let changingPermission = $state(false);
  let downloadingId = $state<string | null>(null);

  const PANE_TABS: readonly { value: PaneTab; label: string }[] = [
    { value: "context", label: "Context" },
    { value: "permissions", label: "Permissions" },
    { value: "artifacts", label: "Artifacts" },
  ];

  /* Download from the card saves the newest version as Markdown, the way the document reads. */
  async function downloadLatest(
    artifactId: string,
    title: string,
    versionNumber: number,
  ): Promise<void> {
    const conversationId = session.conversationId;
    if (conversationId === null) return;
    downloadingId = artifactId;
    const outcome = await readArtifactVersion(fetchImpl, conversationId, artifactId, versionNumber);
    downloadingId = null;
    if (outcome.kind !== "ok") {
      failureToast(
        outcome.failure,
        "Couldn't load the document, so nothing was downloaded. Try again.",
      );
      return;
    }
    const name = artifactFileName(title, versionNumber, "md");
    const where = await saveToTarget(outcome.value.content, name, "text/markdown");
    toast.success(where === "folder" ? `Saved ${name} to your folder.` : `Downloaded ${name}.`);
  }

  const earlierOn = $derived(session.permissions.includes("own-matter-conversations"));
  const openArtifact = $derived(
    openDocument === null
      ? undefined
      : session.artifacts.find((artifact) => artifact.id === openDocument?.artifactId),
  );

  async function setEarlier(granted: boolean): Promise<void> {
    changingPermission = true;
    const outcome = await session.setPermission("own-matter-conversations", granted);
    changingPermission = false;
    if (outcome !== null && outcome.kind !== "ok") {
      failureToast(outcome.failure, "Nothing changed.");
    }
  }

  async function restore(versionNumber: number): Promise<boolean> {
    if (openDocument === null) return false;
    const outcome = await session.restoreVersion(openDocument.artifactId, versionNumber);
    if (outcome === null || outcome.kind !== "ok") {
      if (outcome === null) toast.error("The version wasn't restored. Nothing changed.");
      else failureToast(outcome.failure, "The version wasn't restored. Nothing changed.");
      return false;
    }
    return true;
  }

  function open(artifactId: string, versionNumber: number): void {
    openDocument = { artifactId, versionNumber };
  }
</script>

{#snippet closeButton()}
  <Tooltip.Root>
    <Tooltip.Trigger>
      {#snippet child({ props })}
        <Button {...props} variant="ghost" size="icon-sm" aria-label="Close the pane" onclick={onClose}>
          <X class="size-16" aria-hidden="true" />
        </Button>
      {/snippet}
    </Tooltip.Trigger>
    <Tooltip.Content side="bottom">Close</Tooltip.Content>
  </Tooltip.Root>
{/snippet}

{#snippet documentCards()}
  <ul class="flex flex-col gap-8" aria-label="Documents Magnus wrote">
    {#each session.artifacts as artifact (artifact.id)}
      {@const latest = latestVersion(artifact)}
      <li class="flex flex-col rounded-md border border-border-default bg-surface-raised hover:border-border-strong">
        <button
          type="button"
          class="flex w-full items-start gap-8 rounded-t-md px-12 pt-8 pb-4 text-start"
          aria-label="View {artifact.title}"
          onclick={() => open(artifact.id, latest?.versionNumber ?? 1)}
        >
          <FileText class="mt-2 size-16 shrink-0 text-text-muted" aria-hidden="true" />
          <span class="flex min-w-0 flex-1 flex-col gap-2">
            <span class="truncate text-sm font-semibold">{artifact.title}</span>
            <span class="truncate text-xs text-text-muted">
              Document &middot; {artifact.versions.length}
              {artifact.versions.length === 1 ? "version" : "versions"}
            </span>
            <span class="truncate text-xs text-text-muted">Only in this conversation</span>
            {#if latest !== undefined}
              <span class="truncate text-xs text-text-subtle">
                Last changed by {versionOrigin(latest, memberName)} &middot; {formatInstant(
                  latest.createdAt,
                )}
              </span>
            {/if}
          </span>
        </button>
        <div class="flex gap-2 ps-32 pe-8 pb-8">
          <Button variant="ghost" size="sm" onclick={() => open(artifact.id, latest?.versionNumber ?? 1)}>
            <Eye class="size-16" aria-hidden="true" />
            View
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={latest === undefined || downloadingId === artifact.id}
            onclick={() => void downloadLatest(artifact.id, artifact.title, latest?.versionNumber ?? 1)}
          >
            <Download class="size-16" aria-hidden="true" />
            Download
          </Button>
        </div>
      </li>
    {/each}
  </ul>
{/snippet}

{#snippet tabList()}
  <!-- The three sections as the shared segmented control, the same one the rail's orders use. The
       pane is the sunken surface, the same tint as the control's track, so the track is raised here
       to stay visible. -->
  <SegmentedControl.Root
    class="flex-1 bg-surface-raised"
    value={tab}
    onValueChange={(next) => (tab = next as PaneTab)}
    aria-label="Pane sections"
  >
    {#each PANE_TABS as entry (entry.value)}
      <SegmentedControl.Item value={entry.value}>{entry.label}</SegmentedControl.Item>
    {/each}
  </SegmentedControl.Root>
{/snippet}

<aside
  aria-label="Context, permissions and artifacts"
  class="absolute inset-0 flex min-h-0 flex-col border-border-default bg-surface-sunken @3xl:static @3xl:w-xs @3xl:shrink-0 @3xl:border-s @5xl:data-[document=true]:w-md"
  data-document={openArtifact !== undefined}
>
  {#if openArtifact !== undefined && openDocument !== null}
    <ArtifactView
      artifact={openArtifact}
      conversationId={session.conversationId ?? ""}
      bind:versionNumber={
        () => openDocument?.versionNumber ?? 1,
        (versionNumber) => {
          if (openDocument !== null) openDocument = { ...openDocument, versionNumber };
        }
      }
      {memberName}
      canRestore={readerIsAuthor}
      {fetchImpl}
      onBack={() => {
        openDocument = null;
        tab = "artifacts";
      }}
      onRestore={restore}
    />
  {:else}
    <div class="flex items-center gap-8 px-12 pt-12 pb-8">
      {@render tabList()}
      {@render closeButton()}
    </div>

    <div
      role="region"
      aria-label={PANE_TABS.find((entry) => entry.value === tab)?.label}
      class="flex min-h-0 flex-1 flex-col gap-16 mc-scrollbar overflow-y-auto px-16 pt-4 pb-16"
    >
      {#if tab === "context"}
        <section class="flex flex-col gap-8" aria-labelledby="pane-attached">
          <div class="flex items-center justify-between gap-8">
            <FieldLabel as="h3" id="pane-attached">Attached Files</FieldLabel>
            <Tooltip.Root>
              <Tooltip.Trigger>
                {#snippet child({ props })}
                  <Button
                    {...props}
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Attach files"
                    disabled={attachRefusal !== undefined || !readerIsAuthor}
                    onclick={onAttach}
                  >
                    <Paperclip class="size-16" aria-hidden="true" />
                  </Button>
                {/snippet}
              </Tooltip.Trigger>
              <Tooltip.Content side="bottom">{attachRefusal ?? "Attach Files"}</Tooltip.Content>
            </Tooltip.Root>
          </div>
          {#if session.attachments.length === 0}
            <p class="text-sm text-text-muted">None attached.</p>
          {:else}
            <ul class="flex flex-col gap-8">
              {#each session.attachments as attachment (attachment.fileId)}
                <li
                  class="flex flex-col rounded-md border border-border-default bg-surface-raised hover:border-border-strong"
                >
                  <div class="flex items-start gap-8 px-12 pt-8 pb-4">
                    <FileText class="mt-2 size-16 shrink-0 text-text-muted" aria-hidden="true" />
                    <span class="flex min-w-0 flex-1 flex-col gap-2">
                      <span class="truncate text-sm font-semibold">{attachmentName(attachment)}</span>
                      <span class="text-xs text-text-muted">{attachmentStatusSentence(attachment)}</span>
                      <span class="truncate text-xs text-text-subtle">
                        Attached {formatInstant(attachment.attachedAt)}
                      </span>
                    </span>
                  </div>
                  {#if readerIsAuthor}
                    <div class="flex gap-2 ps-32 pe-8 pb-8">
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={detachingFileId === attachment.fileId}
                        onclick={() => onDetach(attachment.fileId)}
                        aria-label="Take {attachmentName(attachment)} off this conversation"
                      >
                        <X class="size-16" aria-hidden="true" />
                        Remove
                      </Button>
                    </div>
                  {/if}
                </li>
              {/each}
            </ul>
          {/if}
        </section>

        <section class="flex flex-col gap-8" aria-labelledby="pane-documents">
          <FieldLabel as="h3" id="pane-documents">Documents Magnus Wrote</FieldLabel>
          {#if session.artifacts.length === 0}
            <p class="text-sm text-text-muted">None yet.</p>
          {:else}
            {@render documentCards()}
          {/if}
        </section>

        {#if earlierOn}
          <section class="flex flex-col gap-4" aria-labelledby="pane-other">
            <FieldLabel as="h3" id="pane-other">Other Conversations</FieldLabel>
            <p class="text-sm">
              Magnus also reads the latest messages of up to five of {readerIsAuthor
                ? "your"
                : `${memberName}'s`} other conversations on this matter.
            </p>
          </section>
        {/if}
      {:else if tab === "permissions"}
        <section class="flex flex-col" aria-labelledby="pane-this-matter">
          <div class="flex items-baseline justify-between gap-8 pb-4">
            <FieldLabel as="h3" id="pane-this-matter">This Matter</FieldLabel>
            <span class="truncate text-xs text-text-muted">
              {matterLine ?? "Not on a matter"}
            </span>
          </div>
          <div class="flex items-start justify-between gap-12 border-b border-border-default py-8">
            <span class="flex min-w-0 flex-col gap-2">
              <span class="text-sm font-medium">Attached Files</span>
              <span class="text-xs text-text-muted">
                Always on. Magnus reads only the files attached to this conversation.
              </span>
            </span>
          </div>
          <div class="flex items-start justify-between gap-12 border-b border-border-default py-8">
            <span class="flex min-w-0 flex-col gap-2">
              <span id="pane-earlier-label" class="text-sm font-medium">
                {readerIsAuthor ? "Your" : `${memberName}'s`} Other Conversations on This Matter
              </span>
              <span class="text-xs text-text-muted">
                {#if matterLine === null}
                  Move this conversation to a matter to turn this on.
                {:else}
                  Off unless you turn it on. When on, Magnus reads the latest messages of up to five of
                  {readerIsAuthor ? "your" : `${memberName}'s`} most recent other conversations on
                  this matter. Never another staff member's.
                {/if}
              </span>
            </span>
            <Switch
              aria-labelledby="pane-earlier-label"
              checked={earlierOn}
              disabled={matterLine === null || !readerIsAuthor || changingPermission}
              onCheckedChange={(checked) => void setEarlier(checked)}
            />
          </div>
        </section>
        <p class="text-xs text-text-muted">
          Firm records, the client's other matters, research services and the firm library aren't read. Each shows here, off, once Magnus can search it.
        </p>
      {:else}
        {#if session.artifacts.length === 0}
          <p class="text-sm text-text-muted">
            None yet. Ask Magnus to draft a letter, a table or a timeline and it opens here.
          </p>
        {:else}
          {@render documentCards()}
        {/if}
      {/if}
    </div>
  {/if}
</aside>
